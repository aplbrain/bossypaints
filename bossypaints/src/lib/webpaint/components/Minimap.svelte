<!--
@component Minimap

@desc A minimap that shows the current layer, and all annotations.
@prop {AnnotationManagerStore} annotationStore - The store that contains all annotations.
@prop {NavigationStore} nav - The store that contains the current layer and image dimensions.
@prop {number} height - The height of the minimap.
-->
<script lang="ts">
	import p5 from 'p5';
	import type { NavigationStore } from '$lib/stores/NavigationStore.svelte';
	import type { AnnotationManagerStore } from '$lib/stores/AnnotationManagerStore.svelte';

	export let annotationStore: AnnotationManagerStore;
	export let nav: NavigationStore;

	export let height = 256;

	// Create the canvas element and attach it to the DOM:
	const canvas = document.createElement('canvas');
	canvas.id = 'minimap';
	document.body.appendChild(canvas);

	const minimapSketch = (s: p5) => {
		s.setup = () => {
			// runs once
			s.createCanvas(64, height, document.getElementById('minimap'));
			s.background(0, 0, 0);
		};

		s.draw = () => {
			s.clear();
			s.fill(255, 255, 255, 100);
			s.rect(0, 0, s.width - 10, 256);

			s.strokeWeight(4);
			s.stroke(255);
			s.line(
				0,
				s.map(nav.layer, 0, nav.maxLayer - nav.minLayer, 0, height),
				s.width,
				s.map(nav.layer, 0, nav.maxLayer - nav.minLayer, 0, height)
			);

			s.noStroke();
			annotationStore.annotations.forEach((annolist, layer) => {
				annolist.forEach((anno) => {
					s.fill(...anno.color, 10);
					anno.points.forEach((pt) => {
						s.ellipse(
							s.map(pt[0], 0, nav.imageWidth, 0, s.width),
							s.map(layer, 0, nav.maxLayer - nav.minLayer, 0, height),
							10,
							10
						);
					});
					// s.ellipse(
					// 	s.map(anno.points[0][0], 0, nav.imageWidth, 0, s.width),
					// 	s.map(layer, 0, nav.maxLayer - nav.minLayer, 0, height),
					// 	10,
					// 	10
					// );
				});
			});
		};

		s.mousePressed = (event) => {
			// Allow clicks to change layers
            if (event.target !== s.canvas) return;
            const mouseX = s.mouseX;
            const mouseY = s.mouseY;

            if (mouseX < 0 || mouseX > s.width || mouseY < 0 || mouseY > s.height) {
                return;
            }

            const totalLayers = nav.maxLayer - nav.minLayer;
            const clickedLayer = Math.floor(s.map(mouseY, 0, height, 0, totalLayers));
            const newLayer = Math.max(nav.minLayer, Math.min(nav.maxLayer - 1, clickedLayer));
            nav.setLayer(newLayer);

            event.preventDefault();
            event.stopPropagation();
            return false;
        };
	};

	export const minimap = new p5(minimapSketch);
</script>

<style>
	:global(#minimap) {
		position: absolute;
		bottom: 0;
		left: 0;
		z-index: 100;
		background: transparent;
	}
</style>
