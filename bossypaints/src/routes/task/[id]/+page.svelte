<script lang="ts">
	import Header from '$lib/Header.svelte';
	import { generateNeuroglancerLink } from '$lib/neuroglancer';
	import type { TaskInDB } from '$lib/api';

	let { data } = $props();

	const task: TaskInDB = data.task;

	interface User {
		username: string;
		[key: string]: any;
	}

	let user: User | null = null;
	let showSettings = false;

	// Get user from local storage if available
	if (localStorage.getItem('user')) {
		user = !!localStorage.getItem('user')
			? JSON.parse(localStorage.getItem('user') || '{}')
			: undefined;
	}

	function formatTaskId(id: string) {
		return id.split('-')[0];
	}

	function nglLink(task: TaskInDB) {
		return generateNeuroglancerLink(task);
	}

	// For CloudVolume URIs, show path without protocol and bucket/domain
	function cvDisplayPath(uri?: string): string {
		if (!uri) return '';
		let u = uri.trim();
		// Strip precomputed:// wrapper if present
		if (u.startsWith('precomputed://')) {
			u = u.slice('precomputed://'.length);
		}
		// Detect and strip scheme (e.g., gs://, s3://, file://, https://)
		const schemeMatch = u.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
		let scheme = '';
		if (schemeMatch) {
			scheme = (schemeMatch[1] || '').toLowerCase();
			u = u.slice(schemeMatch[0].length);
		}
		// Normalize leading slashes
		u = u.replace(/^\/+/, '');
		// For gs/s3/https, drop the first segment (bucket or host). For file, keep full path.
		const parts = u.split('/');
		if (scheme === 'gs' || scheme === 's3' || scheme.startsWith('http')) {
			return parts.length > 1 ? parts.slice(1).join('/') : '';
		} else if (scheme === 'file') {
			// Preserve absolute path semantics
			return '/' + parts.join('/');
		}
		// Fallback: if no scheme was detected, attempt to drop first segment as bucket-like
		return parts.length > 1 ? parts.slice(1).join('/') : u;
	}

	function calculateVolume() {
		const x_size = task.x_max - task.x_min;
		const y_size = task.y_max - task.y_min;
		const z_size = task.z_max - task.z_min;
		return { x_size, y_size, z_size, total: x_size * y_size * z_size };
	}

	const volume = $derived(calculateVolume());
</script>

<svelte:head>
	<title>Task {formatTaskId(task.id)} - BossyPaints</title>
</svelte:head>

