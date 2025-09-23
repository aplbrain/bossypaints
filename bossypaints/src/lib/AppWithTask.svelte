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
	import { onMount, onDestroy } from 'svelte';
	import {
		AnnotationIcon,
		CheckIcon,
		HelpIcon,
		LockIcon,
		InfoIcon,
		DownloadIcon
	} from '$lib/icons';

	const notyf = new Notyf();

	export let task: TaskInDB;
	let annotationStore: AnnotationManagerStore;
	let nav: NavigationStore;
	let showKeybindings = false;
	let showInfo = true;

	// Navigation confirmation modal
	let showNavigationModal = false;
	let pendingNavigation: (() => void) | null = null;
	let hasUnsavedChanges = false;
	let lastCheckpointAnnotations: any[] = [];

	// Histogram window state (default 8-bit window)
	let histMin = 0;
	let histMax = 255;

	function handleHistogramChange(min: number, max: number) {
		// Ensure ordered and within reasonable bounds
		const newMin = Math.max(0, Math.min(min, max));
		const newMax = Math.max(newMin, Math.min(max, 65535));
		histMin = newMin;
		histMax = newMax;
	}

	// Function to check if there are unsaved changes
	function checkForUnsavedChanges() {
		if (!annotationStore) return false;

		const currentAnnotations = annotationStore.getAllAnnotations();
		const currentAnnotationsString = JSON.stringify(currentAnnotations);
		const lastCheckpointString = JSON.stringify(lastCheckpointAnnotations);

		return currentAnnotationsString !== lastCheckpointString;
	}

	// Function to handle navigation with confirmation
	function handleNavigation(navigationFn: () => void) {
		hasUnsavedChanges = checkForUnsavedChanges();

		if (hasUnsavedChanges) {
			pendingNavigation = navigationFn;
			showNavigationModal = true;
		} else {
			navigationFn();
		}
	}

	// Function to confirm navigation (discard changes)
	function confirmNavigation() {
		showNavigationModal = false;
		if (pendingNavigation) {
			pendingNavigation();
			pendingNavigation = null;
		}
	}

	// Function to cancel navigation
	function cancelNavigation() {
		showNavigationModal = false;
		pendingNavigation = null;
	}

	// Function to save and then navigate
	async function saveAndNavigate() {
		try {
			await API.checkpointTask({
				taskId: task.id,
				checkpoint: annotationStore.getAllAnnotations()
			});

			// Update last checkpoint to current state
			lastCheckpointAnnotations = annotationStore.getAllAnnotations();
			hasUnsavedChanges = false;

			notyf.success('Changes saved successfully!');

			// Proceed with navigation after a brief delay
			setTimeout(() => {
				if (pendingNavigation) {
					pendingNavigation();
					pendingNavigation = null;
				}
				showNavigationModal = false;
			}, 500);
		} catch (error) {
			notyf.error('Failed to save changes. Please try again.');
			console.error('Save failed:', error);
		}
	}

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

		// Set initial checkpoint state after loading
		lastCheckpointAnnotations = annotationStore.getAllAnnotations();
		hasUnsavedChanges = false;
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

	// Set up paint app body styles on mount and clean up on destroy
	onMount(() => {
		// Apply paint app specific styles
		document.body.style.margin = '0';
		document.body.style.padding = '0';
		document.body.style.overflow = 'hidden';
	});

	onDestroy(() => {
		// Restore normal body styles when leaving paint app
		document.body.style.margin = '';
		document.body.style.padding = '';
		document.body.style.overflow = '';
	});
</script>

