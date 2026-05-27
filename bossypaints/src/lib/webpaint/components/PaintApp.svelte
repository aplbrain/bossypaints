<!--
@component PaintApp

The primary component for the PaintApp. This component is responsible for
rendering the main canvas and handling user input. It also loads image data
from BossDB and displays it on the canvas.

@prop {AnnotationManagerStore} annotationStore - Svelte store for annotations.
@prop {NavigationStore} nav - Svelte store for navigation data.
@prop {string} datasetURI - The URI of the dataset to load from BossDB.

-->
<script lang="ts">
	import p5 from 'p5';
	import { onMount, onDestroy } from 'svelte';
	import { keybindings, type MouseEventType } from '../keybindings';
	import type { NavigationStore } from '../stores/NavigationStore.svelte';
	import BossRemote from '../intern';
	import type { AnnotationManagerStore } from '../stores/AnnotationManagerStore.svelte';
	import APP_CONFIG from '../config';
	import { debug as debugUtil } from '../debug';
	import Minimap from './Minimap.svelte';
	import PolygonAnnotation from '../PolygonAnnotation';
	import { ImageCache, type ChunkIdentifier } from '../ImageCache';
	import { BrowserStorage, type NavigationState } from '../BrowserStorage';
	import { type SplitSeed, type SplitSeedLabel } from '../split';

	export let annotationStore: AnnotationManagerStore;
	export let nav: NavigationStore;

	export let datasetURI: string;
	export let xs: [number, number];
	export let ys: [number, number];
	export let zs: [number, number];
	export let resolution: number | undefined = undefined;

	// Histogram window to adjust imagery contrast
	export let histMin: number = 0;
	export let histMax: number = 255;

	// Keep ImageCache aware of current window for future network fetches
	$: if (imageCache) {
		imageCache.setHistogramWindow(histMin, histMax);
	}

	// Expose the on:submit event to the parent component:
	export let onSubmitData: (layerwiseAnnotations: PolygonAnnotation[]) => void = () => {};
	export let onCheckpointData: (layerwiseAnnotations: PolygonAnnotation[]) => void = () => {};
	export let onToggleInfo: () => void = () => {};
	export let onToggleMerge: () => void = () => {};
	export let onCopyToAdjacentSlice: (direction: -1 | 1) => void | Promise<void> = () => {};
	export let onCopyFromLastSlice: () => void | Promise<void> = () => {};
	export let onPropagateToAdjacentSlice: (direction: -1 | 1) => void | Promise<void> = () => {};
	export let onPropagateFromLastSlice: () => void | Promise<void> = () => {};
	export let splitModeActive: boolean = false;
	export let splitSeedColor: SplitSeedLabel = 'red';
	export let splitSeeds: Array<SplitSeed> = [];
	export let splitPreviewAnnotations: Array<PolygonAnnotation> = [];
	export let splitTargetSegmentID: number | null = null;
	export let splitPreviewSegmentID: number | null = null;
	export let onAddSplitSeed: (point: { x: number; y: number; z: number }) => void = () => {};
	export let onRemoveSplitSeed: (seedID: number) => void = () => {};
	export let showMinimap = true;
	export let minimapFootprint = 0;

	// Toggle visibility of task region (yellow rectangle) and axes
	let showAxesAndTaskRegion = true;
	let showDebugOverlay = false;

	// Function to toggle axes and task region visibility
	function toggleAxesAndTaskRegion() {
		showAxesAndTaskRegion = !showAxesAndTaskRegion;
	}

	function calculateRegionCentroid(region: Array<[number, number]>): [number, number] {
		if (region.length === 0) {
			return [0, 0];
		}

		let centroidX = 0;
		let centroidY = 0;
		let signedArea = 0;

		for (let index = 0; index < region.length; index += 1) {
			const nextIndex = (index + 1) % region.length;
			const [x0, y0] = region[index];
			const [x1, y1] = region[nextIndex];
			const areaComponent = x0 * y1 - x1 * y0;
			signedArea += areaComponent;
			centroidX += (x0 + x1) * areaComponent;
			centroidY += (y0 + y1) * areaComponent;
		}

		signedArea *= 0.5;
		if (Math.abs(signedArea) < 1e-10) {
			return [
				region.reduce((sum, [x]) => sum + x, 0) / region.length,
				region.reduce((sum, [, y]) => sum + y, 0) / region.length
			];
		}

		return [centroidX / (6 * signedArea), centroidY / (6 * signedArea)];
	}

	function pointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
		let inside = false;

		for (
			let index = 0, previousIndex = polygon.length - 1;
			index < polygon.length;
			previousIndex = index++
		) {
			const [x1, y1] = polygon[index];
			const [x2, y2] = polygon[previousIndex];
			const intersects =
				y1 > point[1] !== y2 > point[1] &&
				point[0] < ((x2 - x1) * (point[1] - y1)) / (y2 - y1) + x1;
			if (intersects) {
				inside = !inside;
			}
		}

		return inside;
	}

	function drawAnnotationWithColor(
		s: p5,
		annotation: PolygonAnnotation,
		fillColor: [number, number, number, number],
		strokeColor: [number, number, number, number]
	) {
		s.fill(fillColor[0], fillColor[1], fillColor[2], fillColor[3]);
		s.stroke(strokeColor[0], strokeColor[1], strokeColor[2], strokeColor[3]);
		s.strokeWeight(2);

		for (const positiveRegion of annotation.positiveRegions) {
			s.beginShape();
			for (const [x, y] of positiveRegion) {
				s.vertex(x, y);
			}

			for (const negativeRegion of annotation.negativeRegions) {
				const centroid = calculateRegionCentroid(negativeRegion);
				if (!pointInPolygon(centroid, positiveRegion)) {
					continue;
				}
				s.beginContour();
				for (const [x, y] of negativeRegion) {
					s.vertex(x, y);
				}
				s.endContour();
			}

			s.endShape();
		}
	}

	function drawSplitPreviewOverlay(s: p5) {
		if (!splitModeActive || splitTargetSegmentID === null || splitPreviewSegmentID === null) {
			return;
		}

		const visiblePreviewAnnotations = splitPreviewAnnotations.filter(
			(annotation) => annotation.z === nav.layer
		);
		for (const annotation of visiblePreviewAnnotations) {
			if (annotation.segmentID === splitTargetSegmentID) {
				drawAnnotationWithColor(s, annotation, [239, 68, 68, 72], [185, 28, 28, 210]);
			} else if (annotation.segmentID === splitPreviewSegmentID) {
				drawAnnotationWithColor(s, annotation, [59, 130, 246, 88], [29, 78, 216, 220]);
			}
		}
	}

	function drawSplitSeedsForCurrentLayer(s: p5) {
		if (!splitModeActive) {
			return;
		}

		const visibleSeeds = splitSeeds.filter((seed) => seed.z === nav.layer);
		for (const seed of visibleSeeds) {
			const seedColor =
				seed.label === 'red'
					? ([239, 68, 68, 255] as [number, number, number, number])
					: ([59, 130, 246, 255] as [number, number, number, number]);
			const isActiveColor = seed.label === splitSeedColor;

			s.stroke(255, 255, 255, 220);
			s.strokeWeight(isActiveColor ? 4 / nav.zoom : 3 / nav.zoom);
			s.fill(seedColor[0], seedColor[1], seedColor[2], seedColor[3]);
			s.circle(seed.x, seed.y, (isActiveColor ? 14 : 11) / nav.zoom);
		}
	}

	function getSplitSeedUnderPointer(sceneX: number, sceneY: number): SplitSeed | null {
		if (!splitModeActive) {
			return null;
		}

		const dataSpaceCoord = nav.sceneToData(sceneX, sceneY);
		const hitRadius = 16 / nav.zoom;
		const hitRadiusSquared = hitRadius * hitRadius;
		let closestSeed: SplitSeed | null = null;
		let closestDistanceSquared = hitRadiusSquared;

		for (const seed of splitSeeds) {
			if (seed.z !== nav.layer) {
				continue;
			}

			const dx = seed.x - dataSpaceCoord.x;
			const dy = seed.y - dataSpaceCoord.y;
			const distanceSquared = dx * dx + dy * dy;
			if (distanceSquared <= closestDistanceSquared) {
				closestSeed = seed;
				closestDistanceSquared = distanceSquared;
			}
		}

		return closestSeed;
	}

	const remote = new BossRemote();

	// Fixed chunk sizes for consistent performance across all resolutions
	const chunkSizeX = APP_CONFIG.fixedChunkSize.width;
	const chunkSizeY = APP_CONFIG.fixedChunkSize.height;
	const chunkSizeZ = APP_CONFIG.fixedChunkSize.depth;
	const configuredResolutionValues = Array.from(
		new Set(APP_CONFIG.resolutionLevels.map((level) => level.resolution))
	).sort((left, right) => left - right);
	const maxConfiguredResolution =
		configuredResolutionValues[configuredResolutionValues.length - 1] ?? 0;

	// Helper function to get the current resolution level based on zoom
	function getCurrentResolutionLevel(zoom: number): {
		threshold: number;
		resolution: number;
		color: number[];
		name: string;
	} {
		// Find the appropriate resolution level based on zoom
		// Levels are sorted by threshold descending, so first match is correct
		for (const level of APP_CONFIG.resolutionLevels) {
			if (zoom >= level.threshold) {
				return level;
			}
		}
		// Fallback to the highest resolution level if zoom is extremely low
		return APP_CONFIG.resolutionLevels[APP_CONFIG.resolutionLevels.length - 1];
	}

	function resolveDisplayResolution(targetResolution: number): number {
		if (!availableMipLevels || availableMipLevels.length === 0) {
			return targetResolution;
		}

		if (availableMipLevels.includes(targetResolution)) {
			return targetResolution;
		}

		const finerOrEqualLevels = availableMipLevels
			.filter((resolutionLevel) => resolutionLevel <= targetResolution)
			.sort((left, right) => right - left);
		if (finerOrEqualLevels.length > 0) {
			return finerOrEqualLevels[0];
		}

		const coarserLevels = availableMipLevels
			.filter((resolutionLevel) => resolutionLevel > targetResolution)
			.sort((left, right) => left - right);
		if (coarserLevels.length > 0) {
			return coarserLevels[0];
		}

		return targetResolution;
	}

	function getActiveResolutionLevel(zoom: number): {
		threshold: number;
		resolution: number;
		color: number[];
		name: string;
	} {
		const targetResolutionLevel = getCurrentResolutionLevel(zoom);
		const resolvedResolution = resolveDisplayResolution(targetResolutionLevel.resolution);

		if (resolvedResolution === targetResolutionLevel.resolution) {
			return targetResolutionLevel;
		}

		return {
			...targetResolutionLevel,
			resolution: resolvedResolution,
			name: `Res ${resolvedResolution}`
		};
	}

	function getProgressiveResolutionLoadSequence(targetResolution: number): number[] {
		if (!APP_CONFIG.progressiveMipLoading.enabled) {
			return [targetResolution];
		}

		const coarseSteps = Math.max(0, APP_CONFIG.progressiveMipLoading.coarseSteps);
		if (coarseSteps === 0) {
			return [targetResolution];
		}

		if (availableMipLevels && availableMipLevels.length > 0) {
			const availableMipSet = new Set(availableMipLevels);
			const sequence: number[] = [];

			for (let resolutionLevel = targetResolution + coarseSteps; resolutionLevel >= targetResolution; resolutionLevel -= 1) {
				if (availableMipSet.has(resolutionLevel)) {
					sequence.push(resolutionLevel);
				}
			}

			if (sequence.length > 0) {
				return sequence;
			}

			return [targetResolution];
		}

		const maxResolution = Math.min(targetResolution + coarseSteps, maxConfiguredResolution);
		const sequence: number[] = [];
		for (let resolutionLevel = maxResolution; resolutionLevel >= targetResolution; resolutionLevel -= 1) {
			sequence.push(resolutionLevel);
		}
		return sequence;
	}

	// Helper function to calculate filmstrip-aligned Z-range for a given Z-coordinate
	function getFilmstripZRange(z: number): { z_min: number; z_max: number } {
		const batchSize = APP_CONFIG.filmstrip.batchSize;
		const batchIndex = Math.floor(z / batchSize);
		const z_min = batchIndex * batchSize;
		const z_max = z_min + batchSize;
		return { z_min, z_max };
	}

	function getPrefetchFilmstripRanges(
		currentZ: number,
		visibleChunkWindow: VisibleChunkWindow
	): Array<{ z_min: number; z_max: number }> {
		const prefetchRanges: Array<{ z_min: number; z_max: number }> = [];
		const batchSize = APP_CONFIG.filmstrip.batchSize;
		const lowerPrefetchTriggerZ = visibleChunkWindow.filmstripZMin + 1;
		const upperPrefetchTriggerZ = visibleChunkWindow.filmstripZMax - 2;
		const lowerBound = nav.restrictLayerBounds ? zs[0] : 0;
		const upperBound = nav.restrictLayerBounds ? zs[1] : null;

		if (currentZ <= lowerPrefetchTriggerZ) {
			const previousZMax = visibleChunkWindow.filmstripZMin;
			const previousZMin = Math.max(previousZMax - batchSize, lowerBound);
			if (previousZMax > previousZMin) {
				prefetchRanges.push({ z_min: previousZMin, z_max: previousZMax });
			}
		}

		if (currentZ >= upperPrefetchTriggerZ) {
			const nextZMin = visibleChunkWindow.filmstripZMax;
			if (upperBound === null || nextZMin < upperBound) {
				const nextZMax =
					upperBound === null ? nextZMin + batchSize : Math.min(nextZMin + batchSize, upperBound);
				if (nextZMax > nextZMin) {
					prefetchRanges.push({ z_min: nextZMin, z_max: nextZMax });
				}
			}
		}

		return prefetchRanges;
	}

	// Helper function to calculate Boss resolution level directly
	function getResolutionLevel(resolutionLevel: number): number {
		return resolutionLevel;
	}

	type ChunkBounds = {
		x_min: number;
		x_max: number;
		y_min: number;
		y_max: number;
		z_min: number;
		z_max: number;
	};

	type VisibleChunkWindow = {
		minChunkX: number;
		maxChunkX: number;
		minChunkY: number;
		maxChunkY: number;
		chunkZ: number;
		resolution: number;
		filmstripZMin: number;
		filmstripZMax: number;
	};

	// Helper function to get chunk coordinates for a given point
	// Returns coordinates that BossDB expects
	function getChunkForPoint(
		x: number,
		y: number,
		z: number,
		resolutionLevel: number = 0
	): {
		x_min: number;
		x_max: number;
		y_min: number;
		y_max: number;
		z_min: number;
		z_max: number;
	} {
		// At higher resolution levels, chunks cover more world space
		const chunkWorldSize = APP_CONFIG.fixedChunkSize.width * Math.pow(2, resolutionLevel);

		// Find which logical chunk contains this world point
		const chunkX = Math.floor(x / chunkWorldSize);
		const chunkY = Math.floor(y / chunkWorldSize);
		const chunkZ = Math.floor(z / APP_CONFIG.fixedChunkSize.depth);

		// Convert back to base resolution coordinates for BossDB
		return {
			x_min: chunkX * APP_CONFIG.fixedChunkSize.width,
			x_max: (chunkX + 1) * APP_CONFIG.fixedChunkSize.width,
			y_min: chunkY * APP_CONFIG.fixedChunkSize.height,
			y_max: (chunkY + 1) * APP_CONFIG.fixedChunkSize.height,
			z_min: chunkZ * APP_CONFIG.fixedChunkSize.depth,
			z_max: (chunkZ + 1) * APP_CONFIG.fixedChunkSize.depth
		};
	}

	// Helper function to get all neighboring chunks around a center point
	function getViewportChunkWindow(
		viewWidth: number,
		viewHeight: number,
		currentZ: number,
		resolutionLevel: number = 0
	): VisibleChunkWindow {
		const topLeft = nav.sceneToData(0, 0);
		const bottomRight = nav.sceneToData(viewWidth, viewHeight);
		const minX = Math.min(topLeft.x, bottomRight.x);
		const maxX = Math.max(topLeft.x, bottomRight.x);
		const minY = Math.min(topLeft.y, bottomRight.y);
		const maxY = Math.max(topLeft.y, bottomRight.y);
		const chunkWorldWidth = APP_CONFIG.fixedChunkSize.width * Math.pow(2, resolutionLevel);
		const chunkWorldHeight = APP_CONFIG.fixedChunkSize.height * Math.pow(2, resolutionLevel);
		const viewportPaddingChunks = APP_CONFIG.chunkLoading.viewportPaddingChunks;
		const epsilon = 1e-6;
		const filmstripRange = getFilmstripZRange(currentZ);

		return {
			minChunkX: Math.max(0, Math.floor(minX / chunkWorldWidth) - viewportPaddingChunks),
			maxChunkX: Math.max(
				0,
				Math.floor((maxX - epsilon) / chunkWorldWidth) + viewportPaddingChunks
			),
			minChunkY: Math.max(0, Math.floor(minY / chunkWorldHeight) - viewportPaddingChunks),
			maxChunkY: Math.max(
				0,
				Math.floor((maxY - epsilon) / chunkWorldHeight) + viewportPaddingChunks
			),
			chunkZ: Math.max(0, Math.floor(currentZ / APP_CONFIG.fixedChunkSize.depth)),
			resolution: resolutionLevel,
			filmstripZMin: filmstripRange.z_min,
			filmstripZMax: filmstripRange.z_max
		};
	}

	function visibleChunkWindowEquals(
		left: VisibleChunkWindow | null,
		right: VisibleChunkWindow
	): boolean {
		return (
			!!left &&
			left.minChunkX === right.minChunkX &&
			left.maxChunkX === right.maxChunkX &&
			left.minChunkY === right.minChunkY &&
			left.maxChunkY === right.maxChunkY &&
			left.chunkZ === right.chunkZ &&
			left.resolution === right.resolution &&
			left.filmstripZMin === right.filmstripZMin &&
			left.filmstripZMax === right.filmstripZMax
		);
	}

	function getVisibleChunksForWindow(
		window: VisibleChunkWindow,
		centerOfScreen: { x: number; y: number }
	): Array<ChunkBounds> {
		const chunkWorldWidth = APP_CONFIG.fixedChunkSize.width * Math.pow(2, window.resolution);
		const chunkWorldHeight = APP_CONFIG.fixedChunkSize.height * Math.pow(2, window.resolution);
		const prioritizeCenter = APP_CONFIG.chunkLoading.prioritizeCenter;
		const centerChunkX = Math.floor(centerOfScreen.x / chunkWorldWidth);
		const centerChunkY = Math.floor(centerOfScreen.y / chunkWorldHeight);
		const chunks: Array<ChunkBounds & { distance: number }> = [];

		for (let chunkX = window.minChunkX; chunkX <= window.maxChunkX; chunkX += 1) {
			for (let chunkY = window.minChunkY; chunkY <= window.maxChunkY; chunkY += 1) {
				chunks.push({
					x_min: chunkX * APP_CONFIG.fixedChunkSize.width,
					x_max: (chunkX + 1) * APP_CONFIG.fixedChunkSize.width,
					y_min: chunkY * APP_CONFIG.fixedChunkSize.height,
					y_max: (chunkY + 1) * APP_CONFIG.fixedChunkSize.height,
					z_min: window.chunkZ * APP_CONFIG.fixedChunkSize.depth,
					z_max: (window.chunkZ + 1) * APP_CONFIG.fixedChunkSize.depth,
					distance: Math.hypot(chunkX - centerChunkX, chunkY - centerChunkY)
				});
			}
		}

		if (prioritizeCenter) {
			chunks.sort((a, b) => a.distance - b.distance);
		}

		return chunks.map(({ distance: _distance, ...chunk }) => chunk);
	}

	// Check if center of screen is outside current ROI
	function isOutsideROI(centerOfScreen: { x: number; y: number }, currentZ: number): boolean {
		return (
			centerOfScreen.x < xs[0] ||
			centerOfScreen.x >= xs[1] ||
			centerOfScreen.y < ys[0] ||
			centerOfScreen.y >= ys[1] ||
			currentZ < zs[0] ||
			currentZ >= zs[1]
		);
	}

	// Keep track of the last logged chunk to avoid spamming console
	let lastLoggedChunk: string | null = null;

	// Image cache for managing resolution chunks
	let imageCache: ImageCache;
	let browserStorage: BrowserStorage;
	let lastVisibleChunkWindow: VisibleChunkWindow | null = null;
	let lastProgressiveLoadSignature: string | null = null;
	let lastPrefetchRangeSignature: string | null = null;
	let currentVisibleChunks: ChunkIdentifier[] = [];
	let currentRenderFallbackResolutions: number[] = [];
	let availableMipLevels: number[] | null = null;
	let lastMipMetadataDatasetURI: string | null = null;
	let navigationStateSaveTimer: ReturnType<typeof setTimeout> | null = null;

	type ChunkRenderSource = {
		image: any;
		sourceIdentifier: ChunkIdentifier;
		sourceX: number;
		sourceY: number;
		sourceWidth: number;
		sourceHeight: number;
	};

	async function refreshAvailableMipLevels(uri: string): Promise<void> {
		const mipLevels = await remote.getAvailableMipLevels(uri);
		if (uri !== lastMipMetadataDatasetURI) {
			return;
		}

		availableMipLevels = mipLevels && mipLevels.length > 0 ? mipLevels : null;
	}

	$: if (datasetURI && datasetURI !== lastMipMetadataDatasetURI) {
		lastMipMetadataDatasetURI = datasetURI;
		availableMipLevels = null;
		void refreshAvailableMipLevels(datasetURI);
	}

	function getAncestorChunkIdentifier(
		targetIdentifier: ChunkIdentifier,
		sourceResolution: number
	): ChunkIdentifier {
		if (sourceResolution === targetIdentifier.resolution) {
			return targetIdentifier;
		}

		const targetDisplayScale = Math.pow(2, targetIdentifier.resolution);
		const sourceDisplayScale = Math.pow(2, sourceResolution);
		const sourceChunkWorldWidth = APP_CONFIG.fixedChunkSize.width * sourceDisplayScale;
		const sourceChunkWorldHeight = APP_CONFIG.fixedChunkSize.height * sourceDisplayScale;
		const targetWorldX = targetIdentifier.x_min * targetDisplayScale;
		const targetWorldY = targetIdentifier.y_min * targetDisplayScale;
		const sourceChunkX = Math.floor(targetWorldX / sourceChunkWorldWidth);
		const sourceChunkY = Math.floor(targetWorldY / sourceChunkWorldHeight);

		return {
			x_min: sourceChunkX * APP_CONFIG.fixedChunkSize.width,
			x_max: (sourceChunkX + 1) * APP_CONFIG.fixedChunkSize.width,
			y_min: sourceChunkY * APP_CONFIG.fixedChunkSize.height,
			y_max: (sourceChunkY + 1) * APP_CONFIG.fixedChunkSize.height,
			z_min: targetIdentifier.z_min,
			z_max: targetIdentifier.z_max,
			resolution: sourceResolution
		};
	}

	function getBestRenderSourceForChunk(
		targetIdentifier: ChunkIdentifier,
		currentLayer: number
	): ChunkRenderSource | null {
		if (!imageCache || currentRenderFallbackResolutions.length === 0) {
			return null;
		}

		const targetDisplayScale = Math.pow(2, targetIdentifier.resolution);
		const targetWorldX = targetIdentifier.x_min * targetDisplayScale;
		const targetWorldY = targetIdentifier.y_min * targetDisplayScale;
		const targetWorldWidth = APP_CONFIG.fixedChunkSize.width * targetDisplayScale;
		const targetWorldHeight = APP_CONFIG.fixedChunkSize.height * targetDisplayScale;

		for (const sourceResolution of currentRenderFallbackResolutions) {
			if (sourceResolution < targetIdentifier.resolution) {
				continue;
			}

			const sourceIdentifier = getAncestorChunkIdentifier(targetIdentifier, sourceResolution);
			const filmstripInfo = imageCache.getFilmstripRenderInfo(sourceIdentifier, currentLayer);
			if (!filmstripInfo) {
				continue;
			}

			const sourceDisplayScale = Math.pow(2, sourceResolution);
			const sourceWorldX = sourceIdentifier.x_min * sourceDisplayScale;
			const sourceWorldY = sourceIdentifier.y_min * sourceDisplayScale;
			const sourceX = Math.round((targetWorldX - sourceWorldX) / sourceDisplayScale);
			const sourceY =
				filmstripInfo.sourceY +
				Math.round((targetWorldY - sourceWorldY) / sourceDisplayScale);
			const sourceWidth = Math.max(1, Math.round(targetWorldWidth / sourceDisplayScale));
			const sourceHeight = Math.max(1, Math.round(targetWorldHeight / sourceDisplayScale));

			return {
				image: filmstripInfo.filmstrip,
				sourceIdentifier,
				sourceX,
				sourceY,
				sourceWidth,
				sourceHeight
			};
		}

		return null;
	}

	// Pinch zoom state tracking
	let lastTouchDistance: number = 0;
	let isPinching: boolean = false;
	let pinchCenter: { x: number; y: number } = { x: 0, y: 0 };
	let lastTouchPos: { x: number; y: number } | null = null;
	// Long-press selection state
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressStartPos: { x: number; y: number } | null = null;
	const LONG_PRESS_MS = 450;
	const LONG_PRESS_MOVE_TOLERANCE = 10;

	// Function to calculate native task center coordinates
	function calculateNativeTaskCenter() {
		// Calculate the center of the task region
		const taskCenterX = (xs[0] + xs[1]) / 2;
		const taskCenterY = (ys[0] + ys[1]) / 2;

		// If resolution is provided, multiply to get native resolution position
		const nativeCenterX =
			resolution !== undefined ? taskCenterX * Math.pow(2, resolution) : taskCenterX;
		const nativeCenterY =
			resolution !== undefined ? taskCenterY * Math.pow(2, resolution) : taskCenterY;

		return { nativeCenterX, nativeCenterY };
	}

	// Helper function to calculate distance between two touch points (p5.js version)
	function getTouchDistance(s: p5): number {
		if (s.touches.length < 2) return 0;
		const touches = s.touches as Array<{ x: number; y: number }>;
		const dx = touches[0].x - touches[1].x;
		const dy = touches[0].y - touches[1].y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	// Helper function to calculate center point between two touches (p5.js version)
	function getTouchCenter(s: p5): { x: number; y: number } {
		if (s.touches.length < 2) return { x: 0, y: 0 };
		const touches = s.touches as Array<{ x: number; y: number }>;
		return {
			x: (touches[0].x + touches[1].x) / 2,
			y: (touches[0].y + touches[1].y) / 2
		};
	}

	// Helper function for pinch zoom using the centerfullyZoom logic
	function pinchZoom(newZoom: number, centerX: number, centerY: number) {
		const oldZoom = nav.zoom;
		nav.setZoom(newZoom);

		// Adjust position to zoom towards the pinch center
		nav.decrementX(centerX * (1 / oldZoom - 1 / nav.zoom));
		nav.decrementY(centerY * (1 / oldZoom - 1 / nav.zoom));

		// Save navigation state with debouncing
		saveNavigationStateDebounced();
	}

	// Debounced navigation state saving to avoid too frequent writes
	function saveNavigationStateDebounced() {
		if (navigationStateSaveTimer) {
			clearTimeout(navigationStateSaveTimer);
		}

		navigationStateSaveTimer = setTimeout(() => {
			if (browserStorage) {
				const navState: NavigationState = {
					x: nav.x,
					y: nav.y,
					zoom: nav.zoom,
					layer: nav.layer
				};
				browserStorage.saveNavigationState(navState, datasetURI);
			}
		}, 500); // Save after 500ms of no navigation changes
	}

	// Container for the canvas - we'll mount it properly in Svelte
	let canvasContainer: HTMLElement;

	// Keep a reference for event target checks
	let appCanvasEl: HTMLCanvasElement | null = null;

	// Keep a reference to the actual p5 canvas element
	let p5CanvasEl: HTMLCanvasElement | null = null;

	// Use the debug prop, fallback to config, then debugMode for compatibility
	const debugEnabled = APP_CONFIG.debug;

	// Debug information reactive variables
	let debugInfo = {
		sceneMouseX: 0,
		sceneMouseY: 0,
		dataMouseX: 0,
		dataMouseY: 0,
		centerX: 0,
		centerY: 0,
		layer: 0,
		zoom: 0,
		resolutionName: '',
		resolutionLevel: 0,
		chunkInfo: '',
		cacheStats: {
			enabled: false,
			entryCount: 0,
			cacheSize: 0,
			maxCacheSize: 0,
			utilizationPercent: 0,
			filmstripCount: 0,
			totalSlicesInFilmstrips: 0,
			loadingCount: 0,
			filmstripLoadingCount: 0
		},
		storageStats: {
			totalChunks: 0,
			estimatedSize: 0
		},
		pinchInfo: {
			active: false,
			touchDistance: 0,
			centerX: 0,
			centerY: 0
		}
	};

	// Debug overlay element reference
	let debugOverlayElement: HTMLDivElement | null = null;

	// Function to copy debug info to clipboard
	function copyDebugInfo() {
		if (debugOverlayElement) {
			const text = debugOverlayElement.innerText;
			navigator.clipboard
				.writeText(text)
				.then(() => {
					console.log('Debug info copied to clipboard');
				})
				.catch((err) => {
					console.error('Failed to copy debug info:', err);
				});
		}
	}

	// Function to load and cache visible chunks based on current view
	async function loadVisibleChunks(
		centerOfScreen: { x: number; y: number },
		currentZ: number,
		viewWidth: number,
		viewHeight: number,
		visibleChunkWindow: VisibleChunkWindow,
		currentResolutionLevel: {
			threshold: number;
			resolution: number;
			color: number[];
			name: string;
		},
		progressiveLoadSequence: number[],
		prefetchFilmstripRanges: Array<{ z_min: number; z_max: number }>
	) {
		if (!imageCache) return;

		debugUtil.log('LOAD: Loading visible chunks for:', {
			center: `x:${centerOfScreen.x.toFixed(0)}, y:${centerOfScreen.y.toFixed(0)}`,
			z: currentZ,
			filmstrip: `${visibleChunkWindow.filmstripZMin}:${visibleChunkWindow.filmstripZMax}`,
			resolution: currentResolutionLevel.resolution,
			progressiveSequence: progressiveLoadSequence,
			prefetchFilmstrips:
				prefetchFilmstripRanges.length > 0
					? prefetchFilmstripRanges.map((range) => `${range.z_min}:${range.z_max}`)
					: ['none']
		});

		const targetChunks = getVisibleChunksForWindow(visibleChunkWindow, centerOfScreen);
		const newVisibleChunks: ChunkIdentifier[] = [];
		const requestedChunks = new Map<string, ChunkIdentifier>();

		for (const chunk of targetChunks) {
			const chunkId: ChunkIdentifier = {
				x_min: chunk.x_min,
				x_max: chunk.x_max,
				y_min: chunk.y_min,
				y_max: chunk.y_max,
				z_min: visibleChunkWindow.filmstripZMin,
				z_max: visibleChunkWindow.filmstripZMax,
				resolution: getResolutionLevel(currentResolutionLevel.resolution)
			};

			newVisibleChunks.push(chunkId);
		}

		currentVisibleChunks = newVisibleChunks;
		currentRenderFallbackResolutions = [...progressiveLoadSequence].reverse();

		for (const resolutionLevel of progressiveLoadSequence) {
			const resolutionWindow = getViewportChunkWindow(
				viewWidth,
				viewHeight,
				currentZ,
				resolutionLevel
			);
			const resolutionChunks = getVisibleChunksForWindow(resolutionWindow, centerOfScreen);

			for (const chunk of resolutionChunks) {
				const requestChunkId: ChunkIdentifier = {
					x_min: chunk.x_min,
					x_max: chunk.x_max,
					y_min: chunk.y_min,
					y_max: chunk.y_max,
					z_min: resolutionWindow.filmstripZMin,
					z_max: resolutionWindow.filmstripZMax,
					resolution: getResolutionLevel(resolutionLevel)
				};
				requestedChunks.set(JSON.stringify(requestChunkId), requestChunkId);
			}

			for (const prefetchFilmstripRange of prefetchFilmstripRanges) {
				for (const chunk of resolutionChunks) {
					const requestChunkId: ChunkIdentifier = {
						x_min: chunk.x_min,
						x_max: chunk.x_max,
						y_min: chunk.y_min,
						y_max: chunk.y_max,
						z_min: prefetchFilmstripRange.z_min,
						z_max: prefetchFilmstripRange.z_max,
						resolution: getResolutionLevel(resolutionLevel)
					};
					requestedChunks.set(JSON.stringify(requestChunkId), requestChunkId);
				}
			}
		}

		const desiredRequestedChunks = Array.from(requestedChunks.values());
		imageCache.cancelRequestsExcept(desiredRequestedChunks);

		for (const chunkId of desiredRequestedChunks) {
			void imageCache.getImage(chunkId).catch((err) => {
				debugUtil.warn(`LOAD: Failed to load chunk:`, err);
			});
		}
	}

	// Helper function to generate a readable tile key for debug display
	function generateTileKey(
		chunkId: ChunkIdentifier,
		resolutionLevel: { name: string; resolution: number }
	): string {
		// Create a shorter, more readable identifier
		const coordinateScale = Math.pow(2, resolutionLevel.resolution);
		const chunkX = Math.floor(chunkId.x_min / (chunkSizeX * coordinateScale));
		const chunkY = Math.floor(chunkId.y_min / (chunkSizeY * coordinateScale));
		const chunkZ = Math.floor(chunkId.z_min / chunkSizeZ);
		return `${resolutionLevel.name}[${chunkX},${chunkY},${chunkZ}]`;
	}

	// Function to render cached chunks
	function renderCachedChunks(s: p5, resolutionLevel: { resolution: number; threshold: number }) {
		if (!imageCache || currentVisibleChunks.length === 0) return;

		// At higher resolution levels, chunks represent more detail in the same screen space
		// res 0 = 1x1 world pixel per image pixel
		// res 1 = 2x2 world pixels per image pixel (image looks 2x bigger)
		// res 2 = 4x4 world pixels per image pixel (image looks 4x bigger)
		const displayScale = Math.pow(2, resolutionLevel.resolution);

		for (const chunkId of currentVisibleChunks) {
			// Calculate rendering position and size based on resolution level
			const renderX = chunkId.x_min * displayScale;
			const renderY = chunkId.y_min * displayScale;
			const renderWidth = APP_CONFIG.fixedChunkSize.width * displayScale;
			const renderHeight = APP_CONFIG.fixedChunkSize.height * displayScale;
			const renderSource = getBestRenderSourceForChunk(chunkId, nav.layer);
			if (renderSource) {
				let film = renderSource.image;
				if (!(histMin === 0 && histMax === 255)) {
					film = imageCache.getAdjustedImageForWindow(
						renderSource.sourceIdentifier,
						renderSource.image,
						histMin,
						histMax
					);
				}
				s.image(
					film,
					renderX,
					renderY,
					renderWidth,
					renderHeight,
					renderSource.sourceX,
					renderSource.sourceY,
					renderSource.sourceWidth,
					renderSource.sourceHeight
				);

				continue;
			} else {
				// If debug is disabled, just draw a placeholder rectangle
				s.fill(100, 100, 100, 100);
				s.noStroke();
				s.rect(renderX, renderY, renderWidth, renderHeight);
			}
			if (debugEnabled) {
				// Draw debug information (e.g., chunk boundaries)
				s.stroke(255, 0, 0);
				s.strokeWeight(5);
				s.noFill();
				s.rect(renderX, renderY, renderWidth, renderHeight);
			}
		}
	}

	const sketch = (s: p5) => {
		s.setup = () => {
			// runs once
			if (canvasContainer) {
				s.createCanvas(window.innerWidth, window.innerHeight, canvasContainer);
			} else {
				s.createCanvas(window.innerWidth, window.innerHeight);
			}
			// Acquire canvas element from drawing context
			p5CanvasEl = (s.drawingContext as CanvasRenderingContext2D).canvas as HTMLCanvasElement;
			appCanvasEl = p5CanvasEl; // Set the reference for event handling
			s.background(0, 0, 0);

			// Initialize browser storage
			browserStorage = new BrowserStorage();

			// Initialize the image cache
			imageCache = new ImageCache(remote, datasetURI, s, 500); // 500MB cache for multiple resolution levels

			// Try to restore navigation state from storage
			const savedNavState = browserStorage.loadNavigationState(datasetURI);
			// if (savedNavState) {
			// 	nav.setX(savedNavState.x);
			// 	nav.setY(savedNavState.y);
			// 	nav.setZoom(savedNavState.zoom);
			// 	nav.setLayer(savedNavState.layer);
			// 	debugUtil.log('Restored navigation state from storage');
			// } else {
			// Default camera to task center position
			// Calculate and store the original task center in native coordinates
			const { nativeCenterX, nativeCenterY } = calculateNativeTaskCenter();
			nav.setOriginalTaskCenter(nativeCenterX, nativeCenterY);

			// Center the viewport on the task center
			nav.panToOriginalTaskCenter(s.width, s.height);

			debugUtil.log('Centered camera on task position:', {
				taskCenter: { x: (xs[0] + xs[1]) / 2, y: (ys[0] + ys[1]) / 2 },
				nativeCenter: { x: nativeCenterX, y: nativeCenterY },
				resolution: resolution
			});
			// }

			// Load initial chunks
			const centerOfScreen = nav.sceneToData(s.width / 2, s.height / 2);
			const currentResolutionLevelInfo = getActiveResolutionLevel(nav.zoom);
			const progressiveLoadSequence = getProgressiveResolutionLoadSequence(
				currentResolutionLevelInfo.resolution
			);
			const initialVisibleChunkWindow = getViewportChunkWindow(
				s.width,
				s.height,
				nav.layer,
				currentResolutionLevelInfo.resolution
			);
			const initialPrefetchFilmstripRanges = getPrefetchFilmstripRanges(
				nav.layer,
				initialVisibleChunkWindow
			);
			lastVisibleChunkWindow = initialVisibleChunkWindow;
			lastProgressiveLoadSignature = progressiveLoadSequence.join(',');
			lastPrefetchRangeSignature =
				initialPrefetchFilmstripRanges.length > 0
					? initialPrefetchFilmstripRanges
							.map((range) => `${range.z_min}:${range.z_max}`)
							.join('|')
					: null;
			loadVisibleChunks(
				centerOfScreen,
				nav.layer,
				s.width,
				s.height,
				initialVisibleChunkWindow,
				currentResolutionLevelInfo,
				progressiveLoadSequence,
				initialPrefetchFilmstripRanges
			);
		};

		s.draw = () => {
			s.background(0, 0, 0);
			// Cursor is a crosshair if nav.drawing:
			if (splitModeActive || nav.drawing) {
				s.cursor('crosshair');
			} else {
				s.cursor('default');
			}

			s.push();
			s.scale(nav.zoom);
			s.translate(nav.x, nav.y);

			annotationStore.setHoveredAnnotation(null);

			// Get current view info for dynamic loading
			const centerOfScreen = nav.sceneToData(s.width / 2, s.height / 2);
			const currentResolutionLevelInfo = getActiveResolutionLevel(nav.zoom);
			const progressiveLoadSequence = getProgressiveResolutionLoadSequence(
				currentResolutionLevelInfo.resolution
			);
			const progressiveLoadSignature = progressiveLoadSequence.join(',');
			const visibleChunkWindow = getViewportChunkWindow(
				s.width,
				s.height,
				nav.layer,
				currentResolutionLevelInfo.resolution
			);
			const prefetchFilmstripRanges = getPrefetchFilmstripRanges(nav.layer, visibleChunkWindow);
			const prefetchRangeSignature =
				prefetchFilmstripRanges.length > 0
					? prefetchFilmstripRanges.map((range) => `${range.z_min}:${range.z_max}`).join('|')
					: null;

			if (
				!visibleChunkWindowEquals(lastVisibleChunkWindow, visibleChunkWindow) ||
				lastProgressiveLoadSignature !== progressiveLoadSignature ||
				lastPrefetchRangeSignature !== prefetchRangeSignature
			) {
				if (lastVisibleChunkWindow?.resolution !== visibleChunkWindow.resolution) {
					debugUtil.log(
						`Resolution changed from ${lastVisibleChunkWindow?.resolution} to ${visibleChunkWindow.resolution} - keeping cache`
					);
				}

				lastVisibleChunkWindow = visibleChunkWindow;
				lastProgressiveLoadSignature = progressiveLoadSignature;
				lastPrefetchRangeSignature = prefetchRangeSignature;
				loadVisibleChunks(
					centerOfScreen,
					nav.layer,
					s.width,
					s.height,
					visibleChunkWindow,
					currentResolutionLevelInfo,
					progressiveLoadSequence,
					prefetchFilmstripRanges
				);
			}

			// Render the cached chunks
			renderCachedChunks(s, currentResolutionLevelInfo);

			if (showAxesAndTaskRegion) {
				// Draw yellow cube around the complete task region
				s.stroke(255, 255, 0); // Yellow color
				s.strokeWeight(3);
				s.noFill();

				// Calculate native coordinates (task region might be in higher-res coordinates)
				const nativeTaskX1 = resolution !== undefined ? xs[0] * Math.pow(2, resolution) : xs[0];
				const nativeTaskY1 = resolution !== undefined ? ys[0] * Math.pow(2, resolution) : ys[0];
				const nativeTaskX2 = resolution !== undefined ? xs[1] * Math.pow(2, resolution) : xs[1];
				const nativeTaskY2 = resolution !== undefined ? ys[1] * Math.pow(2, resolution) : ys[1];

				// Draw the task region rectangle
				s.rect(
					nativeTaskX1,
					nativeTaskY1,
					nativeTaskX2 - nativeTaskX1,
					nativeTaskY2 - nativeTaskY1
				);
			}

			if (debugEnabled) {
				// axes:
				s.stroke(255, 0, 0);
				s.line(0, 0, 100, 0);
				s.stroke(0, 255, 0);
				s.line(0, 0, 0, 100);
			}

			// Draw annotations only if they're visible
			if (nav.annotationsVisible) {
				if (!splitModeActive) {
					annotationStore.currentAnnotation.annotation.draw(s, nav, annotationStore);
				}

				// Optimize hover detection - calculate mouse position once
				const dataPosition = nav.sceneToData(s.mouseX, s.mouseY);
				const hideSourceSegmentDuringSplitPreview =
					splitModeActive && splitTargetSegmentID !== null && splitPreviewAnnotations.length > 0;

				for (let anno of annotationStore.getLayerAnnotations(nav.layer) || []) {
					if (hideSourceSegmentDuringSplitPreview && anno.segmentID === splitTargetSegmentID) {
						continue;
					}
					anno.draw(s, nav, annotationStore);
					if (anno.pointIsInside([dataPosition.x, dataPosition.y])) {
						annotationStore.setHoveredAnnotation(anno);
					}
				}

				if (splitModeActive) {
					drawSplitPreviewOverlay(s);
					drawSplitSeedsForCurrentLayer(s);
				}
			}
			s.pop();

			// Draw chunk visualization AFTER everything else so it's visible on top
			if (debugEnabled && imageCache) {
				// Get the center of the screen
				const debugCenterOfScreen = nav.sceneToData(s.width / 2, s.height / 2);

				// Get the current resolution level based on zoom
				const debugCurrentResolutionLevelInfo = getActiveResolutionLevel(nav.zoom);

				// Get chunks using the current resolution level
				const currentChunk = getChunkForPoint(
					debugCenterOfScreen.x,
					debugCenterOfScreen.y,
					nav.layer,
					debugCurrentResolutionLevelInfo.resolution
				);
				const debugVisibleChunkWindow = getViewportChunkWindow(
					s.width,
					s.height,
					nav.layer,
					debugCurrentResolutionLevelInfo.resolution
				);
				const allChunks = getVisibleChunksForWindow(debugVisibleChunkWindow, debugCenterOfScreen);

				// Draw all neighboring chunks
				s.strokeWeight(1);
				s.noFill();

				// Log current chunk coordinates when they change to avoid console spam
				const coordinateScale = Math.pow(2, currentResolutionLevelInfo.resolution);
				const chunkKey = `${currentResolutionLevelInfo.name}_${currentChunk.x_min}-${currentChunk.x_max}_${currentChunk.y_min}-${currentChunk.y_max}_${currentChunk.z_min}-${currentChunk.z_max}`;
				if (chunkKey !== lastLoggedChunk) {
					debugUtil.log(`Current ${currentResolutionLevelInfo.name} chunk XYZ coords:`, {
						x: [currentChunk.x_min, currentChunk.x_max],
						y: [currentChunk.y_min, currentChunk.y_max],
						z: [currentChunk.z_min, currentChunk.z_max],
						chunkSize: [chunkSizeX * coordinateScale, chunkSizeY * coordinateScale, chunkSizeZ],
						resolution: currentResolutionLevelInfo.resolution
					});
					lastLoggedChunk = chunkKey;
				}
			}

			if (showAxesAndTaskRegion) {
				// axes in center of viewport:
				s.stroke(255, 0, 0);
				s.line(s.width / 2, s.height / 2, s.width / 2 + 100, s.height / 2);
				s.stroke(0, 255, 0);
				s.line(s.width / 2, s.height / 2, s.width / 2, s.height / 2 + 100);
			}

			// Debug information is now displayed via HTML overlay instead of P5.js text

			// Update debug information for HTML display
			// if (debugEnabled) {
			const worldCoords = nav.sceneToData(s.mouseX, s.mouseY);
			const displayCenterOfScreen = nav.sceneToData(s.width / 2, s.height / 2);
			const displayResolutionLevelInfo = getActiveResolutionLevel(nav.zoom);

			// Update mouse and scene info
			debugInfo.sceneMouseX = s.mouseX;
			debugInfo.sceneMouseY = s.mouseY;
			debugInfo.dataMouseX = worldCoords.x;
			debugInfo.dataMouseY = worldCoords.y;
			debugInfo.centerX = displayCenterOfScreen.x;
			debugInfo.centerY = displayCenterOfScreen.y;
			debugInfo.layer = nav.layer;
			debugInfo.zoom = nav.zoom;
			debugInfo.resolutionName = displayResolutionLevelInfo.name;
			debugInfo.resolutionLevel = displayResolutionLevelInfo.resolution;

			// Update chunk info
			const currentChunk = getChunkForPoint(
				displayCenterOfScreen.x,
				displayCenterOfScreen.y,
				nav.layer,
				displayResolutionLevelInfo.resolution
			);
			debugInfo.chunkInfo = `x:[${currentChunk.x_min}, ${currentChunk.x_max}] y:[${currentChunk.y_min}, ${currentChunk.y_max}] z:[${currentChunk.z_min}, ${currentChunk.z_max}]`;

			// Update cache stats
			if (imageCache) {
				const stats = imageCache.getStats();
				debugInfo.cacheStats = {
					enabled: imageCache.isCacheEnabled(),
					entryCount: stats.entryCount,
					cacheSize: stats.cacheSize,
					maxCacheSize: stats.maxCacheSize,
					utilizationPercent: stats.utilizationPercent,
					filmstripCount: stats.filmstripCount,
					totalSlicesInFilmstrips: stats.totalSlicesInFilmstrips,
					loadingCount: stats.loadingCount,
					filmstripLoadingCount: stats.filmstripLoadingCount
				};

				// Update storage stats (async)
				imageCache
					.getCombinedStats()
					.then((combinedStats) => {
						debugInfo.storageStats = {
							totalChunks: combinedStats.storage.totalChunks,
							estimatedSize: combinedStats.storage.estimatedSize
						};
					})
					.catch(() => {
						// Ignore errors in debug display
					});
				// }

				// Update pinch info
				debugInfo.pinchInfo = {
					active: isPinching,
					touchDistance: lastTouchDistance,
					centerX: pinchCenter.x,
					centerY: pinchCenter.y
				};
			}
		};

		s.keyPressed = (evt: any) => {
			const keyEvent = evt as KeyboardEvent | undefined;
			const key = keyEvent?.key ?? s.key;

			if (splitModeActive) {
				if (
					(keyEvent?.shiftKey &&
						!keyEvent.altKey &&
						(keyEvent.code === 'Comma' || keyEvent.code === 'Period')) ||
					(keyEvent?.altKey &&
						(keyEvent.code === 'Comma' || keyEvent.code === 'Period' || keyEvent.code === 'KeyC'))
				) {
					return false;
				}

				if (
					keyEvent?.code === 'Enter' ||
					keyEvent?.code === 'Backspace' ||
					key === 'd' ||
					key === 'D' ||
					key === 'x' ||
					key === 'X' ||
					key === '=' ||
					key === '-'
				) {
					return false;
				}
			}

			// Alt + S = checkpoint
			if (s.keyIsDown(s.ALT) && s.keyCode === 83) {
				// If SHIFT is also pressed, submit the data
				if (s.keyIsDown(s.SHIFT)) {
					onSubmitData(annotationStore.getAllAnnotations());
					return false;
				} else {
					onCheckpointData(annotationStore.getAllAnnotations());
					return false;
				}
			}

			if (keyEvent?.shiftKey && !keyEvent.altKey && keyEvent.code === 'Comma') {
				void Promise.resolve(onCopyToAdjacentSlice(-1)).finally(() => {
					saveNavigationStateDebounced();
				});
				return false;
			}

			if (keyEvent?.shiftKey && !keyEvent.altKey && keyEvent.code === 'Period') {
				void Promise.resolve(onCopyToAdjacentSlice(1)).finally(() => {
					saveNavigationStateDebounced();
				});
				return false;
			}

			if (keyEvent?.altKey && !keyEvent.shiftKey && keyEvent.code === 'Comma') {
				void Promise.resolve(onPropagateToAdjacentSlice(-1)).finally(() => {
					saveNavigationStateDebounced();
				});
				return false;
			}

			if (keyEvent?.altKey && !keyEvent.shiftKey && keyEvent.code === 'Period') {
				void Promise.resolve(onPropagateToAdjacentSlice(1)).finally(() => {
					saveNavigationStateDebounced();
				});
				return false;
			}

			if (keyEvent?.altKey && keyEvent.code === 'KeyC') {
				if (keyEvent.shiftKey) {
					void Promise.resolve(onPropagateFromLastSlice()).finally(() => {
						saveNavigationStateDebounced();
					});
				} else {
					void Promise.resolve(onCopyFromLastSlice()).finally(() => {
						saveNavigationStateDebounced();
					});
				}
				return false;
			}

			// 't' key = toggle info panel visibility
			if (s.key === 't' || s.key === 'T') {
				onToggleInfo();
				return false;
			}

			// 's' key = toggle segment panel visibility
			if (s.key === 's' || s.key === 'S') {
				onToggleMerge();
				return false;
			}

			// 'z' key = toggle minimap visibility
			if (keyEvent?.code === 'KeyZ' && !keyEvent.shiftKey && !keyEvent.altKey && !keyEvent.metaKey) {
				showMinimap = !showMinimap;
				return false;
			}

			// 'a' key = toggle axes and task region visibility
			if (s.key === 'a' || s.key === 'A') {
				toggleAxesAndTaskRegion();
				return false;
			}

			// '\' key = toggle debug overlay visibility
			if (
				keyEvent?.code === 'Backslash' &&
				!keyEvent.shiftKey &&
				!keyEvent.altKey &&
				!keyEvent.metaKey
			) {
				showDebugOverlay = !showDebugOverlay;
				return false;
			}

			for (const kb of keybindings.filter((kb) => kb.eventType === 'key')) {
				if (kb.matcher(s)) {
					kb.handler(s, annotationStore, nav, evt);
					// Save navigation state after key interactions
					saveNavigationStateDebounced();
					return false;
				}
			}
		};

		// Helper function to check if an event should be ignored by p5
		function shouldIgnoreEvent(evt: any): boolean {
			if (!evt || !evt.target) return false;

			const target = evt.target as HTMLElement;

			// Ignore events on interactive form elements that should handle their own mouse events
			const tagName = target.tagName.toLowerCase();
			if (['input', 'textarea', 'select', 'button', 'a'].includes(tagName)) {
				return true;
			}

			// Ignore events on elements that are inside interactive components
			if (target.closest('input, textarea, select, button, a')) {
				return true;
			}

			// For input elements specifically, check if they're range sliders or number inputs
			if (tagName === 'input') {
				const inputType = (target as HTMLInputElement).type;
				if (['range', 'number', 'text', 'email', 'password'].includes(inputType)) {
					return true;
				}
			}

			return false;
		}

		s.mousePressed = (evt: any) => {
			if (shouldIgnoreEvent(evt)) {
				return true; // Let other elements handle their events
			}
			return handleMouseEvent('mousePressed', evt);
		};

		s.mouseDragged = (evt: any) => {
			if (shouldIgnoreEvent(evt)) {
				return true; // Let other elements handle their events
			}
			return handleMouseEvent('mouseDragged', evt);
		};

		s.mouseWheel = (evt: WheelEvent) => {
			if (shouldIgnoreEvent(evt)) {
				return true; // Let other elements handle their events
			}
			return handleMouseEvent('mouseWheel', evt);
		};

		// Touch event handlers for pinch zoom and single-finger interactions
		s.touchStarted = (evt: any) => {
			if (shouldIgnoreEvent(evt)) {
				return true; // Let other elements handle their events
			}
			if (s.touches.length === 2) {
				// Start pinch gesture
				isPinching = true;
				lastTouchDistance = getTouchDistance(s);
				pinchCenter = getTouchCenter(s);
				if (evt && evt.preventDefault) evt.preventDefault();
				return false;
			}
			if (s.touches.length === 1) {
				const touches = s.touches as Array<{ x: number; y: number }>;
				const t = touches[0];

				if (splitModeActive) {
					const seedUnderPointer = getSplitSeedUnderPointer(t.x, t.y);
					if (seedUnderPointer) {
						onRemoveSplitSeed(seedUnderPointer.id);
					} else {
						const dataSpaceCoord = nav.sceneToData(t.x, t.y);
						onAddSplitSeed({
							x: dataSpaceCoord.x,
							y: dataSpaceCoord.y,
							z: nav.layer
						});
					}
					lastTouchPos = { x: t.x, y: t.y };
					if (evt && evt.preventDefault) evt.preventDefault();
					return false;
				}

				// Prepare long-press selection (when not drawing)
				longPressStartPos = { x: t.x, y: t.y };
				if (longPressTimer) clearTimeout(longPressTimer);
				if (!nav.drawing) {
					longPressTimer = setTimeout(() => {
						if (longPressStartPos) {
							const dx = t.x - longPressStartPos.x;
							const dy = t.y - longPressStartPos.y;
							if (Math.hypot(dx, dy) <= LONG_PRESS_MOVE_TOLERANCE) {
								const dataPos = nav.sceneToData(t.x, t.y);
								const annoUnderMouse = annotationStore
									.getAllAnnotations()
									.find((a) => a.pointIsInside([dataPos.x, dataPos.y]));
								if (annoUnderMouse) {
									annotationStore.setHoveredAnnotation(annoUnderMouse);
									annotationStore.setCurrentSegmentID(annoUnderMouse.segmentID);
									annotationStore.currentAnnotation.annotation.segmentID = annoUnderMouse.segmentID;
								}
							}
						}
						longPressTimer = null;
					}, LONG_PRESS_MS);
				}

				// Start draw or pan baseline
				if (nav.drawing) {
					const dataSpaceCoord = nav.sceneToData(t.x, t.y);
					annotationStore.currentAnnotation.addVertex([dataSpaceCoord.x, dataSpaceCoord.y]);
					lastTouchPos = { x: t.x, y: t.y };
				} else {
					lastTouchPos = { x: t.x, y: t.y };
				}
				if (evt && evt.preventDefault) evt.preventDefault();
				return false;
			}
			return true;
		};

		s.touchMoved = (evt: any) => {
			if (shouldIgnoreEvent(evt)) {
				return true; // Let other elements handle their events
			}
			if (isPinching && s.touches.length === 2) {
				const currentDistance = getTouchDistance(s);
				const currentCenter = getTouchCenter(s);

				if (lastTouchDistance > 0) {
					// Calculate zoom factor based on distance change
					const distanceRatio = currentDistance / lastTouchDistance;
					const zoomChange = (distanceRatio - 1) * APP_CONFIG.pinchZoomSpeed * nav.zoom;
					const newZoom = Math.max(
						APP_CONFIG.zoomBounds.min,
						Math.min(APP_CONFIG.zoomBounds.max, nav.zoom + zoomChange)
					);

					// Apply zoom towards the pinch center
					pinchZoom(newZoom, currentCenter.x, currentCenter.y);
				}

				lastTouchDistance = currentDistance;
				pinchCenter = currentCenter;
				if (evt && evt.preventDefault) evt.preventDefault();
				return false;
			}
			// Single-finger draw or pan
			if (s.touches.length === 1) {
				const touches = s.touches as Array<{ x: number; y: number }>;
				const curr = { x: touches[0].x, y: touches[0].y };

				if (splitModeActive) {
					lastTouchPos = curr;
					if (evt && evt.preventDefault) evt.preventDefault();
					return false;
				}

				// Cancel long-press if user moves beyond tolerance
				if (longPressStartPos) {
					const mdx = curr.x - longPressStartPos.x;
					const mdy = curr.y - longPressStartPos.y;
					if (Math.hypot(mdx, mdy) > LONG_PRESS_MOVE_TOLERANCE && longPressTimer) {
						clearTimeout(longPressTimer);
						longPressTimer = null;
					}
				}

				if (nav.drawing) {
					const dataSpaceCoord = nav.sceneToData(curr.x, curr.y);
					annotationStore.currentAnnotation.addVertex([dataSpaceCoord.x, dataSpaceCoord.y]);
				} else if (lastTouchPos) {
					const dx = curr.x - lastTouchPos.x;
					const dy = curr.y - lastTouchPos.y;
					if (dx !== 0 || dy !== 0) {
						nav.incrementX(dx / nav.zoom);
						nav.incrementY(dy / nav.zoom);
						saveNavigationStateDebounced();
					}
				}
				lastTouchPos = curr;
				if (evt && evt.preventDefault) evt.preventDefault();
				return false;
			}
		};

		s.touchEnded = (evt: any) => {
			if (shouldIgnoreEvent(evt)) {
				return true; // Let other elements handle their events
			}
			if (s.touches.length < 2) {
				// End pinch gesture
				isPinching = false;
				lastTouchDistance = 0;
			}
			// Clear any pending long-press
			if (longPressTimer) {
				clearTimeout(longPressTimer);
				longPressTimer = null;
			}
			longPressStartPos = null;

			if (s.touches.length === 0) {
				lastTouchPos = null;
			}
			return true;
		};

		function handleMouseEvent(eventType: MouseEventType, evt: MouseEvent | KeyboardEvent) {
			if (splitModeActive) {
				if (eventType === 'mousePressed' && s.mouseButton === s.LEFT && !s.keyIsDown(s.SHIFT)) {
					const seedUnderPointer = getSplitSeedUnderPointer(s.mouseX, s.mouseY);
					if (seedUnderPointer) {
						onRemoveSplitSeed(seedUnderPointer.id);
					} else {
						const dataSpaceCoord = nav.sceneToData(s.mouseX, s.mouseY);
						onAddSplitSeed({
							x: dataSpaceCoord.x,
							y: dataSpaceCoord.y,
							z: nav.layer
						});
					}
					return false;
				}

				if (eventType === 'mouseDragged' && s.mouseButton === s.LEFT && !s.keyIsDown(s.SHIFT)) {
					return false;
				}

				if (eventType === 'mousePressed' && s.mouseButton === s.RIGHT) {
					(evt as MouseEvent).preventDefault();
					return false;
				}
			}

			for (const kb of keybindings.filter(
				(kb) => kb.eventType === 'mouse' && kb.mouseEventType === eventType
			)) {
				if (kb.matcher(s)) {
					const result = kb.handler(s, annotationStore, nav, evt);
					// Save navigation state after mouse interactions that might change navigation
					if (eventType === 'mouseWheel' || eventType === 'mouseDragged') {
						saveNavigationStateDebounced();
					}
					return result;
				}
			}
		}

		s.windowResized = () => {
			s.resizeCanvas(window.innerWidth, window.innerHeight);
		};
	};

	// p5 app instance
	let app: p5;

	// Store references to event listeners for cleanup
	let gestureStartListener: (e: Event) => void;
	let gestureChangeListener: (e: Event) => void;
	let gestureEndListener: (e: Event) => void;
	let touchStartListener: (e: TouchEvent) => void;
	let touchMoveListener: (e: TouchEvent) => void;
	let touchEndListener: (e: TouchEvent) => void;
	let wheelListener: (e: WheelEvent) => void;
	let contextMenuListener: (e: Event) => void;

	// Initialize event listeners on mount
	onMount(() => {
		// Initialize the p5 app now that the DOM is ready
		app = new p5(sketch);

		// Prevent browser's default pinch zoom behavior
		gestureStartListener = (e) => e.preventDefault();
		gestureChangeListener = (e) => e.preventDefault();
		gestureEndListener = (e) => e.preventDefault();

		// Prevent default touch behaviors that might interfere with pinch zoom
		touchStartListener = (e) => {
			// Only prevent default if the event is on or near the canvas
			if (e.touches.length > 1 && p5CanvasEl) {
				const target = e.target as HTMLElement;
				if (target === p5CanvasEl || p5CanvasEl.contains(target)) {
					e.preventDefault();
				}
			}
		};

		touchMoveListener = (e) => {
			// Only prevent default if the event is on or near the canvas
			if (e.touches.length > 1 && p5CanvasEl) {
				const target = e.target as HTMLElement;
				if (target === p5CanvasEl || p5CanvasEl.contains(target)) {
					e.preventDefault();
				}
			}
		};

		touchEndListener = (e) => {
			// Only prevent default if the event is on or near the canvas
			if (e.touches.length > 0 && p5CanvasEl) {
				const target = e.target as HTMLElement;
				if (target === p5CanvasEl || p5CanvasEl.contains(target)) {
					e.preventDefault();
				}
			}
		};

		// Prevent browser's default pinch zoom behavior on all wheel events with ctrlKey
		wheelListener = (e) => {
			// Only prevent default if event is on canvas and ctrlKey is pressed
			if (e.ctrlKey && p5CanvasEl) {
				const target = e.target as HTMLElement;
				if (target === p5CanvasEl || p5CanvasEl.contains(target)) {
					e.preventDefault();
				}
			}
		};

		contextMenuListener = (e) => {
			// Only prevent context menu on the canvas
			if (p5CanvasEl) {
				const target = e.target as HTMLElement;
				if (target === p5CanvasEl || p5CanvasEl.contains(target)) {
					e.preventDefault();
				}
			}
		};

		// Add all event listeners
		document.addEventListener('gesturestart', gestureStartListener);
		document.addEventListener('gesturechange', gestureChangeListener);
		document.addEventListener('gestureend', gestureEndListener);
		document.addEventListener('touchstart', touchStartListener, { passive: false });
		document.addEventListener('touchmove', touchMoveListener, { passive: false });
		document.addEventListener('touchend', touchEndListener, { passive: false });
		document.addEventListener('wheel', wheelListener, { passive: false });
		document.addEventListener('contextmenu', contextMenuListener);
	});

	// Clean up everything on destroy
	onDestroy(() => {
		// Clear any pending timers
		if (navigationStateSaveTimer) {
			clearTimeout(navigationStateSaveTimer);
			navigationStateSaveTimer = null;
		}

		// Remove all event listeners
		if (gestureStartListener) document.removeEventListener('gesturestart', gestureStartListener);
		if (gestureChangeListener) document.removeEventListener('gesturechange', gestureChangeListener);
		if (gestureEndListener) document.removeEventListener('gestureend', gestureEndListener);
		if (touchStartListener) document.removeEventListener('touchstart', touchStartListener);
		if (touchMoveListener) document.removeEventListener('touchmove', touchMoveListener);
		if (touchEndListener) document.removeEventListener('touchend', touchEndListener);
		if (wheelListener) document.removeEventListener('wheel', wheelListener);
		if (contextMenuListener) document.removeEventListener('contextmenu', contextMenuListener);

		// Clean up p5 instance
		if (app) {
			app.remove(); // This removes the canvas and cleans up p5 properly
		}

		// Clean up image cache if it exists
		if (imageCache) {
			// If ImageCache has a cleanup method, call it here
			// imageCache.cleanup?.();
		}

		// Clean up browser storage timer
		if (browserStorage) {
			// Save final state before cleanup
			try {
				const navState: NavigationState = {
					x: nav.x,
					y: nav.y,
					zoom: nav.zoom,
					layer: nav.layer
				};
				browserStorage.saveNavigationState(navState, datasetURI);
			} catch (e) {
				// Ignore errors during cleanup
			}
		}
	});
</script>

<!-- Canvas container -->
<div bind:this={canvasContainer} class="paint-app-canvas"></div>

<div
	class="debug-overlay-shell"
	style="transform: translateX({showDebugOverlay ? '0' : 'calc(-100% - 10px)'});"
>
	<div
		class="debug-overlay"
		role="button"
		tabindex="0"
		aria-label="Copy debug info"
		on:click={copyDebugInfo}
		on:keydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				copyDebugInfo();
			}
		}}
		bind:this={debugOverlayElement}
	>
		<div class="debug-line">Scene Mouse: {debugInfo.sceneMouseX}, {debugInfo.sceneMouseY}</div>
		<div class="debug-line">
			Data Mouse: {debugInfo.dataMouseX.toFixed(3)}, {debugInfo.dataMouseY.toFixed(3)}
		</div>
		<div class="debug-line">
			Center of Screen: x: {debugInfo.centerX.toFixed(3)}, y: {debugInfo.centerY.toFixed(3)} (z: {debugInfo.layer})
		</div>
		<div class="debug-line">
			Zoom: {debugInfo.zoom.toFixed(3)} | Current Resolution: {debugInfo.resolutionName} (Level {debugInfo.resolutionLevel})
		</div>
		<div class="debug-line">
			Original ROI: x:[{xs[0]}, {xs[1]}] y:[{ys[0]}, {ys[1]}] z:[{zs[0]}, {zs[1]}]
		</div>
		<div class="debug-line">Current {debugInfo.resolutionName} Chunk: {debugInfo.chunkInfo}</div>

		<div class="debug-line">
			Chunk Loading: viewport-driven with {APP_CONFIG.chunkLoading.viewportPaddingChunks} chunk padding,
			center-first={APP_CONFIG.chunkLoading.prioritizeCenter}
		</div>

		{#if imageCache}
			<div class="debug-line">
				Memory Cache: {debugInfo.cacheStats.enabled ? 'ENABLED' : 'DISABLED'}, {debugInfo.cacheStats
					.entryCount} entries, {(debugInfo.cacheStats.cacheSize / 1024 / 1024).toFixed(1)}MB / {(
					debugInfo.cacheStats.maxCacheSize /
					1024 /
					1024
				).toFixed(0)}MB ({debugInfo.cacheStats.utilizationPercent.toFixed(1)}%)
			</div>
			<div class="debug-line">
				Filmstrip Cache: {debugInfo.cacheStats.filmstripCount} batches, {debugInfo.cacheStats
					.totalSlicesInFilmstrips} slices
			</div>
			<div class="debug-line">
				Loading: {debugInfo.cacheStats.loadingCount} chunks, {debugInfo.cacheStats
					.filmstripLoadingCount} filmstrips
			</div>
			<div class="debug-line storage-stats">
				Browser Storage: {debugInfo.storageStats.totalChunks} chunks, {(
					debugInfo.storageStats.estimatedSize /
					1024 /
					1024
				).toFixed(1)}MB
			</div>
		{/if}

		{#if APP_CONFIG.debug}
			<div class="debug-line">Pinch Active: {debugInfo.pinchInfo.active}</div>
			{#if debugInfo.pinchInfo.active}
				<div class="debug-line">Touch Distance: {debugInfo.pinchInfo.touchDistance.toFixed(2)}</div>
				<div class="debug-line">
					Pinch Center: {debugInfo.pinchInfo.centerX.toFixed(1)}, {debugInfo.pinchInfo.centerY.toFixed(
						1
					)}
				</div>
			{/if}
		{/if}
	</div>

	<button
		class="debug-toggle"
		on:click={() => (showDebugOverlay = !showDebugOverlay)}
		title="Toggle Debug (\\)"
		aria-label="Toggle Debug Overlay"
	>
		{#if showDebugOverlay}
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M15 5l-7 7 7 7"
				/>
			</svg>
		{:else}
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
			</svg>
		{/if}
		<span class="debug-toggle-key">\</span>
	</button>
</div>

<Minimap
	bind:footprint={minimapFootprint}
	{annotationStore}
	{nav}
	show={showMinimap}
	onToggle={() => (showMinimap = !showMinimap)}
/>

<style>
	.paint-app-canvas {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		z-index: 0;

		/* Touch-friendly defaults to keep interactions inside the canvas */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		overscroll-behavior: contain;
	}

	/* Ensure the p5 canvas itself also blocks browser gestures */
	.paint-app-canvas canvas {
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.debug-overlay-shell {
		position: fixed;
		top: 56px;
		left: 10px;
		z-index: 1000;
		pointer-events: auto;
		transition: transform 300ms ease-in-out;
	}

	.debug-overlay {
		position: relative;
		background: rgba(0, 0, 0, 0.8);
		color: white;
		font-family: monospace;
		font-size: 12px;
		padding: 10px;
		border-radius: 6px;
		z-index: 1000;
		pointer-events: auto;
		max-width: 600px;
		cursor: pointer;
		opacity: 1;
	}

	.debug-toggle {
		position: absolute;
		right: -28px;
		top: 28px;
		transform: translateY(-50%);
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 0 0.375rem 0.375rem 0;
		border: 1px solid rgb(209 213 219);
		background: white;
		color: rgb(55 65 81);
		box-shadow:
			0 1px 2px rgb(0 0 0 / 0.08),
			0 1px 3px rgb(0 0 0 / 0.12);
		cursor: pointer;
	}

	.debug-toggle:hover {
		background: rgb(249 250 251);
	}

	.debug-toggle-key {
		position: absolute;
		bottom: 2px;
		left: 2px;
		font-size: 10px;
		line-height: 1;
		color: rgb(107 114 128);
		opacity: 0.7;
	}

	.debug-line {
		margin-bottom: 2px;
		white-space: nowrap;
	}

	.storage-stats {
		color: #ccccff; /* Light blue color matching the original P5.js implementation */
	}
</style>
