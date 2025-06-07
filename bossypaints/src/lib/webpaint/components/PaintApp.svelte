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

	export let annotationStore: AnnotationManagerStore;
	export let nav: NavigationStore;

	export let datasetURI: string;
	export let xs: [number, number];
	export let ys: [number, number];
	export let zs: [number, number];
	export let resolution: number | undefined = undefined;

	// Expose the on:submit event to the parent component:
	export let onSubmitData: (layerwiseAnnotations: PolygonAnnotation[]) => void = () => {};
	export let onCheckpointData: (layerwiseAnnotations: PolygonAnnotation[]) => void = () => {};

	// Toggle visibility of task region (yellow rectangle) and axes
	let showAxesAndTaskRegion = true;

	// Function to toggle axes and task region visibility
	function toggleAxesAndTaskRegion() {
		showAxesAndTaskRegion = !showAxesAndTaskRegion;
	}

	const remote = new BossRemote();

	// Fixed chunk sizes for consistent performance across all resolutions
	const chunkSizeX = APP_CONFIG.fixedChunkSize.width;
	const chunkSizeY = APP_CONFIG.fixedChunkSize.height;
	const chunkSizeZ = APP_CONFIG.fixedChunkSize.depth;

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

	// Helper function to calculate filmstrip-aligned Z-range for a given Z-coordinate
	function getFilmstripZRange(z: number): { z_min: number; z_max: number } {
		const batchSize = APP_CONFIG.filmstrip.batchSize;
		const batchIndex = Math.floor(z / batchSize);
		const z_min = batchIndex * batchSize;
		const z_max = z_min + batchSize;
		return { z_min, z_max };
	}

	// Helper function to calculate Boss resolution level directly
	function getResolutionLevel(resolutionLevel: number): number {
		return resolutionLevel;
	}

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
		const chunkZ = Math.floor(z / 16);

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
	function getAllNeighboringChunks(
		centerOfScreen: { x: number; y: number },
		currentZ: number,
		resolutionLevel: number = 0
	): Array<{
		x_min: number;
		x_max: number;
		y_min: number;
		y_max: number;
		z_min: number;
		z_max: number;
	}> {
		const chunks = [];

		// At higher resolution levels, chunks cover more world space
		const chunkWorldSize = APP_CONFIG.fixedChunkSize.width * Math.pow(2, resolutionLevel);

		// Find which logical chunk contains the center point
		const centerChunkX = Math.floor(centerOfScreen.x / chunkWorldSize);
		const centerChunkY = Math.floor(centerOfScreen.y / chunkWorldSize);
		const centerChunkZ = Math.floor(currentZ / APP_CONFIG.fixedChunkSize.depth);

		const radius = APP_CONFIG.chunkLoading.radius;
		const prioritizeCenter = APP_CONFIG.chunkLoading.prioritizeCenter;

		// Generate chunks in order of priority (center-out) or simple grid order
		if (prioritizeCenter) {
			// Create an array of chunk offsets sorted by distance from center
			const chunkOffsets = [];
			for (let dx = -radius; dx <= radius; dx++) {
				for (let dy = -radius; dy <= radius; dy++) {
					const distance = Math.sqrt(dx * dx + dy * dy);
					chunkOffsets.push({ dx, dy, distance });
				}
			}

			// Sort by distance from center (closest first)
			chunkOffsets.sort((a, b) => a.distance - b.distance);

			// Generate chunks in priority order
			for (const { dx, dy } of chunkOffsets) {
				const chunkX = centerChunkX + dx;
				const chunkY = centerChunkY + dy;
				const chunkZ = centerChunkZ;

				// Skip chunks that would be negative
				if (chunkX < 0 || chunkY < 0 || chunkZ < 0) continue;

				// Convert back to base resolution coordinates for BossDB
				chunks.push({
					x_min: chunkX * APP_CONFIG.fixedChunkSize.width,
					x_max: (chunkX + 1) * APP_CONFIG.fixedChunkSize.width,
					y_min: chunkY * APP_CONFIG.fixedChunkSize.height,
					y_max: (chunkY + 1) * APP_CONFIG.fixedChunkSize.height,
					z_min: chunkZ * APP_CONFIG.fixedChunkSize.depth,
					z_max: (chunkZ + 1) * APP_CONFIG.fixedChunkSize.depth
				});
			}
		} else {
			// Generate chunks in simple grid order
			for (let dx = -radius; dx <= radius; dx++) {
				for (let dy = -radius; dy <= radius; dy++) {
					const chunkX = centerChunkX + dx;
					const chunkY = centerChunkY + dy;
					const chunkZ = centerChunkZ;

					// Skip chunks that would be negative
					if (chunkX < 0 || chunkY < 0 || chunkZ < 0) continue;

					// Convert back to base resolution coordinates for BossDB
					chunks.push({
						x_min: chunkX * APP_CONFIG.fixedChunkSize.width,
						x_max: (chunkX + 1) * APP_CONFIG.fixedChunkSize.width,
						y_min: chunkY * APP_CONFIG.fixedChunkSize.height,
						y_max: (chunkY + 1) * APP_CONFIG.fixedChunkSize.height,
						z_min: chunkZ * APP_CONFIG.fixedChunkSize.depth,
						z_max: (chunkZ + 1) * APP_CONFIG.fixedChunkSize.depth
					});
				}
			}
		}

		return chunks;
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
	let loadedChunks: Map<string, p5.Image> = new Map();
	let currentResolutionLevel: number = 0;
	let lastCenterChunk: ChunkIdentifier | null = null;
	let currentVisibleChunks: ChunkIdentifier[] = [];
	let navigationStateSaveTimer: ReturnType<typeof setTimeout> | null = null;

	// Pinch zoom state tracking
	let lastTouchDistance: number = 0;
	let isPinching: boolean = false;
	let pinchCenter: { x: number; y: number } = { x: 0, y: 0 };

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

	// Create the canvas element and attach it to the DOM:
	const canvas = document.createElement('canvas');
	canvas.id = 'app';
	document.body.appendChild(canvas);

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

	// Function to load and cache visible chunks based on current view
	async function loadVisibleChunks(
		centerOfScreen: { x: number; y: number },
		currentZ: number,
		currentResolutionLevel: {
			threshold: number;
			resolution: number;
			color: number[];
			name: string;
		}
	) {
		if (!imageCache) return;

		// Calculate filmstrip-aligned Z-range for efficient batch loading
		const filmstripRange = getFilmstripZRange(currentZ);

		debugUtil.log('LOAD: Loading visible chunks for:', {
			center: `x:${centerOfScreen.x.toFixed(0)}, y:${centerOfScreen.y.toFixed(0)}`,
			z: currentZ,
			filmstrip: `${filmstripRange.z_min}:${filmstripRange.z_max}`,
			resolution: currentResolutionLevel.resolution
		});

		// Get all chunks that should be visible
		const chunks = getAllNeighboringChunks(
			centerOfScreen,
			currentZ,
			currentResolutionLevel.resolution
		);
		const newVisibleChunks: ChunkIdentifier[] = [];

		// Convert chunk bounds to ChunkIdentifier format and load chunks in priority order
		const chunkPromises: Promise<void>[] = [];
		for (const chunk of chunks) {
			// Load each chunk using filmstrip-aligned Z-range for efficient batch fetching
			const chunkId: ChunkIdentifier = {
				x_min: chunk.x_min,
				x_max: chunk.x_max,
				y_min: chunk.y_min,
				y_max: chunk.y_max,
				z_min: filmstripRange.z_min, // Filmstrip-aligned range
				z_max: filmstripRange.z_max, // Filmstrip-aligned range
				resolution: getResolutionLevel(currentResolutionLevel.resolution)
			};

			newVisibleChunks.push(chunkId);

			// Start loading the chunk asynchronously (prioritized by getAllNeighboringChunks order)
			debugUtil.log(
				`LOAD: Requesting filmstrip chunk: x:[${chunkId.x_min}-${chunkId.x_max}], y:[${chunkId.y_min}-${chunkId.y_max}], z:[${chunkId.z_min}-${chunkId.z_max}] (priority: ${chunks.indexOf(chunk)})`
			);
			const loadPromise = imageCache.getImage(chunkId).catch((err) => {
				debugUtil.warn(`LOAD: Failed to load chunk:`, err);
			});
			chunkPromises.push(loadPromise);
		}

		// Load all chunks but don't wait for completion (async loading)
		Promise.allSettled(chunkPromises).then(() => {
			debugUtil.log(
				`LOAD: Completed loading ${chunks.length} chunks for resolution ${currentResolutionLevel.resolution}`
			);
		});

		currentVisibleChunks = newVisibleChunks;

		// Preload neighboring chunks for smooth navigation
		const centerChunk = getChunkForPoint(
			centerOfScreen.x,
			centerOfScreen.y,
			currentZ,
			currentResolutionLevel.resolution
		);
		const centerChunkId: ChunkIdentifier = {
			x_min: centerChunk.x_min,
			x_max: centerChunk.x_max,
			y_min: centerChunk.y_min,
			y_max: centerChunk.y_max,
			z_min: filmstripRange.z_min, // Filmstrip-aligned range
			z_max: filmstripRange.z_max, // Filmstrip-aligned range
			resolution: getResolutionLevel(currentResolutionLevel.resolution)
		};

		// Preload with configurable radius around the center chunk
		imageCache.preloadNeighboringChunks(centerChunkId, APP_CONFIG.chunkLoading.radius);

		// Preload neighboring filmstrip batches for efficient Z-navigation
		imageCache.preloadNeighboringFilmstrips(centerChunkId);
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
			// Try to get the cached image first (individual chunk)
			let image = imageCache.getCachedImage(chunkId);

			if (image) {
				// Calculate rendering position and size based on resolution level
				const renderX = chunkId.x_min * displayScale;
				const renderY = chunkId.y_min * displayScale;
				const renderWidth = APP_CONFIG.fixedChunkSize.width * displayScale; // 256, 512, 1024, etc.
				const renderHeight = APP_CONFIG.fixedChunkSize.height * displayScale; // 256, 512, 1024, etc.

				// Draw the individual cached image - extract correct layer from filmstrip
				s.image(
					image,
					renderX,
					renderY,
					renderWidth,
					renderHeight,
					0,
					(nav.layer % APP_CONFIG.fixedChunkSize.depth) * APP_CONFIG.fixedChunkSize.height, // Index into the filmstrip for the current layer
					APP_CONFIG.fixedChunkSize.width,
					APP_CONFIG.fixedChunkSize.height
				);

				continue;
			}

			// Try to render directly from filmstrip
			const filmstripInfo = imageCache.getFilmstripRenderInfo(chunkId, nav.layer);

			// Calculate rendering position and size based on resolution level
			const renderX = chunkId.x_min * displayScale;
			const renderY = chunkId.y_min * displayScale;
			const renderWidth = APP_CONFIG.fixedChunkSize.width * displayScale;
			const renderHeight = APP_CONFIG.fixedChunkSize.height * displayScale;
			if (filmstripInfo) {
				// Render directly from filmstrip
				s.image(
					filmstripInfo.filmstrip,
					renderX,
					renderY,
					renderWidth,
					renderHeight,
					0,
					nav.layer * APP_CONFIG.fixedChunkSize.height,
					filmstripInfo.sourceWidth,
					filmstripInfo.sourceHeight
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
			const appElement = document.getElementById('app');
			if (appElement) {
				s.createCanvas(window.innerWidth, window.innerHeight, appElement);
			} else {
				s.createCanvas(window.innerWidth, window.innerHeight);
			}
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
			const currentResolutionLevelInfo = getCurrentResolutionLevel(nav.zoom);
			loadVisibleChunks(centerOfScreen, nav.layer, currentResolutionLevelInfo);
		};

		s.draw = () => {
			s.background(0, 0, 0);
			// Cursor is a crosshair if nav.drawing:
			if (nav.drawing) {
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
			const currentResolutionLevelInfo = getCurrentResolutionLevel(nav.zoom);

			// Check if we need to load new chunks (resolution changed or moved significantly)
			const centerChunk = getChunkForPoint(
				centerOfScreen.x,
				centerOfScreen.y,
				nav.layer,
				currentResolutionLevelInfo.resolution
			);

			// Use filmstrip-aligned Z-range for center chunk calculation
			const filmstripRange = getFilmstripZRange(nav.layer);

			const centerChunkId: ChunkIdentifier = {
				x_min: centerChunk.x_min,
				x_max: centerChunk.x_max,
				y_min: centerChunk.y_min,
				y_max: centerChunk.y_max,
				z_min: filmstripRange.z_min, // Filmstrip-aligned range
				z_max: filmstripRange.z_max, // Filmstrip-aligned range
				resolution: getResolutionLevel(currentResolutionLevelInfo.resolution)
			};
			// Check if we've moved to a different chunk or changed resolution level or layer
			const chunkChanged =
				!lastCenterChunk ||
				lastCenterChunk.x_min !== centerChunkId.x_min ||
				lastCenterChunk.y_min !== centerChunkId.y_min ||
				lastCenterChunk.z_min !== centerChunkId.z_min ||
				lastCenterChunk.resolution !== centerChunkId.resolution;
			if (chunkChanged) {
				// If resolution level changed, update the current level
				if (lastCenterChunk && lastCenterChunk.resolution !== centerChunkId.resolution) {
					currentResolutionLevel = centerChunkId.resolution;
					// Keep old resolution level cached for fast switching
					debugUtil.log(
						`Resolution changed from ${lastCenterChunk.resolution} to ${centerChunkId.resolution} - keeping cache`
					);
				}

				lastCenterChunk = centerChunkId;
				loadVisibleChunks(centerOfScreen, nav.layer, currentResolutionLevelInfo);
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

			annotationStore.currentAnnotation.annotation.draw(s, nav, annotationStore);
			for (let anno of annotationStore.getLayerAnnotations(nav.layer)) {
				anno.draw(s, nav, annotationStore);

				if (anno.pointIsInside([s.mouseX, s.mouseY])) {
					annotationStore.setHoveredAnnotation(anno);
				}
				let dataPosition = nav.sceneToData(s.mouseX, s.mouseY);
				if (anno.pointIsInside([dataPosition.x, dataPosition.y])) {
					annotationStore.setHoveredAnnotation(anno);
				}
			}
			s.pop();

			// Draw chunk visualization AFTER everything else so it's visible on top
			if (debugEnabled && imageCache) {
				// Get the center of the screen
				const debugCenterOfScreen = nav.sceneToData(s.width / 2, s.height / 2);

				// Get the current resolution level based on zoom
				const debugCurrentResolutionLevelInfo = getCurrentResolutionLevel(nav.zoom);

				// Get chunks using the current resolution level
				const currentChunk = getChunkForPoint(
					debugCenterOfScreen.x,
					debugCenterOfScreen.y,
					nav.layer,
					debugCurrentResolutionLevelInfo.resolution
				);
				const allChunks = getAllNeighboringChunks(
					debugCenterOfScreen,
					nav.layer,
					debugCurrentResolutionLevelInfo.resolution
				);

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
			const displayResolutionLevelInfo = getCurrentResolutionLevel(nav.zoom);

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

			// 'a' key = toggle axes and task region visibility
			if (s.key === 'a' || s.key === 'A') {
				toggleAxesAndTaskRegion();
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

		s.mousePressed = (evt: any) => {
			if (evt.target !== s.canvas) return;
			return handleMouseEvent('mousePressed', evt);
		};

		s.mouseDragged = (evt: any) => {
			if (evt.target !== s.canvas) return;
			return handleMouseEvent('mouseDragged', evt);
		};

		s.mouseWheel = (evt: WheelEvent) => {
			if (evt.target !== s.canvas) return;
			return handleMouseEvent('mouseWheel', evt);
		};

		// Touch event handlers for pinch zoom
		s.touchStarted = (evt: any) => {
			// console.log('touchStarted called, touches:', s.touches.length);
			if (evt && evt.target !== s.canvas) return;

			if (s.touches.length === 2) {
				// console.log('Starting pinch gesture');
				// Start pinch gesture
				isPinching = true;
				lastTouchDistance = getTouchDistance(s);
				pinchCenter = getTouchCenter(s);
				// console.log('Initial touch distance:', lastTouchDistance);
				if (evt && evt.preventDefault) evt.preventDefault();
				return false;
			}

			// Handle single touch as mouse events for drawing/panning
			return true;
		};

		s.touchMoved = (evt: any) => {
			// console.log('touchMoved called, touches:', s.touches.length, 'isPinching:', isPinching);
			if (evt && evt.target !== s.canvas) return;

			if (isPinching && s.touches.length === 2) {
				const currentDistance = getTouchDistance(s);
				const currentCenter = getTouchCenter(s);
				// console.log('Pinch move - distance:', currentDistance, 'lastDistance:', lastTouchDistance);

				if (lastTouchDistance > 0) {
					// Calculate zoom factor based on distance change
					const distanceRatio = currentDistance / lastTouchDistance;
					const zoomChange = (distanceRatio - 1) * APP_CONFIG.pinchZoomSpeed * nav.zoom;
					const newZoom = Math.max(0.1, Math.min(10, nav.zoom + zoomChange));
					// console.log('Applying zoom change:', zoomChange, 'newZoom:', newZoom);

					// Apply zoom towards the pinch center
					pinchZoom(newZoom, currentCenter.x, currentCenter.y);
				}

				lastTouchDistance = currentDistance;
				pinchCenter = currentCenter;
				if (evt && evt.preventDefault) evt.preventDefault();
				return false;
			}

			return true;
		};

		s.touchEnded = (evt: any) => {
			// console.log('touchEnded called, touches:', s.touches.length);
			if (evt && evt.target !== s.canvas) return;

			if (s.touches.length < 2) {
				// console.log('Ending pinch gesture');
				// End pinch gesture
				isPinching = false;
				lastTouchDistance = 0;
			}

			return true;
		};

		function handleMouseEvent(eventType: MouseEventType, evt: MouseEvent | KeyboardEvent) {
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

	export const app = new p5(sketch);
	document.addEventListener('contextmenu', (event) => event.preventDefault());

	// Prevent browser's default pinch zoom behavior
	document.addEventListener('gesturestart', (e) => e.preventDefault());
	document.addEventListener('gesturechange', (e) => e.preventDefault());
	document.addEventListener('gestureend', (e) => e.preventDefault());

	// Prevent default touch behaviors that might interfere with pinch zoom
	document.addEventListener(
		'touchstart',
		(e) => {
			if (e.touches.length > 1) {
				e.preventDefault();
			}
		},
		{ passive: false }
	);

	document.addEventListener(
		'touchmove',
		(e) => {
			if (e.touches.length > 1) {
				e.preventDefault();
			}
		},
		{ passive: false }
	);

	document.addEventListener(
		'touchend',
		(e) => {
			// Allow single touch events but prevent multi-touch defaults
			if (e.touches.length > 0) {
				e.preventDefault();
			}
		},
		{ passive: false }
	);

	// Prevent browser's default pinch zoom behavior on all wheel events with ctrlKey
	// This ensures Mac trackpad pinch gestures are handled by our p5 mouseWheel handler
	document.addEventListener(
		'wheel',
		(e) => {
			if (e.ctrlKey) {
				e.preventDefault();
			}
		},
		{ passive: false }
	);
</script>

<!-- Debug information overlay -->
<!-- {#if debugEnabled} -->
<div class="debug-overlay">
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
		Chunk Loading: {(2 * APP_CONFIG.chunkLoading.radius + 1) ** 2} chunks ({2 *
			APP_CONFIG.chunkLoading.radius +
			1}x{2 * APP_CONFIG.chunkLoading.radius + 1} grid, radius={APP_CONFIG.chunkLoading.radius},
		center-first={APP_CONFIG.chunkLoading.prioritizeCenter})
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
<!-- {/if} -->

<Minimap {annotationStore} {nav} />

<style>
	.debug-overlay {
		position: fixed;
		top: 10px;
		left: 10px;
		background: rgba(0, 0, 0, 0.8);
		color: white;
		font-family: monospace;
		font-size: 12px;
		padding: 10px;
		border-radius: 5px;
		z-index: 1000;
		pointer-events: none;
		max-width: 600px;
	}

	.debug-line {
		margin-bottom: 2px;
		white-space: nowrap;
	}

	.storage-stats {
		color: #ccccff; /* Light blue color matching the original P5.js implementation */
	}
</style>
