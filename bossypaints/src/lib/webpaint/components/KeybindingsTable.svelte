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

	type KeybindingSection = {
		title: string;
		keys: string[];
	};

	const keybindingSections: KeybindingSection[] = [
		{
			title: 'Mouse & Drawing',
			keys: ['Space', 'Click', 'Drag', 'SHIFT + Drag', 'Right Click']
		},
		{
			title: 'Navigation',
			keys: [
				'Left Arrow',
				'Right Arrow',
				'Up Arrow',
				'Down Arrow',
				', (comma)',
				'. (period)',
				'ESC'
			]
		},
		{
			title: 'Propagation',
			keys: ['Alt + C', 'Alt + Shift + C', 'Shift + ,', 'Shift + .', 'Alt + ,', 'Alt + .']
		},
		{
			title: 'Segments',
			keys: ['ENTER', 'Backspace', 'x', 'd', '=', '-']
		},
		{
			title: 'Display',
			keys: ['a', 't', 'm', 'v']
		},
		{
			title: 'Zoom',
			keys: ['Shift + =', 'Shift + -', '0', 'Scroll']
		}
	];

	const assignedKeys = new Set(keybindingSections.flatMap((section) => section.keys));
	$: groupedKeybindings = keybindingSections
		.map((section) => ({
			title: section.title,
			items: keybindings.filter((kb) => section.keys.includes(kb.key))
		}))
		.filter((section) => section.items.length > 0);
	$: ungroupedKeybindings = keybindings.filter((kb) => !assignedKeys.has(kb.key));

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
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
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
					onclick={() => (show = false)}
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
			<div class="p-6 space-y-6">
				{#each groupedKeybindings as section}
					<section class="space-y-3">
						<div class="flex items-center gap-3">
							<h3 class="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
								{section.title}
							</h3>
							<div class="h-px flex-1 bg-gray-200"></div>
						</div>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
							{#each section.items as kb}
								<div class="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
									<div class="flex items-start gap-3">
										<span
											class="font-mono text-sm bg-white px-2 py-1 rounded border border-gray-300 text-gray-700 shrink-0"
										>
											{kb.key}
										</span>
										<span class="text-gray-700 text-sm leading-5">
											{kb.action}
										</span>
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/each}

				{#if ungroupedKeybindings.length > 0}
					<section class="space-y-3">
						<div class="flex items-center gap-3">
							<h3 class="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Other</h3>
							<div class="h-px flex-1 bg-gray-200"></div>
						</div>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
							{#each ungroupedKeybindings as kb}
								<div class="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
									<div class="flex items-start gap-3">
										<span
											class="font-mono text-sm bg-white px-2 py-1 rounded border border-gray-300 text-gray-700 shrink-0"
										>
											{kb.key}
										</span>
										<span class="text-gray-700 text-sm leading-5">
											{kb.action}
										</span>
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/if}
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
