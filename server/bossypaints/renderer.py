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
        # TODO: scale correctly
        voxel_size = [1, 1, 1]  # Default voxel size in nm

        # Create a NumPy volume sized for the task's FOV
        x_size = int((task.x_max - task.x_min) / voxel_size[0])
        y_size = int((task.y_max - task.y_min) / voxel_size[1])
        z_size = int((task.z_max - task.z_min) / voxel_size[2])

        ids = sorted(set(poly.segmentID for checkpoint in checkpoints for poly in checkpoint.polygons))
        id_count = len(ids)
        logger.info(f"Total unique segment IDs found: {id_count}")

        volume = np.zeros((x_size, y_size, z_size, id_count) if as_channels else (x_size, y_size, z_size), dtype=np.uint64)

        resolution_factor = 2 ** task.resolution
        scaled_voxel_size = [v * resolution_factor for v in voxel_size]

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
                source_cv = CloudVolume(task.cloudvolume_uri, mip=task.resolution, progress=False, cache=False, use_https=True)
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

        # Determine source scale and voxel_offset to inherit
        source_scale_index = 0
        source_scale = None
        source_voxel_offset = [0, 0, 0]
        source_resolution = None
        try:
            if task.data_source_type == "cloudvolume" and task.cloudvolume_uri:
                src_cv = CloudVolume(task.cloudvolume_uri, progress=False, cache=False, use_https=True)
                available_scales = src_cv.scales if hasattr(src_cv, 'scales') else []
                if len(available_scales) == 0:
                    logger.warning("Source CloudVolume has no scales info; falling back to defaults")
                # Choose the requested resolution index if available, else fallback to closest (0)
                if task.resolution < len(available_scales):
                    source_scale_index = task.resolution
                else:
                    logger.warning(f"Requested task.resolution={task.resolution} not in source scales (0..{len(available_scales)-1}); falling back to 0")
                    source_scale_index = 0

                if len(available_scales) > 0:
                    # scales entries in CloudVolume are dict-like
                    source_scale = available_scales[source_scale_index]
                    source_resolution = source_scale.get('resolution', None) if isinstance(source_scale, dict) else None
                    source_voxel_offset = source_scale.get('voxel_offset', source_voxel_offset) if isinstance(source_scale, dict) else source_voxel_offset
                    logger.info(f"Selected source scale index={source_scale_index}, resolution={source_resolution}, voxel_offset={source_voxel_offset}")
        except Exception as e:
            logger.warning(f"Could not read source CloudVolume scales: {e}")

        # If we got a source resolution, use it for the new dataset; else fall back to computed scaled_voxel_size
        if source_resolution:
            info_resolution = list(source_resolution)
        else:
            info_resolution = scaled_voxel_size

        # Use the source voxel_offset, not the task bounds
        info_voxel_offset = list(source_voxel_offset)

        logger.info(f"Using info resolution={info_resolution} and info_voxel_offset={info_voxel_offset} for new CloudVolume")

        # Create CloudVolume info using the source scale's resolution and voxel_offset
        info = {
            "type": "segmentation",
            "data_type": "uint64",
            "num_channels": 1,
            "scales": [{
                "key": "0",
                "size": [volume_zyx.shape[2], volume_zyx.shape[1], volume_zyx.shape[0]],  # x, y, z
                "resolution": info_resolution,
                "voxel_offset": info_voxel_offset,
                "chunk_sizes": [[64, 64, 64]],
                "encoding": "compressed_segmentation",
                "compressed_segmentation_block_size": [8, 8, 8]
            }],
        }

        # Write info file
        info_path = os.path.join(self.directory, f"{self.base_name}_task_{task.id}", "info")
        os.makedirs(os.path.dirname(info_path), exist_ok=True)
        with open(info_path, 'w') as f:
            json.dump(info, f, indent=2)

        # CloudVolume indexing is [x, y, z] but our volume data is in (z, y, x) order
        # We will transpose later and write after selecting the correct source scale.
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

        # If the source selected scale index differs from task.resolution, resample the volume by powers of two
        scale_diff = source_scale_index - task.resolution
        if scale_diff != 0:
            factor = 2 ** abs(scale_diff)
            logger.info(f"Resampling volume by factor {factor} (scale_diff={scale_diff}) to match source scale index")
            if scale_diff > 0:
                # Need to upsample volume (repeat voxels)
                volume_xyzc = np.repeat(volume_xyzc, factor, axis=0)
                volume_xyzc = np.repeat(volume_xyzc, factor, axis=1)
                volume_xyzc = np.repeat(volume_xyzc, factor, axis=2)
            else:
                # Need to downsample volume (take every factor-th voxel)
                volume_xyzc = volume_xyzc[::factor, ::factor, ::factor, ...]
            logger.info(f"Volume shape after resample: {volume_xyzc.shape}")

        # Compute write indices relative to the new dataset's voxel_offset
        # Convert task bounds (assumed in mip=task.resolution voxel coordinates) to the target mip coordinates
        conv_factor = 2 ** (source_scale_index - task.resolution)
        write_x0 = int(round(task.x_min * conv_factor - info_voxel_offset[0]))
        write_x1 = int(round(task.x_max * conv_factor - info_voxel_offset[0]))
        write_y0 = int(round(task.y_min * conv_factor - info_voxel_offset[1]))
        write_y1 = int(round(task.y_max * conv_factor - info_voxel_offset[1]))
        write_z0 = int(round(task.z_min * conv_factor - info_voxel_offset[2]))
        write_z1 = int(round(task.z_max * conv_factor - info_voxel_offset[2]))

        logger.info(f"Writing to new CloudVolume at indices x:[{write_x0}:{write_x1}] y:[{write_y0}:{write_y1}] z:[{write_z0}:{write_z1}]")

        # Create CloudVolume instance for the target dataset/mip before writing
        try:
            cv = CloudVolume(cv_path, mip=source_scale_index, info=info, progress=True, cache=False, fill_missing=False)
            logger.info(f"Created CloudVolume at {cv_path} mip={source_scale_index}")
        except Exception as e:
            logger.warning(f"Failed to create CloudVolume at mip={source_scale_index}: {e}; falling back to mip=0")
            source_scale_index = 0
            cv = CloudVolume(cv_path, mip=0, info=info, progress=True, cache=False, fill_missing=False)

        # Determine target dataset size from the source scale if available (use the info we wrote or cv.info)
        try:
            target_size = None
            if source_scale and isinstance(source_scale, dict) and 'size' in source_scale:
                target_size = tuple(source_scale['size'])
            elif hasattr(cv, 'info'):
                target_size = tuple(cv.info.get('scales', [])[0].get('size', None))
            if not target_size:
                # Fallback to the info size we created earlier
                target_size = tuple(info['scales'][0]['size'])
            max_x, max_y, max_z = target_size[0], target_size[1], target_size[2]
        except Exception:
            max_x = volume_xyzc.shape[0]
            max_y = volume_xyzc.shape[1]
            max_z = volume_xyzc.shape[2]

        # Clip write indices to dataset bounds and compute corresponding source slices from volume_xyzc
        tx0 = max(0, write_x0)
        ty0 = max(0, write_y0)
        tz0 = max(0, write_z0)
        tx1 = min(max_x, write_x1)
        ty1 = min(max_y, write_y1)
        tz1 = min(max_z, write_z1)

        if tx0 >= tx1 or ty0 >= ty1 or tz0 >= tz1:
            logger.warning(f"After clipping, write region is empty: x:[{tx0}:{tx1}] y:[{ty0}:{ty1}] z:[{tz0}:{tz1}]. Skipping write.")
        else:
            # Compute source slices into volume_xyzc
            src_x0 = tx0 - write_x0
            src_x1 = src_x0 + (tx1 - tx0)
            src_y0 = ty0 - write_y0
            src_y1 = src_y0 + (ty1 - ty0)
            src_z0 = tz0 - write_z0
            src_z1 = src_z0 + (tz1 - tz0)

            # Ensure slice indices are within volume bounds
            src_x0 = max(0, src_x0); src_y0 = max(0, src_y0); src_z0 = max(0, src_z0)
            src_x1 = min(volume_xyzc.shape[0], src_x1)
            src_y1 = min(volume_xyzc.shape[1], src_y1)
            src_z1 = min(volume_xyzc.shape[2], src_z1)

            logger.info(f"Clipped write region x:[{tx0}:{tx1}] y:[{ty0}:{ty1}] z:[{tz0}:{tz1}], src slice x:[{src_x0}:{src_x1}] y:[{src_y0}:{src_y1}] z:[{src_z0}:{src_z1}]")

            try:
                cv[tx0:tx1, ty0:ty1, tz0:tz1] = volume_xyzc[src_x0:src_x1, src_y0:src_y1, src_z0:src_z1, ...]
                logger.info(f"Successfully wrote clipped volume to {cv_path} at mip={source_scale_index}")
            except Exception as e:
                logger.error(f"Failed to save volume to CloudVolume: {e}")

        # Return the CloudVolume path for potential use in meshing or other operations
        return cv_path
