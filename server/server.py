import os
from typing import Optional

import fastapi
import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, APIRouter
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.security import OAuth2AuthorizationCodeBearer
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt
from jose.exceptions import JWTError
from pydantic import BaseModel
from dotenv import load_dotenv
from bossypaints.tasks import InMemoryTaskQueueStore, Task

# Load environment variables from .env file
load_dotenv()

app = fastapi.FastAPI()

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
    "/app",
    StaticFiles(directory=os.path.join("webbuild"), html=True),
    name="static",
)

STATIC_DIR = os.path.join("webbuild")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

task_store = InMemoryTaskQueueStore()  # or JSONFileTaskQueueStore("tasks.json")
task_store.put(
    Task(
        collection="Witvliet2020",
        experiment="Dataset_1",
        channel="em",
        resolution=3,
        x_min=1256,
        x_max=1768,
        y_min=1256,
        y_max=1768,
        z_min=0,
        z_max=32,
        priority=0,
    )
)

api_router = APIRouter()


@api_router.get("/hello")
async def hello(current_user: dict = Depends(get_current_user)):
    username = current_user.get("preferred_username", "user")
    return {"message": f"Hello, {username}!"}


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


@api_router.post("/tasks/{task_id}/checkpoint")
async def checkpoint_task(task_id: int, checkpoint: dict):
    print(f"Checkpoint for task {task_id}: {checkpoint}")
    return {"message": "Checkpoint received"}


app.include_router(api_router, prefix="/api")


@app.get("/login")
async def login():
    return RedirectResponse(
        url=f"{KEYCLOAK_URL}/protocol/openid-connect/auth?client_id={KEYCLOAK_CLIENT_ID}&response_type=code&scope=openid&redirect_uri=http://localhost:8000/callback"
    )


@app.get("/callback")
async def callback(request: Request, code: str):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{KEYCLOAK_URL}/protocol/openid-connect/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": "http://localhost:8000/callback",
                "client_id": KEYCLOAK_CLIENT_ID,
                "client_secret": KEYCLOAK_CLIENT_SECRET,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        response.raise_for_status()
        token_data = response.json()
        response = RedirectResponse(url="/app")
        response.set_cookie(
            key="access_token", value=token_data["access_token"], httponly=True
        )
        return response


# Fallback for all other routes: serve SvelteKit's index.html
@app.exception_handler(404)
async def custom_404_handler(request: Request, exc):
    # Serve the index.html file for unknown routes
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
