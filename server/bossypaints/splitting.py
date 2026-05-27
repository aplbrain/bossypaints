from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import maximum_flow
from skimage.draw import polygon as rasterize_polygon
from skimage.graph import MCP_Geometric

from bossypaints.checkpoints import Polygon
from bossypaints.tasks import TaskInDB
from bossypaints.unrenderer import volume_to_polygons

MODEL_EPSILON = 1e-6
RIDGE_LAMBDA = 1e-3
PERCEPTRON_MAX_ITERATIONS = 4096
DEFAULT_MIN_AREA_PX = 0
DEFAULT_SIMPLIFY_TOLERANCE = 0.0
GRAPH_CUT_SMOOTHNESS = 6
GRAPH_CUT_TERMINAL_SCALE = 48
INFINITE_TERMINAL_CAPACITY = 1_000_000_000
RED_LABEL = "red"
BLUE_LABEL = "blue"


@dataclass(frozen=True)
class CropBox3D:
    x0: int
    x1: int
    y0: int
    y1: int
    z0: int
    z1: int

    @property
    def width(self) -> int:
        return self.x1 - self.x0

    @property
    def height(self) -> int:
        return self.y1 - self.y0

    @property
    def depth(self) -> int:
        return self.z1 - self.z0


@dataclass(frozen=True)
class SplitSeed:
    x: float
    y: float
    z: int
    label: str


@dataclass
class SplitContext:
    task: TaskInDB
    source_segment_id: int
    new_segment_id: int
    source_polygons: list[Polygon]
    seeds: list[SplitSeed]
    options: dict[str, Any] = field(default_factory=dict)


@dataclass
class SplitResult:
    method: str
    display_name: str
    polygons: list[Polygon]
    meta: dict[str, Any] = field(default_factory=dict)


class SplitMethod(Protocol):
    name: str
    display_name: str

    def run(self, context: SplitContext) -> SplitResult:
        ...


_SPLIT_METHODS: dict[str, SplitMethod] = {}


def register_split_method(method: SplitMethod) -> None:
    _SPLIT_METHODS[method.name] = method


def list_split_methods() -> list[str]:
    return sorted(_SPLIT_METHODS.keys())


def split_segment(method_name: str, context: SplitContext) -> SplitResult:
    method = _SPLIT_METHODS.get(method_name)
    if method is None:
        available = ", ".join(list_split_methods())
        raise ValueError(f"Unknown split method '{method_name}'. Available methods: {available}")
    return method.run(context)


@dataclass(frozen=True)
class LinearSplitModel:
    means: np.ndarray
    scales: np.ndarray
    weights: np.ndarray
    bias: float


def _validate_seed_labels(seeds: list[SplitSeed]) -> None:
    invalid_labels = sorted({seed.label for seed in seeds if seed.label not in {RED_LABEL, BLUE_LABEL}})
    if invalid_labels:
        raise ValueError(f"Unsupported split seed labels: {', '.join(invalid_labels)}")


def _polygon_bbox_3d(
    polygons: list[Polygon],
    task: TaskInDB,
    padding_xy: int = 0,
    padding_z: int = 0,
) -> CropBox3D:
    res_factor = 2 ** task.resolution
    x_values: list[float] = []
    y_values: list[float] = []
    z_values: list[int] = []

    for polygon in polygons:
        z_values.append(int(polygon.z))
        for region in polygon.positiveRegions + polygon.negativeRegions:
            if len(region) < 3:
                continue
            points = np.asarray(region, dtype=np.float32)
            x_values.extend((points[:, 0] / res_factor).tolist())
            y_values.extend((points[:, 1] / res_factor).tolist())

    if not x_values or not y_values or not z_values:
        raise ValueError("No polygon vertices were available to compute a split crop.")

    x0 = max(task.x_min, int(np.floor(min(x_values))) - padding_xy)
    x1 = min(task.x_max, int(np.ceil(max(x_values))) + padding_xy + 1)
    y0 = max(task.y_min, int(np.floor(min(y_values))) - padding_xy)
    y1 = min(task.y_max, int(np.ceil(max(y_values))) + padding_xy + 1)
    z0 = max(task.z_min, min(z_values) - padding_z)
    z1 = min(task.z_max, max(z_values) + padding_z + 1)

    if x1 <= x0 or y1 <= y0 or z1 <= z0:
        raise ValueError("Split crop collapsed after clipping to task bounds.")

    return CropBox3D(x0=x0, x1=x1, y0=y0, y1=y1, z0=z0, z1=z1)


