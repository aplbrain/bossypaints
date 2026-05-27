from typing import Any, Optional, Literal

import fastapi
import httpx
import imageio.v2 as imageio
from fastapi import FastAPI, Request, Response, APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
import io
import os
import zipfile
import tempfile
from pathlib import Path
import numpy as np
from cloudvolume import CloudVolume
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from dotenv import load_dotenv

from bossypaints.background import render_and_mesh
from bossypaints.tasks import SQLiteTaskQueueStore, Task, TaskID
from bossypaints.checkpoints import Checkpoint, SQLiteCheckpointStore, Polygon
from bossypaints.propagation import CropBox, PropagationContext, propagate_segment
from bossypaints.splitting import SplitContext, SplitSeed, split_segment

# Load environment variables from .env file
load_dotenv()

# Public base URL for generated links (can be set from compose as BOSSYPAINTS_API_URL)
PUBLIC_BASE_URL = os.getenv('BOSSYPAINTS_API_URL')

app = fastapi.FastAPI()


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Use a service-local `db/` directory for persistence so the backend and
# its mounted host directory align. The directory lives inside `server/`.
DB_DIR = Path(__file__).resolve().parent / "db"
DB_DIR.mkdir(parents=True, exist_ok=True)

# Initialize stores against files inside server/db/
task_store = SQLiteTaskQueueStore(str(DB_DIR / "tasks.db"))

checkpoint_store = SQLiteCheckpointStore(str(DB_DIR / "checkpoints.db"))

api_router = APIRouter()


async def get_username_from_request(request: Request) -> str:
    """Extract username from BossDB token in request headers or query params."""
    token = get_token_from_request(request)

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                "https://api.bossdb.io/v1/groups/",
                headers={
                    "Authorization": f"Token {token}",
                    "Accept": "application/json",
                },
            )
            response.raise_for_status()
            data = response.json()
            username = [grp for grp in data["groups"] if grp.endswith("-primary")][0].split(
                "-primary"
            )[0]
            return username
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Invalid authorization token: {str(e)}")


def get_token_from_request(request: Request) -> str:
    """Extract an auth token from the request headers or query params."""
    token = None

    # Try to get token from Authorization header first
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Token "):
        token = auth_header.split(" ")[1]

    # If no token in header, try query parameter (for file downloads)
    if not token:
        token = request.query_params.get("token")

    if not token:
        raise HTTPException(status_code=401, detail="Authorization token required")
    return token


@api_router.get("/tasks")
async def get_tasks(request: Request):
    username = await get_username_from_request(request)
    tasks = task_store.list_for_user_active(username)  # Only return non-archived tasks
    return {"tasks": tasks}


@api_router.get("/tasks/archived")
async def get_archived_tasks(request: Request):
    username = await get_username_from_request(request)
    tasks = task_store.list_for_user_archived(username)
    return {"tasks": tasks}


@api_router.get("/tasks/next")
async def get_next_task(request: Request):
    username = await get_username_from_request(request)
    tasks = task_store.list_for_user_active(username)  # Only consider non-archived tasks
    if tasks:
        # Sort by priority (higher priority first) and return the first one
        tasks.sort(key=lambda t: t.priority, reverse=True)
        return {"task": tasks[0]}
    else:
        return {"task": None}


@api_router.post("/tasks/{task_id}/archive")
async def archive_task(request: Request, task_id: TaskID):
    username = await get_username_from_request(request)
    task = task_store.get(task_id)

    # Verify user owns this task
    if not task or task.assigned_to != username:
        raise HTTPException(status_code=404, detail="Task not found or not assigned to you")

    # Archive the task
    task_store.update_archived(task_id, True)
    return {"message": "Task archived successfully"}


@api_router.post("/tasks/{task_id}/unarchive")
async def unarchive_task(request: Request, task_id: TaskID):
    username = await get_username_from_request(request)
    task = task_store.get(task_id)

    # Verify user owns this task
    if not task or task.assigned_to != username:
        raise HTTPException(status_code=404, detail="Task not found or not assigned to you")

    # Unarchive the task
    task_store.update_archived(task_id, False)
    return {"message": "Task unarchived successfully"}

