<script lang="ts">
	import { tick } from 'svelte';

	type GroupEntry = {
		type: 'group';
		ids: Array<number>;
		sortKey: number;
	};

	type SegmentEntry = {
		type: 'segment';
		id: number;
		sortKey: number;
	};

	type TreeEntry = GroupEntry | SegmentEntry;

	export let annotatedSegmentIDs: Array<number> = [];
	export let mergedSegmentGroups: Array<Array<number>> = [];
	export let currentSegmentID: number;
	export let hoveredSegmentID: number | null = null;
	export let getSegmentColor: (segmentID: number) => [number, number, number] = () => [
		59, 130, 246
	];
	export let onSelectSegmentID: (segmentID: number) => void = () => {};
	export let onMergeSegments: (segmentIDs: Array<number>) => void = () => {};
	export let onUnmergeSegment: (segmentID: number) => void = () => {};
	export let show: boolean = false;
	export let onToggle: () => void = () => {};

	let mergeMode = false;
	let selectedSegmentIDs: Array<number> = [];
	let treeBodyElement: HTMLDivElement | null = null;

	function normalizeSegmentIDs(segmentIDs: Array<number>): Array<number> {
		return [
			...new Set(segmentIDs.filter((segmentID) => Number.isInteger(segmentID) && segmentID > 0))
		].sort((a, b) => a - b);
	}

	function openMergeMode() {
		mergeMode = true;
		selectedSegmentIDs = [];
	}

	function cancelMergeMode() {
		mergeMode = false;
		selectedSegmentIDs = [];
	}

	function confirmMerge() {
		const segmentIDsToMerge = normalizeSegmentIDs(selectedSegmentIDs);
		if (segmentIDsToMerge.length < 2) {
			return;
		}
		onMergeSegments(segmentIDsToMerge);
		cancelMergeMode();
	}

	function toggleSelectedSegment(segmentID: number, checked: boolean) {
		selectedSegmentIDs = checked
			? normalizeSegmentIDs([...selectedSegmentIDs, segmentID])
			: selectedSegmentIDs.filter((id) => id !== segmentID);
	}

	function handleSelectSegment(segmentID: number) {
		onSelectSegmentID(segmentID);
	}

	function handleUnmergeSegment(event: MouseEvent, segmentID: number) {
		event.stopPropagation();
		onUnmergeSegment(segmentID);
	}

	function isSelectedForMerge(segmentID: number): boolean {
		return selectedSegmentIDs.includes(segmentID);
	}

	function isHoveredSegment(segmentID: number): boolean {
		return hoveredSegmentID === segmentID && currentSegmentID !== segmentID;
	}

	function getSegmentColorStyle(segmentID: number): string {
		const [red, green, blue] = getSegmentColor(segmentID);
		return `rgb(${red}, ${green}, ${blue})`;
	}

	function formatGroupLabel(segmentIDs: Array<number>): string {
		if (segmentIDs.length === 0) {
			return 'Group';
		}
		return `${segmentIDs[0]} (${segmentIDs.join(', ')}) Group`;
	}

	async function scrollActiveRowIntoView() {
		await tick();
		const activeRow = treeBodyElement?.querySelector('[data-active="true"]');
		if (activeRow instanceof HTMLElement) {
			activeRow.scrollIntoView({ block: 'nearest' });
		}
	}

	$: normalizedAnnotatedSegmentIDs = normalizeSegmentIDs(annotatedSegmentIDs);
	$: normalizedMergedSegmentGroups = mergedSegmentGroups
		.map((group) => normalizeSegmentIDs(group))
		.filter((group) => group.length > 1)
		.sort((a, b) => a[0] - b[0]);
	$: mergedSegmentIDSet = new Set(normalizedMergedSegmentGroups.flat());
	$: visibleSegmentIDs = normalizeSegmentIDs([
		...normalizedAnnotatedSegmentIDs,
		...normalizedMergedSegmentGroups.flat(),
		currentSegmentID
	]);
	$: standaloneSegmentIDs = visibleSegmentIDs.filter(
		(segmentID) => !mergedSegmentIDSet.has(segmentID)
	);
	$: treeEntries = [
		...normalizedMergedSegmentGroups.map(
			(group): GroupEntry => ({
				type: 'group',
				ids: group,
				sortKey: group[0]
			})
		),
		...standaloneSegmentIDs.map(
			(segmentID): SegmentEntry => ({
				type: 'segment',
				id: segmentID,
				sortKey: segmentID
			})
		)
	].sort((a, b) => a.sortKey - b.sortKey) as Array<TreeEntry>;
	$: if (show && treeBodyElement) {
		void scrollActiveRowIntoView();
	}
</script>

<div
	class="fixed top-4 left-4 z-40 transition-transform duration-300 ease-in-out"
	style="transform: translateX({show ? '0' : '-104%'});"
