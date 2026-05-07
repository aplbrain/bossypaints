<!--
@component Minimap

@desc A minimap that shows the current layer, and all annotations.
@prop {AnnotationManagerStore} annotationStore - The store that contains all annotations.
@prop {NavigationStore} nav - The store that contains the current layer and image dimensions.
@prop {number} height - The height of the minimap.
-->
<script lang="ts">
	import p5 from 'p5';
	import { onDestroy } from 'svelte';
	import type { NavigationStore } from '../stores/NavigationStore.svelte';
	import type { AnnotationManagerStore } from '../stores/AnnotationManagerStore.svelte';

	export let annotationStore: AnnotationManagerStore;
	export let nav: NavigationStore;

	export let height = 256;

	let minimapPointerDownHandler: (e: PointerEvent) => void;
	let minimapCanvasEl: HTMLCanvasElement | null = null;

	// Create the canvas element and attach it to the DOM:
	const canvas = document.createElement('canvas');
	canvas.id = 'minimap';
	document.body.appendChild(canvas);

	const indicatorSize = 4; // Size of the indicator circles in the minimap

	const minimapSketch = (s: p5) => {
		s.setup = () => {
			// runs once
			const renderer = s.createCanvas(64, height);
			const parent = document.getElementById('minimap');
			if (parent) renderer.parent(parent);
			minimapCanvasEl = (s.drawingContext as CanvasRenderingContext2D).canvas as HTMLCanvasElement;

			// Attach Pointer Events for touch tapping to change layers
			minimapPointerDownHandler = (e: PointerEvent) => {
				// Only handle direct taps on the minimap canvas
				if (!minimapCanvasEl || e.target !== minimapCanvasEl) return;

				const rect = minimapCanvasEl!.getBoundingClientRect();
				const localX = e.clientX - rect.left;
				const localY = e.clientY - rect.top;

				if (localX < 0 || localX > s.width || localY < 0 || localY > s.height) {
					return;
				}

				const totalLayers = nav.maxLayer - nav.minLayer;
				const clickedLayer = nav.minLayer + Math.floor((localY / height) * totalLayers);
				const newLayer = Math.max(nav.minLayer, Math.min(nav.maxLayer - 1, clickedLayer));
				nav.setLayer(newLayer);

				e.preventDefault();
				e.stopPropagation();
				return false as unknown as boolean;
			};
			minimapCanvasEl = (s.drawingContext as CanvasRenderingContext2D).canvas as HTMLCanvasElement;
			minimapCanvasEl.addEventListener('pointerdown', minimapPointerDownHandler, {
				passive: false
			});

			s.background(0, 0, 0);
		};

		s.draw = () => {
			s.clear();
			s.fill(255, 255, 255, 100);
			s.rect(0, 0, s.width - 10, height);

			s.strokeWeight(4);
			s.stroke(255);
			s.line(
				0,
				s.map(nav.layer, nav.minLayer, nav.maxLayer, 0, height),
				s.width,
				s.map(nav.layer, nav.minLayer, nav.maxLayer, 0, height)
			);

			s.noStroke();
			annotationStore.annotations.forEach((annolist, layer) => {
				const absoluteLayer = nav.minLayer + layer;
				annolist.forEach((anno) => {
					s.fill(anno.color[0], anno.color[1], anno.color[2], 150);
					s.ellipse(
						anno.segmentID * indicatorSize,
						s.map(absoluteLayer, nav.minLayer, nav.maxLayer, 0, height),
						indicatorSize,
						indicatorSize
					);
					// s.ellipse(
					// 	s.map(anno.points[0][0], 0, nav.imageWidth, 0, s.width),
					// 	s.map(layer, 0, nav.maxLayer - nav.minLayer, 0, height),
					// 	10,
					// 	10
					// );
				});
			});
		};

		s.mousePressed = () => {
			const mouseX = s.mouseX;
			const mouseY = s.mouseY;

			if (mouseX < 0 || mouseX > s.width || mouseY < 0 || mouseY > s.height) {
				return;
			}

			const totalLayers = nav.maxLayer - nav.minLayer;
			const clickedLayer = nav.minLayer + Math.floor(s.map(mouseY, 0, height, 0, totalLayers));
			const newLayer = Math.max(nav.minLayer, Math.min(nav.maxLayer - 1, clickedLayer));
			nav.setLayer(newLayer);

			return false;
		};
	};

	export const minimap = new p5(minimapSketch);

	onDestroy(() => {
		if (minimapCanvasEl && minimapPointerDownHandler) {
			minimapCanvasEl.removeEventListener('pointerdown', minimapPointerDownHandler as any);
		}
	});
</script>

<style>
	:global(#minimap) {
		position: absolute;
		bottom: 0;
		left: 0;
		z-index: 100;
		background: transparent;

		/* Touch ergonomics */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		overscroll-behavior: contain;
	}
</style>