def _rasterize_region_into_mask(
    mask_yx: np.ndarray,
    region: list[tuple[float, float]],
    crop_box: CropBox3D,
    res_factor: int,
    value: bool,
) -> None:
    if len(region) < 3:
        return

    points = np.asarray(region, dtype=np.float32)
    points_x = points[:, 0] / res_factor - crop_box.x0
    points_y = points[:, 1] / res_factor - crop_box.y0
    rr, cc = rasterize_polygon(points_y, points_x, shape=mask_yx.shape)
    mask_yx[rr, cc] = value


def _rasterize_polygons_to_volume_mask(
    polygons: list[Polygon],
    task: TaskInDB,
    crop_box: CropBox3D,
) -> np.ndarray:
    mask_zyx = np.zeros((crop_box.depth, crop_box.height, crop_box.width), dtype=bool)
    res_factor = 2 ** task.resolution

    for polygon in polygons:
        local_z = polygon.z - crop_box.z0
        if local_z < 0 or local_z >= crop_box.depth:
            continue

        slice_mask = mask_zyx[local_z]
        for region in polygon.positiveRegions:
            _rasterize_region_into_mask(slice_mask, region, crop_box, res_factor, True)
        for region in polygon.negativeRegions:
            _rasterize_region_into_mask(slice_mask, region, crop_box, res_factor, False)

    return mask_zyx


def _seed_to_local_voxel(seed: SplitSeed, task: TaskInDB, crop_box: CropBox3D) -> tuple[int, int, int]:
    res_factor = 2 ** task.resolution
    local_x = int(np.rint(seed.x / res_factor - crop_box.x0))
    local_y = int(np.rint(seed.y / res_factor - crop_box.y0))
    local_z = int(seed.z - crop_box.z0)

    local_x = int(np.clip(local_x, 0, max(crop_box.width - 1, 0)))
    local_y = int(np.clip(local_y, 0, max(crop_box.height - 1, 0)))
    local_z = int(np.clip(local_z, 0, max(crop_box.depth - 1, 0)))
    return (local_z, local_y, local_x)


def _snap_seed_to_mask(
    local_seed: tuple[int, int, int],
    mask_zyx: np.ndarray,
    occupied_coords_zyx: np.ndarray,
    occupied_coords_by_z: dict[int, np.ndarray],
) -> tuple[int, int, int]:
    if mask_zyx[local_seed]:
        return local_seed

    local_z, local_y, local_x = local_seed
    same_slice_coords = occupied_coords_by_z.get(local_z)
    if same_slice_coords is not None and same_slice_coords.size > 0:
        deltas = same_slice_coords[:, 1:] - np.asarray([local_y, local_x], dtype=np.int32)
        nearest_index = int(np.argmin(np.sum(deltas * deltas, axis=1)))
        snapped_y, snapped_x = same_slice_coords[nearest_index]
        return (local_z, int(snapped_y), int(snapped_x))

    if occupied_coords_zyx.size == 0:
        raise ValueError("Selected segment did not rasterize to a non-empty 3D mask.")

    deltas = occupied_coords_zyx - np.asarray(local_seed, dtype=np.int32)
    nearest_index = int(np.argmin(np.sum(deltas * deltas, axis=1)))
    snapped_z, snapped_y, snapped_x = occupied_coords_zyx[nearest_index]
    return (int(snapped_z), int(snapped_y), int(snapped_x))


