<script lang="ts">
	export let className: string = 'w-4 h-4';
	export let stroke: string = 'currentColor';
</script>

<svg class={className} fill="none" {stroke} viewBox="0 0 24 24">
	<path
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width="2"
		d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4l2-2m0 0l2 2m-2-2v6"
	/>
</svg>
