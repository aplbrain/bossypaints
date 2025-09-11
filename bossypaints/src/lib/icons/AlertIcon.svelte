<script lang="ts">
	export let className: string = 'w-4 h-4';
	export let stroke: string = 'currentColor';
</script>

<svg class={className} fill="none" {stroke} viewBox="0 0 24 24">
	<path
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width="2"
		d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
	></path>
</svg>