<!-- Main Container -->
<div class="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
	<Header {user} bind:showSettings />

	<!-- Main Content -->
	<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
		<!-- Breadcrumb -->
		<nav class="flex mb-8" aria-label="Breadcrumb">
			<ol class="inline-flex items-center space-x-1 md:space-x-3">
				<li class="inline-flex items-center">
					<a
						href="/"
						class="inline-flex items-center text-sm font-medium text-gray-700 hover:text-blue-600"
					>
						<svg
							class="w-4 h-4 mr-2"
							fill="currentColor"
							viewBox="0 0 20 20"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"
							></path>
						</svg>
						Dashboard
					</a>
				</li>
				<li>
					<div class="flex items-center">
						<svg
							class="w-6 h-6 text-gray-400"
							fill="currentColor"
							viewBox="0 0 20 20"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								fill-rule="evenodd"
								d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
								clip-rule="evenodd"
							></path>
						</svg>
						<span class="ml-1 text-sm font-medium text-gray-500 md:ml-2">
							Task {formatTaskId(task.id)}
						</span>
					</div>
				</li>
			</ol>
		</nav>

		<!-- Task Header -->
		<div class="bg-white rounded-2xl shadow-sm p-8 border border-gray-200 mb-8">
			<div class="flex items-center justify-between mb-6">
				<div class="flex items-center">
					<div
						class="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center text-white text-lg font-bold mr-4"
					>
						{formatTaskId(task.id).slice(0, 2)}
					</div>
					<div>
						<h1 class="text-3xl font-bold text-gray-900">Task {formatTaskId(task.id)}</h1>
						<p class="text-gray-600">
							ID: <span class="font-mono text-sm">{task.id}</span>
						</p>
					</div>
				</div>
				<div class="flex space-x-3">
					<a
						href="/app/{task.id}"
						class="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm"
					>
						<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M19 10a9 9 0 11-18 0 9 9 0 0118 0z"
							></path>
						</svg>
						Start Annotation
					</a>
					<a
						href={nglLink(task)}
						target="_blank"
						class="inline-flex items-center px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm"
					>
						<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
							></path>
						</svg>
						Open in Neuroglancer
					</a>
				</div>
			</div>
		</div>

		<!-- Task Details Grid -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
			<!-- Data Source Information -->
			<div class="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
				<div class="flex items-center mb-4">
					<div class="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center mr-3">
						<svg
							class="w-4 h-4 text-indigo-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
							></path>
						</svg>
					</div>
					<h2 class="text-xl font-semibold text-gray-900">Data Source</h2>
				</div>

				{#if task.data_source_type === 'cloudvolume'}
					<div class="space-y-4">
						<div class="flex items-center space-x-2 mb-3">
							<span
								class="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200"
							>
								CloudVolume
							</span>
						</div>
						<div>
							<h3 class="text-sm font-medium text-gray-700 mb-2">URI</h3>
							<div class="bg-gray-50 rounded-lg p-3">
								<p class="text-sm font-mono text-gray-900 break-all">
									{task.cloudvolume_uri}
								</p>
							</div>
						</div>
						<div>
							<h3 class="text-sm font-medium text-gray-700 mb-2">Display Path</h3>
							<p class="text-sm text-gray-900">
								{cvDisplayPath(task.cloudvolume_uri) || 'N/A'}
							</p>
						</div>
					</div>
				{:else}
					<div class="space-y-4">
						<div class="flex items-center space-x-2 mb-3">
							<span
								class="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200"
							>
								BossDB
							</span>
						</div>
						<div class="grid grid-cols-1 gap-4">
							<div>
								<h3 class="text-sm font-medium text-gray-700 mb-1">Collection</h3>
								<p class="text-sm text-gray-900">{task.collection}</p>
							</div>
							<div>
								<h3 class="text-sm font-medium text-gray-700 mb-1">Experiment</h3>
								<p class="text-sm text-gray-900">{task.experiment}</p>
							</div>
							<div>
								<h3 class="text-sm font-medium text-gray-700 mb-1">Channel</h3>
								<p class="text-sm text-gray-900">{task.channel}</p>
							</div>
						</div>
					</div>
				{/if}

				<div class="mt-4 pt-4 border-t border-gray-200">
					<div>
						<h3 class="text-sm font-medium text-gray-700 mb-1">Resolution</h3>
						<span
							class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
						>
							{task.resolution}
						</span>
					</div>
				</div>
			</div>

			<!-- Spatial Bounds -->
			<div class="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
				<div class="flex items-center mb-4">
					<div class="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center mr-3">
						<svg
							class="w-4 h-4 text-purple-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 4m0 13V4m0 0L9 7"
							></path>
						</svg>
					</div>
					<h2 class="text-xl font-semibold text-gray-900">Spatial Bounds</h2>
				</div>

				<div class="space-y-4">
					<div class="grid grid-cols-3 gap-4">
						<div class="bg-gray-50 rounded-lg p-4">
							<div class="flex items-center mb-2">
								<span
									class="inline-flex items-center px-1.5 py-0.5 mr-2 rounded-full text-xs font-semibold bg-red-500 text-white"
								>
									X
								</span>
								<span class="text-sm font-medium text-gray-700">Axis</span>
							</div>
							<div class="space-y-1 font-mono text-sm">
								<div class="flex justify-between">
									<span class="text-gray-600">Min:</span>
									<span class="text-gray-900">{task.x_min.toLocaleString()}</span>
								</div>
								<div class="flex justify-between">
									<span class="text-gray-600">Max:</span>
									<span class="text-gray-900">{task.x_max.toLocaleString()}</span>
								</div>
								<div class="flex justify-between border-t pt-1 mt-2">
									<span class="text-gray-600 font-medium">Size:</span>
									<span class="text-gray-900 font-medium">{volume.x_size.toLocaleString()}</span>
								</div>
							</div>
						</div>

						<div class="bg-gray-50 rounded-lg p-4">
							<div class="flex items-center mb-2">
								<span
									class="inline-flex items-center px-1.5 py-0.5 mr-2 rounded-full text-xs font-semibold bg-green-500 text-white"
								>
									Y
								</span>
								<span class="text-sm font-medium text-gray-700">Axis</span>
							</div>
							<div class="space-y-1 font-mono text-sm">
								<div class="flex justify-between">
									<span class="text-gray-600">Min:</span>
									<span class="text-gray-900">{task.y_min.toLocaleString()}</span>
								</div>
								<div class="flex justify-between">
									<span class="text-gray-600">Max:</span>
									<span class="text-gray-900">{task.y_max.toLocaleString()}</span>
								</div>
								<div class="flex justify-between border-t pt-1 mt-2">
									<span class="text-gray-600 font-medium">Size:</span>
									<span class="text-gray-900 font-medium">{volume.y_size.toLocaleString()}</span>
								</div>
							</div>
						</div>

						<div class="bg-gray-50 rounded-lg p-4">
							<div class="flex items-center mb-2">
								<span
									class="inline-flex items-center px-1.5 py-0.5 mr-2 rounded-full text-xs font-semibold bg-blue-500 text-white"
								>
									Z
								</span>
								<span class="text-sm font-medium text-gray-700">Axis</span>
							</div>
							<div class="space-y-1 font-mono text-sm">
								<div class="flex justify-between">
									<span class="text-gray-600">Min:</span>
									<span class="text-gray-900">{task.z_min.toLocaleString()}</span>
								</div>
								<div class="flex justify-between">
									<span class="text-gray-600">Max:</span>
									<span class="text-gray-900">{task.z_max.toLocaleString()}</span>
								</div>
								<div class="flex justify-between border-t pt-1 mt-2">
									<span class="text-gray-600 font-medium">Size:</span>
									<span class="text-gray-900 font-medium">{volume.z_size.toLocaleString()}</span>
								</div>
							</div>
						</div>
					</div>

					<div class="bg-blue-50 rounded-lg p-4 border border-blue-200">
						<div class="flex items-center justify-between">
							<div class="flex items-center">
								<svg
									class="w-5 h-5 text-blue-600 mr-2"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
									></path>
								</svg>
								<span class="text-sm font-medium text-blue-800">Total Volume</span>
							</div>
							<span class="text-lg font-bold text-blue-900 font-mono"
								>{volume.total.toLocaleString()} voxels</span
							>
						</div>
					</div>
				</div>
			</div>

			<!-- Task Configuration -->
			<div class="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
				<div class="flex items-center mb-4">
					<div class="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center mr-3">
						<svg
							class="w-4 h-4 text-green-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
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
					</div>
					<h2 class="text-xl font-semibold text-gray-900">Configuration</h2>
				</div>

				<div class="space-y-4">
					{#if task.priority !== undefined}
						<div>
							<h3 class="text-sm font-medium text-gray-700 mb-1">Priority</h3>
							<span
								class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"
							>
								{task.priority}
							</span>
						</div>
					{/if}

					{#if task.output_type}
						<div>
							<h3 class="text-sm font-medium text-gray-700 mb-1">Output Type</h3>
							<span
								class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"
							>
								{task.output_type}
							</span>
						</div>
					{/if}

					{#if task.destination_collection || task.destination_experiment || task.destination_channel}
						<div>
							<h3 class="text-sm font-medium text-gray-700 mb-2">Destination</h3>
							<div class="bg-gray-50 rounded-lg p-3 space-y-2">
								{#if task.destination_collection}
									<div class="flex justify-between">
										<span class="text-sm text-gray-600">Collection:</span>
										<span class="text-sm text-gray-900">{task.destination_collection}</span>
									</div>
								{/if}
								{#if task.destination_experiment}
									<div class="flex justify-between">
										<span class="text-sm text-gray-600">Experiment:</span>
										<span class="text-sm text-gray-900">{task.destination_experiment}</span>
									</div>
								{/if}
								{#if task.destination_channel}
									<div class="flex justify-between">
										<span class="text-sm text-gray-600">Channel:</span>
										<span class="text-sm text-gray-900">{task.destination_channel}</span>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>

			<!-- Quick Actions -->
			<div class="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
				<div class="flex items-center mb-4">
					<div class="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center mr-3">
						<svg
							class="w-4 h-4 text-orange-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13 10V3L4 14h7v7l9-11h-7z"
							></path>
						</svg>
					</div>
					<h2 class="text-xl font-semibold text-gray-900">Quick Actions</h2>
				</div>

				<div class="space-y-3">
					<a
						href="/app/{task.id}"
						class="flex items-center justify-between p-3 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors duration-200"
					>
						<div class="flex items-center">
							<svg
								class="w-5 h-5 text-blue-600 mr-3"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M19 10a9 9 0 11-18 0 9 9 0 0118 0z"
								></path>
							</svg>
							<div>
								<p class="text-sm font-medium text-blue-900">Start Annotation</p>
								<p class="text-xs text-blue-700">Begin annotating this task</p>
							</div>
						</div>
						<svg
							class="w-4 h-4 text-blue-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"
							></path>
						</svg>
					</a>

					<a
						href={nglLink(task)}
						target="_blank"
						class="flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors duration-200"
					>
						<div class="flex items-center">
							<svg
								class="w-5 h-5 text-gray-600 mr-3"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
								></path>
							</svg>
							<div>
								<p class="text-sm font-medium text-gray-900">Open in Neuroglancer</p>
								<p class="text-xs text-gray-700">View data in external viewer</p>
							</div>
						</div>
						<svg
							class="w-4 h-4 text-gray-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
							></path>
						</svg>
					</a>
				</div>
			</div>
		</div>
	</main>
</div>