def _prepare_seed_voxels(
    context: SplitContext,
    crop_box: CropBox3D,
    mask_zyx: np.ndarray,
) -> tuple[list[tuple[int, int, int]], list[tuple[int, int, int]]]:
    _validate_seed_labels(context.seeds)
    occupied_coords_zyx = np.argwhere(mask_zyx)
    occupied_coords_by_z = {
        z: occupied_coords_zyx[occupied_coords_zyx[:, 0] == z][:, 1:]
        for z in np.unique(occupied_coords_zyx[:, 0])
    }

    red_seed_voxels: set[tuple[int, int, int]] = set()
    blue_seed_voxels: set[tuple[int, int, int]] = set()

    for seed in context.seeds:
        snapped_seed = _snap_seed_to_mask(
            _seed_to_local_voxel(seed, context.task, crop_box),
            mask_zyx,
            occupied_coords_zyx,
            occupied_coords_by_z,
        )
        if seed.label == RED_LABEL:
            red_seed_voxels.add(snapped_seed)
        else:
            blue_seed_voxels.add(snapped_seed)

    if not red_seed_voxels or not blue_seed_voxels:
        raise ValueError("Place at least one red seed and one blue seed before splitting.")

    overlap = red_seed_voxels.intersection(blue_seed_voxels)
    if overlap:
        raise ValueError("Red and blue seeds collapsed onto the same voxel. Spread them apart.")

    return sorted(red_seed_voxels), sorted(blue_seed_voxels)


def _local_voxels_to_xyz(voxels_zyx: list[tuple[int, int, int]]) -> np.ndarray:
    return np.asarray([[x, y, z] for z, y, x in voxels_zyx], dtype=np.float32)


def _normalize_xyz(points_xyz: np.ndarray, means: np.ndarray, scales: np.ndarray) -> np.ndarray:
    return (points_xyz - means) / scales


def _build_centroid_bisector_model(seed_points_xyz: np.ndarray, labels: np.ndarray) -> LinearSplitModel:
    red_points = seed_points_xyz[labels < 0]
    blue_points = seed_points_xyz[labels > 0]
    red_centroid = np.mean(red_points, axis=0)
    blue_centroid = np.mean(blue_points, axis=0)
    weights = blue_centroid - red_centroid
    if np.all(np.abs(weights) < MODEL_EPSILON):
        raise ValueError("The provided seeds do not define a stable split.")

    midpoint = (red_centroid + blue_centroid) / 2.0
    return LinearSplitModel(
        means=np.zeros(3, dtype=np.float32),
        scales=np.ones(3, dtype=np.float32),
        weights=weights.astype(np.float32),
        bias=float(-np.dot(weights, midpoint)),
    )


def _refine_linear_model_with_perceptron(
    seed_points_xyz: np.ndarray,
    labels: np.ndarray,
    model: LinearSplitModel,
) -> LinearSplitModel:
    normalized_points = _normalize_xyz(seed_points_xyz, model.means, model.scales)
    weights = model.weights.astype(np.float64, copy=True)
    bias = float(model.bias)

    for _ in range(PERCEPTRON_MAX_ITERATIONS):
        made_update = False
        for point, label in zip(normalized_points, labels):
            score = float(np.dot(weights, point) + bias)
            if label * score > MODEL_EPSILON:
                continue
            weights += label * point
            bias += float(label)
            made_update = True

        if not made_update:
            return LinearSplitModel(
                means=model.means,
                scales=model.scales,
                weights=weights.astype(np.float32),
                bias=bias,
            )

    return model


