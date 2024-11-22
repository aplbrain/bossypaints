<script lang="ts">
	import { goto } from '$app/navigation';

	import API from '$lib/api';
	import type { TaskInDB } from '$lib/api';

	let tasks: TaskInDB[] = [];

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

Click <a href="/app">here</a> to go to the app page.

<h1>Tasks</h1>
<table>
	<thead>
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
	<tbody>
		{#each tasks as task}
			<tr>
				<td><a href="/app/{task.id}"><pre>{task.id}</pre></a></td>
				<td>{task.collection}</td>
				<td>{task.experiment}</td>
				<td>{task.channel}</td>
				<td>{task.resolution}</td>
				<td>{task.x_min}–{task.x_max}, {task.y_min}–{task.y_max}, {task.z_min}–{task.z_max}</td>
				<td>
					<button on:click={() => goto(`/app/${task.id}`)}>Start</button>
					<a href={nglLink(task)}>View in neuroglancer</a>
				</td>
			</tr>
		{/each}
	</tbody>
</table>
