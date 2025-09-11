from typing import Optional, Literal

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
from pydantic import BaseModel, validator
from dotenv import load_dotenv

from bossypaints.background import render_and_mesh
from bossypaints.tasks import JSONFileTaskQueueStore, Task, TaskID
from bossypaints.checkpoints import Checkpoint, JSONCheckpointStore

# Load environment variables from .env file
load_dotenv()

app = fastapi.FastAPI()


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

task_store = JSONFileTaskQueueStore("tasks.json")

checkpoint_store = JSONCheckpointStore("checkpoints.json")

api_router = APIRouter()


async def get_username_from_request(request: Request) -> str:
    """Extract username from BossDB token in request headers or query params."""
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


@api_router.get("/tasks")
async def get_tasks(request: Request):
    username = await get_username_from_request(request)
    tasks = task_store.list_for_user(username)
    return {"tasks": tasks}


@api_router.get("/tasks/next")
async def get_next_task(request: Request):
    username = await get_username_from_request(request)
    tasks = task_store.list_for_user(username)
    if tasks:
        # Sort by priority (higher priority first) and return the first one
        tasks.sort(key=lambda t: t.priority, reverse=True)
        return {"task": tasks[0]}
    else:
        return {"task": None}

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

    checkpoint_obj = Checkpoint(taskID=task_id, polygons=checkpoint["checkpoint"])
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

    checkpoint_obj = Checkpoint(taskID=task_id, polygons=checkpoint["checkpoint"])
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
    )

    # Create or confirm access to the destination collection, experiment, and channel
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




class AssignTaskRequest(BaseModel):
    assigned_to: str


@api_router.post("/tasks/{task_id}/assign")
async def assign_task(request: Request, task_id: TaskID, assign_request: AssignTaskRequest):
    """Assign a task to a specific user. Currently allows any authenticated user to reassign tasks."""
    username = await get_username_from_request(request)  # Verify the requester is authenticated

    task = task_store.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Update the task assignment
    task.assigned_to = assign_request.assigned_to

    # Save the updated task back to the store
    tasks = task_store._load_latest_from_file()
    tasks[task_id] = task
    task_store._write_to_file(tasks)

    return {"message": f"Task {task_id} assigned to {assign_request.assigned_to}"}


@api_router.get("/tasks/unassigned")
async def get_unassigned_tasks(request: Request):
    """Get all tasks that are not assigned to any user."""
    username = await get_username_from_request(request)  # Verify the requester is authenticated

    tasks = task_store.list()
    unassigned_tasks = [task for task in tasks if task.assigned_to is None]
    return {"tasks": unassigned_tasks}


# ----------------------------
# Export endpoints
# ----------------------------

EXPORTS_DIR = Path("exports")

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
        return {"exports": {"meshes": [], "segments": []}}

    exports = {"meshes": [], "segments": []}

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
        vol = CloudVolume(cv_uri, mip=res, progress=False, cache=False)
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