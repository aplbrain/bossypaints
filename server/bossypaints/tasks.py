import abc
import json
import uuid
import pydantic
from typing import List, Optional, Literal
import threading
import sqlite3
from contextlib import contextmanager

TaskID = str


class Task(pydantic.BaseModel):
    # Data source type: either 'bossdb' or 'cloudvolume'
    data_source_type: Literal["bossdb", "cloudvolume"] = "bossdb"
    # Output destination type: either 'bossdb' (write to BossDB) or 'download' (user will download)
    output_type: Literal["bossdb", "download"] = "download"

    # Task metadata
    name: Optional[str] = None  # User-defined task name

    # BossDB fields (used when data_source_type is 'bossdb')
    collection: Optional[str] = None
    experiment: Optional[str] = None
    channel: Optional[str] = None

    # CloudVolume fields (used when data_source_type is 'cloudvolume')
    cloudvolume_uri: Optional[str] = None

    # Common fields
    resolution: int
    x_min: int
    x_max: int
    y_min: int
    y_max: int
    z_min: int
    z_max: int
    priority: int
    destination_collection: str | None = None
    destination_experiment: str | None = None
    destination_channel: str | None = None
    assigned_to: str | None = None  # BossDB username of the assigned user
    export_pending: bool = False  # Flag to indicate if an export is currently in progress
    archived: bool = False  # Flag to indicate if the task is archived

    @pydantic.validator('collection', 'experiment', 'channel')
    def validate_bossdb_fields(cls, v, values):
        """Ensure BossDB fields are present when data_source_type is 'bossdb'"""
        if values.get('data_source_type') == 'bossdb' and v is None:
            raise ValueError('BossDB fields (collection, experiment, channel) are required when data_source_type is "bossdb"')
        return v

    @pydantic.validator('cloudvolume_uri')
    def validate_cloudvolume_fields(cls, v, values):
        """Ensure CloudVolume URI is present when data_source_type is 'cloudvolume'"""
        if values.get('data_source_type') == 'cloudvolume' and v in [None, '']:
            raise ValueError('CloudVolume URI is required when data_source_type is "cloudvolume"')
        return v


class TaskInDB(Task):
    id: TaskID


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
    def list(self) -> List[TaskInDB]:
        pass

    @abc.abstractmethod
    def list_for_user(self, username: str) -> List[TaskInDB]:
        pass

    @abc.abstractmethod
    def list_for_user_archived(self, username: str) -> List[TaskInDB]:
        """Get all archived tasks for a user."""
        pass

    @abc.abstractmethod
    def list_for_user_active(self, username: str) -> List[TaskInDB]:
        """Get all non-archived tasks for a user."""
        pass

    @abc.abstractmethod
    def update_export_pending(self, task_id: TaskID, pending: bool) -> None:
        """Update the export_pending flag for a task."""
        pass

    @abc.abstractmethod
    def update_archived(self, task_id: TaskID, archived: bool) -> None:
        """Update the archived flag for a task."""
        pass

    @abc.abstractmethod
    def update_name(self, task_id: TaskID, name: Optional[str]) -> None:
        """Update the name of a task."""
        pass


class InMemoryTaskQueueStore(TaskQueueStore):
    def __init__(self):
        self._tasks = {}
        self._next_id = 0

    def put(self, task: Task) -> TaskID:
        task_id = uuid.uuid4().hex
        self._tasks[task_id] = TaskInDB(id=task_id, **task.dict())
        return task_id

    def get(self, task_id: TaskID) -> TaskInDB:
        return self._tasks[task_id]

    def delete(self, task_id: TaskID) -> None:
        del self._tasks[task_id]

    def list(self) -> List[TaskInDB]:
        return list(self._tasks.values())

    def list_for_user(self, username: str) -> List[TaskInDB]:
        return [task for task in self._tasks.values()
                if task.assigned_to == username]

    def list_for_user_archived(self, username: str) -> List[TaskInDB]:
        return [task for task in self._tasks.values()
                if task.assigned_to == username and task.archived]

    def list_for_user_active(self, username: str) -> List[TaskInDB]:
        return [task for task in self._tasks.values()
                if task.assigned_to == username and not task.archived]

    def update_export_pending(self, task_id: TaskID, pending: bool) -> None:
        if task_id in self._tasks:
            self._tasks[task_id].export_pending = pending

    def update_archived(self, task_id: TaskID, archived: bool) -> None:
        if task_id in self._tasks:
            self._tasks[task_id].archived = archived

    def update_name(self, task_id: TaskID, name: Optional[str]) -> None:
        if task_id in self._tasks:
            self._tasks[task_id].name = name


