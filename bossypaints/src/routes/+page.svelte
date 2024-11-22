<script lang="ts">
	import { goto } from '$app/navigation';

	import API from '$lib/api';
	import type { TaskInDB } from '$lib/api';

	let tasks: TaskInDB[] = [];

	API.getTasks().then((response) => {
		tasks = response.tasks;
	});

	function goToViewInNeuroglancer(task: TaskInDB) {}
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
					<button on:click={() => goToViewInNeuroglancer(task)}>View in Neuroglancer</button>
				</td>
			</tr>
		{/each}
	</tbody>
</table>
