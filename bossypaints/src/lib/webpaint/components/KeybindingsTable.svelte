<!--
@component KeybindingsTable

@desc A modal that displays the keybindings for the app.
@see src/lib/keybindings.ts

@prop {boolean} show - Whether the modal is visible or not.
-->
<script lang="ts">
	import { keybindings } from '../keybindings';
	import { onMount, onDestroy } from 'svelte';

	export let show = true;

	// Close modal when clicking outside or pressing Escape
	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			show = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			show = false;
		}
	}

	function handleGlobalKeydown(event: KeyboardEvent) {
		if (event.key === 'h' || event.key === 'H') {
			show = !show;
		}
	}

	onMount(() => {
		document.addEventListener('keydown', handleGlobalKeydown);
	});

	onDestroy(() => {
		document.removeEventListener('keydown', handleGlobalKeydown);
	});
</script>

{#if show}
	<!-- Modal backdrop -->
	<div
		class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
		on:click={handleBackdropClick}
		on:keydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="keybindings-title"
	>
		<!-- Modal content -->
		<div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto">
			<!-- Modal header -->
			<div class="flex items-center justify-between p-6 border-b border-gray-200">
				<h2 id="keybindings-title" class="text-xl font-semibold text-gray-900">Keybindings</h2>
				<button
					class="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors"
					on:click={() => (show = false)}
					aria-label="Close keybindings"
				>
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						></path>
					</svg>
				</button>
			</div>

			<!-- Modal body -->
			<div class="p-6">
				<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
					{#each keybindings as kb}
						<div
							class="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
						>
							<span
								class="font-mono text-sm bg-white px-2 py-1 rounded border border-gray-300 text-gray-700"
							>
								{kb.key}
							</span>
							<span class="text-gray-700 text-sm flex-1 ml-4">
								{kb.action}
							</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Modal footer -->
			<div class="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-lg">
				<p class="text-sm text-gray-600 text-center">
					Press <kbd class="px-2 py-1 bg-white border border-gray-300 rounded text-xs font-mono"
						>H</kbd
					>
					or
					<kbd class="px-2 py-1 bg-white border border-gray-300 rounded text-xs font-mono"
						>Escape</kbd
					> to close
				</p>
			</div>
		</div>
	</div>
{/if}
