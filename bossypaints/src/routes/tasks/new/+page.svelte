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

	async function createTask() {
		const task = {
			collection,
			experiment,
			channel,
			resolution,
			x_min: x_center - x_radius,
			x_max: x_center + x_radius,
			y_min: y_center - y_radius,
			y_max: y_center + y_radius,
			z_min: z_center - z_radius,
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
			<ul>
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
			<ul>
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
			<ul>
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
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
				/>
				{#if coordFrame}
					<span class="text-gray-500 text-sm">({coordFrame?.x_start} - {coordFrame?.x_stop})</span>
				{/if}
			</label>
			<label class="block flex-1">
				<span class="text-gray-700">X Radius:</span>
				<input
					type="number"
					bind:value={x_radius}
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
				/>
			</label>
		</div>
		<div class="flex space-x-4">
			<label class="block flex-1">
				<span class="text-gray-700">Y Center:</span>
				<input
					type="number"
					bind:value={y_center}
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
				/>
				{#if coordFrame}
					<span class="text-gray-500 text-sm">({coordFrame?.y_start} - {coordFrame?.y_stop})</span>
				{/if}
			</label>
			<label class="block flex-1">
				<span class="text-gray-700">Y Radius:</span>
				<input
					type="number"
					bind:value={y_radius}
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
				/>
			</label>
		</div>
		<div class="flex space-x-4">
			<label class="block flex-1">
				<span class="text-gray-700">Z Center:</span>
				<input
					type="number"
					bind:value={z_center}
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
				/>
				{#if coordFrame}
					<span class="text-gray-500 text-sm">({coordFrame?.z_start} - {coordFrame?.z_stop})</span>
				{/if}
			</label>
			<label class="block flex-1">
				<span class="text-gray-700">Z Radius:</span>
				<input
					type="number"
					bind:value={z_radius}
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
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
