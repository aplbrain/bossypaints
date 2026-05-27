import polybool, { type Polygon } from '@velipso/polybool';
import PolygonAnnotation from './PolygonAnnotation';

export type SplitSeedLabel = 'red' | 'blue';
export type SplitMethod = 'linear' | 'geodesic' | 'graph_cut';

export type SplitSeed = {
	id: number;
	x: number;
	y: number;
	z: number;
	label: SplitSeedLabel;
};

export type SplitPoint3D = {
	x: number;
	y: number;
	z: number;
};

export type SplitBounds = {
	xMin: number;
	xMax: number;
	yMin: number;
	yMax: number;
};

export type SplitModel = {
	means: [number, number, number];
	scales: [number, number, number];
	weights: [number, number, number];
	bias: number;
};

export type SplitLayerPreview = {
	red: PolygonAnnotation | null;
	blue: PolygonAnnotation | null;
};

const MODEL_EPSILON = 1e-6;
const RIDGE_LAMBDA = 1e-3;
const PERCEPTRON_MAX_ITERATIONS = 2048;

function dedupePolygonVertices(points: Array<[number, number]>): Array<[number, number]> {
	const deduped: Array<[number, number]> = [];
	for (const point of points) {
		const previousPoint = deduped[deduped.length - 1];
		if (
			previousPoint &&
			Math.abs(previousPoint[0] - point[0]) < MODEL_EPSILON &&
			Math.abs(previousPoint[1] - point[1]) < MODEL_EPSILON
		) {
			continue;
		}
		deduped.push([point[0], point[1]]);
	}

	if (deduped.length > 1) {
		const firstPoint = deduped[0];
		const lastPoint = deduped[deduped.length - 1];
		if (
			Math.abs(firstPoint[0] - lastPoint[0]) < MODEL_EPSILON &&
			Math.abs(firstPoint[1] - lastPoint[1]) < MODEL_EPSILON
		) {
			deduped.pop();
		}
	}

	return deduped;
}

function solveLinearSystem(matrix: number[][], vector: number[]): Array<number> | null {
	const size = vector.length;
	const augmented = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);

	for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
		let maxRowIndex = pivotIndex;
		for (let rowIndex = pivotIndex + 1; rowIndex < size; rowIndex += 1) {
			if (
				Math.abs(augmented[rowIndex][pivotIndex]) > Math.abs(augmented[maxRowIndex][pivotIndex])
			) {
				maxRowIndex = rowIndex;
			}
		}

		if (Math.abs(augmented[maxRowIndex][pivotIndex]) < MODEL_EPSILON) {
			return null;
		}

		if (maxRowIndex !== pivotIndex) {
			[augmented[pivotIndex], augmented[maxRowIndex]] = [
				augmented[maxRowIndex],
				augmented[pivotIndex]
			];
		}

		const pivotValue = augmented[pivotIndex][pivotIndex];
		for (let columnIndex = pivotIndex; columnIndex <= size; columnIndex += 1) {
			augmented[pivotIndex][columnIndex] /= pivotValue;
		}

		for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
			if (rowIndex === pivotIndex) {
				continue;
			}

			const factor = augmented[rowIndex][pivotIndex];
			if (Math.abs(factor) < MODEL_EPSILON) {
				continue;
			}

			for (let columnIndex = pivotIndex; columnIndex <= size; columnIndex += 1) {
				augmented[rowIndex][columnIndex] -= factor * augmented[pivotIndex][columnIndex];
			}
		}
	}

	return augmented.map((row) => row[size]);
}

function buildCentroidBisectorModel(seeds: Array<SplitSeed>): SplitModel | null {
	const redSeeds = seeds.filter((seed) => seed.label === 'red');
	const blueSeeds = seeds.filter((seed) => seed.label === 'blue');
	if (redSeeds.length === 0 || blueSeeds.length === 0) {
		return null;
	}

	const centroidFor = (group: Array<SplitSeed>): [number, number, number] => {
		const total = group.reduce(
			(accumulator, seed) => [
				accumulator[0] + seed.x,
				accumulator[1] + seed.y,
				accumulator[2] + seed.z
			],
			[0, 0, 0]
		);
		return [total[0] / group.length, total[1] / group.length, total[2] / group.length];
	};

	const redCentroid = centroidFor(redSeeds);
	const blueCentroid = centroidFor(blueSeeds);
	const weights: [number, number, number] = [
		blueCentroid[0] - redCentroid[0],
		blueCentroid[1] - redCentroid[1],
		blueCentroid[2] - redCentroid[2]
	];

	if (
		Math.abs(weights[0]) < MODEL_EPSILON &&
		Math.abs(weights[1]) < MODEL_EPSILON &&
		Math.abs(weights[2]) < MODEL_EPSILON
	) {
		return null;
	}

	const midpoint: [number, number, number] = [
		(redCentroid[0] + blueCentroid[0]) / 2,
		(redCentroid[1] + blueCentroid[1]) / 2,
		(redCentroid[2] + blueCentroid[2]) / 2
	];

	return {
		means: [0, 0, 0],
		scales: [1, 1, 1],
		weights,
		bias: -(weights[0] * midpoint[0] + weights[1] * midpoint[1] + weights[2] * midpoint[2])
	};
}

