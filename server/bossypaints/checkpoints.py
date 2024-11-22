import abc
import pydantic

from bossypaints.tasks import TaskID


class Polygon(pydantic.BaseModel):
    points: list[tuple[float, float]]
    editing: bool
    segmentID: int
    color: list[int] | None
    z: int


class Checkpoint(pydantic.BaseModel):
    polygons: list[Polygon]
    taskID: int

    # When receiving dict, convert to Polygon
    @pydantic.validator("polygons", pre=True)
    def convert_polygons(cls, v):
        return [Polygon(**polygon) for polygon in v]


class CheckpointStore(abc.ABC):
    """
    A class for handling IO of checkpoint data.
    """

    def save_checkpoint(self, checkpoint: Checkpoint) -> None:
        """
        Save a checkpoint to the store.
        """
        ...

    def get_checkpoints_for_task(self, task_id: int) -> list[Checkpoint]:
        """
        Get all checkpoints for a given task.
        """
        ...


class InMemoryCheckpointStore(CheckpointStore):
    def __init__(self):
        self.checkpoints: dict[TaskID, list[Checkpoint]] = {}

    def save_checkpoint(self, checkpoint: Checkpoint) -> None:
        self.checkpoints.setdefault(checkpoint.taskID, []).append(checkpoint)

    def get_checkpoints_for_task(self, task_id: int) -> list[Checkpoint]:
        return self.checkpoints.get(task_id, [])
