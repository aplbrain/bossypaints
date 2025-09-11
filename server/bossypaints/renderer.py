import pathlib
from bossypaints.checkpoints import Checkpoint
from bossypaints.tasks import TaskInDB

# For rasterizing polys with scikit-image
from skimage.draw import polygon
from skimage.io import imsave
import numpy as np
import logging
import os
import json

from intern import array
from cloudvolume import CloudVolume

logger = logging.getLogger(__name__)


class VolumePolygonRenderer:

    def render_from_checkpoints(self, checkpoints: list[Checkpoint]):
        # Render the volume from the checkpoints
        pass


class NumpyInMemoryVolumePolygonRenderer(VolumePolygonRenderer):

    def _materialize_xyz_volume(self, task: TaskInDB, checkpoints: list[Checkpoint], as_channels: bool = False):
        """Materialize a volume in Numpy array format from a list of Checkpoints.

        Arguments:
            - task: TaskInDB object containing task metadata.
            - checkpoints: List of Checkpoint objects to render.
            - as_channels: If True, render each seg ID as a separate channel in the volume.

        """
        x_size = task.x_max - task.x_min
        y_size = task.y_max - task.y_min
        z_size = task.z_max - task.z_min

        ids = sorted(set(poly.segmentID for checkpoint in checkpoints for poly in checkpoint.polygons))
        id_count = len(ids)
        logger.info(f"Total unique segment IDs found: {id_count}")

        volume = np.zeros((x_size, y_size, z_size, id_count) if as_channels else (x_size, y_size, z_size), dtype=np.uint64)

        logger.info(f"Creating volume of size {x_size}x{y_size}x{z_size}")

        # Calculate the resolution scaling factor
        resolution_factor = 2 ** task.resolution
        logger.info(f"Using resolution scaling factor: {resolution_factor} (resolution level: {task.resolution})")

        for checkpoint in checkpoints:
            for poly in checkpoint.polygons:
                z = poly.z - task.z_min
                if z < 0 or z >= z_size:
                    logger.warning(f"Polygon z={poly.z} is outside volume bounds (z_min={task.z_min}, z_max={task.z_max}). Skipping.")
                    continue

                # Use the new positiveRegions/negativeRegions schema
                logger.info(f"Rendering polygon: {len(poly.positiveRegions)} positive regions, {len(poly.negativeRegions)} negative regions")

                # Rasterize all positive regions (outer boundaries)
                for positive_region in poly.positiveRegions:
                    points = np.array(positive_region)
                    if points.ndim != 2 or len(points) < 3:
                        continue

                    # Scale down coordinates by resolution factor and offset points to be relative to task bounds
                    points_scaled = points / resolution_factor
                    points_offset = points_scaled.copy()
                    points_offset[:, 0] -= task.x_min
                    points_offset[:, 1] -= task.y_min

                    logger.info(f"Positive region: Original coords range x:[{points[:, 0].min():.1f}, {points[:, 0].max():.1f}], y:[{points[:, 1].min():.1f}, {points[:, 1].max():.1f}]")
                    logger.info(f"Positive region: Scaled coords range x:[{points_offset[:, 0].min():.1f}, {points_offset[:, 0].max():.1f}], y:[{points_offset[:, 1].min():.1f}, {points_offset[:, 1].max():.1f}]")

                    rr, cc = polygon(points_offset[:, 1], points_offset[:, 0])  # Note: y, x order for polygon
                    rr = np.clip(rr, 0, y_size - 1)
                    cc = np.clip(cc, 0, x_size - 1)

                    logger.info(f"Positive region: {len(rr)} pixels set to segmentID {poly.segmentID}")
                    if as_channels:
                        volume[cc, rr, z, ids.index(poly.segmentID)] = poly.segmentID
                    else:
                        volume[cc, rr, z] = poly.segmentID

                # Subtract all negative regions (holes)
                for negative_region in poly.negativeRegions:
                    hole_points = np.array(negative_region)
                    if hole_points.ndim != 2 or len(hole_points) < 3:
                        continue

                    # Scale down coordinates by resolution factor and offset hole points to be relative to task bounds
                    hole_points_scaled = hole_points / resolution_factor
                    hole_points_offset = hole_points_scaled.copy()
                    hole_points_offset[:, 0] -= task.x_min
                    hole_points_offset[:, 1] -= task.y_min

                    hole_rr, hole_cc = polygon(hole_points_offset[:, 1], hole_points_offset[:, 0])  # Note: y, x order
                    hole_rr = np.clip(hole_rr, 0, y_size - 1)
                    hole_cc = np.clip(hole_cc, 0, x_size - 1)

                    logger.info(f"Negative region: {len(hole_rr)} pixels cleared")
                    if as_channels:
                        volume[hole_cc, hole_rr, z, ids.index(poly.segmentID)] = 0
                    else:
                        volume[hole_cc, hole_rr, z] = 0

        return volume


class ImageStackVolumePolygonRenderer(NumpyInMemoryVolumePolygonRenderer):

    def __init__(self, directory: str = "./", fmt: str = "tif"):
        self.fmt = fmt
        self.directory = directory
        pathlib.Path(self.directory).mkdir(parents=True, exist_ok=True)

    def render_from_checkpoints(self, task: TaskInDB, checkpoints: list[Checkpoint]):
        """Render a volume in Numpy array format from a list of Checkpoints"""
        volume = self._materialize_xyz_volume(task, checkpoints)

        # fpath = f"{self.directory}{task.collection}_{task.experiment}_{task.channel}_{task.resolution}_{task.id}.{z}.{self.fmt}"
        for z in range(volume.shape[-1]):
            if np.sum(volume[:, :, z]) == 0:
                logger.info(f"Skipping empty slice at z={z}")
                continue
            imsave(
                f"{self.directory}{task.collection}_{task.experiment}_{task.channel}_{task.resolution}_{task.id}.{z}.{self.fmt}",
                volume[:, :, z].astype(np.uint16)
            )


