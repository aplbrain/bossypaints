<script lang="ts">
	import { ExternalLinkIcon, LockIcon } from '$lib/icons';

	export let title: string;
	export let subtitle: string;
	export let description: string;
	export let icon: any;
	export let showSettings: () => void;
</script>

<!-- Welcome Section -->
<div class="max-w-2xl mx-auto text-center">
	<div class="bg-white rounded-2xl shadow-sm p-8 border border-gray-200">
		<div
			class="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl mx-auto mb-6 flex items-center justify-center"
		>
			<svelte:component this={icon} class="w-8 h-8 text-white" />
		</div>
		<h2 class="text-3xl font-bold text-gray-900 mb-4">{title}</h2>
		<p class="text-lg text-gray-600 mb-8">{subtitle}</p>
		<div class="bg-blue-50 rounded-lg p-6 mb-6">
			<h3 class="text-lg font-semibold text-blue-900 mb-2">Get Started</h3>
			<p class="text-blue-800 mb-4">{description}</p>
			<a
				href="https://api.bossdb.io/v1/mgmt/token"
				target="_blank"
				class="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium"
			>
				Generate API Token
				<ExternalLinkIcon className="w-4 h-4 ml-1" />
			</a>
		</div>
		<button
			onclick={showSettings}
			aria-label="Open API token settings"
			class="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm"
		>
			<LockIcon class="w-4 h-4 mr-2" />
			Enter API Token
		</button>
	</div>
</div>