@api_router.post("/tasks/{task_id}/save")
async def save_task(request: Request, task_id: TaskID, checkpoint: dict, background_tasks: BackgroundTasks):
    username = await get_username_from_request(request)
    task = task_store.get(task_id)

    # Verify user owns this task
    if not task or task.assigned_to != username:
        raise HTTPException(status_code=404, detail="Task not found or not assigned to you")

    # Check if export is already in progress
    if task.export_pending:
        raise HTTPException(status_code=409, detail="Export already in progress for this task")

    checkpoint_obj = Checkpoint(
        taskID=task_id,
        polygons=checkpoint["checkpoint"],
        mergeGroups=checkpoint.get("mergeGroups", []),
    )
    checkpoint_store.save_checkpoint(checkpoint_obj)

    # Set export pending flag to true
    task_store.update_export_pending(task_id, True)

    # Kick off a background task to render the volume
    background_tasks.add_task(render_and_mesh, task_id, task, checkpoint_store.get_checkpoints_for_task(task_id), task_store)
    return {"message": "Checkpoint received and rendering started"}



@api_router.post("/tasks/{task_id}/checkpoint")
async def checkpoint_task(request: Request, task_id: TaskID, checkpoint: dict):
    username = await get_username_from_request(request)
    task = task_store.get(task_id)

    # Verify user owns this task
    if not task or task.assigned_to != username:
        raise HTTPException(status_code=404, detail="Task not found or not assigned to you")

    checkpoint_obj = Checkpoint(
        taskID=task_id,
        polygons=checkpoint["checkpoint"],
        mergeGroups=checkpoint.get("mergeGroups", []),
    )
    checkpoint_store.save_checkpoint(checkpoint_obj)

    # Reset export pending flag since new annotations invalidate pending exports
    task_store.update_export_pending(task_id, False)

    return {"message": "Checkpoint received"}


@api_router.get("/tasks/{task_id}/checkpoints")
async def get_task_checkpoints(request: Request, task_id: TaskID):
    username = await get_username_from_request(request)
    task = task_store.get(task_id)

    # Verify user owns this task
    if not task or task.assigned_to != username:
        raise HTTPException(status_code=404, detail="Task not found or not assigned to you")

    checkpoints = checkpoint_store.get_checkpoints_for_task(task_id)
    return {"checkpoints": checkpoints}


@api_router.get("/tasks/{task_id}")
async def get_task_by_id(request: Request, task_id: TaskID):
    username = await get_username_from_request(request)
    task = task_store.get(task_id)

    # Verify user owns this task
    if not task or task.assigned_to != username:
        raise HTTPException(status_code=404, detail="Task not found or not assigned to you")

    return {"task": task}


class PropagateSegmentRequest(BaseModel):
    method: str = "random_walker"
    source_z: int
    target_z: int
    segment_id: int
    source_polygons: list[Polygon]
    options: dict[str, Any] = Field(default_factory=dict)


class SplitSeedRequest(BaseModel):
    x: float
    y: float
    z: int
    label: Literal["red", "blue"]


class SplitSegmentRequest(BaseModel):
    method: str = "linear"
    segment_id: int
    new_segment_id: int
    source_polygons: list[Polygon]
    seeds: list[SplitSeedRequest]
    options: dict[str, Any] = Field(default_factory=dict)


def _load_cloudvolume_task_slice(task: Task, z: int, crop_box: CropBox) -> np.ndarray:
    if not task.cloudvolume_uri:
        raise ValueError("CloudVolume task is missing a source URI.")

    volume = CloudVolume(
        task.cloudvolume_uri,
        mip=task.resolution,
        progress=False,
        cache=False,
        use_https=True,
    )
    block = np.asarray(volume[crop_box.x0:crop_box.x1, crop_box.y0:crop_box.y1, z : z + 1])
    if block.ndim == 4:
        block = block[..., 0]
    if block.ndim != 3 or block.shape[2] == 0:
        raise ValueError("CloudVolume source did not return a single slice cutout.")
    return block[:, :, 0].T.astype(np.float32, copy=False)


def _load_bossdb_task_slice(
    task: Task,
    token: str,
    z: int,
    crop_box: CropBox,
) -> np.ndarray:
    if not task.collection or not task.experiment or not task.channel:
        raise ValueError("BossDB task is missing collection, experiment, or channel metadata.")

    cutout_url = (
        f"https://api.bossdb.io/v1/cutout/"
        f"{task.collection}/{task.experiment}/{task.channel}/{task.resolution}/"
        f"{crop_box.x0}:{crop_box.x1}/{crop_box.y0}:{crop_box.y1}/{z}:{z + 1}/"
    )
    with httpx.Client(timeout=60.0) as client:
        response = client.get(
            cutout_url,
            headers={
                "Authorization": f"Token {token}",
                "Accept": "image/png",
            },
        )
        response.raise_for_status()

    image = imageio.imread(io.BytesIO(response.content))
    if image.ndim == 3:
        image = image[..., 0]
    if image.ndim != 2:
        raise ValueError("BossDB cutout did not decode into a single grayscale slice.")
    return np.asarray(image, dtype=np.float32)