def _fit_linear_model(seed_points_xyz: np.ndarray, labels: np.ndarray) -> LinearSplitModel:
    means = seed_points_xyz.mean(axis=0)
    scales = seed_points_xyz.std(axis=0)
    scales = np.where(scales > MODEL_EPSILON, scales, 1.0).astype(np.float32)

    normalized_points = _normalize_xyz(seed_points_xyz, means, scales)
    design_matrix = np.concatenate(
        [normalized_points, np.ones((normalized_points.shape[0], 1), dtype=np.float32)],
        axis=1,
    )
    normal_matrix = design_matrix.T @ design_matrix
    normal_matrix[:3, :3] += np.eye(3, dtype=np.float32) * RIDGE_LAMBDA
    rhs_vector = design_matrix.T @ labels.astype(np.float32)

    try:
        solution = np.linalg.solve(normal_matrix, rhs_vector)
    except np.linalg.LinAlgError:
        solution = None

    if solution is None:
        return _build_centroid_bisector_model(seed_points_xyz, labels)

    model = LinearSplitModel(
        means=means.astype(np.float32),
        scales=scales,
        weights=solution[:3].astype(np.float32),
        bias=float(solution[3]),
    )
    return _refine_linear_model_with_perceptron(seed_points_xyz, labels, model)


def _evaluate_linear_model(model: LinearSplitModel, points_xyz: np.ndarray) -> np.ndarray:
    normalized_points = _normalize_xyz(points_xyz, model.means, model.scales)
    return normalized_points @ model.weights + model.bias


def _assign_unresolved_voxels_by_seed_distance(
    unresolved_coords_zyx: np.ndarray,
    red_seed_voxels: list[tuple[int, int, int]],
    blue_seed_voxels: list[tuple[int, int, int]],
) -> np.ndarray:
    red_distance_sq = _nearest_seed_distance_sq(unresolved_coords_zyx, red_seed_voxels)
    blue_distance_sq = _nearest_seed_distance_sq(unresolved_coords_zyx, blue_seed_voxels)
    return blue_distance_sq < red_distance_sq


def _nearest_seed_distance_sq(
    coords_zyx: np.ndarray,
    seed_voxels: list[tuple[int, int, int]],
) -> np.ndarray:
    seed_array = np.asarray(seed_voxels, dtype=np.int32)
    return np.min(
        np.sum((coords_zyx[:, None, :] - seed_array[None, :, :]) ** 2, axis=2),
        axis=1,
    )


def _build_mask_from_selected_coords(
    shape: tuple[int, int, int],
    coords_zyx: np.ndarray,
) -> np.ndarray:
    mask = np.zeros(shape, dtype=bool)
    if coords_zyx.size > 0:
        mask[coords_zyx[:, 0], coords_zyx[:, 1], coords_zyx[:, 2]] = True
    return mask


def _volume_mask_to_polygons(
    red_mask_zyx: np.ndarray,
    blue_mask_zyx: np.ndarray,
    context: SplitContext,
    crop_box: CropBox3D,
) -> list[Polygon]:
    volume = np.zeros((crop_box.width, crop_box.height, crop_box.depth), dtype=np.uint64)
    volume[np.transpose(red_mask_zyx, (2, 1, 0))] = np.uint64(context.source_segment_id)
    volume[np.transpose(blue_mask_zyx, (2, 1, 0))] = np.uint64(context.new_segment_id)

    checkpoints = volume_to_polygons(
        volume=volume,
        task=context.task,
        segment_ids=[context.source_segment_id, context.new_segment_id],
        min_area_px=int(context.options.get("min_area_px", DEFAULT_MIN_AREA_PX)),
        simplify_tolerance=float(
            context.options.get("simplify_tolerance", DEFAULT_SIMPLIFY_TOLERANCE)
        ),
        tile_origin=(
            crop_box.x0 - context.task.x_min,
            crop_box.y0 - context.task.y_min,
            crop_box.z0 - context.task.z_min,
        ),
    )
    if not checkpoints:
        return []
    return checkpoints[0].polygons


