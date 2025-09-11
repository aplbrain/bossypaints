<script lang="ts">
	export let className: string = 'w-4 h-4';
	export let stroke: string = 'currentColor';
</script>

<svg class={className} fill="none" {stroke} viewBox="0 0 24 24">
	<path
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width="2"
		d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
	></path>
</svg>
