<script lang="ts">
	import AppWithTask from '$lib/AppWithTask.svelte';
	import API, { type TaskInDB } from '$lib/api';

	let task: TaskInDB;

	async function loadTask() {
		let response = await API.getNextTask();
		task = response.task;
	}

	loadTask();
</script>

<svelte:head>
	<title>Annotation App - BossyPaints</title>
</svelte:head>

{#if task}
	<AppWithTask {task} />
{/if}

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
</style>