class JSONFileTaskQueueStore(TaskQueueStore):
    def __init__(self, filename: str):
        self._filename = filename
        self._lock = threading.Lock()

    def new_uid(self) -> TaskID:
        return str(uuid.uuid4())

    def _load_latest_from_file(self) -> dict[TaskID, TaskInDB]:
        try:
            with open(self._filename) as f:
                json_data = json.load(f)

            return {
                task_id: TaskInDB(**task_data)
                for task_id, task_data in json_data.items()
            }

        except FileNotFoundError:
            return {}

    def _write_to_file(self, tasks: dict[TaskID, TaskInDB]) -> None:
        with open(self._filename, "w") as f:
            json.dump({task_id: task.dict() for task_id, task in tasks.items()}, f)

    def put(self, task: Task) -> TaskID:
        with self._lock:
            tasks = self._load_latest_from_file()
            task_id = self.new_uid()
            tasks[task_id] = TaskInDB(id=task_id, **task.dict())
            self._write_to_file(tasks)
            return task_id

    def get(self, task_id: TaskID) -> TaskInDB:
        tasks = self._load_latest_from_file()
        return tasks[task_id]

    def delete(self, task_id: TaskID) -> None:
        with self._lock:
            tasks = self._load_latest_from_file()
            del tasks[task_id]
            self._write_to_file(tasks)

    def list(self) -> List[TaskInDB]:
        tasks = self._load_latest_from_file()
        return list(tasks.values())

    def list_for_user(self, username: str) -> List[TaskInDB]:
        tasks = self._load_latest_from_file()
        return [task for task in tasks.values()
                if task.assigned_to == username]

    def list_for_user_archived(self, username: str) -> List[TaskInDB]:
        tasks = self._load_latest_from_file()
        return [task for task in tasks.values()
                if task.assigned_to == username and task.archived]

    def list_for_user_active(self, username: str) -> List[TaskInDB]:
        tasks = self._load_latest_from_file()
        return [task for task in tasks.values()
                if task.assigned_to == username and not task.archived]

    def update_export_pending(self, task_id: TaskID, pending: bool) -> None:
        with self._lock:
            tasks = self._load_latest_from_file()
            if task_id in tasks:
                tasks[task_id].export_pending = pending
                self._write_to_file(tasks)

    def update_archived(self, task_id: TaskID, archived: bool) -> None:
        with self._lock:
            tasks = self._load_latest_from_file()
            if task_id in tasks:
                tasks[task_id].archived = archived
                self._write_to_file(tasks)

    def update_name(self, task_id: TaskID, name: Optional[str]) -> None:
        with self._lock:
            tasks = self._load_latest_from_file()
            if task_id in tasks:
                tasks[task_id].name = name
                self._write_to_file(tasks)


