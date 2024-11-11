import abc
import json
import os
import uuid
from typing import Optional

import fastapi
import httpx
import pydantic
from fastapi import Depends, FastAPI, HTTPException, Request, Security
from fastapi.responses import FileResponse
from fastapi.security import OAuth2AuthorizationCodeBearer
from fastapi.staticfiles import StaticFiles
from jose import jwt
from jose.exceptions import JWTError
from pydantic import BaseModel

app = fastapi.FastAPI()

TaskID = int | str


class Task(pydantic.BaseModel):
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
    priority: TaskID


class TaskInDB(Task):
    id: int


class TaskQueueStore(abc.ABC):
    """
    A base class for task queue stores.

    Must be able to take and materialize pydantic.BaseModel objects.
    """

    @abc.abstractmethod
    def put(self, task: Task) -> TaskID:
        pass

    @abc.abstractmethod
    def get(self, task_id: TaskID) -> TaskInDB:
        pass

    @abc.abstractmethod
    def delete(self, task_id: TaskID) -> None:
        pass

    @abc.abstractmethod
    def list(self) -> list[TaskInDB]:
        pass


class InMemoryTaskQueueStore(TaskQueueStore):
    def __init__(self):
        self._tasks = {}
        self._next_id = 0

    def put(self, task: Task) -> TaskID:
        task_id = self._next_id
        self._next_id += 1
        self._tasks[task_id] = TaskInDB(id=task_id, **task.dict())
        return task_id

    def get(self, task_id: TaskID) -> TaskInDB:
        return self._tasks[task_id]

    def delete(self, task_id: TaskID) -> None:
        del self._tasks[task_id]

    def list(self) -> list[TaskInDB]:
        return list(self._tasks.values())


class JSONFileTaskQueueStore(TaskQueueStore):
    def __init__(self, filename: str):
        self._filename = filename

    def new_uid(self) -> TaskID:
        return str(uuid.uuid4())

    def _load_latest_from_file(self) -> dict[TaskID, TaskInDB]:
        try:
            with open(self._filename) as f:
                json_data = json.load(f)

            return {
                task_id: TaskInDB(id=task_id, **task_data)
                for task_id, task_data in json_data.items()
            }
        except FileNotFoundError:
            return {}

    def _write_to_file(self, tasks: dict[TaskID, TaskInDB]) -> None:
        with open(self._filename, "w") as f:
            json.dump({task_id: task.dict() for task_id, task in tasks.items()}, f)

    def put(self, task: Task) -> TaskID:
        tasks = self._load_latest_from_file()
        task_id = self.new_uid()
        tasks[task_id] = TaskInDB(id=task_id, **task.dict())
        self._write_to_file(tasks)
        return task_id

    def get(self, task_id: TaskID) -> TaskInDB:
        tasks = self._load_latest_from_file()
        return tasks[task_id]

    def delete(self, task_id: TaskID) -> None:
        tasks = self._load_latest_from_file()
        del tasks[task_id]
        self._write_to_file(tasks)

    def list(self) -> list[TaskInDB]:
        tasks = self._load_latest_from_file()
        return list(tasks.values())


# Set up environment variables
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID")
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET")  # Optional

# OAuth2 setup
oauth2_scheme = OAuth2AuthorizationCodeBearer(
    authorizationUrl=f"{KEYCLOAK_URL}/protocol/openid-connect/auth",
    tokenUrl=f"{KEYCLOAK_URL}/protocol/openid-connect/token",
)


# Keycloak public key retrieval (for verifying JWT)
async def get_keycloak_public_key():
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{KEYCLOAK_URL}/protocol/openid-connect/certs")
        response.raise_for_status()
        jwks = response.json()
    return jwks


# Dependency for getting and verifying the token
async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        jwks = await get_keycloak_public_key()
        unverified_header = jwt.get_unverified_header(token)
        rsa_key = {}
        for key in jwks["keys"]:
            if key["kid"] == unverified_header["kid"]:
                rsa_key = {
                    "kty": key["kty"],
                    "kid": key["kid"],
                    "use": key["use"],
                    "n": key["n"],
                    "e": key["e"],
                }
        if rsa_key:
            payload = jwt.decode(
                token, rsa_key, algorithms=["RS256"], audience=KEYCLOAK_CLIENT_ID
            )
            return payload
        else:
            raise credentials_exception
    except JWTError:
        raise credentials_exception


class User(BaseModel):
    sub: str
    preferred_username: Optional[str] = None
    email: Optional[str] = None
    roles: Optional[list] = []


def get_user_from_token(token_payload: dict) -> User:
    return User(
        sub=token_payload.get("sub"),
        preferred_username=token_payload.get("preferred_username"),
        email=token_payload.get("email"),
        roles=token_payload.get("realm_access", {}).get("roles", []),
    )


app = FastAPI()

# Serve the SvelteKit static files
app.mount(
    "/",
    StaticFiles(directory=os.path.join("webbuild"), html=True),
    name="static",
)

STATIC_DIR = os.path.join("webbuild")


@app.get("/secure-endpoint")
async def secure_endpoint(current_user: User = Depends(get_current_user)):
    return {"message": f"Hello, {current_user.preferred_username}"}


# MVP GET endpt to test keycloak integration
@app.get("/test-noauth")
async def test_noauth():
    return {"message": "hello public world!"}


@app.get("/hello")
async def hello(current_user: dict = Depends(get_current_user)):
    username = current_user.get("preferred_username", "user")
    return {"message": f"Hello, {username}!"}


# Fallback for all other routes: serve SvelteKit's index.html
@app.exception_handler(404)
async def custom_404_handler(request: Request, exc):
    # Serve the index.html file for unknown routes
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
