# Using a debian slim image instead of alpine makes it easier to install
# dependencies that adhere to PEP 518.
FROM ghcr.io/astral-sh/uv:0.5.8-debian-slim

# Build deps:
# Install required build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy only the dependency files first
COPY pyproject.toml uv.lock .python-version  /app/

# Sync dependencies using uv
RUN uv sync

# Copy the rest of the application code
COPY . /app

# Make port 8000 available to the world outside this container
EXPOSE 8000

# Define environment variable
ENV UVICORN_CMD="uvicorn server:app --host 0.0.0.0 --port 8000"

# Run uvicorn server when the container launches
CMD uv run $UVICORN_CMD