def _load_task_slice(
    task: Task,
    token: str,
    z: int,
    crop_box: CropBox,
) -> np.ndarray:
    if z < task.z_min or z >= task.z_max:
        raise ValueError(f"Slice z={z} is outside task bounds [{task.z_min}, {task.z_max}).")

    if task.data_source_type == "cloudvolume":
        return _load_cloudvolume_task_slice(task, z, crop_box)
    return _load_bossdb_task_slice(task, token, z, crop_box)


@api_router.post("/tasks/{task_id}/propagate-segment")
async def propagate_task_segment(
    request: Request,
    task_id: TaskID,
    propagate_request: PropagateSegmentRequest,
):
    username = await get_username_from_request(request)
    task = task_store.get(task_id)

    # Verify user owns this task
    if not task or task.assigned_to != username:
        raise HTTPException(status_code=404, detail="Task not found or not assigned to you")

    if propagate_request.source_z < task.z_min or propagate_request.source_z >= task.z_max:
        raise HTTPException(status_code=400, detail="Source slice is outside task bounds.")
    if propagate_request.target_z < task.z_min or propagate_request.target_z >= task.z_max:
        raise HTTPException(status_code=400, detail="Target slice is outside task bounds.")

    source_polygons = [
        polygon
        for polygon in propagate_request.source_polygons
        if polygon.segmentID == propagate_request.segment_id
    ]
    if not source_polygons:
        raise HTTPException(status_code=400, detail="No source polygons were provided for the active segment.")

    token = get_token_from_request(request)

    def load_slice(z: int, crop_box: CropBox) -> np.ndarray:
        return _load_task_slice(task, token, z, crop_box)

    try:
        result = propagate_segment(
            propagate_request.method,
            PropagationContext(
                task=task,
                segment_id=propagate_request.segment_id,
                source_z=propagate_request.source_z,
                target_z=propagate_request.target_z,
                source_polygons=source_polygons,
                load_slice=load_slice,
                options=propagate_request.options,
            ),
        )
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text if exc.response is not None else str(exc)
        raise HTTPException(status_code=502, detail=f"Source imagery request failed: {detail}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Propagation failed: {exc}") from exc

    return {
        "method": result.method,
        "display_name": result.display_name,
        "source_z": propagate_request.source_z,
        "target_z": propagate_request.target_z,
        "segment_id": propagate_request.segment_id,
        "polygons": result.polygons,
        "meta": result.meta,
    }


