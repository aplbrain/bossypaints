# bossypaints server

This is the backend for the bossypaints project. This FastAPI-based API server handles BossDB auth and data relaying, the creation and storage of tasks and results, and the management of the paint queue (Tasks).

## Installation & Running

```bash
# Install uv if you don't already have it:
curl -LsSf https://astral.sh/uv/install.sh | sh

# Enter this directory (cd server)
uv run uvicorn server:app --reload
```

If you ONLY want to install the dependencies, you can run the following:

```bash
uv sync
```
