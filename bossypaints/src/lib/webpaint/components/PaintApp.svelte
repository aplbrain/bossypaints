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

	const remote = new BossRemote();

	const imageWidth = xs[1] - xs[0];
	const imageHeight = ys[1] - ys[0];
	const imageDepth = zs[1] - zs[0];

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

	const debug = APP_CONFIG.debug || debugMode;

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
					0,	//dx
					nav.layer * imageHeight, //dy
					imageWidth, //dwidth
					imageHeight //dheight
				);

				if (debug) {
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

			if (debug) {
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