function normalizePoint(
	point: SplitPoint3D,
	model: Pick<SplitModel, 'means' | 'scales'>
): [number, number, number] {
	return [
		(point.x - model.means[0]) / model.scales[0],
		(point.y - model.means[1]) / model.scales[1],
		(point.z - model.means[2]) / model.scales[2]
	];
}

function refineModelWithPerceptron(seeds: Array<SplitSeed>, model: SplitModel): SplitModel {
	let weights = [...model.weights] as [number, number, number];
	let bias = model.bias;

	for (let iteration = 0; iteration < PERCEPTRON_MAX_ITERATIONS; iteration += 1) {
		let madeUpdate = false;

		for (const seed of seeds) {
			const normalizedPoint = normalizePoint(seed, model);
			const label = seed.label === 'blue' ? 1 : -1;
			const score =
				weights[0] * normalizedPoint[0] +
				weights[1] * normalizedPoint[1] +
				weights[2] * normalizedPoint[2] +
				bias;

			if (label * score > MODEL_EPSILON) {
				continue;
			}

			weights = [
				weights[0] + label * normalizedPoint[0],
				weights[1] + label * normalizedPoint[1],
				weights[2] + label * normalizedPoint[2]
			];
			bias += label;
			madeUpdate = true;
		}

		if (!madeUpdate) {
			return {
				...model,
				weights,
				bias
			};
		}
	}

	return model;
}

export function evaluateSplitModel(model: SplitModel, point: SplitPoint3D): number {
	const normalizedPoint = normalizePoint(point, model);
	return (
		model.weights[0] * normalizedPoint[0] +
		model.weights[1] * normalizedPoint[1] +
		model.weights[2] * normalizedPoint[2] +
		model.bias
	);
}

export function fitSplitModel(seeds: Array<SplitSeed>): SplitModel | null {
	const redSeeds = seeds.filter((seed) => seed.label === 'red');
	const blueSeeds = seeds.filter((seed) => seed.label === 'blue');
	if (redSeeds.length === 0 || blueSeeds.length === 0) {
		return null;
	}

	const means: [number, number, number] = [0, 0, 0];
	for (const seed of seeds) {
		means[0] += seed.x;
		means[1] += seed.y;
		means[2] += seed.z;
	}
	means[0] /= seeds.length;
	means[1] /= seeds.length;
	means[2] /= seeds.length;

	const scales: [number, number, number] = [0, 0, 0];
	for (const seed of seeds) {
		scales[0] += (seed.x - means[0]) ** 2;
		scales[1] += (seed.y - means[1]) ** 2;
		scales[2] += (seed.z - means[2]) ** 2;
	}
	scales[0] = Math.sqrt(scales[0] / seeds.length) || 1;
	scales[1] = Math.sqrt(scales[1] / seeds.length) || 1;
	scales[2] = Math.sqrt(scales[2] / seeds.length) || 1;

	const designMatrix = seeds.map((seed) => {
		const normalizedPoint = normalizePoint(seed, { means, scales });
		return [...normalizedPoint, 1];
	});

	const normalMatrix = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
	const rhsVector = [0, 0, 0, 0];

	designMatrix.forEach((row, rowIndex) => {
		const label = seeds[rowIndex].label === 'blue' ? 1 : -1;
		for (let rowComponent = 0; rowComponent < 4; rowComponent += 1) {
			rhsVector[rowComponent] += row[rowComponent] * label;
			for (let columnComponent = 0; columnComponent < 4; columnComponent += 1) {
				normalMatrix[rowComponent][columnComponent] += row[rowComponent] * row[columnComponent];
			}
		}
	});

	for (let diagonalIndex = 0; diagonalIndex < 3; diagonalIndex += 1) {
		normalMatrix[diagonalIndex][diagonalIndex] += RIDGE_LAMBDA;
	}

	const solution = solveLinearSystem(normalMatrix, rhsVector);
	const fallbackModel = buildCentroidBisectorModel(seeds);

	if (!solution) {
		return fallbackModel;
	}

	const regressionModel: SplitModel = {
		means,
		scales,
		weights: [solution[0], solution[1], solution[2]],
		bias: solution[3]
	};

	return refineModelWithPerceptron(seeds, regressionModel) || fallbackModel;
}

