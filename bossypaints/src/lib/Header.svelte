<script lang="ts">
	export let user: { username: string; [key: string]: any } | null = null;
	export let showSettings: boolean = false;
	export let title: string = 'BossyPaints';
	export let subtitle: string = '';
	export let showLogo: boolean = true;
	export let showNewTaskButton: boolean = true;
	export let showSettingsButton: boolean = true;
	export let customActions: Array<{
		href?: string;
		onClick?: () => void;
		text: string;
		icon?: string;
		variant?: 'primary' | 'secondary' | 'ghost';
	}> = [];

	function toggleSettings() {
		showSettings = !showSettings;
	}

	// Auto-generate subtitle based on user state if not provided
	$: computedSubtitle =
		subtitle || (user?.username ? `Welcome back, ${user.username}` : 'Neural annotation platform');
</script>

<!-- Header -->
<header class="bg-white shadow-sm border-b">
	<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
		<div class="flex justify-between items-center py-6">
			<div class="flex items-center space-x-4">
				<!-- Logo/Icon -->
				{#if showLogo}
					<div
						class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center"
					>
						<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v6a2 2 0 002 2h4a2 2 0 002-2V5z"
							></path>
						</svg>
					</div>
				{/if}
				<div>
					<h1 class="text-2xl font-bold text-gray-900">{title}</h1>
					{#if computedSubtitle}
						<p class="text-sm text-gray-600">{computedSubtitle}</p>
					{/if}
				</div>
			</div>

			<!-- Header Actions -->
			<div class="flex items-center space-x-4">
				<!-- Custom Actions -->
				{#each customActions as action}
					{#if action.href}
						<a
							href={action.href}
							class="inline-flex items-center px-4 py-2 font-medium rounded-lg transition-colors duration-200 {action.variant ===
							'primary'
								? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
								: action.variant === 'secondary'
									? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
									: 'text-gray-600 hover:text-gray-800'}"
						>
							{#if action.icon === 'plus'}
								<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 4v16m8-8H4"
									></path>
								</svg>
							{:else if action.icon === 'back'}
								<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M10 19l-7-7m0 0l7-7m-7 7h18"
									></path>
								</svg>
							{/if}
							{action.text}
						</a>
					{:else}
						<button
							on:click={action.onClick}
							class="inline-flex items-center px-4 py-2 font-medium rounded-lg transition-colors duration-200 {action.variant ===
							'primary'
								? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
								: action.variant === 'secondary'
									? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
									: 'text-gray-600 hover:text-gray-800'}"
						>
							{#if action.icon === 'plus'}
								<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 4v16m8-8H4"
									></path>
								</svg>
							{:else if action.icon === 'back'}
								<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M10 19l-7-7m0 0l7-7m-7 7h18"
									></path>
								</svg>
							{/if}
							{action.text}
						</button>
					{/if}
				{/each}

				<!-- Default New Task Button -->
				{#if showNewTaskButton && user?.username && customActions.length === 0}
					<a
						href="/tasks/new"
						class="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm"
					>
						<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 4v16m8-8H4"
							></path>
						</svg>
						New Task
					</a>
				{/if}

				<!-- Settings Button -->
				{#if showSettingsButton}
					<button
						on:click={toggleSettings}
						class="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors duration-200"
						title="Settings"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
							></path>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
							></path>
						</svg>
					</button>
				{/if}
			</div>
		</div>
	</div>
</header>
