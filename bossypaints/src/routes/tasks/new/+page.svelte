<script lang="ts">
	import API from '$lib/api';
	import { goto } from '$app/navigation';
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
		if (response.task_id) {
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
				goto(`/app/${response.task_id}`);
			}, 1000);
		}
	}
</script>

<main class="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-md">
	<h1 class="text-2xl font-bold mb-6">Create Task</h1>
	<form on:submit|preventDefault={createTask} class="space-y-4">
		<label class="block">
			<span class="text-gray-700">Collection:</span>
			<input
				type="text"
				bind:value={collection}
				on:input={debounceFetchCollectionSuggestions}
				class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
			/>
			<ul class="autocomplete-list absolute bg-white border border-gray-300 rounded-md shadow-md">
				{#each collectionSuggestions as suggestion}
					<li
						on:click={() => {
							collection = suggestion;
							collectionSuggestions = [];
						}}
					>
						{suggestion}
					</li>
				{/each}
			</ul>
		</label>
		<label class="block">
			<span class="text-gray-700">Experiment:</span>
			<input
				type="text"
				bind:value={experiment}
				on:input={debounceFetchExperimentSuggestions}
				class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
			/>
			<ul class="autocomplete-list absolute bg-white border border-gray-300 rounded-md shadow-md">
				{#each experimentSuggestions as suggestion}
					<li
						on:click={() => {
							experiment = suggestion;
							experimentSuggestions = [];
						}}
					>
						{suggestion}
					</li>
				{/each}
			</ul>
		</label>
		<label class="block">
			<span class="text-gray-700">Channel:</span>
			<input
				type="text"
				bind:value={channel}
				on:input={debounceFetchChannelSuggestions}
				class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
			/>
			<ul class="autocomplete-list absolute bg-white border border-gray-300 rounded-md shadow-md">
				{#each channelSuggestions as suggestion}
					<li
						on:click={() => {
							channel = suggestion;
							channelSuggestions = [];
						}}
					>
						{suggestion}
					</li>
				{/each}
			</ul>
		</label>
		<label class="block">
			<span class="text-gray-700">Resolution:</span>
			<input
				type="number"
				bind:value={resolution}
				class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
			/>
		</label>
		<div class="flex space-x-4">
			<label class="block flex-1">
				<span class="text-gray-700">X Center:</span>
				<input
					type="number"
					bind:value={x_center}
					min={coordFrame?.x_start}
					max={coordFrame?.x_stop}
					disabled={useEntireXExtent}
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
				/>
				{#if coordFrame}
					<span class="text-gray-500 text-sm">
						({coordFrame?.x_start} - {coordFrame?.x_stop})
					</span>
				{/if}
			</label>
			<label class="block flex-1">
				<span class="text-gray-700">X Radius:</span>
				<input
					type="number"
					bind:value={x_radius}
					disabled={useEntireXExtent}
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
				/>
			</label>
			<label for="useEntireXExtent" class="block flex-1" >
				<span class="text-gray-700"> Use entire X extent</span>
				<input
					id="useEntireXExtent"
					type="checkbox"
					bind:checked={useEntireXExtent}
					class="rounded text-indigo-600 focus:ring-indigo-500"
				/>
			</label>
		</div>
		<div class="flex space-x-4">
			<label class="block flex-1">
				<span class="text-gray-700">Y Center:</span>
				<input
					type="number"
					bind:value={y_center}
					min={coordFrame?.y_start}
					max={coordFrame?.y_stop}
					disabled={useEntireYExtent}
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
				/>
				{#if coordFrame}
					<span class="text-gray-500 text-sm">
						({coordFrame?.y_start} - {coordFrame?.y_stop})
					</span>
				{/if}
			</label>
			<label class="block flex-1">
				<span class="text-gray-700">Y Radius:</span>
				<input
					type="number"
					bind:value={y_radius}
					disabled={useEntireYExtent}
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
				/>
			</label>
			<label for="useEntireYExtent" class="block flex-1" >
				<span class="text-gray-700"> Use entire Y extent</span>
				<input
					id="useEntireYExtent"
					type="checkbox"
					bind:checked={useEntireYExtent}
					class="rounded text-indigo-600 focus:ring-indigo-500"
				/>
			</label>
		</div>
		<div class="flex space-x-4">
			<label class="block flex-1">
				<span class="text-gray-700">Z Center:</span>
				<input
					type="number"
					bind:value={z_center}
					min={coordFrame?.z_start}
					max={coordFrame?.z_stop}
					disabled={useEntireZExtent}
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
				/>
				{#if coordFrame}
					<span class="text-gray-500 text-sm">
						({coordFrame?.z_start} - {coordFrame?.z_stop})
					</span>
				{/if}
			</label>
			<label class="block flex-1">
				<span class="text-gray-700">Z Radius:</span>
				<input
					type="number"
					bind:value={z_radius}
					disabled={useEntireZExtent}
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
				/>
			</label>
			<label for="useEntireZExtent" class="block flex-1" >
				<span class="text-gray-700"> Use entire Z extent</span>
				<input
					id="useEntireZExtent"
					type="checkbox"
					bind:checked={useEntireZExtent}
					class="rounded text-indigo-600 focus:ring-indigo-500"
				/>
			</label>
		</div>
		<label class="block">
			<span class="text-gray-700">Destination Collection:</span>
			<input
				type="text"
				bind:value={destination_collection}
				class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
			/>
		</label>
		<label class="block">
			<span class="text-gray-700">Destination Experiment:</span>
			<input
				type="text"
				bind:value={destination_experiment}
				class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
			/>
		</label>
		<label class="block">
			<span class="text-gray-700">Destination Channel:</span>
			<input
				type="text"
				bind:value={destination_channel}
				class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
			/>
		</label>
		<button
			type="submit"
			class="w-full bg-indigo-500 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
		>
			Create Task
		</button>
	</form>
	{#if message}
		<p class="mt-4">{message}</p>
	{/if}
</main>


<style>
	.autocomplete-list {
	}
	.autocomplete-list li {
		padding: 0.5rem;
		cursor: pointer;
	}
	.autocomplete-list li:hover {
		background-color: #f5f5f5;
	}
</style>