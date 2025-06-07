from typing import Protocol
import pydantic
import json

from bossypaints.tasks import TaskID


class Polygon(pydantic.BaseModel):
    # Legacy fields for backward compatibility
    points: list[tuple[float, float]] = []
    holes: list[list[tuple[float, float]]] = []  # Support for genus 1 shapes

    # New positive/negative regions approach
    positiveRegions: list[list[tuple[float, float]]] = []
    negativeRegions: list[list[tuple[float, float]]] = []

    editing: bool
    segmentID: int
    color: list[int] | None = None
    z: int

    def model_post_init(self, __context) -> None:
        """Ensure compatibility between old and new schema formats"""
        # If we have positiveRegions but no points (new format), populate points for backward compatibility
        if self.positiveRegions and not self.points:
            if len(self.positiveRegions) > 0:
                self.points = self.positiveRegions[0]  # Use first positive region as main points

        # If we have negativeRegions but no holes (new format), populate holes for backward compatibility
        if self.negativeRegions and not self.holes:
            self.holes = self.negativeRegions

        # If we have points but no positiveRegions (legacy format), populate positiveRegions
        if self.points and not self.positiveRegions:
            self.positiveRegions = [self.points]

        # If we have holes but no negativeRegions (legacy format), populate negativeRegions
        if self.holes and not self.negativeRegions:
            self.negativeRegions = self.holes


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
