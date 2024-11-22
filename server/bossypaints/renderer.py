from bossypaints.checkpoints import Checkpoint
from bossypaints.tasks import TaskInDB

# For rasterizing polys with scikit-image
from skimage.draw import polygon
from skimage.io import imsave
import numpy as np


class VolumePolygonRenderer:

    def render_from_checkpoints(self, checkpoints: list[Checkpoint]):
        # Render the volume from the checkpoints
        pass


class ImageStackVolumePolygonRenderer(VolumePolygonRenderer):

    def __init__(self, directory: str = "./", fmt: str = "jpg"):
        self.fmt = fmt
        self.directory = directory

    def render_from_checkpoints(self, task: TaskInDB, checkpoints: list[Checkpoint]):
        """Render a volume in Numpy array format from a list of Checkpoints"""
        x_size = task.x_max - task.x_min
        y_size = task.y_max - task.y_min
        z_size = task.z_max - task.z_min
        volume = np.zeros((x_size, y_size, z_size), dtype=np.uint8)
        for checkpoint in checkpoints:
            for poly in checkpoint.polygons:
                z = poly.z
                points = np.array(poly.points)
                if points.ndim != 2:
                    continue
                # points[:, 0] = np.clip(points[:, 0], task.x_min, task.x_max)
                # points[:, 1] = np.clip(points[:, 1], task.y_min, task.y_max)
                rr, cc = polygon(points[:, 0], points[:, 1])
                rr = np.clip(rr, 0, x_size - 1)
                cc = np.clip(cc, 0, y_size - 1)
                volume[rr, cc, z] = poly.segmentID
        # fpath = f"{self.directory}{task.collection}_{task.experiment}_{task.channel}_{task.resolution}_{task.id}.{z}.{self.fmt}"
        for z in range(z_size):
            imsave(
                f"{self.directory}{task.collection}_{task.experiment}_{task.channel}_{task.resolution}_{task.id}.{z}.{self.fmt}",
                volume[:, :, z],
            )
