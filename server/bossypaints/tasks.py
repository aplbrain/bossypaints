import abc
import json
import uuid
import pydantic

TaskID = str


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
    priority: int
    destination_collection: str | None = None
    destination_experiment: str | None = None
    destination_channel: str | None = None


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
    def list(self) -> list[TaskInDB]:
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

    def list(self) -> list[TaskInDB]:
        tasks = self._load_latest_from_file()
        return list(tasks.values())
