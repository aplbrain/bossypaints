<script lang="ts">
	import PaintApp from 'webpaint/src/lib/components/PaintApp.svelte';
	import { createAnnotationManagerStore } from 'webpaint/src/lib/stores/AnnotationManagerStore.svelte';
	import { createNavigationStore } from 'webpaint/src/lib/stores/NavigationStore.svelte';

	const numberOfSlices = 32;

	let annotationStore = createAnnotationManagerStore(numberOfSlices);
	let nav = createNavigationStore({
		minLayer: 0,
		maxLayer: numberOfSlices - 1,
		imageWidth: 512,
		imageHeight: 512
	});
</script>

<PaintApp
	{annotationStore}
	{nav}
	datasetURI={'Witvliet2020/Dataset_1/em'}
	xs={[1256, 1768]}
	ys={[1256, 1768]}
	zs={[0, 32]}
	resolution={Number(3)}
/>
