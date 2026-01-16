import logging
import math
from typing import Iterable

import numpy as np
from skimage import measure

from bossypaints.checkpoints import Checkpoint, Polygon
from bossypaints.tasks import TaskInDB

logger = logging.getLogger(__name__)


def volume_to_polygons(
    volume: np.ndarray,
    task: TaskInDB,
    segment_ids: list[int] | None = None,
    *,
    min_area_px: int = 4,
    simplify_tolerance: float = 0.0,
    tile_origin: tuple[int, int, int] | None = None,
    keep_bbox: tuple[int, int, int, int] | None = None,
) -> list[Checkpoint]:
    """Convert a segmentation volume into checkpoint polygons.

    Arguments:
        volume: Segmentation volume as (x, y, z) or (x, y, z, c).
        task: TaskInDB providing bounds and resolution.
        segment_ids: Optional segment IDs to include; for channel volumes this
            maps channel index -> segment ID.
        min_area_px: Remove regions with area <= this size (in pixels).
        simplify_tolerance: Polygon simplification tolerance in pixels.
        tile_origin: Optional (x, y, z) offset for tiled volumes, in task
            resolution voxel units.
        keep_bbox: Optional (x0, y0, x1, y1) in tile-local voxel coords; only
            keep polygons whose centroid falls inside this box (stitching aid).
    """
    if volume.ndim not in (3, 4):
        raise ValueError("volume must have shape (x, y, z) or (x, y, z, c)")

    z_size = volume.shape[2]
    res_factor = 2**task.resolution
    origin_x, origin_y, origin_z = tile_origin or (0, 0, 0)

    polygons: list[Polygon] = []
    for z in range(z_size):
        if volume.ndim == 3:
            slice_xy = volume[:, :, z]
            seg_ids = segment_ids or _unique_segment_ids(slice_xy)
            for seg_id in seg_ids:
                if seg_id == 0:
                    continue
                mask_xy = slice_xy == seg_id
                polygons.extend(
                    _polygons_from_mask(
                        mask_xy,
                        seg_id,
                        z,
                        task,
                        res_factor,
                        origin_x,
                        origin_y,
                        origin_z,
                        min_area_px,
                        simplify_tolerance,
                        keep_bbox,
                    )
                )
        else:
            channels = volume.shape[-1]
            for channel_idx in range(channels):
                slice_xy = volume[:, :, z, channel_idx]
                seg_id = _channel_segment_id(slice_xy, channel_idx, segment_ids)
                if seg_id == 0:
                    continue
                mask_xy = slice_xy != 0
                polygons.extend(
                    _polygons_from_mask(
                        mask_xy,
                        seg_id,
                        z,
                        task,
                        res_factor,
                        origin_x,
                        origin_y,
                        origin_z,
                        min_area_px,
                        simplify_tolerance,
                        keep_bbox,
                    )
                )

    return [Checkpoint(polygons=polygons, taskID=task.id)]


def _unique_segment_ids(slice_xy: np.ndarray) -> list[int]:
    ids = np.unique(slice_xy)
    return [int(seg_id) for seg_id in ids if seg_id != 0]


def _channel_segment_id(
    slice_xy: np.ndarray,
    channel_idx: int,
    segment_ids: list[int] | None,
) -> int:
    if segment_ids and channel_idx < len(segment_ids):
        return segment_ids[channel_idx]
    uniques = np.unique(slice_xy)
    uniques = uniques[uniques != 0]
    if len(uniques) == 1:
        return int(uniques[0])
    if len(uniques) > 1:
        logger.warning(
            "Channel %d has multiple segment IDs; using the first one.",
            channel_idx,
        )
        return int(uniques[0])
    return 0


