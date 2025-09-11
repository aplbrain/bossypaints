<script lang="ts">
	import { CheckIcon, CloseIcon, LockIcon, HelpIcon } from '$lib/icons';

	interface User {
		username: string;
		[key: string]: any;
	}

	export let showSettings: boolean = false;
	export let apiToken: string | null = '';
	export let user: User | null = null;
	export let variant: 'default' | 'archived' = 'default';
	export let saveApiToken: () => Promise<void>;

	// Define colors based on variant
	$: colors = {
		default: {
			inputFocus: 'focus:ring-blue-500',
			button: 'bg-blue-600 hover:bg-blue-700',
			links: 'text-blue-600 hover:text-blue-800'
		},
		archived: {
			inputFocus: 'focus:ring-orange-500',
			button: 'bg-orange-600 hover:bg-orange-700',
			links: 'text-orange-600 hover:text-orange-800'
		}
	}[variant];

	function closeSidebar() {
		showSettings = false;
	}
</script>

{#if showSettings}
	<div class="fixed inset-0 z-50 overflow-hidden">
		<div class="absolute inset-0 overflow-hidden">
			<!-- Backdrop -->
			<button
				class="absolute inset-0 bg-black bg-opacity-50 transition-opacity w-full h-full cursor-default"
				onclick={closeSidebar}
				aria-label="Close settings"
			></button>

			<!-- Slide-out panel -->
			<section class="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl">
				<div class="flex flex-col h-full">
					<!-- Header -->
					<div class="px-6 py-4 border-b border-gray-200">
						<div class="flex items-center justify-between">
							<h3 class="text-lg font-semibold text-gray-900">Settings</h3>
							<button
								onclick={closeSidebar}
								class="text-gray-400 hover:text-gray-600 transition-colors duration-200"
								aria-label="Close settings"
							>
								<CloseIcon class="w-5 h-5" />
							</button>
						</div>
					</div>

					<!-- Content -->
					<div class="flex-1 px-6 py-6 space-y-6">
						<div>
							<label for="apiToken" class="block text-sm font-medium text-gray-700 mb-2">
								BossDB API Token
							</label>
							<div class="space-y-3">
								<input
									type={user?.username ? 'password' : 'text'}
									placeholder="Enter your API token"
									id="apiToken"
									bind:value={apiToken}
									class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 {colors.inputFocus} focus:border-transparent text-sm"
								/>
								<button
									onclick={saveApiToken}
									aria-label="Save API token"
									class="w-full px-4 py-2 {colors.button} text-white font-medium rounded-lg transition-colors duration-200 text-sm"
								>
									Save Token
								</button>
							</div>
							{#if user?.username}
								<div class="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
									<div class="flex items-center">
										<CheckIcon className="w-4 h-4 text-green-600 mr-2" />
										<span class="text-sm font-medium text-green-800"
											>Connected as {user.username}</span
										>
									</div>
								</div>
							{/if}
						</div>

						<div class="border-t border-gray-200 pt-6">
							<h4 class="text-sm font-medium text-gray-900 mb-3">Quick Links</h4>
							<div class="space-y-2">
								<a
									href="https://api.bossdb.io/v1/mgmt/token"
									target="_blank"
									class="flex items-center text-sm {colors.links}"
								>
									<LockIcon class="w-4 h-4 mr-2" />
									Generate API Token
								</a>
								<a
									href="https://bossdb.org/help"
									target="_blank"
									class="flex items-center text-sm {colors.links}"
								>
									<HelpIcon className="w-4 h-4 mr-2" />
									Help & Documentation
								</a>
							</div>
						</div>
					</div>
				</div>
			</section>
		</div>
	</div>
{/if}
