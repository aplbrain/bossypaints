# Use an official Python runtime as a parent image
FROM ghcr.io/astral-sh/uv:0.5.8-python3.11-alpine

# Set the working directory in the container
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

# Install gcc for building deps
# RUN apt-get update && apt-get install -y gcc
RUN apk add --no-cache gcc musl-dev

# Sync dependencies using uv
RUN uv sync

# Make port 8000 available to the world outside this container
EXPOSE 8000

# Define environment variable
ENV UVICORN_CMD="uvicorn server:app --host 0.0.0.0 --port 8000"

# Run uvicorn server when the container launches
CMD uv run $UVICORN_CMD
