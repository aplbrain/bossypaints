<script lang="ts">
	import AppWithTask from '$lib/AppWithTask.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title
		>{data.task ? `Task ${data.task.id.split('-')[0]} - BossyPaints` : 'Task - BossyPaints'}</title
	>
</svelte:head>

{#if data.task}
	<AppWithTask task={data.task} />
{/if}

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
</style>
