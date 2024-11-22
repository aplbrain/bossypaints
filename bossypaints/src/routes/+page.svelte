<script lang="ts">
	import PaintApp from 'webpaint/src/lib/components/PaintApp.svelte';
	import { createAnnotationManagerStore } from 'webpaint/src/lib/stores/AnnotationManagerStore.svelte';
	import { createNavigationStore } from 'webpaint/src/lib/stores/NavigationStore.svelte';
	import API, { type Task } from '$lib/api';

	let task: Task | null = null;
	let annotationStore = null;
	let nav = null;

	// const numberOfSlices = 32;

	// let annotationStore = createAnnotationManagerStore(numberOfSlices);
	// let nav = createNavigationStore({
	// 	minLayer: 0,
	// 	maxLayer: numberOfSlices - 1,
	// 	imageWidth: 512,
	// 	imageHeight: 512
	// });

	async function loadTask() {
		let response = await API.getNextTask();
		task = response.task;
		console.log(task.z_max, task.z_min);
		annotationStore = createAnnotationManagerStore(task.z_max - task.z_min + 1);
		nav = createNavigationStore({
			minLayer: task.z_min,
			maxLayer: task.z_max,
			imageWidth: task.x_max - task.x_min + 1,
			imageHeight: task.y_max - task.y_min + 1
		});
	}

	loadTask();
</script>

{#if task && annotationStore && nav}
	<PaintApp
		{annotationStore}
		{nav}
		datasetURI={`${task.collection}/${task.experiment}/${task.channel}`}
		xs={[task.x_min, task.x_max]}
		ys={[task.y_min, task.y_max]}
		zs={[task.z_min, task.z_max]}
		resolution={task.resolution}
		debugMode
		onCheckpointData={(data) => {
			API.checkpointTask({ taskId: task.id, checkpoint: data });
		}}
	/>
{/if}

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
</style>
