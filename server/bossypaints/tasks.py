import abc
import json
import uuid
import pydantic
from typing import List, Optional, Literal

TaskID = str


class Task(pydantic.BaseModel):
    # Data source type: either 'bossdb' or 'cloudvolume'
    data_source_type: Literal["bossdb", "cloudvolume"] = "bossdb"
    # Output destination type: either 'bossdb' (write to BossDB) or 'download' (user will download)
    output_type: Literal["bossdb", "download"] = "download"

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
    def update_export_pending(self, task_id: TaskID, pending: bool) -> None:
        """Update the export_pending flag for a task."""
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

    def update_export_pending(self, task_id: TaskID, pending: bool) -> None:
        if task_id in self._tasks:
            self._tasks[task_id].export_pending = pending


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
                task_id: TaskInDB(**task_data)
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

    def list(self) -> List[TaskInDB]:
        tasks = self._load_latest_from_file()
        return list(tasks.values())

    def list_for_user(self, username: str) -> List[TaskInDB]:
        tasks = self._load_latest_from_file()
        return [task for task in tasks.values()
                if task.assigned_to == username]

    def update_export_pending(self, task_id: TaskID, pending: bool) -> None:
        tasks = self._load_latest_from_file()
        if task_id in tasks:
            tasks[task_id].export_pending = pending
            self._write_to_file(tasks)
