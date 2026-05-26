<!--
@component InfoTable

A prettier info panel that displays information about the current state of the annotation
manager and navigation store.

@prop currentLayer {number} - The current layer number
@prop currentSegmentID {number} - The current segment ID
@prop layerAnnotationCount {number} - Number of annotations on current layer
@prop onLayerChange {function} - Callback to change layer number
@prop onSegmentIDChange {function} - Callback to change segment ID
-->
<script lang="ts">
	import { ArrowDownIcon, ArrowUpIcon } from '$lib/icons';

	export let currentLayer: number;
	export let currentSegmentID: number;
	export let currentSegmentColor: [number, number, number] = [59, 130, 246];
	export let layerAnnotationCount: number;
	export let onLayerChange: (newLayer: number) => void;
	export let onSegmentIDChange: (id: number) => void;
	export let onCopyFromLastSlice: () => void = () => {};
	export let onPropagateFromLastSlice: () => void | Promise<void> = () => {};
	export let adjacentSegmentSourceLayer: number | null = null;
	export let propagationActionLabel: string = 'Propagate from last slice';
	export let propagationInFlight: boolean = false;
	export let propagationMode: string = 'RW';
	export let propagationModes: string[] = ['RW'];
	export let onPropagationModeChange: (mode: string) => void = () => {};

	// Histogram window controls (assume uint8 range)
	export let histMin: number = 0;
	export let histMax: number = 255;
	export let onHistogramChange: (min: number, max: number) => void = () => {};

	// Visibility control from parent (slide panel in/out)
	export let show: boolean = true;
	export let onToggle: () => void = () => {};

	let histDebounce: any = null;
	function emitHistogram(min: number, max: number) {
		if (histDebounce) clearTimeout(histDebounce);
		histDebounce = setTimeout(() => onHistogramChange(min, max), 75);
	}
	function setHistMin(v: number) {
		const clamped = Math.max(0, Math.min(255, Math.floor(v)));
		if (clamped > histMax) emitHistogram(clamped, clamped);
		else emitHistogram(clamped, histMax);
	}
	function setHistMax(v: number) {
		const clamped = Math.max(0, Math.min(255, Math.floor(v)));
		if (clamped < histMin) emitHistogram(clamped, clamped);
		else emitHistogram(histMin, clamped);
	}

	let editingSegmentId = false;
	let tempSegmentId = currentSegmentID.toString();
	let inputElement: HTMLInputElement;

	function startEditingSegmentId() {
		editingSegmentId = true;
		tempSegmentId = currentSegmentID.toString();
		// Focus the input after it's rendered
		setTimeout(() => {
			if (inputElement) {
				inputElement.focus();
				inputElement.select();
			}
		}, 0);
	}

	function incrementLayer() {
		onLayerChange(currentLayer + 1);
	}

	function decrementLayer() {
		onLayerChange(currentLayer - 1);
	}

	function saveSegmentId() {
		const newId = parseInt(tempSegmentId);
		if (!isNaN(newId) && newId > 0) {
			onSegmentIDChange(newId);
		} else {
			tempSegmentId = currentSegmentID.toString();
		}
		editingSegmentId = false;
	}

	function cancelEditingSegmentId() {
		tempSegmentId = currentSegmentID.toString();
		editingSegmentId = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			saveSegmentId();
		} else if (event.key === 'Escape') {
			cancelEditingSegmentId();
		}
	}

	$: colorStyle = `rgb(${currentSegmentColor[0]}, ${currentSegmentColor[1]}, ${currentSegmentColor[2]})`;

	// Update temp segment ID when the current segment ID changes
	$: if (!editingSegmentId) {
		tempSegmentId = currentSegmentID.toString();
	}
</script>

<!-- Info Panel - Top Right -->
<div
	class="fixed top-4 right-4 z-40 transition-transform duration-300 ease-in-out"
	style="transform: translateX({show ? '0' : '104%'});"
