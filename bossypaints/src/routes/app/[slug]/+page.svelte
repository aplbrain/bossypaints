<script lang="ts">
	import AppWithTask from '$lib/AppWithTask.svelte';

	let { data } = $props();
</script>

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
