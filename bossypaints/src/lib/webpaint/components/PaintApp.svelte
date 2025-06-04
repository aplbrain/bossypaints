<!--
@component PaintApp

The primary component for the PaintApp. This component is responsible for
rendering the main canvas and handling user input. It also loads the image data
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

	// Calculate chunk size (same as current ROI)
	const chunkSizeX = xs[1] - xs[0];
	const chunkSizeY = ys[1] - ys[0];
	const chunkSizeZ = zs[1] - zs[0];

	// Helper function to get chunk coordinates for a given point
	function getChunkForPoint(
		x: number,
		y: number,
		z: number
	): {
		x_min: number;
		x_max: number;
		y_min: number;
		y_max: number;
		z_min: number;
		z_max: number;
	} {
		// Calculate which chunk the point is in
		const chunkX = Math.floor(x / chunkSizeX);
		const chunkY = Math.floor(y / chunkSizeY);
		const chunkZ = Math.floor(z / chunkSizeZ);

		// Calculate chunk bounds, ensuring we never go below 0
		const x_min = Math.max(0, chunkX * chunkSizeX);
		const x_max = x_min + chunkSizeX;
		const y_min = Math.max(0, chunkY * chunkSizeY);
		const y_max = y_min + chunkSizeY;
		const z_min = Math.max(0, chunkZ * chunkSizeZ);
		const z_max = z_min + chunkSizeZ;

		return { x_min, x_max, y_min, y_max, z_min, z_max };
	}

	// Helper function to get all neighboring chunks around a center point
	function getAllNeighboringChunks(
		centerOfScreen: { x: number; y: number },
		currentZ: number
	): Array<{
		x_min: number;
		x_max: number;
		y_min: number;
		y_max: number;
		z_min: number;
		z_max: number;
	}> {
		const chunks = [];

		// Get the chunk that contains the center point
		const centerChunk = getChunkForPoint(centerOfScreen.x, centerOfScreen.y, currentZ);
		const centerChunkX = Math.floor(centerOfScreen.x / chunkSizeX);
		const centerChunkY = Math.floor(centerOfScreen.y / chunkSizeY);
		const centerChunkZ = Math.floor(currentZ / chunkSizeZ);

		// Generate all 9 chunks (3x3 grid) around the center chunk
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				const chunkX = centerChunkX + dx;
				const chunkY = centerChunkY + dy;
				const chunkZ = centerChunkZ; // Keep same Z for now

				// Skip chunks that would be negative
				if (chunkX < 0 || chunkY < 0 || chunkZ < 0) continue;

				const x_min = chunkX * chunkSizeX;
				const x_max = x_min + chunkSizeX;
				const y_min = chunkY * chunkSizeY;
				const y_max = y_min + chunkSizeY;
				const z_min = chunkZ * chunkSizeZ;
				const z_max = z_min + chunkSizeZ;

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

	let filmstrip: p5.Image = new p5.Image(imageWidth, imageHeight * imageDepth);
	//  Fill with color while loading...
	filmstrip.loadPixels();
	for (let i = 0; i < filmstrip.pixels.length; i += 4) {
		filmstrip.pixels[i] = 105;
		filmstrip.pixels[i + 1] = 157;
		filmstrip.pixels[i + 2] = 163;
		filmstrip.pixels[i + 3] = 255;
	}
	filmstrip.updatePixels();

	// Create the canvas element and attach it to the DOM:
	const canvas = document.createElement('canvas');
	canvas.id = 'app';
	document.body.appendChild(canvas);

	// Use the debug prop, fallback to config, then debugMode for compatibility
	const debugEnabled = debug ?? (APP_CONFIG.debug || debugMode);

	const sketch = (s: p5) => {
		// Download the data from BossDB:
		remote
			.getCutoutPNG(datasetURI, resolution, [xs[0], xs[1]], [ys[0], ys[1]], [zs[0], zs[1]])
			.then((blob) => {
				if (blob) {
					const url = URL.createObjectURL(blob);
					filmstrip = s.loadImage(url);
				} else {
					throw new Error('Failed to load image');
				}
			})
			.catch((err) => {
				console.error(err);
			});

		s.setup = () => {
			// runs once
			s.createCanvas(window.innerWidth, window.innerHeight, document.getElementById('app'));
			s.background(0, 0, 0);

			// Set the nav to the center of the image
			nav.setX((s.width - nav.imageWidth) / 2);
			nav.setY((s.height - nav.imageHeight) / 2);
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
			if (filmstrip) {
				// Start-y is the layer number times -imageHeight
				// Stop-y is (layer number + 1) times -imageHeight
				// These are "source" coordinates.
				// The destination coordinates are always 0, 0

				// const screenCoords = nav.dataToScene(0, 0);
				s.image(
					filmstrip,
					0, //screenCoords.x,
					0, //screenCoords.y,
					imageWidth, //* nav.zoom, //width
					imageHeight, //* nav.zoom, //height
					0, //dx
					nav.layer * imageHeight, //dy
					imageWidth, //dwidth
					imageHeight //dheight
				);

				if (debugEnabled) {
					// axes:
					s.stroke(255, 0, 0);
					s.line(0, 0, 100, 0);
					s.stroke(0, 255, 0);
					s.line(0, 0, 0, 100);
				}
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
			if (debugEnabled && filmstrip) {
				// Get the center of the screen and all neighboring chunks
				const centerOfScreen = nav.sceneToData(s.width / 2, s.height / 2);
				const currentChunk = getChunkForPoint(centerOfScreen.x, centerOfScreen.y, nav.layer);
				const allChunks = getAllNeighboringChunks(centerOfScreen, nav.layer);

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

					if (isCurrentChunk) {
						// Draw current chunk in thick yellow
						s.stroke(255, 255, 0); // Bright yellow
						s.strokeWeight(4);
					} else {
						// Draw neighboring chunks in thinner light yellow
						s.stroke(255, 255, 100); // Light yellow
						s.strokeWeight(2);
					}

					s.rect(chunkTopLeft.x, chunkTopLeft.y, chunkScreenWidth, chunkScreenHeight);
				}

				// Only log coordinates when they change to avoid console spam
				const chunkKey = `${currentChunk.x_min}-${currentChunk.x_max}_${currentChunk.y_min}-${currentChunk.y_max}_${currentChunk.z_min}-${currentChunk.z_max}`;
				if (chunkKey !== lastLoggedChunk) {
					console.log('Current chunk XYZ coords:', {
						x: [currentChunk.x_min, currentChunk.x_max],
						y: [currentChunk.y_min, currentChunk.y_max],
						z: [currentChunk.z_min, currentChunk.z_max]
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

				// Show current ROI bounds
				s.text(
					`Original ROI: x:[${xs[0]}, ${xs[1]}] y:[${ys[0]}, ${ys[1]}] z:[${zs[0]}, ${zs[1]}]`,
					10,
					40
				);

				// Show current chunk info
				const currentChunk = getChunkForPoint(centerOfScreen.x, centerOfScreen.y, nav.layer);
				s.text(
					`Current Chunk: x:[${currentChunk.x_min}, ${currentChunk.x_max}] y:[${currentChunk.y_min}, ${currentChunk.y_max}] z:[${currentChunk.z_min}, ${currentChunk.z_max}]`,
					10,
					50
				);

				// Show if outside original ROI - fix the logic
				if (isOutsideROI(centerOfScreen, nav.layer)) {
					s.fill(255, 255, 0); // Yellow text
					s.text('CENTER OUTSIDE ORIGINAL ROI', 10, 60);
				} else {
					s.fill(0, 255, 0); // Green text
					s.text('CENTER INSIDE ORIGINAL ROI', 10, 60);
				}
			}
		};

		s.keyPressed = (evt) => {
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
					return false;
				}
			}
		};

		s.mousePressed = (evt) => {
			if (evt.target !== s.canvas) return;
			return handleMouseEvent('mousePressed', evt);
		};

		s.mouseDragged = (evt) => {
			if (evt.target !== s.canvas) return;
			return handleMouseEvent('mouseDragged', evt);
		};

		s.mouseWheel = (evt: WheelEvent) => {
			if (evt.target !== s.canvas) return;
			return handleMouseEvent('mouseWheel', evt);
		};

		function handleMouseEvent(eventType: MouseEventType, evt: MouseEvent | KeyboardEvent) {
			for (const kb of keybindings.filter(
				(kb) => kb.eventType === 'mouse' && kb.mouseEventType === eventType
			)) {
				if (kb.matcher(s)) {
					return kb.handler(s, annotationStore, nav, evt);
				}
			}
		}

		s.windowResized = () => {
			s.resizeCanvas(window.innerWidth, window.innerHeight);
		};
	};

	export const app = new p5(sketch);
	document.addEventListener('contextmenu', (event) => event.preventDefault());
</script>

<Minimap {annotationStore} {nav} />
