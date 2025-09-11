from typing import Protocol
import pydantic
import json
import sqlite3
import uuid
from contextlib import contextmanager

from bossypaints.tasks import TaskID


class Polygon(pydantic.BaseModel):
    # Positive/negative regions approach
    positiveRegions: list[list[tuple[float, float]]] = []
    negativeRegions: list[list[tuple[float, float]]] = []

    editing: bool
    segmentID: int
    color: list[int] | None = None
    z: int


class Checkpoint(pydantic.BaseModel):
    polygons: list[Polygon]
    taskID: TaskID

    # When receiving dict, convert to Polygon
    @pydantic.validator("polygons", pre=True)
    def convert_polygons(cls, v):
        if isinstance(v, list):
            result = []
            for polygon in v:
                if isinstance(polygon, Polygon):
                    # Already a Polygon object
                    result.append(polygon)
                elif isinstance(polygon, dict):
                    # Dict that needs to be converted
                    result.append(Polygon(**polygon))
                else:
                    # Unexpected type
                    raise ValueError(f"Polygon must be dict or Polygon object, got {type(polygon)}")
            return result
        return v


class CheckpointStore(Protocol):
    """
    A class for handling IO of checkpoint data.
    """

    def save_checkpoint(self, checkpoint: Checkpoint) -> None:
        """
        Save a checkpoint to the store.
        """
        ...

    def get_checkpoints_for_task(self, task_id: TaskID) -> list[Checkpoint]:
        """
        Get all checkpoints for a given task.
        """
        ...


class InMemoryCheckpointStore(CheckpointStore):
    def __init__(self):
        self.checkpoints: dict[TaskID, list[Checkpoint]] = {}

    def save_checkpoint(self, checkpoint: Checkpoint) -> None:
        self.checkpoints.setdefault(checkpoint.taskID, []).append(checkpoint)

    def get_checkpoints_for_task(self, task_id: TaskID) -> list[Checkpoint]:
        return self.checkpoints.get(task_id, [])


class JSONCheckpointStore(CheckpointStore):
    def __init__(self, filename: str):
        self._filename = filename

    def _load_latest_from_file(self) -> dict[TaskID, list[Checkpoint]]:
        try:
            with open(self._filename) as f:
                json_data = json.load(f)
            return {
                task_id: [Checkpoint(**checkpoint) for checkpoint in checkpoints]
                for task_id, checkpoints in json_data.items()
            }
        except FileNotFoundError:
            return {}

    def _write_to_file(self, checkpoints: dict[TaskID, list[Checkpoint]]) -> None:
        with open(self._filename, "w") as f:
            json.dump(
                {
                    task_id: [checkpoint.dict() for checkpoint in checkpoints]
                    for task_id, checkpoints in checkpoints.items()
                },
                f,
            )

    def save_checkpoint(self, checkpoint: Checkpoint) -> None:
        # TODO: Must support deletion and merging of checkpoints.
        #       In the interim, replace the checkpoint for the task.
        # checkpoints = self._load_latest_from_file()
        # checkpoints.setdefault(checkpoint.taskID, []).append(checkpoint)
        # self._write_to_file(checkpoints)

        # Replace the checkpoint for the task
        checkpoints = self._load_latest_from_file()
        checkpoints[checkpoint.taskID] = [checkpoint]
        self._write_to_file(checkpoints)

    def get_checkpoints_for_task(self, task_id: TaskID) -> list[Checkpoint]:
        checkpoints = self._load_latest_from_file()
        return checkpoints.get(task_id, [])


class SQLiteCheckpointStore(CheckpointStore):
    def __init__(self, db_path: str = "checkpoints.db"):
        self._db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        """Initialize the SQLite database and create the checkpoints table if it doesn't exist."""
        with self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS checkpoints (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    polygons_json TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Create index for faster task lookups
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_checkpoints_task_id
                ON checkpoints(task_id)
            """)
            # Create index for ordering by creation time
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_checkpoints_created_at
                ON checkpoints(task_id, created_at)
            """)
            conn.commit()

    @contextmanager
    def _get_connection(self):
        """Get a database connection with proper error handling."""
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row  # Enable dict-like access to rows
        try:
            yield conn
        finally:
            conn.close()

    def _checkpoint_from_row(self, row: sqlite3.Row) -> Checkpoint:
        """Convert a SQLite row to a Checkpoint object."""
        polygons_data = json.loads(row['polygons_json'])
        return Checkpoint(
            taskID=row['task_id'],
            polygons=[Polygon(**polygon_data) for polygon_data in polygons_data]
        )

    def save_checkpoint(self, checkpoint: Checkpoint) -> None:
        """Save a checkpoint to the SQLite database."""
        checkpoint_id = str(uuid.uuid4())
        polygons_json = json.dumps([polygon.dict() for polygon in checkpoint.polygons])

        with self._get_connection() as conn:
            # For now, replace the checkpoint for the task (matching existing behavior)
            # TODO: Support multiple checkpoints per task with proper versioning

            # Delete existing checkpoints for this task
            conn.execute("DELETE FROM checkpoints WHERE task_id = ?", (checkpoint.taskID,))

            # Insert the new checkpoint
            conn.execute("""
                INSERT INTO checkpoints (id, task_id, polygons_json)
                VALUES (?, ?, ?)
            """, (checkpoint_id, checkpoint.taskID, polygons_json))

            conn.commit()

    def get_checkpoints_for_task(self, task_id: TaskID) -> list[Checkpoint]:
        """Get all checkpoints for a given task, ordered by creation time."""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM checkpoints
                WHERE task_id = ?
                ORDER BY created_at ASC
            """, (task_id,))

            return [self._checkpoint_from_row(row) for row in cursor.fetchall()]

    def get_latest_checkpoint_for_task(self, task_id: TaskID) -> Checkpoint | None:
        """Get the most recent checkpoint for a given task."""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM checkpoints
                WHERE task_id = ?
                ORDER BY created_at DESC
                LIMIT 1
            """, (task_id,))

            row = cursor.fetchone()
            return self._checkpoint_from_row(row) if row else None

    def delete_checkpoints_for_task(self, task_id: TaskID) -> None:
        """Delete all checkpoints for a given task."""
        with self._get_connection() as conn:
            conn.execute("DELETE FROM checkpoints WHERE task_id = ?", (task_id,))
            conn.commit()

    def get_checkpoint_count_for_task(self, task_id: TaskID) -> int:
        """Get the number of checkpoints for a given task."""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT COUNT(*) as count
                FROM checkpoints
                WHERE task_id = ?
            """, (task_id,))

            row = cursor.fetchone()
            return row['count'] if row else 0
