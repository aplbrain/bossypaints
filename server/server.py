import os
from typing import Optional

import fastapi
import httpx
from fastapi import FastAPI, Request, Response, APIRouter
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from bossypaints.renderer import (
    ImageStackVolumePolygonRenderer,
    BossDBInternVolumePolygonRenderer,
)
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
# task_store.put(
#     Task(
#         collection="Witvliet2020",
#         experiment="Dataset_1",
#         channel="em",
#         resolution=3,
#         x_min=1256,
#         x_max=1768,
#         y_min=1256,
#         y_max=1768,
#         z_min=0,
#         z_max=32,
#         priority=0,
#         destination_collection="Matelsky2024",
#         destination_experiment="Witvliet_1",
#         destination_channel="seg",
#     )
# )

checkpoint_store = JSONCheckpointStore("checkpoints.json")

api_router = APIRouter()


@api_router.get("/tasks")
async def get_tasks():
    tasks = task_store.list()
    return {"tasks": tasks}


@api_router.get("/tasks/next")
async def get_next_task():
    tasks = task_store.list()
    if tasks:
        return {"task": tasks[0]}
    else:
        return {"task": None}


@api_router.post("/tasks/{task_id}/save")
async def save_task(task_id: TaskID, checkpoint: dict):
    checkpoint_obj = Checkpoint(taskID=task_id, polygons=checkpoint["checkpoint"])
    checkpoint_store.save_checkpoint(checkpoint_obj)
    # Render this volume:
    task = task_store.get(task_id)
    ImageStackVolumePolygonRenderer(
        fmt="tif", directory="./exports/"
    ).render_from_checkpoints(task, checkpoint_store.get_checkpoints_for_task(task_id))
    # BossDBInternVolumePolygonRenderer().render_from_checkpoints(
    #     task, checkpoint_store.get_checkpoints_for_task(task_id)
    # )


@api_router.post("/tasks/{task_id}/checkpoint")
async def checkpoint_task(task_id: TaskID, checkpoint: dict):
    checkpoint_obj = Checkpoint(taskID=task_id, polygons=checkpoint["checkpoint"])
    checkpoint_store.save_checkpoint(checkpoint_obj)
    return {"message": "Checkpoint received"}


@api_router.get("/tasks/{task_id}/checkpoints")
async def get_task_checkpoints(task_id: TaskID):
    checkpoints = checkpoint_store.get_checkpoints_for_task(task_id)
    return {"checkpoints": checkpoints}


@api_router.get("/tasks/{task_id}")
async def get_task_by_id(task_id: TaskID):
    task = task_store.get(task_id)
    if task:
        return {"task": task}
    else:
        return {"task": None}


@api_router.get("/bossdb/username")
async def get_bossdb_username(request: Request):
    # TODO: This is a really janky way to get the username.
    token = request.headers.get("Authorization", "").split(" ")[1]
    async with httpx.AsyncClient() as client:
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
    collection: str
    experiment: str
    channel: str
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


@api_router.post("/tasks/create")
async def create_task(
    request: Request, response: Response, new_task: CreateTaskRequest
):
    # Check if the collection exists and the user has access to it
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

        # Create the task
        task = Task(
            collection=new_task.collection,
            experiment=new_task.experiment,
            channel=new_task.channel,
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
        )

        # Create or confirm access to the destination collection, experiment, and channel
        if (
            task.destination_collection
            and task.destination_experiment
            and task.destination_channel
        ):
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
                # First, need to get the coordframe from the source experiment
                exp_data = await client.get(
                    f"https://api.bossdb.io/v1/collection/{task.collection}/experiment/{task.experiment}",
                    headers={
                        "Authorization": request.headers["Authorization"],
                        "Accept": "application/json",
                    },
                )
                exp_data = exp_data.json()
                print(exp_data)
                create_exp_resp = await client.post(
                    f"https://api.bossdb.io/v1/collection/{task.destination_collection}/experiment/{task.destination_experiment}",
                    headers={
                        "Authorization": request.headers["Authorization"],
                        "Accept": "application/json",
                    },
                    json={
                        "description": f"Created by user with BossyPaints. Imagery source is {task.collection}/{task.experiment}/{task.channel}",
                        "coord_frame": exp_data["coord_frame"],
                        "num_hierarchy_levels": exp_data["num_hierarchy_levels"],
                        "hierarchy_method": exp_data["hierarchy_method"],
                        "num_time_samples": exp_data["num_time_samples"],
                    },
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
                chan_creation_resp = await client.post(
                    f"https://api.bossdb.io/v1/collection/{task.destination_collection}/experiment/{task.destination_experiment}/channel/{task.destination_channel}",
                    headers={
                        "Authorization": request.headers["Authorization"],
                        "Accept": "application/json",
                    },
                    json={
                        "description": f"Created by user with BossyPaints. Imagery source is {task.collection}/{task.experiment}/{task.channel}",
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

        task_id = task_store.put(task)
        return {"task": task, "task_id": task_id}




app.include_router(api_router, prefix="/api")
