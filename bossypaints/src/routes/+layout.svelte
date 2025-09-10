<script>
	import '../app.css';
	import { onMount } from 'svelte';

	// Ensure body scroll is reset on route changes
	onMount(() => {
		// Reset scroll position and body overflow when component mounts
		document.body.style.overflow = 'auto';
		document.body.style.margin = '0';
		document.body.style.padding = '0';
		window.scrollTo(0, 0);
	});
</script>

<svelte:head>
	<title>BossyPaints</title>
</svelte:head>

<slot />