>
	<div
		class="relative bg-white rounded-lg shadow-lg border border-gray-200 min-w-64 py-4 pr-4 pl-10 overflow-visible transition-transform duration-300 ease-in-out"
	>
		<!-- Caret toggle anchored to left edge; remains visible when hidden -->
		<button
			class="absolute -left-7 top-7 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-l-md bg-white border border-gray-300 shadow hover:bg-gray-50 text-gray-700"
			on:click={onToggle}
			title="Toggle Info (T)"
			aria-label="Toggle Info Panel"
		>
			{#if show}
				<!-- caret-right (hide) -->
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			{:else}
				<!-- caret-left (show) -->
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M15 19l-7-7 7-7"
					/>
				</svg>
			{/if}
			<span class="absolute bottom-0.5 right-0.5 text-[10px] text-gray-500 opacity-70">t</span>
		</button>
		<!-- Layer Info -->
		<div class="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
			<span class="text-sm font-medium text-gray-600">Layer</span>
			<div class="flex items-center gap-2">
				<span
					class="text-lg font-bold text-gray-900 bg-blue-50 px-3 py-1 rounded-full border border-blue-200"
				>
					{currentLayer}
				</span>
				<div class="flex flex-col flex-center">
					<button
						on:click={incrementLayer}
						class="relative bg-blue-200 hover:bg-blue-100 border border-blue-400 rounded-t-xl px-2 py-1.5 transition-colors cursor-pointer"
						title="Click to increment layer"
					>
						<ArrowUpIcon className="w-3 h-3" />
						<!-- <span class="absolute bottom-0 right-0.5 font-light text-[20px] text-gray-500 opacity-70">.</span> -->
					</button>
					<button
						on:click={decrementLayer}
						class="relative bg-blue-200 hover:bg-blue-100 border border-blue-400 px-2 py-1.5 rounded-b-xl transition-colors cursor-pointer"
						title="Click to decrement layer"
					>
						<ArrowDownIcon className="w-3 h-3" />
						<!-- <span class="absolute bottom-0 right-0.5 font-light text-[20px] text-gray-500 opacity-70">,</span> -->
					</button>
				</div>
			</div>
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
						aria-label="Save segment ID"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 13l4 4L19 7"
							></path>
						</svg>
					</button>
					<button
						on:click={cancelEditingSegmentId}
						class="text-red-600 hover:text-red-800 p-1"
						title="Cancel"
						aria-label="Cancel editing segment ID"
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
					{currentSegmentID}
				</button>
			{/if}
		</div>

		<!-- Statistics -->
		<div class="space-y-2 text-sm">
			<div class="flex items-center justify-between">
				<span class="text-gray-600">Layer Annotations</span>
				<span class="font-medium text-gray-900 bg-gray-50 px-2 py-1 rounded">
					{layerAnnotationCount}
				</span>
			</div>

			<div class="pt-3 mt-3 border-t border-gray-100">
				<div class="flex items-center justify-between mb-2">
					<span class="text-gray-600">Segment Tools</span>
					{#if adjacentSegmentSourceLayer !== null}
						<span class="text-xs text-gray-500">from z {adjacentSegmentSourceLayer}</span>
					{/if}
				</div>
				<div class="flex items-center justify-between gap-3 mb-2">
					<label class="text-xs text-gray-500" for="propagation-mode">Propagate Mode</label>
					<select
						id="propagation-mode"
						class="px-2 py-1 text-xs border border-gray-300 rounded bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
						value={propagationMode}
						on:change={(event) =>
							onPropagationModeChange((event.target as HTMLSelectElement).value)}
					>
						{#each propagationModes as mode}
							<option value={mode}>{mode}</option>
						{/each}
					</select>
				</div>
				<div class="grid gap-2">
					<div class="relative group">
						<button
							class="w-full px-3 py-2 text-sm font-medium rounded-lg border transition-colors duration-200 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-200 text-left"
							on:click={onCopyFromLastSlice}
							disabled={adjacentSegmentSourceLayer === null || propagationInFlight}
							aria-label="Copy from last slice"
						>
							<span class="flex w-full items-start justify-between gap-3">
								<span class="block">Copy from last slice</span>
								<kbd
									class="ml-auto shrink-0 px-1.5 py-0.5 text-[11px] font-mono bg-white border border-blue-200 rounded"
									>Alt+C</kbd
								>
							</span>
						</button>
						<div
							class="pointer-events-none absolute left-0 top-full z-10 mt-2 hidden w-64 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg group-hover:block group-focus-within:block"
						>
							{#if propagationInFlight}
								<div>Wait for the current propagation request to finish.</div>
							{:else if adjacentSegmentSourceLayer === null}
								<div>No nearby slice has this segment ID.</div>
							{:else}
								<div>Copy from z {adjacentSegmentSourceLayer} onto the current slice.</div>
							{/if}
							<div class="mt-2 border-t border-white/20 pt-2">
								<div class="mb-1 font-medium">Directional shortcuts</div>
								<div class="flex items-center justify-between gap-3">
									<span>Copy to previous z</span>
									<kbd
										class="px-1.5 py-0.5 text-[11px] font-mono bg-white/10 border border-white/20 rounded"
										>Shift+,</kbd
									>
								</div>
								<div class="mt-1 flex items-center justify-between gap-3">
									<span>Copy to next z</span>
									<kbd
										class="px-1.5 py-0.5 text-[11px] font-mono bg-white/10 border border-white/20 rounded"
										>Shift+.</kbd
									>
								</div>
							</div>
						</div>
					</div>
					<div class="relative group">
						<button
							class="w-full px-3 py-2 text-sm font-medium rounded-lg border transition-colors duration-200 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200 text-left"
							on:click={onPropagateFromLastSlice}
							disabled={adjacentSegmentSourceLayer === null || propagationInFlight}
							aria-label={propagationActionLabel}
						>
							<span class="flex w-full items-start justify-between gap-3">
								<span class="block"
									>{propagationInFlight ? 'Propagating...' : propagationActionLabel}</span
								>
								<kbd
									class="ml-auto shrink-0 px-1.5 py-0.5 text-[11px] font-mono bg-white border border-emerald-200 rounded"
									>Alt+Shift+C</kbd
								>
							</span>
						</button>
						<div
							class="pointer-events-none absolute left-0 top-full z-10 mt-2 hidden w-64 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg group-hover:block group-focus-within:block"
						>
							{#if propagationInFlight}
								<div>Propagation request in progress.</div>
							{:else if adjacentSegmentSourceLayer === null}
								<div>No nearby slice has this segment ID.</div>
							{:else}
								<div>
									{propagationActionLabel} from z {adjacentSegmentSourceLayer} onto the current slice.
								</div>
							{/if}
							<div class="mt-2 border-t border-white/20 pt-2">
								<div class="mb-1 font-medium">Directional shortcuts</div>
								<div class="flex items-center justify-between gap-3">
									<span>Propagate to previous z</span>
									<kbd
										class="px-1.5 py-0.5 text-[11px] font-mono bg-white/10 border border-white/20 rounded"
										>Alt+,</kbd
									>
								</div>
								<div class="mt-1 flex items-center justify-between gap-3">
									<span>Propagate to next z</span>
									<kbd
										class="px-1.5 py-0.5 text-[11px] font-mono bg-white/10 border border-white/20 rounded"
										>Alt+.</kbd
									>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Histogram Window Controls -->
			<div class="pt-3 mt-3 border-t border-gray-100">
				<div class="flex items-center justify-between mb-2">
					<span class="text-gray-600">Contrast Window</span>
					<button
						class="text-xs text-blue-600 hover:text-blue-800"
						on:click={() => onHistogramChange(0, 255)}
						title="Reset"
						aria-label="Reset contrast window"
					>
						Reset
					</button>
				</div>
				<div class="flex items-center gap-2">
					<label class="text-xs text-gray-500 w-10" for="hist-min-number">Min</label>
					<input
						type="number"
						min="0"
						max="255"
						value={histMin}
						id="hist-min-number"
						on:input={(e) => setHistMin(parseInt((e.target as HTMLInputElement).value))}
						class="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
					<input
						type="range"
						min="0"
						max="255"
						value={histMin}
						id="hist-min-range"
						on:input={(e) => setHistMin(parseInt((e.target as HTMLInputElement).value))}
						class="flex-1"
					/>
				</div>
				<div class="flex items-center gap-2 mt-2">
					<label class="text-xs text-gray-500 w-10" for="hist-max-number">Max</label>
					<input
						type="number"
						min="0"
						max="255"
						value={histMax}
						id="hist-max-number"
						on:input={(e) => setHistMax(parseInt((e.target as HTMLInputElement).value))}
						class="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
					<input
						type="range"
						min="0"
						max="255"
						value={histMax}
						id="hist-max-range"
						on:input={(e) => setHistMax(parseInt((e.target as HTMLInputElement).value))}
						class="flex-1"
					/>
				</div>
			</div>

			<!-- <div class="flex items-center justify-between">
			<span class="text-gray-600">Total Annotations</span>
			<span class="font-medium text-gray-900 bg-gray-50 px-2 py-1 rounded">
				{annotationStore.getAllAnnotations().flat().length}
			</span>
		</div> -->
		</div>
	</div>
</div>