def _build_result_meta(
    crop_box: CropBox3D,
    red_seed_voxels: list[tuple[int, int, int]],
    blue_seed_voxels: list[tuple[int, int, int]],
    red_mask_zyx: np.ndarray,
    blue_mask_zyx: np.ndarray,
) -> dict[str, Any]:
    red_slice_count = int(np.count_nonzero(np.any(red_mask_zyx, axis=(1, 2))))
    blue_slice_count = int(np.count_nonzero(np.any(blue_mask_zyx, axis=(1, 2))))
    return {
        "crop_box": {
            "x0": crop_box.x0,
            "x1": crop_box.x1,
            "y0": crop_box.y0,
            "y1": crop_box.y1,
            "z0": crop_box.z0,
            "z1": crop_box.z1,
        },
        "seed_voxels": {
            RED_LABEL: len(red_seed_voxels),
            BLUE_LABEL: len(blue_seed_voxels),
        },
        "voxel_counts": {
            RED_LABEL: int(np.count_nonzero(red_mask_zyx)),
            BLUE_LABEL: int(np.count_nonzero(blue_mask_zyx)),
        },
        "slice_counts": {
            RED_LABEL: red_slice_count,
            BLUE_LABEL: blue_slice_count,
            "modified": int(np.count_nonzero(np.any(red_mask_zyx | blue_mask_zyx, axis=(1, 2)))),
        },
    }


def _solve_split_masks(
    context: SplitContext,
    method_name: str,
) -> tuple[np.ndarray, np.ndarray, CropBox3D, list[tuple[int, int, int]], list[tuple[int, int, int]]]:
    if not context.source_polygons:
        raise ValueError("No source polygons were provided for the selected segment.")

    crop_box = _polygon_bbox_3d(
        context.source_polygons,
        context.task,
        padding_xy=int(context.options.get("padding_xy", 0)),
        padding_z=int(context.options.get("padding_z", 0)),
    )
    source_mask_zyx = _rasterize_polygons_to_volume_mask(context.source_polygons, context.task, crop_box)
    if not source_mask_zyx.any():
        raise ValueError("Selected segment did not rasterize to a non-empty 3D mask.")

    red_seed_voxels, blue_seed_voxels = _prepare_seed_voxels(context, crop_box, source_mask_zyx)
    method = _SPLIT_METHODS[method_name]
    red_mask_zyx, blue_mask_zyx = method.solve_masks(
        context,
        source_mask_zyx,
        red_seed_voxels,
        blue_seed_voxels,
    )

    if not red_mask_zyx.any() or not blue_mask_zyx.any():
        raise ValueError("The current split does not separate the selected segment.")

    if np.any(red_mask_zyx & blue_mask_zyx):
        raise ValueError("Split produced overlapping segment assignments.")

    return red_mask_zyx, blue_mask_zyx, crop_box, red_seed_voxels, blue_seed_voxels


