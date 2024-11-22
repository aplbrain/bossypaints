<script lang="ts">
	import AppWithTask from '$lib/AppWithTask.svelte';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let {data} = $props();
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
