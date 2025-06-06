<!--
@component InfoTable

A prettier info panel that displays information about the current state of the annotation
manager and navigation store.

@prop annotationStore {AnnotationManagerStore} - The annotation manager store to
  display information about.
@prop nav {NavigationStore} - The navigation store to display information about.
-->
<script lang="ts">
	import { type AnnotationManagerStore } from '$lib/webpaint/stores/AnnotationManagerStore.svelte';
	import { type NavigationStore } from '$lib/webpaint/stores/NavigationStore.svelte';
	import { segmentIdToRGB } from '$lib/webpaint/colorutils';

	export let annotationStore: AnnotationManagerStore;
	export let nav: NavigationStore;

	let editingSegmentId = false;
	let tempSegmentId = annotationStore.currentSegmentID.toString();
	let inputElement: HTMLInputElement;

	function startEditingSegmentId() {
		editingSegmentId = true;
		tempSegmentId = annotationStore.currentSegmentID.toString();
		// Focus the input after it's rendered
		setTimeout(() => {
			if (inputElement) {
				inputElement.focus();
				inputElement.select();
			}
		}, 0);
	}

	function saveSegmentId() {
		const newId = parseInt(tempSegmentId);
		if (!isNaN(newId) && newId > 0) {
			annotationStore.setCurrentSegmentID(newId);
		} else {
			tempSegmentId = annotationStore.currentSegmentID.toString();
		}
		editingSegmentId = false;
	}

	function cancelEditingSegmentId() {
		tempSegmentId = annotationStore.currentSegmentID.toString();
		editingSegmentId = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			saveSegmentId();
		} else if (event.key === 'Escape') {
			cancelEditingSegmentId();
		}
	}

	// Get the current segment color - make it reactive to changes
	$: currentSegmentColor = segmentIdToRGB(annotationStore.currentSegmentID);
	$: colorStyle = `rgb(${currentSegmentColor[0]}, ${currentSegmentColor[1]}, ${currentSegmentColor[2]})`;

	// Update temp segment ID when the current segment ID changes
	$: if (!editingSegmentId) {
		tempSegmentId = annotationStore.currentSegmentID.toString();
	}

	console.log(annotationStore.getLayerAnnotations);
</script>

<!-- Info Panel - Top Right -->
<div
	class="fixed top-4 right-4 bg-white rounded-lg shadow-lg border border-gray-200 p-4 min-w-64 z-40"
>
	<!-- Layer Info -->
	<div class="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
		<span class="text-sm font-medium text-gray-600">Layer</span>
		<span
			class="text-lg font-bold text-gray-900 bg-blue-50 px-3 py-1 rounded-full border border-blue-200"
		>
			{nav.layer}
		</span>
	</div>

	<!-- Segment ID with Color -->
	<div class="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
		<div class="flex items-center gap-2">
			<span class="text-sm font-medium text-gray-600">Segment ID</span>
			<!-- Color indicator -->
			<div
				class="w-4 h-4 rounded-full border-2 border-white shadow-sm"
				style="background-color: {colorStyle}"
				title="Current segment color"
			></div>
		</div>

		{#if editingSegmentId}
			<div class="flex items-center gap-1">
				<input
					bind:this={inputElement}
					type="number"
					bind:value={tempSegmentId}
					on:keydown={handleKeydown}
					on:blur={saveSegmentId}
					class="w-16 px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					min="1"
					step="1"
				/>
				<button
					on:click={saveSegmentId}
					class="text-green-600 hover:text-green-800 p-1"
					title="Save"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"
						></path>
					</svg>
				</button>
				<button
					on:click={cancelEditingSegmentId}
					class="text-red-600 hover:text-red-800 p-1"
					title="Cancel"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						></path>
					</svg>
				</button>
			</div>
		{:else}
			<button
				on:click={startEditingSegmentId}
				class="text-lg font-bold text-gray-900 bg-gray-50 hover:bg-gray-100 px-3 py-1 rounded-full border border-gray-200 transition-colors cursor-pointer"
				title="Click to edit segment ID"
			>
				{annotationStore.currentSegmentID}
			</button>
		{/if}
	</div>

	<!-- Statistics -->
	<div class="space-y-2 text-sm">
		<div class="flex items-center justify-between">
			<span class="text-gray-600">Current Points</span>
			<span class="font-medium text-gray-900 bg-gray-50 px-2 py-1 rounded">
				{annotationStore.currentAnnotation.vertices.length}
			</span>
		</div>

		<div class="flex items-center justify-between">
			<span class="text-gray-600">Layer Annotations</span>
			<span class="font-medium text-gray-900 bg-gray-50 px-2 py-1 rounded">
				{annotationStore.getLayerAnnotations(nav.layer).length}
			</span>
		</div>

		<div class="flex items-center justify-between">
			<span class="text-gray-600">Total Annotations</span>
			<span class="font-medium text-gray-900 bg-gray-50 px-2 py-1 rounded">
				{annotationStore.getAllAnnotations().flat().length}
			</span>
		</div>
	</div>
</div>