class LinearSplitMethod:
    name = "linear"
    display_name = "Linear"

    def run(self, context: SplitContext) -> SplitResult:
        red_mask_zyx, blue_mask_zyx, crop_box, red_seed_voxels, blue_seed_voxels = _solve_split_masks(
            context,
            self.name,
        )
        polygons = _volume_mask_to_polygons(red_mask_zyx, blue_mask_zyx, context, crop_box)
        if not polygons:
            raise ValueError("Linear split could not be converted back into polygons.")
        return SplitResult(
            method=self.name,
            display_name=self.display_name,
            polygons=polygons,
            meta=_build_result_meta(crop_box, red_seed_voxels, blue_seed_voxels, red_mask_zyx, blue_mask_zyx),
        )

    def solve_masks(
        self,
        context: SplitContext,
        source_mask_zyx: np.ndarray,
        red_seed_voxels: list[tuple[int, int, int]],
        blue_seed_voxels: list[tuple[int, int, int]],
    ) -> tuple[np.ndarray, np.ndarray]:
        seed_points_xyz = np.concatenate(
            [_local_voxels_to_xyz(red_seed_voxels), _local_voxels_to_xyz(blue_seed_voxels)],
            axis=0,
        )
        labels = np.concatenate(
            [
                np.full(len(red_seed_voxels), -1, dtype=np.float32),
                np.full(len(blue_seed_voxels), 1, dtype=np.float32),
            ]
        )
        model = _fit_linear_model(seed_points_xyz, labels)

        occupied_coords_zyx = np.argwhere(source_mask_zyx)
        occupied_points_xyz = np.stack(
            [
                occupied_coords_zyx[:, 2],
                occupied_coords_zyx[:, 1],
                occupied_coords_zyx[:, 0],
            ],
            axis=1,
        ).astype(np.float32)
        scores = _evaluate_linear_model(model, occupied_points_xyz)
        blue_coords_zyx = occupied_coords_zyx[scores >= 0]
        blue_mask_zyx = _build_mask_from_selected_coords(source_mask_zyx.shape, blue_coords_zyx)
        if blue_seed_voxels:
            blue_seed_array = np.asarray(blue_seed_voxels, dtype=np.int32)
            blue_mask_zyx[blue_seed_array[:, 0], blue_seed_array[:, 1], blue_seed_array[:, 2]] = True
        if red_seed_voxels:
            red_seed_array = np.asarray(red_seed_voxels, dtype=np.int32)
            blue_mask_zyx[red_seed_array[:, 0], red_seed_array[:, 1], red_seed_array[:, 2]] = False
        red_mask_zyx = source_mask_zyx & ~blue_mask_zyx
        return red_mask_zyx, blue_mask_zyx


class GeodesicSplitMethod:
    name = "geodesic"
    display_name = "Geodesic"

    def run(self, context: SplitContext) -> SplitResult:
        red_mask_zyx, blue_mask_zyx, crop_box, red_seed_voxels, blue_seed_voxels = _solve_split_masks(
            context,
            self.name,
        )
        polygons = _volume_mask_to_polygons(red_mask_zyx, blue_mask_zyx, context, crop_box)
        if not polygons:
            raise ValueError("Geodesic split could not be converted back into polygons.")
        return SplitResult(
            method=self.name,
            display_name=self.display_name,
            polygons=polygons,
            meta=_build_result_meta(crop_box, red_seed_voxels, blue_seed_voxels, red_mask_zyx, blue_mask_zyx),
        )

    def solve_masks(
        self,
        context: SplitContext,
        source_mask_zyx: np.ndarray,
        red_seed_voxels: list[tuple[int, int, int]],
        blue_seed_voxels: list[tuple[int, int, int]],
    ) -> tuple[np.ndarray, np.ndarray]:
        costs = np.where(source_mask_zyx, 1.0, np.inf).astype(np.float32)

        red_costs, _ = MCP_Geometric(costs).find_costs(red_seed_voxels)
        blue_costs, _ = MCP_Geometric(costs).find_costs(blue_seed_voxels)

        blue_mask_zyx = source_mask_zyx & (
            (blue_costs < red_costs)
            | (~np.isfinite(red_costs) & np.isfinite(blue_costs))
        )
        unresolved_mask = source_mask_zyx & ~np.isfinite(red_costs) & ~np.isfinite(blue_costs)
        if unresolved_mask.any():
            unresolved_coords_zyx = np.argwhere(unresolved_mask)
            assign_blue = _assign_unresolved_voxels_by_seed_distance(
                unresolved_coords_zyx,
                red_seed_voxels,
                blue_seed_voxels,
            )
            blue_mask_zyx[
                unresolved_coords_zyx[assign_blue, 0],
                unresolved_coords_zyx[assign_blue, 1],
                unresolved_coords_zyx[assign_blue, 2],
            ] = True

        if blue_seed_voxels:
            blue_seed_array = np.asarray(blue_seed_voxels, dtype=np.int32)
            blue_mask_zyx[blue_seed_array[:, 0], blue_seed_array[:, 1], blue_seed_array[:, 2]] = True
        if red_seed_voxels:
            red_seed_array = np.asarray(red_seed_voxels, dtype=np.int32)
            blue_mask_zyx[red_seed_array[:, 0], red_seed_array[:, 1], red_seed_array[:, 2]] = False
        red_mask_zyx = source_mask_zyx & ~blue_mask_zyx
        return red_mask_zyx, blue_mask_zyx


