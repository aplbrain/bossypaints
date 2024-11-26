<script lang="ts">
	import API from '$lib/api';
	import type { TaskInDB } from '$lib/api';

	let tasks: TaskInDB[] = [];
	let apiToken: string | null = '';
	let user: {} | null = null;

	// Optionally get the API token from local storage
	if (localStorage.getItem('apiToken')) {
		apiToken = localStorage.getItem('apiToken');
	}
	if (localStorage.getItem('user')) {
		user = !!localStorage.getItem('user')
			? JSON.parse(localStorage.getItem('user') || '{}')
			: undefined;
	}

	API.getTasks().then((response) => {
		tasks = response.tasks;
	});

	function nglLink(task: TaskInDB) {
		let state = {
			layers: [
				{
					source: `boss://https://api.bossdb.io/${task.collection}/${task.experiment}/${task.channel}`,
					type: 'image',
					name: task.experiment
				},
				{
					type: 'annotation',
					source: {
						url: 'local://annotations',
						transform: {
							outputDimensions: {
								x: [1e-9, 'm'],
								y: [1e-9, 'm'],
								z: [3e-8, 'm']
							}
						}
					},
					tool: 'annotateBoundingBox',
					tab: 'annotations',
					annotations: [
						{
							pointA: [
								task.x_min * Math.pow(2, task.resolution),
								task.y_min * Math.pow(2, task.resolution),
								task.z_min
							],
							pointB: [
								task.x_max * Math.pow(2, task.resolution),
								task.y_max * Math.pow(2, task.resolution),
								task.z_max
							],
							type: 'axis_aligned_bounding_box',
							id: '1b560fcfeb61c65bca6396b1938020176c7dcc35'
						}
					],
					filterBySegmentation: ['segments'],
					name: 'annotation'
				}
			],
			navigation: {
				pose: {
					position: {
						voxelCoordinates: [
							Math.round(((task.x_max + task.x_min) / 2) * Math.pow(2, task.resolution)),
							Math.round(((task.y_max + task.y_min) / 2) * Math.pow(2, task.resolution)),
							Math.round((task.z_max + task.z_min) / 2)
						]
					}
				},
				zoomFactor: 8
			},
			showAxisLines: false,
			layout: 'xy'
		};

		return `https://neuroglancer.bossdb.io/#!` + JSON.stringify(state);
	}
</script>

<div class="w-full flex md:flex-col lg:flex-row">
	<div class="md:flex-2/3 p-10 flex-1">
		<h1 class="text-3xl mb-3 font-bold">Tasks</h1>
		<p class="mb-5">Welcome, {user?.username}</p>
		<a
			href="/tasks/new"
			class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
		>
			New Task ...
		</a>
		<br />
		<br />
		{#if user?.username}
			<table class="table-auto w-full">
				<thead class="bg-gray-800 text-white">
					<tr>
						<th>Task ID</th>
						<th>Collection</th>
						<th>Experiment</th>
						<th>Channel</th>
						<th>Resolution</th>
						<th>Bounds</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody class="bg-gray-100">
					{#each tasks as task}
						<tr class="border-b border-gray-200 hover:bg-gray-300 h-10">
							<td>
								<a href="/app/{task.id}" class="text-blue-500 cursor-pointer text-center">
									{task.id.split('-')[0]}
								</a>
							</td>
							<td>{task.collection}</td>
							<td>{task.experiment}</td>
							<td>{task.channel}</td>
							<td>{task.resolution}</td>
							<td
								>{task.x_min}–{task.x_max}, {task.y_min}–{task.y_max}, {task.z_min}–{task.z_max}</td
							>
							<td class="text-center">
								<a
									href="/app/{task.id}"
									class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-4 leading-10 rounded"
									>Start</a
								>
								<a
									href={nglLink(task)}
									class="bg-gray-500 hover:bg-gray-700 text-white font-bold py-1 px-4 rounded"
								>
									Neuroglancer
								</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
		{#if !apiToken}
			<div class="bg-gray-50 p-5">
				<h1 class="text-3xl mb-3 font-bold">Welcome to Bossypaints</h1>
				<p>
					Please enter your API token to get started. You can find or generate your API token on
					<a href="https://api.bossdb.io/v1/mgmt/token" class="text-blue-500" target="_blank">
						this page
					</a>.
				</p>
			</div>
		{/if}
	</div>
	<div class="md:flex-1/3 p-10">
		<div class="bg-gray-50 p-5">
			<h1 class="text-3xl mb-3 font-bold">Settings</h1>
			<label for="apiToken" class="block text-sm font-medium text-gray-700">BossDB API Token</label>
			<div class="flex items-center">
				<input
					type={user?.username ? 'password' : 'text'}
					placeholder="API Token"
					id="apiToken"
					bind:value={apiToken}
					class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
					on:change={() => {
						if (apiToken) localStorage.setItem('apiToken', apiToken);

						API.getBossDBUsernameFromToken(apiToken).then((response) => {
							user = response;
							console.log(user);
							localStorage.setItem('user', JSON.stringify(user));
						});
					}}
				/>
				<button
					class="ml-2 mt-1 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
					on:click={() => {
						if (apiToken) {
							localStorage.setItem('apiToken', apiToken);
							API.getBossDBUsernameFromToken(apiToken).then((response) => {
								user = response;
								console.log(user);
								localStorage.setItem('user', JSON.stringify(user));
							});
						}
					}}
				>
					Save
				</button>
			</div>
		</div>
	</div>
</div>