<div class="w-full">
	{#if task && annotationStore && nav}
		<PaintApp
			{annotationStore}
			{nav}
			datasetURI={task.data_source_type === 'cloudvolume'
				? task.cloudvolume_uri || ''
				: `${task.collection}/${task.experiment}/${task.channel}`}
			xs={[task.x_min, task.x_max]}
			ys={[task.y_min, task.y_max]}
			zs={[task.z_min, task.z_max]}
			resolution={task.resolution}
			{histMin}
			{histMax}
			onCheckpointData={(data) => {
				API.checkpointTask({ taskId: task.id, checkpoint: data }).then(() => {
					notyf.success('Checkpoint saved');
				});
			}}
			onToggleInfo={() => (showInfo = !showInfo)}
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
			{histMin}
			{histMax}
			onHistogramChange={handleHistogramChange}
			show={showInfo}
			onToggle={() => (showInfo = !showInfo)}
		/>
		<KeybindingsTable bind:show={showKeybindings} />

		<!-- Percentage Complete Bar - slides down to hide, hover to show -->
		<div
			class="fixed bottom-0 left-1/2 transform -translate-x-1/2 transition-transform duration-300 ease-in-out translate-y-16 hover:translate-y-0 z-20 pointer-events-auto"
		>
			<div class="p-4 bg-white border border-gray-300 rounded-t-lg text-center shadow-lg">
				<p class="text-sm font-medium">
					Percentage Complete: {getPercentageComplete(task, annotationStore).toFixed(2)}%
				</p>
				<p class="text-xs text-gray-600">Task ID: {task.id}</p>
			</div>
		</div>

		<!-- Floating Menu - Bottom Right -->
		<div class="fixed bottom-4 right-4 flex flex-col gap-2 z-30 pointer-events-auto">
			<!-- Paint/Pan Mode Toggle -->
			<button
				class="tooltip {nav.drawing
					? 'bg-green-500 hover:bg-green-600'
					: 'bg-gray-500 hover:bg-gray-600'} text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				style="touch-action: manipulation"
				onclick={() => nav.setDrawing(!nav.drawing)}
				aria-label={nav.drawing ? 'Switch to Pan Mode' : 'Switch to Paint Mode'}
				data-tooltip={nav.drawing ? 'Switch to Pan Mode' : 'Switch to Paint Mode'}
			>
				{#if nav.drawing}
					<AnnotationIcon className="w-5 h-5" />
				{:else}
					<LockIcon class="w-5 h-5" />
				{/if}
			</button>

			<!-- Save/Checkpoint Buttons -->
			<button
				class="tooltip bg-cyan-500 hover:bg-cyan-600 text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				onclick={() => {
					API.checkpointTask({
						taskId: task.id,
						checkpoint: annotationStore.getAllAnnotations()
					}).then(() => {
						notyf.success('Checkpoint saved.');
					});
				}}
				aria-label="Save Progress (Alt+S)"
				data-tooltip="Save Progress (Alt+S)"
			>
				<DownloadIcon className="w-5 h-5" />
			</button>

			<!-- Comment out the complete button for now -->
			<!--
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
				class="tooltip bg-gray-500 hover:bg-gray-600 text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				style="touch-action: manipulation"
				onclick={() => (showKeybindings = !showKeybindings)}
				aria-label="Toggle Keybindings (H)"
				data-tooltip="Toggle Keybindings (H)"
			>
				<HelpIcon className="w-5 h-5" />
			</button>

			<!-- Go to Task Details Button -->
			<button
				class="tooltip bg-purple-500 hover:bg-purple-600 text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				style="touch-action: manipulation"
				onclick={() => handleNavigation(() => goto(`/task/${task.id}`))}
				aria-label="Go to Task Details"
				data-tooltip="Go to Task Details"
			>
				<InfoIcon className="w-5 h-5" />
			</button>

			<!-- Back to Home Button -->
			<button
				class="tooltip bg-indigo-500 hover:bg-indigo-600 text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				style="touch-action: manipulation"
				onclick={() => handleNavigation(() => goto('/'))}
				aria-label="Back to Home"
				data-tooltip="Back to Home"
			>
				<CheckIcon className="w-5 h-5" />
			</button>
		</div>
	{/if}

	<!-- Navigation Confirmation Modal -->
	{#if showNavigationModal}
		<div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
			<div class="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl">
				<div class="flex items-center mb-4">
					<div class="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center mr-3">
						<svg
							class="w-6 h-6 text-yellow-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.081 16.5c-.77.833.192 2.5 1.732 2.5z"
							></path>
						</svg>
					</div>
					<h3 class="text-lg font-medium text-gray-900">Unsaved Changes</h3>
				</div>

				<p class="text-gray-600 mb-6">You have unsaved changes. What would you like to do?</p>

				<div class="flex flex-col space-y-3">
					<button
						class="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors duration-200"
						style="touch-action: manipulation"
						onclick={saveAndNavigate}
						aria-label="Save and Continue"
					>
						Save and Continue
					</button>

					<button
						class="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors duration-200"
						onclick={confirmNavigation}
						aria-label="Discard and Continue"
					>
						Discard Changes
					</button>

					<button
						class="w-full px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg transition-colors duration-200"
						onclick={cancelNavigation}
						aria-label="Cancel navigation"
					>
						Cancel
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* Custom tooltip styles for FAB buttons */
	.tooltip {
		position: relative;
	}

	.tooltip::after {
		content: attr(data-tooltip);
		position: absolute;
		right: 100%;
		top: 50%;
		transform: translateY(-50%);
		background: rgba(0, 0, 0, 0.9);
		color: white;
		padding: 8px 12px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s ease-in-out;
		margin-right: 10px;
		z-index: 1000;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
	}

	.tooltip::before {
		content: '';
		position: absolute;
		right: 100%;
		top: 50%;
		transform: translateY(-50%);
		border: 5px solid transparent;
		border-left-color: rgba(0, 0, 0, 0.9);
		margin-right: 5px;
		opacity: 0;
		transition: opacity 0.2s ease-in-out;
		z-index: 1000;
	}

	.tooltip:hover::after,
	.tooltip:hover::before {
		opacity: 1;
	}

	/* Ensure tooltips appear above other elements */
	.tooltip:hover {
		z-index: 1001;
	}
</style>