class BossDBInternVolumePolygonRenderer(NumpyInMemoryVolumePolygonRenderer):

    def render_from_checkpoints(self, task: TaskInDB, checkpoints: list[Checkpoint]):
        dataset = array(
            f"bossdb://{task.destination_collection}/{task.destination_experiment}/{task.destination_channel}",
            resolution=task.resolution,
        )
        print(f"bossdb://{task.destination_collection}/{task.destination_experiment}/{task.destination_channel}")
        volume = self._materialize_xyz_volume(task, checkpoints).transpose(2, 1, 0)
        dataset[
            task.z_min : task.z_max,
            task.y_min : task.y_max,
            task.x_min : task.x_max,
        ] = volume


class LocalCloudVolumePolygonRenderer(NumpyInMemoryVolumePolygonRenderer):
    """
    Renderer that creates local CloudVolume channels for segmentation output.
    This is the new default renderer.
    """

    def __init__(self, directory: str = "./", base_name: str = "segmentation"):
        self.directory = directory
        self.base_name = base_name
        pathlib.Path(self.directory).mkdir(parents=True, exist_ok=True)

    def render_from_checkpoints(self, task: TaskInDB, checkpoints: list[Checkpoint]):
        """Render segmentation volume as a local CloudVolume (precomputed format)"""
        volume = self._materialize_xyz_volume(task, checkpoints)

        # CloudVolume expects (z, y, x) ordering
        volume_zyx = volume.transpose(2, 1, 0)

        # Create CloudVolume path
        cv_path = f"file://{os.path.abspath(self.directory)}/{self.base_name}_task_{task.id}"

        # Calculate voxel size (default to 1,1,1 if not available)
        voxel_size = [1, 1, 1]  # nm
        try:
            # Try to get voxel size from source if it's BossDB
            if task.data_source_type == "bossdb":
                source_dataset = array(
                    f"bossdb://{task.collection}/{task.experiment}/{task.channel}",
                    resolution=task.resolution,
                )
                voxel_size = source_dataset.voxel_size
            # For CloudVolume sources, try to get info from existing CloudVolume
            elif task.data_source_type == "cloudvolume" and task.cloudvolume_uri:
                source_cv = CloudVolume(task.cloudvolume_uri, mip=task.resolution, progress=False, cache=False)
                if hasattr(source_cv, 'scales') and len(source_cv.scales) > task.resolution:
                    scale = source_cv.scales[task.resolution]
                    if hasattr(scale, 'resolution'):
                        voxel_size = list(scale.resolution)
        except Exception as e:
            logger.warning(f"Could not determine voxel size from source: {e}")

        # Scale voxel size by resolution factor
        resolution_factor = 2 ** task.resolution
        scaled_voxel_size = [v * resolution_factor for v in voxel_size]

        logger.info(f"Creating CloudVolume at {cv_path} with voxel size {scaled_voxel_size}")
        logger.info(f"Volume shape (z,y,x): {volume_zyx.shape}")

        # Create CloudVolume info
        info = {
            "type": "segmentation",
            "data_type": "uint64",
            "num_channels": 1,
            "scales": [{
                "key": "0",  # Always use mip 0 for the single scale we're creating
                "size": [volume_zyx.shape[2], volume_zyx.shape[1], volume_zyx.shape[0]],  # x, y, z
                "resolution": scaled_voxel_size,  # x, y, z in nm
                "voxel_offset": [task.x_min, task.y_min, task.z_min],
                "chunk_sizes": [[64, 64, 64]],
                "encoding": "raw",
                "compressed_segmentation_block_size": [8, 8, 8]
            }],
            "mesh": "mesh",
            "skeletons": "skeletons"
        }

        # Write info file
        info_path = os.path.join(self.directory, f"{self.base_name}_task_{task.id}", "info")
        os.makedirs(os.path.dirname(info_path), exist_ok=True)
        with open(info_path, 'w') as f:
            json.dump(info, f, indent=2)

        # Create CloudVolume instance and write data (always use mip=0 for new datasets)
        cv = CloudVolume(cv_path, mip=0, info=info, progress=False, cache=False)

        # CloudVolume indexing is [x, y, z] but our volume data is in (z, y, x) order
        # We need to transpose the volume to (x, y, z) order for CloudVolume
        logger.info(f"Task bounds: x:[{task.x_min}:{task.x_max}] y:[{task.y_min}:{task.y_max}] z:[{task.z_min}:{task.z_max}]")
        logger.info(f"Volume shape before processing: {volume_zyx.shape}")

        # Ensure volume has channel dimension - add if missing
        if volume_zyx.ndim == 3:
            # Add channel dimension: (z, y, x) -> (z, y, x, 1)
            volume_zyx = volume_zyx[..., np.newaxis]
            logger.info(f"Added channel dimension, new shape: {volume_zyx.shape}")

        # Transpose from (z, y, x, channel) to (x, y, z, channel) for CloudVolume
        volume_xyzc = np.transpose(volume_zyx, (2, 1, 0, 3))
        logger.info(f"Volume shape after transpose: {volume_xyzc.shape} (x, y, z, channel)")

        # Write the segmentation data - CloudVolume expects (x, y, z) indexing and data
        cv[task.x_min:task.x_max, task.y_min:task.y_max, task.z_min:task.z_max] = volume_xyzc

        logger.info(f"Successfully created CloudVolume segmentation at {cv_path}")

        # Return the CloudVolume path for potential use in meshing or other operations
        return cv_path