@api_router.post("/tasks/{task_id}/split-segment")
async def split_task_segment(
    request: Request,
    task_id: TaskID,
    split_request: SplitSegmentRequest,
):
    username = await get_username_from_request(request)
    task = task_store.get(task_id)

    if not task or task.assigned_to != username:
        raise HTTPException(status_code=404, detail="Task not found or not assigned to you")

    if split_request.segment_id <= 0 or split_request.new_segment_id <= 0:
        raise HTTPException(status_code=400, detail="Split segment IDs must be positive integers.")
    if split_request.segment_id == split_request.new_segment_id:
        raise HTTPException(
            status_code=400,
            detail="Split requires distinct source and new segment IDs.",
        )

    source_polygons = [
        polygon
        for polygon in split_request.source_polygons
        if polygon.segmentID == split_request.segment_id
    ]
    if not source_polygons:
        raise HTTPException(
            status_code=400,
            detail="No source polygons were provided for the selected segment.",
        )

    try:
        result = split_segment(
            split_request.method,
            SplitContext(
                task=task,
                source_segment_id=split_request.segment_id,
                new_segment_id=split_request.new_segment_id,
                source_polygons=source_polygons,
                seeds=[SplitSeed(**seed.dict()) for seed in split_request.seeds],
                options=split_request.options,
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Split failed: {exc}") from exc

    return {
        "method": result.method,
        "display_name": result.display_name,
        "segment_id": split_request.segment_id,
        "new_segment_id": split_request.new_segment_id,
        "polygons": result.polygons,
        "meta": result.meta,
    }


@api_router.get("/bossdb/username")
async def get_bossdb_username(request: Request):
    username = await get_username_from_request(request)
    return {"username": username}


@api_router.get("/bossdb/autocomplete")
async def autocomplete_bossdb_resource(request: Request, collection: str, experiment: Optional[str] = None, channel: Optional[str] = None):
    # There are three cases:
    # 1. col str    exp null    chan null   -> return all collections with prefix
    # 2. col str    exp str     chan null   -> return all experiments with prefix inside collection
    # 3. col str    exp str     chan str    -> return all channels with prefix inside experiment
    token = request.headers.get("Authorization", "").split(" ")[1]
    async with httpx.AsyncClient() as client:
        if experiment in [None, "", ] and channel in [None, "", ]:
            response = await client.get(
                f"https://api.bossdb.io/v1/collection/",
                headers={
                    "Authorization": "Token " + token,
                    "Accept": "application/json",
                },
            )
            response.raise_for_status()
            data = response.json()
            return {"resources": [res for res in data.get("collections", []) if res.lower().startswith(collection.lower())]}
        elif experiment not in [None, "", ] and channel in [None, "", ]:
            response = await client.get(
                f"https://api.bossdb.io/v1/collection/{collection}/experiment/",
                headers={
                    "Authorization": "Token " + token,
                    "Accept": "application/json",
                },
            )
            response.raise_for_status()
            data = response.json()
            return {"resources": [res for res in data.get("experiments", []) if res.lower().startswith(experiment.lower())]}
        elif experiment not in [None, "", ] and channel not in [None, "", ]:
            response = await client.get(
                f"https://api.bossdb.io/v1/collection/{collection}/experiment/{experiment}/channel/",
                headers={
                    "Authorization": "Token " + token,
                    "Accept": "application/json",
                },
            )
            response.raise_for_status()
            data = response.json()
            return {"resources": [res for res in data.get("channels", []) if res.lower().startswith(channel.lower())]}

@api_router.get("/bossdb/coord_frame/{collection}/{experiment}")
async def get_coord_frame(request: Request, collection: str, experiment: str):
    token = request.headers.get("Authorization", "").split(" ")[1]
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.bossdb.io/v1/collection/{collection}/experiment/{experiment}",
            headers={
                "Authorization": f"Token {token}",
                "Accept": "application/json",
            },
        )
        response.raise_for_status()
        data = response.json()
        coord_frame_name = data["coord_frame"]
        response = await client.get(
            f"https://api.bossdb.io/v1/coord/{coord_frame_name}",
            headers={
                "Authorization": f"Token {token}",
                "Accept": "application/json",
            },
        )
        response.raise_for_status()
        return response.json()


class CreateTaskRequest(BaseModel):
    # Data source type
    data_source_type: Literal["bossdb", "cloudvolume"] = "cloudvolume"
    # Output destination type
    output_type: Literal["bossdb", "download"] = "download"

    # Task metadata
    name: Optional[str] = None

    # BossDB fields
    collection: Optional[str] = None
    experiment: Optional[str] = None
    channel: Optional[str] = None

    # CloudVolume fields
    cloudvolume_uri: Optional[str] = None

    # Common fields
    resolution: int
    x_min: int
    x_max: int
    y_min: int
    y_max: int
    z_min: int
    z_max: int
    priority: Optional[int] = 0
    destination_collection: Optional[str] = None
    destination_experiment: Optional[str] = None
    destination_channel: Optional[str] = None

    @validator('collection', 'experiment', 'channel')
    def validate_bossdb_fields(cls, v, values):
        """Ensure BossDB fields are present when data_source_type is 'bossdb'"""
        if values.get('data_source_type') == 'bossdb' and v is None:
            raise ValueError('BossDB fields (collection, experiment, channel) are required when data_source_type is "bossdb"')
        return v

    @validator('cloudvolume_uri')
    def validate_cloudvolume_fields(cls, v, values):
        """Ensure CloudVolume URI is present when data_source_type is 'cloudvolume'"""
        if values.get('data_source_type') == 'cloudvolume' and v in [None, '']:
            raise ValueError('CloudVolume URI is required when data_source_type is "cloudvolume"')
        return v

    @validator('destination_collection', 'destination_experiment', 'destination_channel')
    def validate_destination_fields(cls, v, values):
        """Ensure destination fields are present when output_type is 'bossdb'"""
        if values.get('output_type') == 'bossdb' and v is None:
            raise ValueError('Destination fields (collection, experiment, channel) are required when output_type is "bossdb"')
        return v


@api_router.post("/tasks/create")
async def create_task(
    request: Request, response: Response, new_task: CreateTaskRequest
):
    # Get the username from the request to assign the task to this user
    username = await get_username_from_request(request)

    # Handle validation and data source access checking based on data source type
    if new_task.data_source_type == "bossdb":
        # Validate BossDB access
        async with httpx.AsyncClient() as client:
            chan_exists_resp = await client.get(
                f"https://api.bossdb.io/v1/collection/{new_task.collection}",
                headers={
                    "Authorization": request.headers["Authorization"],
                    "Accept": "application/json",
                },
            )
            if chan_exists_resp.status_code != 200:
                response.status_code = 404
                return {
                    "message": "Collection does not exist or you do not have access to it"
                }

            exp_exists_resp = await client.get(
                f"https://api.bossdb.io/v1/collection/{new_task.collection}/experiment/{new_task.experiment}",
                headers={
                    "Authorization": request.headers["Authorization"],
                    "Accept": "application/json",
                },
            )
            if exp_exists_resp.status_code != 200:
                response.status_code = 404
                return {
                    "message": "Experiment does not exist or you do not have access to it"
                }

            chan_exists_resp = await client.get(
                f"https://api.bossdb.io/v1/collection/{new_task.collection}/experiment/{new_task.experiment}/channel/{new_task.channel}",
                headers={
                    "Authorization": request.headers["Authorization"],
                    "Accept": "application/json",
                },
            )
            if chan_exists_resp.status_code != 200:
                response.status_code = 404
                return {"message": "Channel does not exist or you do not have access to it"}

    elif new_task.data_source_type == "cloudvolume":
        # For CloudVolume, we'll do basic URI validation
        # Note: More sophisticated validation could be added here to test CloudVolume access
        if not new_task.cloudvolume_uri or new_task.cloudvolume_uri.strip() == "":
            response.status_code = 400
            return {"message": "CloudVolume URI is required"}

        # Basic URI format validation
        if not (new_task.cloudvolume_uri.startswith('gs://') or
                new_task.cloudvolume_uri.startswith('s3://') or
                new_task.cloudvolume_uri.startswith('file://') or
                new_task.cloudvolume_uri.startswith('https://') or
                new_task.cloudvolume_uri.startswith('precomputed://')):
            response.status_code = 400
            return {"message": "Invalid CloudVolume URI format"}

    # Create the task
    task = Task(
        data_source_type=new_task.data_source_type,
        output_type=new_task.output_type,
        name=new_task.name,
        collection=new_task.collection,
        experiment=new_task.experiment,
        channel=new_task.channel,
        cloudvolume_uri=new_task.cloudvolume_uri,
        resolution=new_task.resolution,
        x_min=new_task.x_min,
        x_max=new_task.x_max,
        y_min=new_task.y_min,
        y_max=new_task.y_max,
        z_min=new_task.z_min,
        z_max=new_task.z_max,
        priority=new_task.priority,
        destination_collection=new_task.destination_collection,
        destination_experiment=new_task.destination_experiment,
        destination_channel=new_task.destination_channel,
        assigned_to=username,  # Assign the task to the user creating it
    )    # Create or confirm access to the destination collection, experiment, and channel
    # (This only applies to BossDB destinations for now)
    if (
        task.output_type == "bossdb"
        and task.destination_collection
        and task.destination_experiment
        and task.destination_channel
    ):
        async with httpx.AsyncClient() as client:
            print("Checking destination collection")
            dest_col_exists_resp = await client.get(
                f"https://api.bossdb.io/v1/collection/{task.destination_collection}",
                headers={
                    "Authorization": request.headers["Authorization"],
                    "Accept": "application/json",
                },
            )
            if dest_col_exists_resp.status_code == 404:
                # Create the collection
                col_creation_resp = await client.post(
                    f"https://api.bossdb.io/v1/collection/{task.destination_collection}",
                    headers={
                        "Authorization": request.headers["Authorization"],
                        "Accept": "application/json",
                    },
                    json={
                        "description": "Created by user with BossyPaints",
                    },
                )
                # check if the collection was created successfully
                if col_creation_resp.status_code != 201:
                    response.status_code = col_creation_resp.status_code
                    return {
                        "message": "Destination collection could not be created",
                        "error": col_creation_resp.json(),
                    }

            elif dest_col_exists_resp.status_code != 200:
                response.status_code = dest_col_exists_resp.status_code
                return {
                    "message": "Destination collection does not exist or you do not have access to it"
                }

            print("Checking destination experiment")

            exp_exists_resp = await client.get(
                f"https://api.bossdb.io/v1/collection/{task.destination_collection}/experiment/{task.destination_experiment}",
                headers={
                    "Authorization": request.headers["Authorization"],
                    "Accept": "application/json",
                },
            )
            if exp_exists_resp.status_code == 404:
                # Create the experiment.
                # For BossDB sources, get the coordframe from the source experiment
                if task.data_source_type == "bossdb":
                    exp_data = await client.get(
                        f"https://api.bossdb.io/v1/collection/{task.collection}/experiment/{task.experiment}",
                        headers={
                            "Authorization": request.headers["Authorization"],
                            "Accept": "application/json",
                        },
                    )
                    exp_data = exp_data.json()
                    print(exp_data)
                    source_description = f"{task.collection}/{task.experiment}/{task.channel}"
                    experiment_json = {
                        "description": f"Created by user with BossyPaints. Imagery source is {source_description}",
                        "coord_frame": exp_data["coord_frame"],
                        "num_hierarchy_levels": exp_data["num_hierarchy_levels"],
                        "hierarchy_method": exp_data["hierarchy_method"],
                        "num_time_samples": exp_data["num_time_samples"],
                    }
                else:
                    # For CloudVolume sources, use default values
                    source_description = task.cloudvolume_uri
                    experiment_json = {
                        "description": f"Created by user with BossyPaints. Imagery source is CloudVolume: {source_description}",
                        "coord_frame": "cf_default",  # You may need to adjust this
                        "num_hierarchy_levels": 7,
                        "hierarchy_method": "anisotropic",
                        "num_time_samples": 1,
                    }

                create_exp_resp = await client.post(
                    f"https://api.bossdb.io/v1/collection/{task.destination_collection}/experiment/{task.destination_experiment}",
                    headers={
                        "Authorization": request.headers["Authorization"],
                        "Accept": "application/json",
                    },
                    json=experiment_json,
                )
                # check if the experiment was created successfully
                if create_exp_resp.status_code != 201:
                    response.status_code = create_exp_resp.status_code
                    return {
                        "message": "Destination experiment could not be created",
                        "error": create_exp_resp.json(),
                    }
            elif exp_exists_resp.status_code != 200:
                response.status_code = exp_exists_resp.status_code
                return {
                    "message": "Destination experiment does not exist or you do not have access to it"
                }

            print("Checking destination channel")

            chan_exists_resp = await client.get(
                f"https://api.bossdb.io/v1/collection/{task.destination_collection}/experiment/{task.destination_experiment}/channel/{task.destination_channel}",
                headers={
                    "Authorization": request.headers["Authorization"],
                    "Accept": "application/json",
                },
            )
            if chan_exists_resp.status_code == 404:
                # Create the channel
                if task.data_source_type == "bossdb":
                    source_description = f"{task.collection}/{task.experiment}/{task.channel}"
                else:
                    source_description = f"CloudVolume: {task.cloudvolume_uri}"

                chan_creation_resp = await client.post(
                    f"https://api.bossdb.io/v1/collection/{task.destination_collection}/experiment/{task.destination_experiment}/channel/{task.destination_channel}",
                    headers={
                        "Authorization": request.headers["Authorization"],
                        "Accept": "application/json",
                    },
                    json={
                        "description": f"Created by user with BossyPaints. Imagery source is {source_description}",
                        "type": "annotation",
                        "datatype": "uint64",
                        "base_resolution": task.resolution,
                        # "related": [
                        #     f"{task.collection}/{task.experiment}/{task.channel}"
                        # ],
                    },
                )
                # check if the channel was created successfully
                if chan_creation_resp.status_code != 201:
                    response.status_code = chan_creation_resp.status_code
                    return {
                        "message": "Destination channel could not be created",
                        "error": chan_creation_resp.json(),
                    }
            elif chan_exists_resp.status_code != 200:
                response.status_code = chan_exists_resp.status_code
                return {
                    "message": "Destination channel does not exist or you do not have access to it"
                }

    # Persist and return the task for all cases (download or bossdb output)
    task_id = task_store.put(task)
    return {"task": task, "task_id": task_id}




class UpdateTaskNameRequest(BaseModel):
    name: Optional[str] = None


@api_router.post("/tasks/{task_id}/update-name")
async def update_task_name(request: Request, task_id: TaskID, update_request: UpdateTaskNameRequest):
    """Update the name of a task. Only the owner can update the task name."""
    username = await get_username_from_request(request)
    task = task_store.get(task_id)

    # Verify user owns this task
    if not task or task.assigned_to != username:
        raise HTTPException(status_code=404, detail="Task not found or not assigned to you")

    # Update the task name
    task_store.update_name(task_id, update_request.name)

    return {"message": "Task name updated successfully", "name": update_request.name}


# ----------------------------
# Export endpoints
# ----------------------------

EXPORTS_DIR = Path(__file__).resolve().parent / "exports"
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

# 1) Bulletproof explicit route with .gz fallback
@app.get("/exports/{path:path}")
async def serve_static(path: str):
    full = EXPORTS_DIR / path
    if full.is_file():
        return FileResponse(
            full,
            media_type="application/octet-stream",
            headers={
                "Cache-Control": "public, max-age=31536000",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers": "Content-Length, Content-Encoding, Accept-Ranges, ETag",
            },
        )
    gz = Path(str(full) + ".gz")
    if gz.is_file():
        return FileResponse(
            gz,
            media_type="application/octet-stream",
            headers={
                "Content-Encoding": "gzip",
                "Cache-Control": "public, max-age=31536000",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers": "Content-Length, Content-Encoding, Accept-Ranges, ETag",
            },
        )
    raise HTTPException(status_code=404, detail="Chunk not found")

@api_router.get("/tasks/{task_id}/exports")
async def list_task_exports(request: Request, task_id: TaskID):
    """List all available exports for a task."""
    username = await get_username_from_request(request)
    task = task_store.get(task_id)

    # Verify user owns this task
    if not task or task.assigned_to != username:
        raise HTTPException(status_code=404, detail=f"Task not found or not assigned to {username}")

    task_export_dir = EXPORTS_DIR / task_id
    if not task_export_dir.exists():
        return {"exports": {"meshes": [], "segments": [], "cloudvolumes": []}}

    exports = {"meshes": [], "segments": [], "cloudvolumes": []}

    try:
        for file_path in task_export_dir.iterdir():
            if file_path.is_file():
                file_info = {
                    "filename": file_path.name,
                    "size": file_path.stat().st_size,
                    "modified": file_path.stat().st_mtime
                }

                if file_path.suffix.lower() == '.obj':
                    exports["meshes"].append(file_info)
                elif file_path.suffix.lower() in ['.tif', '.tiff']:
                    exports["segments"].append(file_info)
            elif file_path.is_dir():
                # Treat directories in the export folder as potential CloudVolume exports
                # If the directory contains an 'info' file it's likely a precomputed CloudVolume
                info_file = file_path / 'info'
                if info_file.exists():
                    # Compute directory size (sum of file sizes)
                    total_size = 0
                    for root, dirs, files in os.walk(file_path):
                        for f in files:
                            try:
                                fp = os.path.join(root, f)
                                total_size += os.path.getsize(fp)
                            except Exception:
                                pass

                    # Build a served HTTP URI so Neuroglancer can access the precomputed dataset
                    # Prefer an explicit PUBLIC_BASE_URL if set (from compose env). Otherwise
                    # fall back to request.base_url.
                    if PUBLIC_BASE_URL:
                        base = PUBLIC_BASE_URL.rstrip('/')
                    else:
                        base = str(request.base_url).rstrip('/')

                    exported_path = f"/exports/{task_id}/{file_path.name}"
                    served_uri = f"{base}{exported_path}"

                    dir_info = {
                        "filename": file_path.name,
                        "size": total_size,
                        "modified": file_path.stat().st_mtime,
                        "uri": served_uri
                    }
                    exports["cloudvolumes"].append(dir_info)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing exports: {str(e)}")

    return {"exports": exports}


@api_router.get("/tasks/{task_id}/exports/download/{filename}")
async def download_export_file(request: Request, task_id: TaskID, filename: str):
    """Download a specific export file."""
    username = await get_username_from_request(request)
    task = task_store.get(task_id)

    # Verify user owns this task
    if not task or task.assigned_to != username:
        raise HTTPException(status_code=404, detail="Task not found or not assigned to you")

    task_export_dir = EXPORTS_DIR / task_id
    file_path = task_export_dir / filename

    # Security check: ensure file is within the task export directory
    try:
        file_path.resolve().relative_to(task_export_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    if not file_path.exists() or not file_path.is_file():
        # If not a file, check if it's a directory (CloudVolume export)
        dir_path = task_export_dir / filename
        if dir_path.exists() and dir_path.is_dir():
            # Create a temporary zip of the directory
            with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp_file:
                zip_path = tmp_file.name

            try:
                with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                    for root, dirs, files in os.walk(dir_path):
                        for f in files:
                            full = os.path.join(root, f)
                            arcname = os.path.relpath(full, start=dir_path)
                            zip_file.write(full, os.path.join(filename, arcname))

                return FileResponse(
                    path=zip_path,
                    filename=f"{filename}.zip",
                    media_type='application/zip',
                    background=lambda: os.unlink(zip_path)
                )
            except Exception as e:
                if os.path.exists(zip_path):
                    os.unlink(zip_path)
                raise HTTPException(status_code=500, detail=f"Error creating zip for directory: {e}")

        raise HTTPException(status_code=404, detail="Export file not found")

    return FileResponse(
        path=str(file_path),
        filename=filename,
        media_type='application/octet-stream'
    )


@api_router.get("/tasks/{task_id}/exports/download-all")
async def download_all_exports(request: Request, task_id: TaskID):
    """Download all exports for a task as a ZIP file."""
    username = await get_username_from_request(request)
    task = task_store.get(task_id)

    # Verify user owns this task
    if not task or task.assigned_to != username:
        raise HTTPException(status_code=404, detail="Task not found or not assigned to you")

    task_export_dir = EXPORTS_DIR / task_id
    if not task_export_dir.exists():
        raise HTTPException(status_code=404, detail="No exports found for this task")

    # Create a temporary ZIP file
    with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp_file:
        zip_path = tmp_file.name

    try:
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # Add all files in the export directory to the ZIP
            for file_path in task_export_dir.iterdir():
                if file_path.is_file():
                    zip_file.write(file_path, file_path.name)
                elif file_path.is_dir():
                    # Add directory contents preserving folder name
                    for root, dirs, files in os.walk(file_path):
                        for f in files:
                            full = os.path.join(root, f)
                            arcname = os.path.relpath(full, start=task_export_dir)
                            zip_file.write(full, arcname)

        # Check if ZIP file has any content
        if os.path.getsize(zip_path) == 0:
            os.unlink(zip_path)
            raise HTTPException(status_code=404, detail="No export files found")

        # Return the ZIP file
        task_id_short = task_id.split('-')[0]  # Use short task ID for filename
        zip_filename = f"task_{task_id_short}_exports.zip"

        return FileResponse(
            path=zip_path,
            filename=zip_filename,
            media_type='application/zip',
            background=lambda: os.unlink(zip_path)  # Clean up temp file after response
        )

    except Exception as e:
        # Clean up temp file if there was an error
        if os.path.exists(zip_path):
            os.unlink(zip_path)
        raise HTTPException(status_code=500, detail=f"Error creating ZIP file: {str(e)}")


# ----------------------------
# CloudVolume filmstrip endpoint
# ----------------------------

@api_router.get("/filmstrip/cloudvolume/mips")
async def filmstrip_cloudvolume_mips(uri: str):
    """Return available mip levels for a CloudVolume source."""
    try:
        vol = CloudVolume(uri, progress=False, cache=False, use_https=True)
        scales = vol.scales if hasattr(vol, "scales") else []
        mip_levels = sorted({int(index) for index, _scale in enumerate(scales)})
        if not mip_levels:
            mip_levels = [0]
        return {"mip_levels": mip_levels}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CloudVolume mip metadata error: {e}")

@api_router.get("/filmstrip/cloudvolume")
async def filmstrip_cloudvolume(
    uri: str,
    res: int,
    x: str,
    y: str,
    z: str,
):
    """
    Generate a PNG filmstrip for a CloudVolume cutout.

    Query params:
      - uri: CloudVolume URI (supports gs://, s3://, file://, https://, precomputed://)
      - res: mip level (resolution)
      - x: "xmin:xmax"
      - y: "ymin:yamx"
      - z: "zmin:zmax" (exclusive stop preferred; if inclusive, effective slices will be adjusted)
    """
    try:
        xmin, xmax = [int(v) for v in x.split(":", 1)]
        ymin, ymax = [int(v) for v in y.split(":", 1)]
        zmin, zmax = [int(v) for v in z.split(":", 1)]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid range parameters; expected 'start:stop'.")

    # Normalize ranges (ensure exclusive z-stop)
    if zmax <= zmin:
        zmax = zmin + 1
    if xmax <= xmin:
        xmax = xmin + 1
    if ymax <= ymin:
        ymax = ymin + 1

    # Strip precomputed:// wrapper if present for CloudVolume constructor;
    # CloudVolume accepts precomputed:// but also works with gs/s3/https. Preserve as-is.
    cv_uri = uri

    try:
        vol = CloudVolume(cv_uri, mip=res, progress=False, cache=False, use_https=True)
        # Fetch block: index order is [x, y, z]
        block = vol[xmin:xmax, ymin:ymax, zmin:zmax]
        # block shape: (x, y, z[, c])
        if block.ndim == 4:
            block = block[..., 0]  # take first channel
        # Convert to uint8 if necessary
        if block.dtype != np.uint8:
            block = block.astype(np.uint8)

        xlen, ylen, zlen = block.shape
        # Compose filmstrip: width=x, height=y*z, by stacking slices along vertical axis.
        film_h = ylen * zlen
        film_w = xlen
        film = np.zeros((film_h, film_w), dtype=np.uint8)

        for zi in range(zlen):
            slice_xy = block[:, :, zi].T  # (y, x)
            y0 = zi * ylen
            film[y0 : y0 + ylen, :] = slice_xy

        # Encode as PNG to bytes
        buf = io.BytesIO()
        imageio.imwrite(buf, film, format="png")
        buf.seek(0)
        return StreamingResponse(buf, media_type="image/png")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CloudVolume filmstrip error: {e}")

app.include_router(api_router, prefix="/api")
