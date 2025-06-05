<!--
@component PaintApp

The primary component for the PaintApp. This component is responsible for
rendering the main canvas and handling user input. It also loa	// Image cache for managing LOD chunks
	let imageCache: ImageCache;
	let browserStorage: BrowserStorage;
	let loadedChunks: Map<string, p5.Image> = new Map();
	let currentLODMultiplier: number = 1;
	let lastCenterChunk: ChunkIdentifier | null = null;
	let currentVisibleChunks: ChunkIdentifier[] = [];
	let navigationStateSaveTimer: number | null = null; image data
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
	export let resolution: number;

	// Expose the on:submit event to the parent component:
	export let onSubmitData: (layerwiseAnnotations: PolygonAnnotation[]) => void = () => {};
	export let onCheckpointData: (layerwiseAnnotations: PolygonAnnotation[]) => void = () => {};
	export let debugMode: boolean = false;
	export let debug: boolean = true; // Default to true for debug mode

	const remote = new BossRemote();

	const imageWidth = xs[1] - xs[0] - 1;
	const imageHeight = ys[1] - ys[0] - 1;
	const imageDepth = Math.max(1, zs[1] - zs[0] - 1);

	// Fixed chunk sizes for consistent performance across all resolutions
	const chunkSizeX = APP_CONFIG.fixedChunkSize.width;
	const chunkSizeY = APP_CONFIG.fixedChunkSize.height;
	const chunkSizeZ = APP_CONFIG.fixedChunkSize.depth;

	// Helper function to get the current LOD level based on zoom
	function getCurrentLODLevel(zoom: number): {
		threshold: number;
		multiplier: number;
		color: number[];
		name: string;
	} {
		// Find the appropriate LOD level based on zoom
		// Levels are sorted by threshold descending, so first match is correct
		for (const level of APP_CONFIG.lodLevels) {
			if (zoom >= level.threshold) {
				return level;
			}
		}
		// Fallback to the lowest level if zoom is extremely low
		return APP_CONFIG.lodLevels[APP_CONFIG.lodLevels.length - 1];
	}

	// Helper function to calculate filmstrip-aligned Z-range for a given Z-coordinate
	function getFilmstripZRange(z: number): { z_min: number; z_max: number } {
		const batchSize = APP_CONFIG.filmstrip.batchSize;
		const batchIndex = Math.floor(z / batchSize);
		const z_min = batchIndex * batchSize;
		const z_max = z_min + batchSize;
		return { z_min, z_max };
	}

	// Helper function to calculate Boss resolution based on base resolution and LOD multiplier
	function getBossResolution(baseResolution: number, lodMultiplier: number): number {
		return baseResolution + Math.log2(lodMultiplier);
	}

	// Helper function to get chunk coordinates for a given point with specific multiplier
	function getChunkForPoint(
		x: number,
		y: number,
		z: number,
		multiplier: number = 1
	): {
		x_min: number;
		x_max: number;
		y_min: number;
		y_max: number;
		z_min: number;
		z_max: number;
	} {
		const effectiveChunkSizeX = chunkSizeX * multiplier;
		const effectiveChunkSizeY = chunkSizeY * multiplier;
		const effectiveChunkSizeZ = chunkSizeZ * multiplier;

		// Calculate which chunk the point is in
		const chunkX = Math.floor(x / effectiveChunkSizeX);
		const chunkY = Math.floor(y / effectiveChunkSizeY);
		const chunkZ = Math.floor(z / effectiveChunkSizeZ);

		// Calculate chunk bounds, ensuring we never go below 0
		const x_min = Math.max(0, chunkX * effectiveChunkSizeX);
		const x_max = x_min + effectiveChunkSizeX;
		const y_min = Math.max(0, chunkY * effectiveChunkSizeY);
		const y_max = y_min + effectiveChunkSizeY;
		const z_min = Math.max(0, chunkZ * effectiveChunkSizeZ);
		const z_max = z_min + effectiveChunkSizeZ;

		return { x_min, x_max, y_min, y_max, z_min, z_max };
	}

	// Helper function to get all neighboring chunks around a center point with specific multiplier
	function getAllNeighboringChunks(
		centerOfScreen: { x: number; y: number },
		currentZ: number,
		multiplier: number = 1
	): Array<{
		x_min: number;
		x_max: number;
		y_min: number;
		y_max: number;
		z_min: number;
		z_max: number;
	}> {
		const chunks = [];
		const effectiveChunkSizeX = chunkSizeX * multiplier;
		const effectiveChunkSizeY = chunkSizeY * multiplier;
		const effectiveChunkSizeZ = chunkSizeZ * multiplier;

		// Get the chunk that contains the center point
		const centerChunk = getChunkForPoint(centerOfScreen.x, centerOfScreen.y, currentZ, multiplier);
		const centerChunkX = Math.floor(centerOfScreen.x / effectiveChunkSizeX);
		const centerChunkY = Math.floor(centerOfScreen.y / effectiveChunkSizeY);
		const centerChunkZ = Math.floor(currentZ / effectiveChunkSizeZ);

		// Generate all 9 chunks (3x3 grid) around the center chunk
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				const chunkX = centerChunkX + dx;
				const chunkY = centerChunkY + dy;
				const chunkZ = centerChunkZ; // Keep same Z for now

				// Skip chunks that would be negative
				if (chunkX < 0 || chunkY < 0 || chunkZ < 0) continue;

				const x_min = chunkX * effectiveChunkSizeX;
				const x_max = x_min + effectiveChunkSizeX;
				const y_min = chunkY * effectiveChunkSizeY;
				const y_max = y_min + effectiveChunkSizeY;
				const z_min = chunkZ * effectiveChunkSizeZ;
				const z_max = z_min + effectiveChunkSizeZ;

				chunks.push({ x_min, x_max, y_min, y_max, z_min, z_max });
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

	// Image cache for managing LOD chunks
	let imageCache: ImageCache;
	let browserStorage: BrowserStorage;
	let loadedChunks: Map<string, p5.Image> = new Map();
	let currentLODMultiplier: number = 1;
	let lastCenterChunk: ChunkIdentifier | null = null;
	let currentVisibleChunks: ChunkIdentifier[] = [];
	let navigationStateSaveTimer: ReturnType<typeof setTimeout> | null = null;

	// Pinch zoom state tracking
	let lastTouchDistance: number = 0;
	let isPinching: boolean = false;
	let pinchCenter: { x: number; y: number } = { x: 0, y: 0 };

	// Helper function to calculate distance between two touch points (p5.js version)
	function getTouchDistance(s: p5): number {
		if (s.touches.length < 2) return 0;
		const dx = s.touches[0].x - s.touches[1].x;
		const dy = s.touches[0].y - s.touches[1].y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	// Helper function to calculate center point between two touches (p5.js version)
	function getTouchCenter(s: p5): { x: number; y: number } {
		if (s.touches.length < 2) return { x: 0, y: 0 };
		return {
			x: (s.touches[0].x + s.touches[1].x) / 2,
			y: (s.touches[0].y + s.touches[1].y) / 2
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

	// Function to clear the cache
	function clearCache() {
		if (imageCache) {
			console.log('UI: Clear cache button clicked, clearing cache and reloading data');
			imageCache
				.clearAll()
				.then(() => {
					// Force reload of current view after cache is cleared
					const centerOfScreen = nav.sceneToData(window.innerWidth / 2, window.innerHeight / 2);
					const currentLODLevel = getCurrentLODLevel(nav.zoom);

					// Clear our tracking variables to force reload
					lastCenterChunk = null;
					currentVisibleChunks = [];
					loadedChunks.clear();

					// Force reload visible chunks for current view
					console.log('UI: Cache cleared, forcing reload of visible chunks');
					loadVisibleChunks(centerOfScreen, nav.layer, currentLODLevel);

					console.log('UI: Cache cleared and view reload triggered');
				})
				.catch((error) => {
					console.error('UI: Error clearing cache:', error);
				});
		}
	}

	// Create the canvas element and attach it to the DOM:
	const canvas = document.createElement('canvas');
	canvas.id = 'app';
	document.body.appendChild(canvas);

	// Use the debug prop, fallback to config, then debugMode for compatibility
	const debugEnabled = debug ?? (APP_CONFIG.debug || debugMode);

	// Function to load and cache visible chunks based on current view
	async function loadVisibleChunks(
		centerOfScreen: { x: number; y: number },
		currentZ: number,
		currentLODLevel: any
	) {
		if (!imageCache) return;

		// Calculate filmstrip-aligned Z-range for efficient batch loading
		const filmstripRange = getFilmstripZRange(currentZ);

		console.log('LOAD: Loading visible chunks for:', {
			center: `x:${centerOfScreen.x.toFixed(0)}, y:${centerOfScreen.y.toFixed(0)}`,
			z: currentZ,
			filmstrip: `${filmstripRange.z_min}:${filmstripRange.z_max}`,
			lod: currentLODLevel.multiplier
		});

		// Get all chunks that should be visible
		const chunks = getAllNeighboringChunks(centerOfScreen, currentZ, currentLODLevel.multiplier);
		const newVisibleChunks: ChunkIdentifier[] = [];

		// Convert chunk bounds to ChunkIdentifier format
		for (const chunk of chunks) {
			// Load each chunk using filmstrip-aligned Z-range for efficient batch fetching
			const chunkId: ChunkIdentifier = {
				x_min: chunk.x_min,
				x_max: chunk.x_max,
				y_min: chunk.y_min,
				y_max: chunk.y_max,
				z_min: filmstripRange.z_min, // Filmstrip-aligned range
				z_max: filmstripRange.z_max, // Filmstrip-aligned range
				lod: getBossResolution(resolution, currentLODLevel.multiplier)
			};

			newVisibleChunks.push(chunkId);

			// Start loading the chunk (this will use cache if already loaded)
			console.log(
				`LOAD: Requesting filmstrip chunk: x:[${chunkId.x_min}-${chunkId.x_max}], y:[${chunkId.y_min}-${chunkId.y_max}], z:[${chunkId.z_min}-${chunkId.z_max}]`
			);
			imageCache.getImage(chunkId).catch((err) => {
				console.warn(`LOAD: Failed to load chunk:`, err);
			});
		}

		currentVisibleChunks = newVisibleChunks;

		// Preload neighboring chunks for smooth navigation
		const centerChunk = getChunkForPoint(
			centerOfScreen.x,
			centerOfScreen.y,
			currentZ,
			currentLODLevel.multiplier
		);
		const centerChunkId: ChunkIdentifier = {
			x_min: centerChunk.x_min,
			x_max: centerChunk.x_max,
			y_min: centerChunk.y_min,
			y_max: centerChunk.y_max,
			z_min: filmstripRange.z_min, // Filmstrip-aligned range
			z_max: filmstripRange.z_max, // Filmstrip-aligned range
			lod: getBossResolution(resolution, currentLODLevel.multiplier)
		};

		// Preload with a radius of 1 (immediate neighbors)
		imageCache.preloadNeighboringChunks(centerChunkId, 1);

		// Preload neighboring filmstrip batches for efficient Z-navigation
		imageCache.preloadNeighboringFilmstrips(centerChunkId);
	}

	// Helper function to generate a readable tile key for debug display
	function generateTileKey(
		chunkId: ChunkIdentifier,
		lodLevel: { name: string; multiplier: number }
	): string {
		// Create a shorter, more readable identifier
		const chunkX = Math.floor(chunkId.x_min / (chunkSizeX * lodLevel.multiplier));
		const chunkY = Math.floor(chunkId.y_min / (chunkSizeY * lodLevel.multiplier));
		const chunkZ = Math.floor(chunkId.z_min / (chunkSizeZ * lodLevel.multiplier));
		return `${lodLevel.name}[${chunkX},${chunkY},${chunkZ}]`;
	}

	// Function to render cached chunks
	function renderCachedChunks(s: p5, lodLevel: { multiplier: number; threshold: number }) {
		if (!imageCache || currentVisibleChunks.length === 0) return;

		// Calculate the scaling factor based on LOD multiplier
		// Higher LOD multipliers mean we fetched smaller images that need to be scaled up
		const scaleFactor = lodLevel.multiplier;

		for (const chunkId of currentVisibleChunks) {
			// Try to get the cached image first (individual chunk)
			let image = imageCache.getCachedImage(chunkId);

			if (image) {
				// Calculate render position and size
				const renderX = chunkId.x_min;
				const renderY = chunkId.y_min;
				const renderWidth = chunkId.x_max - chunkId.x_min;
				const renderHeight = chunkId.y_max - chunkId.y_min;

				// Draw the individual cached image - need to extract correct layer if it's a filmstrip
				s.image(
					image,
					renderX,
					renderY, // Destination position
					renderWidth,
					renderHeight, // Destination size (maintains visual appearance)
					// Source coordinates - extract the correct layer from the image
					0,
					nav.layer * renderHeight, // Index into the filmstrip for the current layer
					renderWidth, // Use chunk width
					renderHeight // Use chunk height (single layer)
				);

				continue; // Skip the rest if we found an image
			}

			// Try to render directly from filmstrip (render-time extraction - much faster!)
			const filmstripInfo = imageCache.getFilmstripRenderInfo(chunkId, nav.layer);

			if (filmstripInfo) {
				// Calculate render position and size
				const renderX = chunkId.x_min;
				const renderY = chunkId.y_min;
				const renderWidth = chunkId.x_max - chunkId.x_min;
				const renderHeight = chunkId.y_max - chunkId.y_min;

				// Render directly from filmstrip using actual source coordinates
				s.image(
					filmstripInfo.filmstrip,
					renderX,
					renderY, // Destination position
					renderWidth,
					renderHeight, // Destination size (maintains visual appearance)
					0, //filmstripInfo.sourceX,
					// de-sqishing:
					nav.layer * renderHeight,
					filmstripInfo.sourceWidth,
					filmstripInfo.sourceHeight // Use actual filmstrip source dimensions
				);

				continue; // Skip the rest if we rendered from filmstrip
			}

			// If we get here, neither the image nor filmstrip was available
			// When cache is disabled, we need to initiate loading without waiting
			if (!imageCache.isCacheEnabled()) {
				// Display a loading indicator or placeholder
				const renderX = chunkId.x_min;
				const renderY = chunkId.y_min;
				const renderWidth = chunkId.x_max - chunkId.x_min;
				const renderHeight = chunkId.y_max - chunkId.y_min;

				// Draw a subtle loading indicator rectangle
				s.push();
				s.noFill();
				s.stroke(100, 100, 255, 100); // Light blue with low opacity
				s.strokeWeight(1);
				s.rect(renderX, renderY, renderWidth, renderHeight);

				// Add a small "loading" text
				s.noStroke();
				s.fill(200, 200, 255);
				s.textSize(12);
				s.textAlign(s.CENTER, s.CENTER);
				s.text('loading...', renderX + renderWidth / 2, renderY + renderHeight / 2);
				s.pop();

				// Force immediate loading attempt for this chunk
				console.log(
					`Force loading chunk because cache is disabled: x:[${chunkId.x_min}-${chunkId.x_max}], y:[${chunkId.y_min}-${chunkId.y_max}], z:${chunkId.z_min}`
				);
				imageCache.getImage(chunkId).catch((err) => {
					console.warn('Failed to load chunk:', err);
				});
			}
		}
	}

	const sketch = (s: p5) => {
		s.setup = () => {
			// runs once
			s.createCanvas(window.innerWidth, window.innerHeight, document.getElementById('app'));
			s.background(0, 0, 0);

			// Initialize browser storage
			browserStorage = new BrowserStorage();

			// Initialize the image cache
			imageCache = new ImageCache(remote, datasetURI, s, 2999); // 100MB cache

			// Try to restore navigation state from storage
			const savedNavState = browserStorage.loadNavigationState(datasetURI);
			if (savedNavState) {
				nav.setX(savedNavState.x);
				nav.setY(savedNavState.y);
				nav.setZoom(savedNavState.zoom);
				nav.setLayer(savedNavState.layer);
				console.log('Restored navigation state from storage');
			} else {
				// Set the nav to the center of the image (default behavior)
				nav.setX((s.width - nav.imageWidth) / 2);
				nav.setY((s.height - nav.imageHeight) / 2);
			}

			// Load initial chunks
			const centerOfScreen = nav.sceneToData(s.width / 2, s.height / 2);
			const currentLODLevel = getCurrentLODLevel(nav.zoom);
			loadVisibleChunks(centerOfScreen, nav.layer, currentLODLevel);
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
			const currentLODLevel = getCurrentLODLevel(nav.zoom);

			// Check if we need to load new chunks (LOD changed or moved significantly)
			const centerChunk = getChunkForPoint(
				centerOfScreen.x,
				centerOfScreen.y,
				nav.layer,
				currentLODLevel.multiplier
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
				lod: getBossResolution(resolution, currentLODLevel.multiplier)
			};
			// Check if we've moved to a different chunk or changed LOD level or layer
			const chunkChanged =
				!lastCenterChunk ||
				lastCenterChunk.x_min !== centerChunkId.x_min ||
				lastCenterChunk.y_min !== centerChunkId.y_min ||
				lastCenterChunk.z_min !== centerChunkId.z_min ||
				lastCenterChunk.lod !== centerChunkId.lod;
			if (chunkChanged) {
				// If LOD level changed, clear old level cache entries
				if (lastCenterChunk && lastCenterChunk.lod !== centerChunkId.lod) {
					currentLODMultiplier = centerChunkId.lod;
					// Optionally clear old LOD level to save memory
					if (imageCache) {
						imageCache.evictLODLevel(lastCenterChunk.lod);
					}
				}

				lastCenterChunk = centerChunkId;
				loadVisibleChunks(centerOfScreen, nav.layer, currentLODLevel);
			}

			// Render the cached chunks
			renderCachedChunks(s, currentLODLevel);

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
				const centerOfScreen = nav.sceneToData(s.width / 2, s.height / 2);

				// Get the current LOD level based on zoom
				const currentLODLevel = getCurrentLODLevel(nav.zoom);

				// Get chunks using the current LOD level
				const currentChunk = getChunkForPoint(
					centerOfScreen.x,
					centerOfScreen.y,
					nav.layer,
					currentLODLevel.multiplier
				);
				const allChunks = getAllNeighboringChunks(
					centerOfScreen,
					nav.layer,
					currentLODLevel.multiplier
				);

				// Draw all neighboring chunks
				s.strokeWeight(1);
				s.noFill();

				for (let i = 0; i < allChunks.length; i++) {
					const chunk = allChunks[i];

					// Transform chunk coordinates to screen coordinates
					const chunkTopLeft = nav.dataToScene(chunk.x_min, chunk.y_min);
					const chunkBottomRight = nav.dataToScene(chunk.x_max, chunk.y_max);
					const chunkScreenWidth = chunkBottomRight.x - chunkTopLeft.x;
					const chunkScreenHeight = chunkBottomRight.y - chunkTopLeft.y;

					// Check if this is the current chunk (contains center of screen)
					const isCurrentChunk =
						chunk.x_min === currentChunk.x_min &&
						chunk.y_min === currentChunk.y_min &&
						chunk.z_min === currentChunk.z_min;

					// Use the color from the current LOD level
					const [r, g, b] = currentLODLevel.color;
					if (isCurrentChunk) {
						// Draw current chunk with bright color and thick stroke
						s.stroke(r, g, b);
						s.strokeWeight(4);
					} else {
						// Draw neighboring chunks with lighter color and thinner stroke
						s.stroke(r * 0.8, g * 0.8, b * 0.8);
						s.strokeWeight(2);
					}

					s.rect(chunkTopLeft.x, chunkTopLeft.y, chunkScreenWidth, chunkScreenHeight);
				}

				// Log current chunk coordinates when they change to avoid console spam
				const chunkKey = `${currentLODLevel.name}_${currentChunk.x_min}-${currentChunk.x_max}_${currentChunk.y_min}-${currentChunk.y_max}_${currentChunk.z_min}-${currentChunk.z_max}`;
				if (chunkKey !== lastLoggedChunk) {
					console.log(`Current ${currentLODLevel.name} chunk XYZ coords:`, {
						x: [currentChunk.x_min, currentChunk.x_max],
						y: [currentChunk.y_min, currentChunk.y_max],
						z: [currentChunk.z_min, currentChunk.z_max],
						chunkSize: [
							chunkSizeX * currentLODLevel.multiplier,
							chunkSizeY * currentLODLevel.multiplier,
							chunkSizeZ * currentLODLevel.multiplier
						],
						multiplier: currentLODLevel.multiplier
					});
					lastLoggedChunk = chunkKey;
				}
			}

			if (debugEnabled) {
				// axes in center of viewport:
				s.stroke(255, 0, 0);
				s.line(s.width / 2, s.height / 2, s.width / 2 + 100, s.height / 2);
				s.stroke(0, 255, 0);
				s.line(s.width / 2, s.height / 2, s.width / 2, s.height / 2 + 100);

				s.fill(255);
				s.noStroke();
				s.text(`Scene Mouse: ${s.mouseX}, ${s.mouseY}`, 10, 10);
				const worldCoords = nav.sceneToData(s.mouseX, s.mouseY);
				s.text(`Data Mouse: ${worldCoords.x.toFixed(3)}, ${worldCoords.y.toFixed(3)}`, 10, 20);
				const centerOfScreen = nav.sceneToData(s.width / 2, s.height / 2);
				s.text(
					`Center of Screen: x: ${centerOfScreen.x.toFixed(3)}, y: ${centerOfScreen.y.toFixed(3)} (z: ${nav.layer})`,
					10,
					30
				);

				// Show zoom and LOD info using multi-level system
				const currentLODLevel = getCurrentLODLevel(nav.zoom);
				const [r, g, b] = currentLODLevel.color;
				s.text(
					`Zoom: ${nav.zoom.toFixed(3)} | Current LOD: ${currentLODLevel.name} (${currentLODLevel.multiplier}x)`,
					10,
					40
				);

				// Show current ROI bounds
				s.text(
					`Original ROI: x:[${xs[0]}, ${xs[1]}] y:[${ys[0]}, ${ys[1]}] z:[${zs[0]}, ${zs[1]}]`,
					10,
					50
				);

				// Show current chunk info using new LOD system
				const currentChunk = getChunkForPoint(
					centerOfScreen.x,
					centerOfScreen.y,
					nav.layer,
					currentLODLevel.multiplier
				);
				s.text(
					`Current ${currentLODLevel.name} Chunk: x:[${currentChunk.x_min}, ${currentChunk.x_max}] y:[${currentChunk.y_min}, ${currentChunk.y_max}] z:[${currentChunk.z_min}, ${currentChunk.z_max}]`,
					10,
					60
				);

				// Show if outside original ROI - fix the logic
				if (isOutsideROI(centerOfScreen, nav.layer)) {
					s.fill(255, 255, 0); // Yellow text
					s.text('CENTER OUTSIDE ORIGINAL ROI', 10, 70);
				} else {
					s.fill(0, 255, 0); // Green text
					s.text('CENTER INSIDE ORIGINAL ROI', 10, 70);
				}

				// Show cache statistics
				if (imageCache) {
					const stats = imageCache.getStats();
					s.fill(255);
					s.text(
						`Memory Cache: ${imageCache.isCacheEnabled() ? 'ENABLED' : 'DISABLED'}, ${stats.entryCount} entries, ${(stats.cacheSize / 1024 / 1024).toFixed(1)}MB / ${(stats.maxCacheSize / 1024 / 1024).toFixed(0)}MB (${stats.utilizationPercent.toFixed(1)}%)`,
						10,
						80
					);
					s.text(
						`Filmstrip Cache: ${stats.filmstripCount} batches, ${stats.totalSlicesInFilmstrips} slices`,
						10,
						90
					);
					s.text(
						`Loading: ${stats.loadingCount} chunks, ${stats.filmstripLoadingCount} filmstrips`,
						10,
						100
					);

					// Show storage stats (async, so we'll update periodically)
					imageCache
						.getCombinedStats()
						.then((combinedStats) => {
							if (debugEnabled) {
								s.fill(200, 200, 255); // Light blue for storage stats
								s.text(
									`Browser Storage: ${combinedStats.storage.totalChunks} chunks, ${(combinedStats.storage.estimatedSize / 1024 / 1024).toFixed(1)}MB`,
									10,
									110
								);
							}
						})
						.catch(() => {
							// Ignore errors in debug display
						});
				}

				// Show pinch zoom debug info
				if (APP_CONFIG.debugPinch) {
					s.fill(255);
					s.text(`Pinch Active: ${isPinching}`, 10, imageCache ? 110 : 80);
					if (isPinching) {
						s.text(`Touch Distance: ${lastTouchDistance.toFixed(2)}`, 10, imageCache ? 120 : 90);
						s.text(
							`Pinch Center: ${pinchCenter.x.toFixed(1)}, ${pinchCenter.y.toFixed(1)}`,
							10,
							imageCache ? 130 : 100
						);
					}
				}
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

		// Function to clear the cache
		function clearCache() {
			if (imageCache) {
				console.log('UI: Clear cache button clicked, clearing cache and reloading data');
				imageCache
					.clearAll()
					.then(() => {
						// Force reload of current view after cache is cleared
						const centerOfScreen = nav.sceneToData(s.width / 2, s.height / 2);
						const currentLODLevel = getCurrentLODLevel(nav.zoom);

						// Clear our tracking variables to force reload
						lastCenterChunk = null;
						currentVisibleChunks = [];
						loadedChunks.clear();

						// Force reload visible chunks for current view
						console.log('UI: Cache cleared, forcing reload of visible chunks');
						loadVisibleChunks(centerOfScreen, nav.layer, currentLODLevel);

						// Force refresh of the UI
						s.redraw();

						console.log('UI: Cache cleared and view reload triggered');
					})
					.catch((error) => {
						console.error('UI: Error clearing cache:', error);
					});
			}
		}

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

<Minimap {annotationStore} {nav} />

<style>
</style>
