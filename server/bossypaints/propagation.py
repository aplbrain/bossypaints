from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

import numpy as np
from scipy import ndimage as ndi
from skimage import exposure, filters, measure, morphology
from skimage.draw import polygon as rasterize_polygon
from skimage.segmentation import random_walker

from bossypaints.checkpoints import Polygon
from bossypaints.tasks import TaskInDB
from bossypaints.unrenderer import volume_to_polygons


@dataclass(frozen=True)
class CropBox:
    x0: int
    x1: int
    y0: int
    y1: int

    @property
    def width(self) -> int:
        return self.x1 - self.x0

    @property
    def height(self) -> int:
        return self.y1 - self.y0


SliceLoader = Callable[[int, CropBox], np.ndarray]


@dataclass
class PropagationContext:
    task: TaskInDB
    segment_id: int
    source_z: int
    target_z: int
    source_polygons: list[Polygon]
    load_slice: SliceLoader
    options: dict[str, Any] = field(default_factory=dict)


@dataclass
class PropagationResult:
    method: str
    display_name: str
    polygons: list[Polygon]
    meta: dict[str, Any] = field(default_factory=dict)


class PropagationMethod(Protocol):
    name: str
    display_name: str

    def run(self, context: PropagationContext) -> PropagationResult:
        ...


_PROPAGATION_METHODS: dict[str, PropagationMethod] = {}


def register_propagation_method(method: PropagationMethod) -> None:
    _PROPAGATION_METHODS[method.name] = method


def list_propagation_methods() -> list[str]:
    return sorted(_PROPAGATION_METHODS.keys())


def propagate_segment(method_name: str, context: PropagationContext) -> PropagationResult:
    method = _PROPAGATION_METHODS.get(method_name)
    if method is None:
        available = ", ".join(list_propagation_methods())
        raise ValueError(f"Unknown propagation method '{method_name}'. Available methods: {available}")
    return method.run(context)


class CopyPropagationMethod:
    name = "copy"
    display_name = "Copy"

    def run(self, context: PropagationContext) -> PropagationResult:
        polygons = [_clone_polygon_to_layer(polygon, context.target_z) for polygon in context.source_polygons]
        return PropagationResult(
            method=self.name,
            display_name=self.display_name,
            polygons=polygons,
            meta={"copied_polygon_count": len(polygons)},
        )


