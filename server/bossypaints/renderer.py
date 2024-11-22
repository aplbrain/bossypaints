from bossypaints.checkpoints import Checkpoint
from bossypaints.tasks import Task


class VolumePolygonRenderer:

    def render_from_checkpoints(self, checkpoints: list[Checkpoint]):
        # Render the volume from the checkpoints
        pass


class ImageStackVolumePolygonRenderer(VolumePolygonRenderer):

    def __init__(self, fmt: str = "jpg"):
        self.fmt = fmt

    def render_from_checkpoints(self, task: Task, checkpoints: list[Checkpoint]):
        # Render the volume from the checkpoints
        pass