function clipPolygonToHalfPlane(
	polygon: Array<[number, number]>,
	evaluatePoint: (point: [number, number]) => number,
	keepPositiveSide: boolean
): Array<[number, number]> {
	if (polygon.length === 0) {
		return [];
	}

	const clipped: Array<[number, number]> = [];
	const isInside = (value: number): boolean =>
		keepPositiveSide ? value >= -MODEL_EPSILON : value <= MODEL_EPSILON;

	for (let index = 0; index < polygon.length; index += 1) {
		const currentPoint = polygon[index];
		const nextPoint = polygon[(index + 1) % polygon.length];
		const currentValue = evaluatePoint(currentPoint);
		const nextValue = evaluatePoint(nextPoint);
		const currentInside = isInside(currentValue);
		const nextInside = isInside(nextValue);

		if (currentInside && nextInside) {
			clipped.push([nextPoint[0], nextPoint[1]]);
			continue;
		}

		if (currentInside !== nextInside) {
			const denominator = currentValue - nextValue;
			if (Math.abs(denominator) > MODEL_EPSILON) {
				const t = currentValue / denominator;
				const intersectionPoint: [number, number] = [
					currentPoint[0] + (nextPoint[0] - currentPoint[0]) * t,
					currentPoint[1] + (nextPoint[1] - currentPoint[1]) * t
				];
				clipped.push(intersectionPoint);
			}
		}

		if (!currentInside && nextInside) {
			clipped.push([nextPoint[0], nextPoint[1]]);
		}
	}

	return dedupePolygonVertices(clipped);
}

function buildHalfPlaneMaskPolygon(
	model: SplitModel,
	z: number,
	bounds: SplitBounds,
	label: SplitSeedLabel
): Array<[number, number]> | null {
	const rectangle: Array<[number, number]> = [
		[bounds.xMin, bounds.yMin],
		[bounds.xMax, bounds.yMin],
		[bounds.xMax, bounds.yMax],
		[bounds.xMin, bounds.yMax]
	];

	const clippedRectangle = clipPolygonToHalfPlane(
		rectangle,
		([x, y]) => evaluateSplitModel(model, { x, y, z }),
		label === 'blue'
	);

	return clippedRectangle.length >= 3 ? clippedRectangle : null;
}

function buildPolyboolPolygonFromAnnotations(
	annotations: Array<PolygonAnnotation>
): Polygon | null {
	const polygons: Array<Polygon> = [];

	for (const annotation of annotations) {
		const regions = [...annotation.positiveRegions, ...annotation.negativeRegions].filter(
			(region) => region.length >= 3
		) as Polygon['regions'];
		if (regions.length === 0) {
			continue;
		}

		polygons.push({
			regions,
			inverted: false
		});
	}

	if (polygons.length === 0) {
		return null;
	}

	return polygons
		.slice(1)
		.reduce((combined, polygon) => polybool.union(combined, polygon), polygons[0]);
}

function polygonAnnotationFromResult(
	result: Polygon,
	segmentID: number,
	z: number
): PolygonAnnotation | null {
	const regions = result.regions
		.map((region) => dedupePolygonVertices(region as Array<[number, number]>))
		.filter((region) => region.length >= 3);

	if (regions.length === 0) {
		return null;
	}

	const annotation = PolygonAnnotation.fromPolyboolRegions(
		regions as Array<Array<[number, number]>>,
		segmentID,
		false,
		z
	);

	return annotation.positiveRegions.length > 0 ? annotation : null;
}

export function createSplitPreviewForLayer({
	annotations,
	sourceSegmentID,
	newSegmentID,
	model,
	bounds,
	z
}: {
	annotations: Array<PolygonAnnotation>;
	sourceSegmentID: number;
	newSegmentID: number;
	model: SplitModel;
	bounds: SplitBounds;
	z: number;
}): SplitLayerPreview {
	const combinedPolygon = buildPolyboolPolygonFromAnnotations(annotations);
	if (!combinedPolygon) {
		return { red: null, blue: null };
	}

	const redMask = buildHalfPlaneMaskPolygon(model, z, bounds, 'red');
	const blueMask = buildHalfPlaneMaskPolygon(model, z, bounds, 'blue');

	const red = redMask
		? polygonAnnotationFromResult(
				polybool.intersect(combinedPolygon, { regions: [redMask], inverted: false }),
				sourceSegmentID,
				z
			)
		: null;
	const blue = blueMask
		? polygonAnnotationFromResult(
				polybool.intersect(combinedPolygon, { regions: [blueMask], inverted: false }),
				newSegmentID,
				z
			)
		: null;

	return { red, blue };
}
