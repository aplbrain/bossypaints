<script lang="ts">
	import PaintApp from 'webpaint/src/lib/components/PaintApp.svelte';
	import {
		createAnnotationManagerStore,
		type AnnotationManagerStore
	} from 'webpaint/src/lib/stores/AnnotationManagerStore.svelte';
	import {
		createNavigationStore,
		type NavigationStore
	} from 'webpaint/src/lib/stores/NavigationStore.svelte';
	import API, { type TaskInDB } from '$lib/api';
	import { Notyf } from 'notyf';
	import 'notyf/notyf.min.css';
	import PolygonAnnotation from 'webpaint/src/lib/PolygonAnnotation';
	const notyf = new Notyf();

	let task: TaskInDB;
	let annotationStore: AnnotationManagerStore;
	let nav: NavigationStore;

	async function loadTask() {
		let response = await API.getNextTask();
		task = response.task;
		annotationStore = createAnnotationManagerStore(task.z_max - task.z_min + 1);
		nav = createNavigationStore({
			minLayer: task.z_min,
			maxLayer: task.z_max,
			imageWidth: task.x_max - task.x_min + 1,
			imageHeight: task.y_max - task.y_min + 1
		});

		let checkpointResponse = await API.getTaskCheckpoints(task.id);
		if (checkpointResponse.checkpoints) {
			checkpointResponse.checkpoints.forEach((checkpoint) => {
				checkpoint.polygons.forEach((annotation) => {
					annotationStore.addAnnotation(
						annotation.z,
						new PolygonAnnotation(
							annotation.points,
							annotation.segmentID,
							annotation.editing,
							annotation.z
						)
					);
				});
			});
		}
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
			API.checkpointTask({ taskId: task.id, checkpoint: data }).then(() => {
				notyf.success('Checkpoint saved');
			});
		}}
		onSubmitData={(data) => {
			API.saveTask({ taskId: task.id, checkpoint: data }).then(() => {
				notyf.success('Volume finalized and saved.');
			});
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