>
	<div
		class="relative bg-white rounded-lg shadow-lg border border-gray-200 w-80 max-w-[calc(100vw-2rem)] py-4 pl-4 pr-10 overflow-visible"
	>
		<button
			class="absolute -right-7 top-7 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-r-md bg-white border border-gray-300 shadow hover:bg-gray-50 text-gray-700"
			on:click={onToggle}
			title="Toggle Merges (M)"
			aria-label="Toggle Merge Panel"
		>
			{#if show}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M15 5l-7 7 7 7"
					/>
				</svg>
			{:else}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			{/if}
			<span class="absolute bottom-0.5 left-0.5 text-[10px] text-gray-500 opacity-70">m</span>
		</button>

		<div class="mb-4 pb-3 border-b border-gray-100">
			<div class="flex items-start justify-between gap-3">
				<div>
					<h2 class="text-lg font-semibold text-gray-900">Merges</h2>
					<p class="text-sm text-gray-600">
						Group IDs together without changing their stored polygon IDs.
					</p>
				</div>
				<div class="flex items-center gap-2 shrink-0">
					{#if mergeMode}
						<button
							class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-200 bg-emerald-600 hover:bg-emerald-700 text-white disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"
							on:click={confirmMerge}
							disabled={selectedSegmentIDs.length < 2}
						>
							Merge
						</button>
						<button
							class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-200 bg-gray-100 hover:bg-gray-200 text-gray-700"
							on:click={cancelMergeMode}
						>
							Cancel
						</button>
					{:else}
						<button
							class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-200 bg-emerald-100 hover:bg-emerald-200 text-emerald-800"
							on:click={openMergeMode}
						>
							Merge
						</button>
					{/if}
				</div>
			</div>
			{#if mergeMode}
				<p class="mt-2 text-xs text-gray-500">
					Select at least two IDs, then merge them under one group ID.
				</p>
			{/if}
		</div>

		<div bind:this={treeBodyElement} class="max-h-[70vh] overflow-y-auto pr-1 space-y-2">
			{#if treeEntries.length === 0}
				<div
					class="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center"
				>
					<p class="text-sm font-medium text-gray-700">No annotated IDs yet</p>
					<p class="mt-1 text-xs text-gray-500">
						Saved annotations will show up here as selectable rows.
					</p>
				</div>
			{:else}
				{#each treeEntries as entry}
					{#if entry.type === 'group'}
						<div class="rounded-lg border border-emerald-200 bg-emerald-50/60">
							<div
								class="flex items-center justify-between gap-3 px-3 py-2 border-b border-emerald-100"
							>
								<div class="flex items-center gap-2">
									<div
										class="w-2.5 h-2.5 rounded-sm"
										style="background-color: {getSegmentColorStyle(entry.ids[0])}"
									></div>
									<span class="text-sm font-semibold text-emerald-900">
										{formatGroupLabel(entry.ids)}
									</span>
								</div>
							</div>
							<div class="ml-4 my-2 border-l border-emerald-200 pl-3 pr-2 space-y-1">
								{#each entry.ids as segmentID}
									<div class="flex items-center gap-2">
										{#if mergeMode}
											<input
												type="checkbox"
												class="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
												checked={isSelectedForMerge(segmentID)}
												on:click|stopPropagation
												on:change={(event) =>
													toggleSelectedSegment(
														segmentID,
														(event.currentTarget as HTMLInputElement).checked
													)}
												aria-label={`Select ID ${segmentID} for merging`}
											/>
										{/if}
										<button
											class="flex-1 min-w-0 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors duration-150 {currentSegmentID ===
											segmentID
												? 'border-blue-300 bg-blue-50 text-blue-900'
												: 'border-transparent bg-white/80 hover:bg-white text-gray-700'}"
											data-active={currentSegmentID === segmentID ? 'true' : 'false'}
											on:click={() => handleSelectSegment(segmentID)}
										>
											<span class="flex items-center gap-2 min-w-0">
												<div
													class="w-2.5 h-2.5 rounded-full shrink-0"
													style="background-color: {getSegmentColorStyle(segmentID)}"
												></div>
												<span class="truncate font-medium">ID {segmentID}</span>
											</span>
											{#if currentSegmentID === segmentID}
												<span
													class="text-[11px] font-semibold uppercase tracking-wide text-blue-600"
												>
													Selected
												</span>
											{:else if isHoveredSegment(segmentID)}
												<span
													class="text-[11px] font-semibold uppercase tracking-wide text-slate-500"
												>
													Hovered
												</span>
											{/if}
										</button>
										{#if !mergeMode}
											<button
												class="px-2 py-1 text-[11px] font-medium rounded-md bg-white hover:bg-red-50 text-red-700 border border-red-200 transition-colors duration-150"
												on:click={(event) => handleUnmergeSegment(event, segmentID)}
											>
												Unmerge
											</button>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{:else}
						<div class="flex items-center gap-2">
							{#if mergeMode}
								<input
									type="checkbox"
									class="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
									checked={isSelectedForMerge(entry.id)}
									on:click|stopPropagation
									on:change={(event) =>
										toggleSelectedSegment(
											entry.id,
											(event.currentTarget as HTMLInputElement).checked
										)}
									aria-label={`Select ID ${entry.id} for merging`}
								/>
							{/if}
							<button
								class="w-full min-w-0 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors duration-150 {currentSegmentID ===
								entry.id
									? 'border-blue-300 bg-blue-50 text-blue-900'
									: 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'}"
								data-active={currentSegmentID === entry.id ? 'true' : 'false'}
								on:click={() => handleSelectSegment(entry.id)}
							>
								<span class="flex items-center gap-2 min-w-0">
									<div
										class="w-2.5 h-2.5 rounded-full shrink-0"
										style="background-color: {getSegmentColorStyle(entry.id)}"
									></div>
									<span class="truncate font-medium">ID {entry.id}</span>
								</span>
								{#if currentSegmentID === entry.id}
									<span class="text-[11px] font-semibold uppercase tracking-wide text-blue-600">
										Selected
									</span>
								{:else if isHoveredSegment(entry.id)}
									<span class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
										Hovered
									</span>
								{/if}
							</button>
						</div>
					{/if}
				{/each}
			{/if}
		</div>
	</div>
</div>
