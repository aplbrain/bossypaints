<script lang="ts">
	import API from '$lib/api';
	import { goto } from '$app/navigation';
	import Header from '$lib/Header.svelte';
	let collection = '';
	let experiment = '';
	let channel = '';
	let resolution = 0;
	let x_center = 0;
	let x_radius = 0;
	let y_center = 0;
	let y_radius = 0;
	let z_center = 0;
	let z_radius = 0;
	let destination_collection = '';
	let destination_experiment = '';
	let destination_channel = '';
	let message = '';
	let collectionSuggestions: string[] = [];
	let experimentSuggestions: string[] = [];
	let channelSuggestions: string[] = [];
	let coordFrame:
		| {
				x_start: number;
				x_stop: number;
				y_start: number;
				y_stop: number;
				z_start: number;
				z_stop: number;
		  }
		| undefined;

	let useEntireXExtent = false;
	let useEntireYExtent = false;
	let useEntireZExtent = false;

	const minAutoCompleteLength = 0;

	let debounceTimeout: number | NodeJS.Timeout | undefined;

	async function fetchCollectionSuggestions() {
		if (collection.length > minAutoCompleteLength) {
			const response = await API.autocompleteBossDBResource({
				collection,
				experiment: null,
				channel: null
			});
			collectionSuggestions = response.resources;
		} else {
			collectionSuggestions = [];
		}
	}

	function debounceFetchCollectionSuggestions() {
		clearTimeout(debounceTimeout);
		debounceTimeout = setTimeout(fetchCollectionSuggestions, 300);
	}

	async function fetchExperimentSuggestions() {
		if (experiment.length > minAutoCompleteLength) {
			const response = await API.autocompleteBossDBResource({
				collection,
				experiment,
				channel: null
			});
			experimentSuggestions = response.resources;
		} else {
			experimentSuggestions = [];
		}
	}

	function debounceFetchExperimentSuggestions() {
		clearTimeout(debounceTimeout);
		debounceTimeout = setTimeout(fetchExperimentSuggestions, 300);
	}

	async function fetchChannelSuggestions() {
		if (channel.length > minAutoCompleteLength) {
			const response = await API.autocompleteBossDBResource({ collection, experiment, channel });
			channelSuggestions = response.resources;
		} else {
			channelSuggestions = [];
		}
	}

	function debounceFetchChannelSuggestions() {
		clearTimeout(debounceTimeout);
		debounceTimeout = setTimeout(fetchChannelSuggestions, 300);
	}

	async function fetchCoordFrame() {
		const response = await API.getCoordFrame(collection, experiment);
		coordFrame = response;
	}

	$: {
		if (collection && experiment) {
			fetchCoordFrame();
		}
	}

	function setXExtent() {
		if (!coordFrame) return;
		const xMid = (coordFrame.x_start + coordFrame.x_stop) / 2;
		const xRad = (coordFrame.x_stop - coordFrame.x_start) / 2;
		x_center = Math.floor(xMid);
		x_radius = Math.floor(xRad);
	}

	function setYExtent() {
		if (!coordFrame) return;
		const yMid = (coordFrame.y_start + coordFrame.y_stop) / 2;
		const yRad = (coordFrame.y_stop - coordFrame.y_start) / 2;
		y_center = Math.floor(yMid);
		y_radius = Math.floor(yRad);
	}

	function setZExtent() {
		if (!coordFrame) return;
		const zMid = (coordFrame.z_start + coordFrame.z_stop) / 2;
		const zRad = (coordFrame.z_stop - coordFrame.z_start) / 2;
		z_center = Math.floor(zMid);
		z_radius = Math.floor(zRad);
	}

	$: if (useEntireXExtent) {
		setXExtent();
	}

	$: if (useEntireYExtent) {
		setYExtent();
	}

	$: if (useEntireZExtent) {
		setZExtent();
	}

	async function createTask() {
		const task = {
			collection,
			experiment,
			channel,
			resolution,
			x_min: Math.max(0, x_center - x_radius),
			x_max: x_center + x_radius,
			y_min: Math.max(0, y_center - y_radius),
			y_max: y_center + y_radius,
			z_min: Math.max(0, z_center - z_radius),
			z_max: z_center + z_radius,
			destination_collection,
			destination_experiment,
			destination_channel,
			priority: 0
		};
		const response = await API.createTask(task);
		message = response?.message;
		// if the task was created successfully, clear the form, wait 1 sec,
		// and then go to the tracing app page with the new task
		if ((response as any).task_id) {
			collection = '';
			experiment = '';
			channel = '';
			resolution = 0;
			x_center = 0;
			x_radius = 0;
			y_center = 0;
			y_radius = 0;
			z_center = 0;
			z_radius = 0;
			useEntireXExtent = false;
			useEntireYExtent = false;
			useEntireZExtent = false;
			destination_collection = '';
			destination_experiment = '';
			destination_channel = '';
			setTimeout(() => {
				// task_id
				goto(`/app/${(response as any).task_id}`);
			}, 1000);
		}
	}
