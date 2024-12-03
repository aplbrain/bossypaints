<script lang="ts">
	import PaintApp from 'webpaint/src/lib/components/PaintApp.svelte';
	import InfoTable from 'webpaint/src/lib/components/InfoTable.svelte';
	import KeybindingsTable from 'webpaint/src/lib/components/KeybindingsTable.svelte';
	import {
		createAnnotationManagerStore,
		type AnnotationManagerStore
	} from 'webpaint/src/lib/stores/AnnotationManagerStore.svelte';
	import {
		createNavigationStore,
		type NavigationStore
	} from 'webpaint/src/lib/stores/NavigationStore.svelte';
	import { goto } from '$app/navigation';
	import API, { type TaskInDB } from '$lib/api';
	import { Notyf } from 'notyf';
	import 'notyf/notyf.min.css';
	import PolygonAnnotation from 'webpaint/src/lib/PolygonAnnotation';
	const notyf = new Notyf();

	export let task: TaskInDB;
	let annotationStore: AnnotationManagerStore;
	let nav: NavigationStore;

	async function loadTask() {
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

	function calculatePolygonArea(points: Array<[number, number]>) {
		let n = points.length;
		let area = 0;

		for (let i = 0; i < n; i++) {
			let [x1, y1] = points[i];
			let [x2, y2] = points[(i + 1) % n]; // Wrap around to the first point
			area += x1 * y2 - y1 * x2;
		}

		return Math.abs(area) / 2;
	}

	function getPercentageComplete(task: TaskInDB, annoStore: AnnotationManagerStore) {
		// Using the shoelace formula for area.
		const totalArea =
			(task.x_max - task.x_min) * (task.y_max - task.y_min) * (task.z_max - task.z_min);
		let annotatedArea = 0;
		annoStore.getAllAnnotations().forEach((annotation) => {
			annotatedArea += calculatePolygonArea(annotation.points);
		});
		return (annotatedArea / totalArea) * 100;
	}

	loadTask();
</script>

<div class="w-full">
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

		<InfoTable {annotationStore} {nav} />
		<KeybindingsTable show={false} />

		<div
			class="fixed bottom-0 p-4 bg-white border border-gray-300 rounded-lg text-center left-1/2 transform -translate-x-1/2"
		>
			<p>Percentage Complete: {getPercentageComplete(task, annotationStore).toFixed(2)}%</p>
			<p>Task ID: {task.id}</p>
		</div>

		<div class="fixed bottom-72 left-0 m-4">
			<button
				class="bg-cyan-500 hover:bg-cyan-700 text-white font-bold py-2 px-4 mr-0 shadow-lg rounded-l-full"
				on:click={() => {
					API.checkpointTask({
						taskId: task.id,
						checkpoint: annotationStore.getAllAnnotations()
					}).then(() => {
						notyf.success('Checkpoint saved.');
					});
				}}
			>
				Checkpoint
			</button>
			<button
				class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 ml-0 shadow-lg rounded-r-full"
				on:click={() => {
					API.saveTask({ taskId: task.id, checkpoint: annotationStore.getAllAnnotations() }).then(
						() => {
							notyf.success('Volume finalized and saved.');
							// After the default 2000 timeout, nav back to home:
							setTimeout(() => {
								goto('/');
							}, 2000);
						}
					);
				}}
			>
				Submit
			</button>
		</div>
	{/if}
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
</style>
