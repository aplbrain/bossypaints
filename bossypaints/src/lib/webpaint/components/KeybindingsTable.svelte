<!--
@component KeybindingsTable

@desc A table that displays the keybindings for the app.
@see src/lib/keybindings.ts

@prop {boolean} show - Whether the table is visible or not.
-->
<script lang="ts">
	import { keybindings } from '../keybindings';

	export let show = true;

	$: classes = show ? '' : 'hidden';

	document.addEventListener('keydown', (e) => {
		if (e.key === 'h') {
			show = !show;
		}
	});
</script>

<table id="keybindings-table" class={classes}>
	<thead>
		<tr>
			<th colspan="2"> Keybindings (Press [h] to hide)</th>
		</tr>
	</thead>
	<tbody>
		<tr><th>Key</th><th>Action</th></tr>
		{#each keybindings as kb}
			<tr>
				<td>{kb.key}</td>
				<td>{kb.action}</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	#keybindings-table {
		position: fixed;
		bottom: 10px;
		right: 10px;
		background-color: white;
		transition: opacity 0.2s;
	}

	#keybindings-table.hidden {
		opacity: 0;
	}
</style>