def _polygons_from_mask(
    mask_xy: np.ndarray,
    segment_id: int,
    z_index: int,
    task: TaskInDB,
    res_factor: int,
    origin_x: int,
    origin_y: int,
    origin_z: int,
    min_area_px: int,
    simplify_tolerance: float,
    keep_bbox: tuple[int, int, int, int] | None,
) -> list[Polygon]:
    if not mask_xy.any():
        return []

    # Contour extraction expects (row, col) => (y, x) ordering.
    mask_yx = mask_xy.T
    labels = measure.label(mask_yx, connectivity=1)
    polygons: list[Polygon] = []

    for region in measure.regionprops(labels):
        if region.area <= min_area_px:
            continue
        if region.image.shape[0] < 2 or region.image.shape[1] < 2:
            continue

        padded = np.pad(region.image, 1, mode="constant", constant_values=0)
        outer = _largest_contour(measure.find_contours(padded, 0.5))
        if outer is None:
            continue

        outer = outer - 1
        outer = _simplify_contour(outer, simplify_tolerance)
        if outer is None:
            continue

        outer[:, 0] += region.bbox[0]
        outer[:, 1] += region.bbox[1]
        points_tile = np.stack([outer[:, 1], outer[:, 0]], axis=1)
        if keep_bbox and not _centroid_in_bbox(points_tile, keep_bbox):
            continue

        positive = _close_ring(
            _points_to_world(points_tile, task, res_factor, origin_x, origin_y)
        )
        negatives: list[list[tuple[float, float]]] = []

        holes_mask = region.filled_image & ~region.image
        if holes_mask.any():
            hole_labels = measure.label(holes_mask, connectivity=1)
            for hole in measure.regionprops(hole_labels):
                if hole.area <= min_area_px:
                    continue
                if hole.image.shape[0] < 2 or hole.image.shape[1] < 2:
                    continue
                hole_padded = np.pad(hole.image, 1, mode="constant", constant_values=0)
                hole_contour = _largest_contour(measure.find_contours(hole_padded, 0.5))
                if hole_contour is None:
                    continue
                hole_contour = hole_contour - 1
                hole_contour = _simplify_contour(hole_contour, simplify_tolerance)
                if hole_contour is None:
                    continue
                hole_contour[:, 0] += region.bbox[0] + hole.bbox[0]
                hole_contour[:, 1] += region.bbox[1] + hole.bbox[1]
                hole_points = np.stack([hole_contour[:, 1], hole_contour[:, 0]], axis=1)
                negatives.append(
                    _close_ring(
                        _points_to_world(
                            hole_points, task, res_factor, origin_x, origin_y
                        )
                    )
                )

        polygons.append(
            Polygon(
                positiveRegions=[positive],
                negativeRegions=negatives,
                editing=False,
                segmentID=segment_id,
                z=int(z_index + origin_z + task.z_min),
            )
        )

    return polygons


def _largest_contour(contours: Iterable[np.ndarray]) -> np.ndarray | None:
    contour_list = list(contours)
    if not contour_list:
        return None
    return max(contour_list, key=lambda c: c.shape[0])


def _simplify_contour(contour: np.ndarray, tolerance: float) -> np.ndarray | None:
    if contour.shape[0] < 3:
        return None
    if tolerance <= 0:
        simplified = contour
    else:
        simplified = measure.approximate_polygon(contour, tolerance)
    if simplified.shape[0] < 3:
        return None
    if np.allclose(simplified[0], simplified[-1]):
        simplified = simplified[:-1]
    if simplified.shape[0] < 3:
        return None
    return simplified


def _points_to_world(
    points_xy: np.ndarray,
    task: TaskInDB,
    res_factor: int,
    origin_x: int,
    origin_y: int,
) -> list[tuple[float, float]]:
    x_offset = origin_x + task.x_min
    y_offset = origin_y + task.y_min
    points = points_xy.copy()
    points[:, 0] = (points[:, 0] + x_offset) * res_factor
    points[:, 1] = (points[:, 1] + y_offset) * res_factor
    return [(float(x), float(y)) for x, y in points]


def _close_ring(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if not points:
        return points
    first = points[0]
    last = points[-1]
    if math.isclose(first[0], last[0], abs_tol=1e-6) and math.isclose(
        first[1], last[1], abs_tol=1e-6
    ):
        return points
    return list(points) + [first]


def _centroid_in_bbox(points_xy: np.ndarray, bbox: tuple[int, int, int, int]) -> bool:
    x0, y0, x1, y1 = bbox
    centroid = np.mean(points_xy, axis=0)
    return x0 <= centroid[0] < x1 and y0 <= centroid[1] < y1