class RandomWalkerPropagationMethod:
    name = "random_walker"
    display_name = "Random Walker"

    def run(self, context: PropagationContext) -> PropagationResult:
        if not context.source_polygons:
            raise ValueError("No source polygons were provided for propagation.")

        corridor_radius = int(context.options.get("corridor_radius", 10))
        foreground_erode_radius = int(context.options.get("foreground_erode_radius", 2))
        background_dilate_radius = int(
            context.options.get(
                "background_dilate_radius",
                min(max(foreground_erode_radius + 2, 4), max(corridor_radius - 2, 4)),
            )
        )
        padding = int(context.options.get("padding", corridor_radius + 12))
        padding = max(padding, corridor_radius + 8)

        crop_box = _polygon_bbox(context.source_polygons, context.task, padding)
        source_mask = _rasterize_polygons_to_mask(
            polygons=context.source_polygons,
            task=context.task,
            crop_box=crop_box,
        )
        if not source_mask.any():
            raise ValueError("Source polygons did not rasterize to a non-empty mask.")

        target_image = context.load_slice(context.target_z, crop_box)
        if target_image.ndim != 2:
            raise ValueError("Propagation expects a single-channel 2D target slice.")

        target_image = _prepare_grayscale_image(
            target_image,
            gaussian_sigma=float(context.options.get("gaussian_sigma", 1.0)),
        )
        markers, corridor_mask = _build_random_walker_markers(
            source_mask=source_mask,
            corridor_radius=corridor_radius,
            foreground_erode_radius=foreground_erode_radius,
            background_dilate_radius=background_dilate_radius,
        )

        labels = random_walker(
            target_image,
            markers,
            beta=float(context.options.get("beta", 180.0)),
            mode=str(context.options.get("mode", "cg_j")),
            tol=float(context.options.get("tol", 1e-3)),
        )
        segmented = labels == 1
        segmented &= corridor_mask

        if bool(context.options.get("fill_holes", True)):
            segmented = ndi.binary_fill_holes(segmented)

        min_area_px = int(context.options.get("min_area_px", 12))
        if min_area_px > 1:
            segmented = morphology.remove_small_objects(segmented, min_size=min_area_px)

        segmented = _keep_components_connected_to_seed(segmented, markers == 1)
        if not segmented.any():
            raise ValueError("Random walker returned an empty segmentation.")

        polygons = _mask_to_polygons(
            mask_yx=segmented,
            task=context.task,
            segment_id=context.segment_id,
            target_z=context.target_z,
            crop_box=crop_box,
            min_area_px=min_area_px,
            simplify_tolerance=float(context.options.get("simplify_tolerance", 1.0)),
        )
        if not polygons:
            raise ValueError("Random walker segmentation could not be converted into polygons.")

        return PropagationResult(
            method=self.name,
            display_name=self.display_name,
            polygons=polygons,
            meta={
                "crop_box": {
                    "x0": crop_box.x0,
                    "x1": crop_box.x1,
                    "y0": crop_box.y0,
                    "y1": crop_box.y1,
                },
                "seed_pixels": {
                    "foreground": int(np.count_nonzero(markers == 1)),
                    "background": int(np.count_nonzero(markers == 2)),
                },
                "radii": {
                    "corridor_radius": corridor_radius,
                    "foreground_erode_radius": foreground_erode_radius,
                    "background_dilate_radius": background_dilate_radius,
                },
                "segmented_pixels": int(np.count_nonzero(segmented)),
            },
        )


def _clone_polygon_to_layer(polygon: Polygon, z: int) -> Polygon:
    return Polygon(
        positiveRegions=[
            [(float(x), float(y)) for x, y in region]
            for region in polygon.positiveRegions
        ],
        negativeRegions=[
            [(float(x), float(y)) for x, y in region]
            for region in polygon.negativeRegions
        ],
        editing=False,
        segmentID=polygon.segmentID,
        color=polygon.color,
        z=z,
    )


def _polygon_bbox(polygons: list[Polygon], task: TaskInDB, padding: int) -> CropBox:
    res_factor = 2 ** task.resolution
    x_values: list[float] = []
    y_values: list[float] = []

    for polygon in polygons:
        for region in polygon.positiveRegions + polygon.negativeRegions:
            if len(region) < 3:
                continue
            points = np.asarray(region, dtype=np.float32)
            x_values.extend((points[:, 0] / res_factor).tolist())
            y_values.extend((points[:, 1] / res_factor).tolist())

    if not x_values or not y_values:
        raise ValueError("No polygon vertices were available to compute a propagation crop.")

    x0 = max(task.x_min, int(np.floor(min(x_values))) - padding)
    x1 = min(task.x_max, int(np.ceil(max(x_values))) + padding + 1)
    y0 = max(task.y_min, int(np.floor(min(y_values))) - padding)
    y1 = min(task.y_max, int(np.ceil(max(y_values))) + padding + 1)

    if x1 <= x0 or y1 <= y0:
        raise ValueError("Propagation crop collapsed after clipping to task bounds.")

    return CropBox(x0=x0, x1=x1, y0=y0, y1=y1)


def _rasterize_polygons_to_mask(
    polygons: list[Polygon],
    task: TaskInDB,
    crop_box: CropBox,
) -> np.ndarray:
    mask = np.zeros((crop_box.height, crop_box.width), dtype=bool)
    res_factor = 2 ** task.resolution

    for polygon in polygons:
        for region in polygon.positiveRegions:
            _rasterize_region_into_mask(mask, region, crop_box, res_factor, True)
        for region in polygon.negativeRegions:
            _rasterize_region_into_mask(mask, region, crop_box, res_factor, False)

    return mask