class SQLiteTaskQueueStore(TaskQueueStore):
    def __init__(self, db_path: str = "tasks.db"):
        self._db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        """Initialize the SQLite database and create the tasks table if it doesn't exist."""
        with self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    data_source_type TEXT NOT NULL DEFAULT 'bossdb',
                    output_type TEXT NOT NULL DEFAULT 'download',
                    name TEXT,
                    collection TEXT,
                    experiment TEXT,
                    channel TEXT,
                    cloudvolume_uri TEXT,
                    resolution INTEGER NOT NULL,
                    x_min INTEGER NOT NULL,
                    x_max INTEGER NOT NULL,
                    y_min INTEGER NOT NULL,
                    y_max INTEGER NOT NULL,
                    z_min INTEGER NOT NULL,
                    z_max INTEGER NOT NULL,
                    priority INTEGER NOT NULL,
                    destination_collection TEXT,
                    destination_experiment TEXT,
                    destination_channel TEXT,
                    assigned_to TEXT,
                    export_pending BOOLEAN NOT NULL DEFAULT 0,
                    archived BOOLEAN NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Add name column to existing tables if it doesn't exist
            try:
                conn.execute("ALTER TABLE tasks ADD COLUMN name TEXT")
            except sqlite3.OperationalError:
                # Column already exists
                pass
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

    def _task_from_row(self, row: sqlite3.Row) -> TaskInDB:
        """Convert a SQLite row to a TaskInDB object."""
        return TaskInDB(
            id=row['id'],
            data_source_type=row['data_source_type'],
            output_type=row['output_type'],
            name=row['name'],
            collection=row['collection'],
            experiment=row['experiment'],
            channel=row['channel'],
            cloudvolume_uri=row['cloudvolume_uri'],
            resolution=row['resolution'],
            x_min=row['x_min'],
            x_max=row['x_max'],
            y_min=row['y_min'],
            y_max=row['y_max'],
            z_min=row['z_min'],
            z_max=row['z_max'],
            priority=row['priority'],
            destination_collection=row['destination_collection'],
            destination_experiment=row['destination_experiment'],
            destination_channel=row['destination_channel'],
            assigned_to=row['assigned_to'],
            export_pending=bool(row['export_pending']),
            archived=bool(row['archived'])
        )

    def put(self, task: Task) -> TaskID:
        task_id = str(uuid.uuid4())

        with self._get_connection() as conn:
            conn.execute("""
                INSERT INTO tasks (
                    id, data_source_type, output_type, name, collection, experiment, channel,
                    cloudvolume_uri, resolution, x_min, x_max, y_min, y_max, z_min, z_max,
                    priority, destination_collection, destination_experiment,
                    destination_channel, assigned_to, export_pending, archived
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                task_id, task.data_source_type, task.output_type, task.name, task.collection,
                task.experiment, task.channel, task.cloudvolume_uri, task.resolution,
                task.x_min, task.x_max, task.y_min, task.y_max, task.z_min, task.z_max,
                task.priority, task.destination_collection, task.destination_experiment,
                task.destination_channel, task.assigned_to, task.export_pending, task.archived
            ))
            conn.commit()

        return task_id

    def get(self, task_id: TaskID) -> TaskInDB:
        with self._get_connection() as conn:
            cursor = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
            row = cursor.fetchone()
            if row is None:
                raise KeyError(f"Task {task_id} not found")
            return self._task_from_row(row)

    def delete(self, task_id: TaskID) -> None:
        with self._get_connection() as conn:
            conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            conn.commit()

    def list(self) -> List[TaskInDB]:
        with self._get_connection() as conn:
            cursor = conn.execute("SELECT * FROM tasks ORDER BY created_at DESC")
            return [self._task_from_row(row) for row in cursor.fetchall()]

    def list_for_user(self, username: str) -> List[TaskInDB]:
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM tasks WHERE assigned_to = ? ORDER BY created_at DESC",
                (username,)
            )
            return [self._task_from_row(row) for row in cursor.fetchall()]

    def list_for_user_archived(self, username: str) -> List[TaskInDB]:
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM tasks WHERE assigned_to = ? AND archived = 1 ORDER BY created_at DESC",
                (username,)
            )
            return [self._task_from_row(row) for row in cursor.fetchall()]

    def list_for_user_active(self, username: str) -> List[TaskInDB]:
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM tasks WHERE assigned_to = ? AND archived = 0 ORDER BY created_at DESC",
                (username,)
            )
            return [self._task_from_row(row) for row in cursor.fetchall()]

    def update_export_pending(self, task_id: TaskID, pending: bool) -> None:
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE tasks SET export_pending = ? WHERE id = ?",
                (pending, task_id)
            )
            conn.commit()

    def update_archived(self, task_id: TaskID, archived: bool) -> None:
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE tasks SET archived = ? WHERE id = ?",
                (archived, task_id)
            )
            conn.commit()

    def update_name(self, task_id: TaskID, name: Optional[str]) -> None:
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE tasks SET name = ? WHERE id = ?",
                (name, task_id)
            )
            conn.commit()