</script>

<!-- Main Container -->
<div class="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
	<Header
		title="Create New Task"
		subtitle="Configure volumetric annotation parameters"
		showNewTaskButton={false}
		showSettingsButton={false}
		customActions={[
			{
				href: '/',
				text: 'Back to Tasks',
				icon: 'back',
				variant: 'ghost'
			}
		]}
	/>

	<!-- Main Content -->
	<main class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
		<form on:submit|preventDefault={createTask} class="space-y-8">
			<!-- Data Source Section -->
			<div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
				<div class="px-6 py-4 border-b border-gray-200 bg-gray-50">
					<div class="flex items-center">
						<div
							class="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center"
						>
							<svg
								class="w-4 h-4 text-blue-600"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z"
								></path>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8 5a2 2 0 012-2h4a2 2 0 012 2v2H8V5z"
								></path>
							</svg>
						</div>
						<div class="ml-3">
							<h3 class="text-lg font-semibold text-gray-900">Data Source</h3>
							<p class="text-sm text-gray-600">Specify the BossDB dataset to annotate</p>
						</div>
					</div>
				</div>

				<div class="p-6 space-y-6">
					<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
						<!-- Collection -->
						<div class="relative">
							<label for="collection" class="block text-sm font-medium text-gray-700 mb-2">
								Collection
								<span class="text-red-500">*</span>
							</label>
							<input
								id="collection"
								type="text"
								bind:value={collection}
								on:input={debounceFetchCollectionSuggestions}
								placeholder="Enter collection name"
								class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
								required
							/>
							{#if collectionSuggestions.length > 0}
								<ul
									class="autocomplete-list absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
								>
									{#each collectionSuggestions as suggestion}
										<li
											on:click={() => {
												collection = suggestion;
												collectionSuggestions = [];
											}}
											class="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm border-b border-gray-100 last:border-b-0 transition-colors duration-150"
											role="button"
											tabindex="0"
											on:keydown={(e) => {
												if (e.key === 'Enter' || e.key === ' ') {
													collection = suggestion;
													collectionSuggestions = [];
												}
											}}
										>
											{suggestion}
										</li>
									{/each}
								</ul>
							{/if}
						</div>

						<!-- Experiment -->
						<div class="relative">
							<label for="experiment" class="block text-sm font-medium text-gray-700 mb-2">
								Experiment
								<span class="text-red-500">*</span>
							</label>
							<input
								id="experiment"
								type="text"
								bind:value={experiment}
								on:input={debounceFetchExperimentSuggestions}
								placeholder="Enter experiment name"
								class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
								required
							/>
							{#if experimentSuggestions.length > 0}
								<ul
									class="autocomplete-list absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
								>
									{#each experimentSuggestions as suggestion}
										<li
											on:click={() => {
												experiment = suggestion;
												experimentSuggestions = [];
											}}
											class="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm border-b border-gray-100 last:border-b-0 transition-colors duration-150"
											role="button"
											tabindex="0"
											on:keydown={(e) => {
												if (e.key === 'Enter' || e.key === ' ') {
													experiment = suggestion;
													experimentSuggestions = [];
												}
											}}
										>
											{suggestion}
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					</div>

					<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
						<!-- Channel -->
						<div class="relative">
							<label for="channel" class="block text-sm font-medium text-gray-700 mb-2">
								Channel
								<span class="text-red-500">*</span>
							</label>
							<input
								id="channel"
								type="text"
								bind:value={channel}
								on:input={debounceFetchChannelSuggestions}
								placeholder="Enter channel name"
								class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
								required
							/>
							{#if channelSuggestions.length > 0}
								<ul
									class="autocomplete-list absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
								>
									{#each channelSuggestions as suggestion}
										<li
											on:click={() => {
												channel = suggestion;
												channelSuggestions = [];
											}}
											class="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm border-b border-gray-100 last:border-b-0 transition-colors duration-150"
											role="button"
											tabindex="0"
											on:keydown={(e) => {
												if (e.key === 'Enter' || e.key === ' ') {
													channel = suggestion;
													channelSuggestions = [];
												}
											}}
										>
											{suggestion}
										</li>
									{/each}
								</ul>
							{/if}
						</div>

						<!-- Resolution -->
						<div>
							<label for="resolution" class="block text-sm font-medium text-gray-700 mb-2">
								Resolution Level
								<span class="text-red-500">*</span>
							</label>
							<input
								id="resolution"
								type="number"
								bind:value={resolution}
								placeholder="e.g., 0"
								min="0"
								class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
								required
							/>
							<p class="mt-1 text-xs text-gray-500">Higher values = lower resolution</p>
						</div>
					</div>
				</div>
			</div>

			<!-- Volume Bounds Section -->
			<div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
				<div class="px-6 py-4 border-b border-gray-200 bg-gray-50">
					<div class="flex items-center">
						<div
							class="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center"
						>
							<svg
								class="w-4 h-4 text-purple-600"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v6a2 2 0 002 2h4a2 2 0 002-2V5z"
								></path>
							</svg>
						</div>
						<div class="ml-3">
							<h3 class="text-lg font-semibold text-gray-900">Volume Bounds</h3>
							<p class="text-sm text-gray-600">Define the 3D region for annotation</p>
						</div>
					</div>
				</div>

				<div class="p-6 space-y-6">
					<!-- X Dimension -->
					<div class="bg-gray-50 rounded-lg p-4">
						<h4 class="text-sm font-semibold text-gray-900 mb-3 flex items-center">
							<span
								class="w-6 h-6 bg-red-100 text-red-600 rounded flex items-center justify-center text-xs font-bold mr-2"
								>X</span
							>
							X-Axis Configuration
						</h4>
						<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
							<div>
								<label for="x_center" class="block text-sm font-medium text-gray-700 mb-2"
									>Center</label
								>
								<input
									id="x_center"
									type="number"
									bind:value={x_center}
									min={coordFrame?.x_start}
									max={coordFrame?.x_stop}
									disabled={useEntireXExtent}
									class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200 disabled:bg-gray-100 disabled:cursor-not-allowed"
								/>
								{#if coordFrame}
									<p class="mt-1 text-xs text-gray-500 font-mono">
										Range: {coordFrame.x_start} - {coordFrame.x_stop}
									</p>
								{/if}
							</div>
							<div>
								<label for="x_radius" class="block text-sm font-medium text-gray-700 mb-2"
									>Radius</label
								>
								<input
									id="x_radius"
									type="number"
									bind:value={x_radius}
									disabled={useEntireXExtent}
									min="0"
									class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200 disabled:bg-gray-100 disabled:cursor-not-allowed"
								/>
							</div>
							<div class="flex items-center justify-center">
								<label class="flex items-center cursor-pointer">
									<input
										id="useEntireXExtent"
										type="checkbox"
										bind:checked={useEntireXExtent}
										class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
									/>
									<span class="ml-2 text-sm text-gray-700">Use full extent</span>
								</label>
							</div>
						</div>
					</div>

					<!-- Y Dimension -->
					<div class="bg-gray-50 rounded-lg p-4">
						<h4 class="text-sm font-semibold text-gray-900 mb-3 flex items-center">
							<span
								class="w-6 h-6 bg-green-100 text-green-600 rounded flex items-center justify-center text-xs font-bold mr-2"
								>Y</span
							>
							Y-Axis Configuration
						</h4>
						<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
							<div>
								<label for="y_center" class="block text-sm font-medium text-gray-700 mb-2"
									>Center</label
								>
								<input
									id="y_center"
									type="number"
									bind:value={y_center}
									min={coordFrame?.y_start}
									max={coordFrame?.y_stop}
									disabled={useEntireYExtent}
									class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200 disabled:bg-gray-100 disabled:cursor-not-allowed"
								/>
								{#if coordFrame}
									<p class="mt-1 text-xs text-gray-500 font-mono">
										Range: {coordFrame.y_start} - {coordFrame.y_stop}
									</p>
								{/if}
							</div>
							<div>
								<label for="y_radius" class="block text-sm font-medium text-gray-700 mb-2"
									>Radius</label
								>
								<input
									id="y_radius"
									type="number"
									bind:value={y_radius}
									disabled={useEntireYExtent}
									min="0"
									class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200 disabled:bg-gray-100 disabled:cursor-not-allowed"
								/>
							</div>
							<div class="flex items-center justify-center">
								<label class="flex items-center cursor-pointer">
									<input
										id="useEntireYExtent"
										type="checkbox"
										bind:checked={useEntireYExtent}
										class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
									/>
									<span class="ml-2 text-sm text-gray-700">Use full extent</span>
								</label>
							</div>
						</div>
					</div>

					<!-- Z Dimension -->
					<div class="bg-gray-50 rounded-lg p-4">
						<h4 class="text-sm font-semibold text-gray-900 mb-3 flex items-center">
							<span
								class="w-6 h-6 bg-blue-100 text-blue-600 rounded flex items-center justify-center text-xs font-bold mr-2"
								>Z</span
							>
							Z-Axis Configuration
						</h4>
						<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
							<div>
								<label for="z_center" class="block text-sm font-medium text-gray-700 mb-2"
									>Center</label
								>
								<input
									id="z_center"
									type="number"
									bind:value={z_center}
									min={coordFrame?.z_start}
									max={coordFrame?.z_stop}
									disabled={useEntireZExtent}
									class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200 disabled:bg-gray-100 disabled:cursor-not-allowed"
								/>
								{#if coordFrame}
									<p class="mt-1 text-xs text-gray-500 font-mono">
										Range: {coordFrame.z_start} - {coordFrame.z_stop}
									</p>
								{/if}
							</div>
							<div>
								<label for="z_radius" class="block text-sm font-medium text-gray-700 mb-2"
									>Radius</label
								>
								<input
									id="z_radius"
									type="number"
									bind:value={z_radius}
									disabled={useEntireZExtent}
									min="0"
									class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200 disabled:bg-gray-100 disabled:cursor-not-allowed"
								/>
							</div>
							<div class="flex items-center justify-center">
								<label class="flex items-center cursor-pointer">
									<input
										id="useEntireZExtent"
										type="checkbox"
										bind:checked={useEntireZExtent}
										class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
									/>
									<span class="ml-2 text-sm text-gray-700">Use full extent</span>
								</label>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Output Destination Section -->
			<div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
				<div class="px-6 py-4 border-b border-gray-200 bg-gray-50">
					<div class="flex items-center">
						<div
							class="flex-shrink-0 w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center"
						>
							<svg
								class="w-4 h-4 text-green-600"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
								></path>
							</svg>
						</div>
						<div class="ml-3">
							<h3 class="text-lg font-semibold text-gray-900">Output Destination</h3>
							<p class="text-sm text-gray-600">Where to save annotation results</p>
						</div>
					</div>
				</div>

				<div class="p-6 space-y-6">
					<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
						<div>
							<label
								for="destination_collection"
								class="block text-sm font-medium text-gray-700 mb-2"
							>
								Destination Collection
								<span class="text-red-500">*</span>
							</label>
							<input
								id="destination_collection"
								type="text"
								bind:value={destination_collection}
								placeholder="Output collection name"
								class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
								required
							/>
						</div>
						<div>
							<label
								for="destination_experiment"
								class="block text-sm font-medium text-gray-700 mb-2"
							>
								Destination Experiment
								<span class="text-red-500">*</span>
							</label>
							<input
								id="destination_experiment"
								type="text"
								bind:value={destination_experiment}
								placeholder="Output experiment name"
								class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
								required
							/>
						</div>
						<div>
							<label for="destination_channel" class="block text-sm font-medium text-gray-700 mb-2">
								Destination Channel
								<span class="text-red-500">*</span>
							</label>
							<input
								id="destination_channel"
								type="text"
								bind:value={destination_channel}
								placeholder="Output channel name"
								class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
								required
							/>
						</div>
					</div>
				</div>
			</div>

			<!-- Submit Section -->
			<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
				<div
					class="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0"
				>
					<div>
						<h3 class="text-lg font-semibold text-gray-900">Ready to Create Task?</h3>
						<p class="text-sm text-gray-600">
							Review your configuration and create the annotation task.
						</p>
					</div>
					<button
						type="submit"
						class="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
					>
						<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 4v16m8-8H4"
							></path>
						</svg>
						Create Task
					</button>
				</div>
			</div>
		</form>

		<!-- Success/Error Message -->
		{#if message}
			<div
				class="mt-6 p-4 rounded-lg {message.includes('successfully') || message.includes('created')
					? 'bg-green-50 border border-green-200'
					: 'bg-red-50 border border-red-200'}"
			>
				<div class="flex items-center">
					{#if message.includes('successfully') || message.includes('created')}
						<svg
							class="w-5 h-5 text-green-600 mr-2"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 13l4 4L19 7"
							></path>
						</svg>
						<p class="text-green-800 font-medium">{message}</p>
					{:else}
						<svg
							class="w-5 h-5 text-red-600 mr-2"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							></path>
						</svg>
						<p class="text-red-800 font-medium">{message}</p>
					{/if}
				</div>
			</div>
		{/if}
	</main>
</div>

<style>
	/* Enhanced autocomplete dropdown styling */
	.autocomplete-list {
		z-index: 50;
	}

	.autocomplete-list li:last-child {
		border-bottom: none;
	}

	/* Smooth transitions for form elements */
	input:focus {
		transform: translateY(-1px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
	}

	/* Custom checkbox styling to match design */
	input[type='checkbox']:checked {
		background-color: #3b82f6;
		border-color: #3b82f6;
	}

	/* Loading state for buttons */
	button:active {
		transform: translateY(1px);
	}
</style>