def _rasterize_region_into_mask(
    mask: np.ndarray,
    region: list[tuple[float, float]],
    crop_box: CropBox,
    res_factor: int,
    value: bool,
) -> None:
    if len(region) < 3:
        return

    points = np.asarray(region, dtype=np.float32)
    points_x = points[:, 0] / res_factor - crop_box.x0
    points_y = points[:, 1] / res_factor - crop_box.y0
    rr, cc = rasterize_polygon(points_y, points_x, shape=mask.shape)
    mask[rr, cc] = value


def _prepare_grayscale_image(image: np.ndarray, gaussian_sigma: float) -> np.ndarray:
    normalized = exposure.rescale_intensity(image.astype(np.float32), out_range=(0.0, 1.0))
    if gaussian_sigma > 0:
        normalized = filters.gaussian(normalized, sigma=gaussian_sigma, preserve_range=True)
    return normalized.astype(np.float32)


def _build_random_walker_markers(
    source_mask: np.ndarray,
    corridor_radius: int,
    foreground_erode_radius: int,
    background_dilate_radius: int,
) -> tuple[np.ndarray, np.ndarray]:
    corridor_radius = max(corridor_radius, 1)
    foreground_erode_radius = max(foreground_erode_radius, 0)
    background_dilate_radius = max(background_dilate_radius, foreground_erode_radius + 1)
    background_dilate_radius = min(background_dilate_radius, corridor_radius)

    corridor_structure = morphology.disk(corridor_radius)
    corridor_mask = ndi.binary_dilation(source_mask, structure=corridor_structure)

    if foreground_erode_radius > 0:
        erode_structure = morphology.disk(foreground_erode_radius)
        foreground_seed = ndi.binary_erosion(source_mask, structure=erode_structure)
    else:
        foreground_seed = source_mask.copy()

    if not foreground_seed.any():
        foreground_seed = source_mask.copy()

    background_structure = morphology.disk(background_dilate_radius)
    exclusion_mask = ndi.binary_dilation(source_mask, structure=background_structure)
    background_seed = corridor_mask & ~exclusion_mask
    background_seed |= ~corridor_mask
    if not background_seed.any():
        background_seed = np.zeros_like(source_mask, dtype=bool)
        background_seed[[0, -1], :] = True
        background_seed[:, [0, -1]] = True
        background_seed &= ~foreground_seed

    if not foreground_seed.any() or not background_seed.any():
        raise ValueError("Could not build both foreground and background seeds for propagation.")

    markers = np.zeros(source_mask.shape, dtype=np.uint8)
    markers[background_seed] = 2
    markers[foreground_seed] = 1
    return markers, corridor_mask


def _keep_components_connected_to_seed(mask: np.ndarray, seed_mask: np.ndarray) -> np.ndarray:
    if not mask.any():
        return mask

    labels = measure.label(mask, connectivity=1)
    seeded_labels = np.unique(labels[seed_mask])
    seeded_labels = seeded_labels[seeded_labels > 0]

    if seeded_labels.size == 0:
        return mask

    return np.isin(labels, seeded_labels)


def _mask_to_polygons(
    mask_yx: np.ndarray,
    task: TaskInDB,
    segment_id: int,
    target_z: int,
    crop_box: CropBox,
    min_area_px: int,
    simplify_tolerance: float,
) -> list[Polygon]:
    mask_xy = mask_yx.T.astype(bool, copy=False)
    volume = np.zeros((crop_box.width, crop_box.height, 1), dtype=np.uint64)
    volume[:, :, 0] = np.where(mask_xy, np.uint64(segment_id), np.uint64(0))

    checkpoints = volume_to_polygons(
        volume=volume,
        task=task,
        segment_ids=[segment_id],
        min_area_px=min_area_px,
        simplify_tolerance=simplify_tolerance,
        tile_origin=(
            crop_box.x0 - task.x_min,
            crop_box.y0 - task.y_min,
            target_z - task.z_min,
        ),
    )
    if not checkpoints:
        return []
    return checkpoints[0].polygons


register_propagation_method(CopyPropagationMethod())
register_propagation_method(RandomWalkerPropagationMethod())