class GraphCutSplitMethod:
    name = "graph_cut"
    display_name = "Graph Cut"

    def run(self, context: SplitContext) -> SplitResult:
        red_mask_zyx, blue_mask_zyx, crop_box, red_seed_voxels, blue_seed_voxels = _solve_split_masks(
            context,
            self.name,
        )
        polygons = _volume_mask_to_polygons(red_mask_zyx, blue_mask_zyx, context, crop_box)
        if not polygons:
            raise ValueError("Graph cut split could not be converted back into polygons.")
        return SplitResult(
            method=self.name,
            display_name=self.display_name,
            polygons=polygons,
            meta=_build_result_meta(crop_box, red_seed_voxels, blue_seed_voxels, red_mask_zyx, blue_mask_zyx),
        )

    def solve_masks(
        self,
        context: SplitContext,
        source_mask_zyx: np.ndarray,
        red_seed_voxels: list[tuple[int, int, int]],
        blue_seed_voxels: list[tuple[int, int, int]],
    ) -> tuple[np.ndarray, np.ndarray]:
        geodesic_costs = np.where(source_mask_zyx, 1.0, np.inf).astype(np.float32)
        red_costs, _ = MCP_Geometric(geodesic_costs).find_costs(red_seed_voxels)
        blue_costs, _ = MCP_Geometric(geodesic_costs).find_costs(blue_seed_voxels)

        unresolved_red_mask = source_mask_zyx & ~np.isfinite(red_costs)
        if unresolved_red_mask.any():
            unresolved_red_coords = np.argwhere(unresolved_red_mask)
            red_costs[
                unresolved_red_coords[:, 0],
                unresolved_red_coords[:, 1],
                unresolved_red_coords[:, 2],
            ] = np.sqrt(_nearest_seed_distance_sq(unresolved_red_coords, red_seed_voxels))

        unresolved_blue_mask = source_mask_zyx & ~np.isfinite(blue_costs)
        if unresolved_blue_mask.any():
            unresolved_blue_coords = np.argwhere(unresolved_blue_mask)
            blue_costs[
                unresolved_blue_coords[:, 0],
                unresolved_blue_coords[:, 1],
                unresolved_blue_coords[:, 2],
            ] = np.sqrt(_nearest_seed_distance_sq(unresolved_blue_coords, blue_seed_voxels))

        node_ids = np.full(source_mask_zyx.shape, -1, dtype=np.int32)
        occupied_coords_zyx = np.argwhere(source_mask_zyx)
        node_ids[source_mask_zyx] = np.arange(occupied_coords_zyx.shape[0], dtype=np.int32)

        rows: list[int] = []
        cols: list[int] = []
        capacities: list[int] = []
        pairwise_weight = max(
            int(context.options.get("graph_cut_smoothness", GRAPH_CUT_SMOOTHNESS)),
            1,
        )
        terminal_scale = max(
            int(context.options.get("graph_cut_terminal_scale", GRAPH_CUT_TERMINAL_SCALE)),
            1,
        )

        def add_undirected_axis_edges(lhs: np.ndarray, rhs: np.ndarray) -> None:
            valid = (lhs >= 0) & (rhs >= 0)
            if not np.any(valid):
                return
            u = lhs[valid].astype(np.int64, copy=False)
            v = rhs[valid].astype(np.int64, copy=False)
            rows.extend(u.tolist())
            cols.extend(v.tolist())
            capacities.extend([pairwise_weight] * len(u))
            rows.extend(v.tolist())
            cols.extend(u.tolist())
            capacities.extend([pairwise_weight] * len(v))

        add_undirected_axis_edges(node_ids[:-1, :, :], node_ids[1:, :, :])
        add_undirected_axis_edges(node_ids[:, :-1, :], node_ids[:, 1:, :])
        add_undirected_axis_edges(node_ids[:, :, :-1], node_ids[:, :, 1:])

        node_count = occupied_coords_zyx.shape[0]
        source_node = node_count
        sink_node = node_count + 1
        red_seed_set = set(red_seed_voxels)
        blue_seed_set = set(blue_seed_voxels)

        for local_z, local_y, local_x in occupied_coords_zyx:
            node = int(node_ids[local_z, local_y, local_x])
            coord = (int(local_z), int(local_y), int(local_x))

            if coord in red_seed_set:
                source_capacity = INFINITE_TERMINAL_CAPACITY
                sink_capacity = 0
            elif coord in blue_seed_set:
                source_capacity = 0
                sink_capacity = INFINITE_TERMINAL_CAPACITY
            else:
                red_distance = float(red_costs[local_z, local_y, local_x])
                blue_distance = float(blue_costs[local_z, local_y, local_x])
                total_distance = max(red_distance + blue_distance, MODEL_EPSILON)
                source_capacity = max(
                    1,
                    int(round((blue_distance / total_distance) * terminal_scale)),
                )
                sink_capacity = max(
                    1,
                    int(round((red_distance / total_distance) * terminal_scale)),
                )

            if source_capacity > 0:
                rows.append(source_node)
                cols.append(node)
                capacities.append(source_capacity)
            if sink_capacity > 0:
                rows.append(node)
                cols.append(sink_node)
                capacities.append(sink_capacity)

        graph = coo_matrix(
            (
                np.asarray(capacities, dtype=np.int32),
                (np.asarray(rows, dtype=np.int32), np.asarray(cols, dtype=np.int32)),
            ),
            shape=(node_count + 2, node_count + 2),
        ).tocsr()

        flow_result = maximum_flow(graph, source_node, sink_node)
        residual = (graph - flow_result.flow).tocsr()

        reachable = np.zeros(node_count + 2, dtype=bool)
        stack = [source_node]
        while stack:
            node = stack.pop()
            if reachable[node]:
                continue
            reachable[node] = True
            start, end = residual.indptr[node], residual.indptr[node + 1]
            for edge_index in range(start, end):
                if residual.data[edge_index] <= 0:
                    continue
                neighbor = int(residual.indices[edge_index])
                if not reachable[neighbor]:
                    stack.append(neighbor)

        red_mask_zyx = np.zeros_like(source_mask_zyx, dtype=bool)
        if node_count > 0:
            red_coords_zyx = occupied_coords_zyx[reachable[:node_count]]
            red_mask_zyx = _build_mask_from_selected_coords(source_mask_zyx.shape, red_coords_zyx)
        blue_mask_zyx = source_mask_zyx & ~red_mask_zyx
        if blue_seed_voxels:
            blue_seed_array = np.asarray(blue_seed_voxels, dtype=np.int32)
            red_mask_zyx[blue_seed_array[:, 0], blue_seed_array[:, 1], blue_seed_array[:, 2]] = False
            blue_mask_zyx[blue_seed_array[:, 0], blue_seed_array[:, 1], blue_seed_array[:, 2]] = True
        if red_seed_voxels:
            red_seed_array = np.asarray(red_seed_voxels, dtype=np.int32)
            red_mask_zyx[red_seed_array[:, 0], red_seed_array[:, 1], red_seed_array[:, 2]] = True
            blue_mask_zyx[red_seed_array[:, 0], red_seed_array[:, 1], red_seed_array[:, 2]] = False
        return red_mask_zyx, blue_mask_zyx


register_split_method(LinearSplitMethod())
register_split_method(GeodesicSplitMethod())
register_split_method(GraphCutSplitMethod())
