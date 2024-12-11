# Using a debian slim image instead of alpine makes it easier to install
# dependencies that adhere to PEP 518.
FROM ghcr.io/astral-sh/uv:0.5.8-debian-slim

# Set the working directory in the container
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

# Install build deps
# RUN apk add --no-cache gcc python3-dev musl-dev linux-headers g++ gfortran
# RUN apt-get update && apt-get install -y gcc musl-dev

# Sync dependencies using uv
RUN uv sync

# Make port 8000 available to the world outside this container
EXPOSE 8000

# Define environment variable
ENV UVICORN_CMD="uvicorn server:app --host 0.0.0.0 --port 8000"

# Run uvicorn server when the container launches
CMD uv run $UVICORN_CMD
