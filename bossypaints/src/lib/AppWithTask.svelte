<script lang="ts">
	import PaintApp from '$lib/webpaint/components/PaintApp.svelte';
	import InfoTable from '$lib/webpaint/components/InfoTable.svelte';
	import KeybindingsTable from '$lib/webpaint/components/KeybindingsTable.svelte';
	import {
		createAnnotationManagerStore,
		type AnnotationManagerStore
	} from '$lib/webpaint/stores/AnnotationManagerStore.svelte';
	import {
		createNavigationStore,
		type NavigationStore
	} from '$lib/webpaint/stores/NavigationStore.svelte';
	import { goto } from '$app/navigation';
	import API, { type TaskInDB } from '$lib/api';
	import { Notyf } from 'notyf';
	import 'notyf/notyf.min.css';
	import PolygonAnnotation from '$lib/webpaint/PolygonAnnotation';
	const notyf = new Notyf();

	export let task: TaskInDB;
	let annotationStore: AnnotationManagerStore;
	let nav: NavigationStore;
	let showKeybindings = false;

	async function loadTask() {
		annotationStore = createAnnotationManagerStore(Math.max(1, task.z_max - task.z_min - 1));
		nav = createNavigationStore({
			minLayer: task.z_min,
			maxLayer: task.z_max - 1,
			layer: Math.floor((task.z_max + task.z_min) / 2),
			imageWidth: task.x_max - task.x_min,
			imageHeight: task.y_max - task.y_min
		});

		let checkpointResponse = await API.getTaskCheckpoints(task.id);
		if (checkpointResponse.checkpoints) {
			checkpointResponse.checkpoints.forEach((checkpoint) => {
				checkpoint.polygons.forEach((annotation) => {
					// Use the new positive/negative regions format
					const polygonAnnotation = new PolygonAnnotation(
						{
							positiveRegions: annotation.positiveRegions,
							negativeRegions: annotation.negativeRegions || []
						},
						annotation.segmentID,
						annotation.editing,
						annotation.z
					);

					annotationStore.addAnnotation(annotation.z, polygonAnnotation);
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
			// Calculate total positive area
			let positiveArea = 0;
			annotation.positiveRegions.forEach((region) => {
				positiveArea += calculatePolygonArea(region);
			});

			// Subtract negative area (holes)
			let negativeArea = 0;
			annotation.negativeRegions.forEach((region) => {
				negativeArea += calculatePolygonArea(region);
			});

			// Net area for this annotation
			const netArea = positiveArea - negativeArea;
			annotatedArea += Math.max(0, netArea); // Ensure non-negative
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

		<InfoTable
			currentLayer={nav.layer}
			currentSegmentID={annotationStore.currentSegmentID}
			layerAnnotationCount={annotationStore.getLayerAnnotations(nav.layer).length}
			onSegmentIDChange={(id) => annotationStore.setCurrentSegmentID(id)}
		/>
		<KeybindingsTable bind:show={showKeybindings} />

		<!-- Percentage Complete Bar - slides down to hide, hover to show -->
		<div
			class="fixed bottom-0 left-1/2 transform -translate-x-1/2 transition-transform duration-300 ease-in-out translate-y-16 hover:translate-y-0"
		>
			<div class="p-4 bg-white border border-gray-300 rounded-t-lg text-center shadow-lg">
				<p class="text-sm font-medium">
					Percentage Complete: {getPercentageComplete(task, annotationStore).toFixed(2)}%
				</p>
				<p class="text-xs text-gray-600">Task ID: {task.id}</p>
			</div>
		</div>

		<!-- Floating Menu - Bottom Right -->
		<div class="fixed bottom-4 right-4 flex flex-col gap-2">
			<!-- Paint/Pan Mode Toggle -->
			<button
				class="{nav.drawing
					? 'bg-green-500 hover:bg-green-600'
					: 'bg-gray-500 hover:bg-gray-600'} text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				on:click={() => nav.setDrawing(!nav.drawing)}
				title={nav.drawing ? 'Switch to Pan Mode' : 'Switch to Paint Mode'}
			>
				{#if nav.drawing}
					<!-- Paintbrush icon -->
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M7 21a4 4 0 01-4-4 4 4 0 014-4h.5l9.793-9.793a1 1 0 011.414 0l2.086 2.086a1 1 0 010 1.414L11 16.5V17a4 4 0 01-4 4z"
						></path>
					</svg>
				{:else}
					<!-- Pointer cursor icon -->
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
						></path>
					</svg>
				{/if}
			</button>

			<!-- Save/Checkpoint Buttons -->
			<button
				class="bg-cyan-500 hover:bg-cyan-600 text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				on:click={() => {
					API.checkpointTask({
						taskId: task.id,
						checkpoint: annotationStore.getAllAnnotations()
					}).then(() => {
						notyf.success('Checkpoint saved.');
					});
				}}
				title="Checkpoint (Alt+S)"
			>
				<!-- Checkpoint icon -->
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
					></path>
				</svg>
			</button>

			<button
				class="bg-blue-500 hover:bg-blue-600 text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				on:click={() => {
					API.saveTask({ taskId: task.id, checkpoint: annotationStore.getAllAnnotations() }).then(
						() => {
							notyf.success('Volume finalized and saved.');
							// After the default 2000 timeout, nav back to home:
							// setTimeout(() => {
							// 	goto('/');
							// }, 2000);
						}
					);
				}}
				title="Submit (Alt+Shift+S)"
			>
				<!-- Submit/Save icon -->
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
					></path>
				</svg>
			</button>

			<!-- Help/Keybindings Toggle -->
			<button
				class="bg-gray-500 hover:bg-gray-600 text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				on:click={() => (showKeybindings = !showKeybindings)}
				title="Toggle Keybindings (H)"
			>
				<!-- Help icon -->
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					></path>
				</svg>
			</button>

			<!-- Back to Home Button -->
			<button
				class="bg-indigo-500 hover:bg-indigo-600 text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				on:click={() => goto('/')}
				title="Back to Home"
			>
				<!-- Home icon -->
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
					></path>
				</svg>
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
