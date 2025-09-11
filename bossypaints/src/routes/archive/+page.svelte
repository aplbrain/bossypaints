<script lang="ts">
	import API from '$lib/api';
	import type { TaskInDB } from '$lib/api';
	import Header from '$lib/Header.svelte';
	import TaskRow from '$lib/TaskRow.svelte';
	import SettingsSidebar from '$lib/SettingsSidebar.svelte';
	import WelcomeSection from '$lib/WelcomeSection.svelte';
	import { ArchiveIcon, EyeIcon, ExternalLinkIcon, CheckIcon, SpinnerIcon } from '$lib/icons';

	interface User {
		username: string;
		[key: string]: any;
	}

	let tasks: TaskInDB[] = [];
	let apiToken: string | null = '';
	let user: User | null = null;
	let loading = true;
	let showSettings = false;

	// Optionally get the API token from local storage
	if (localStorage.getItem('apiToken')) {
		apiToken = localStorage.getItem('apiToken');
	}
	if (localStorage.getItem('user')) {
		user = !!localStorage.getItem('user')
			? JSON.parse(localStorage.getItem('user') || '{}')
			: undefined;
	}

	API.getArchivedTasks()
		.then((response) => {
			tasks = response.tasks;
			loading = false;
		})
		.catch((error) => {
			console.error('Failed to load archived tasks:', error);
			tasks = [];
			loading = false;
		});

	async function saveApiToken() {
		if (apiToken) {
			localStorage.setItem('apiToken', apiToken);
			try {
				const response = await API.getBossDBUsernameFromToken(apiToken);
				user = response;
				localStorage.setItem('user', JSON.stringify(user));
				// Refresh tasks when token is saved
				loading = true;
				const tasksResponse = await API.getArchivedTasks();
				tasks = tasksResponse.tasks;
				loading = false;
			} catch (error) {
				console.error('Failed to validate token:', error);
				loading = false;
			}
		}
	}
</script>

<svelte:head>
	<title>Archived Tasks - BossyPaints</title>
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
						<span class="ml-1 text-sm font-medium text-gray-500 md:ml-2">Archived Tasks</span>
					</div>
				</li>
			</ol>
		</nav>

		{#if !apiToken}
			<WelcomeSection
				title="Archived Tasks"
				subtitle="View and manage your archived annotation tasks."
				description="Please enter your BossDB API token to access your archived tasks."
				icon={ArchiveIcon}
				showSettings={() => (showSettings = true)}
			/>
		{:else if user?.username}
			<!-- Archive Header -->
			<div class="bg-white rounded-2xl shadow-sm p-8 border border-gray-200 mb-8">
				<div class="flex items-center justify-between">
					<div class="flex items-center">
						<div
							class="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center text-white text-lg font-bold mr-4"
						>
							<ArchiveIcon className="w-6 h-6" />
						</div>
						<div>
							<h1 class="text-3xl font-bold text-gray-900">Archived Tasks</h1>
							<p class="text-gray-600">
								{tasks.length} archived task{tasks.length === 1 ? '' : 's'}
							</p>
						</div>
					</div>
					<a
						href="/"
						class="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm"
					>
						<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M10 19l-7-7m0 0l7-7m-7 7h18"
							></path>
						</svg>
						Back to Dashboard
					</a>
				</div>
			</div>

			<!-- Tasks Section -->
			<div class="space-y-6">
				<!-- Tasks Table -->
				{#if loading}
					<div class="bg-white rounded-xl shadow-sm border border-gray-200">
						<div class="p-8 text-center">
							<div
								class="inline-flex items-center justify-center w-12 h-12 bg-orange-100 rounded-full mb-4"
							>
								<svg class="animate-spin w-6 h-6 text-orange-600" fill="none" viewBox="0 0 24 24">
									<circle
										class="opacity-25"
										cx="12"
										cy="12"
										r="10"
										stroke="currentColor"
										stroke-width="4"
									></circle>
									<path
										class="opacity-75"
										fill="currentColor"
										d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
									></path>
								</svg>
							</div>
							<p class="text-gray-600">Loading archived tasks...</p>
						</div>
					</div>
				{:else if tasks.length === 0}
					<div class="bg-white rounded-xl shadow-sm border border-gray-200">
						<div class="p-8 text-center">
							<div
								class="w-12 h-12 bg-gray-100 rounded-full mx-auto mb-4 flex items-center justify-center"
							>
								<ArchiveIcon className="w-6 h-6 text-gray-400" />
							</div>
							<h3 class="text-lg font-medium text-gray-900 mb-2">No archived tasks</h3>
							<p class="text-gray-600 mb-6">
								You haven't archived any tasks yet. Tasks that you archive will appear here.
							</p>
							<a
								href="/"
								class="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200"
							>
								<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M10 19l-7-7m0 0l7-7m-7 7h18"
									></path>
								</svg>
								Back to Dashboard
							</a>
						</div>
					</div>
				{:else}
					<div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
						<div class="px-6 py-4 border-b border-gray-200">
							<h3 class="text-lg font-semibold text-gray-900">Archived Annotation Tasks</h3>
							<p class="text-sm text-gray-600">
								These tasks are archived and won't appear in your main dashboard
							</p>
						</div>

						<div class="overflow-x-auto">
							<table class="min-w-full divide-y divide-gray-200">
								<thead class="bg-gray-50">
									<tr>
										<th
											scope="col"
											class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
											>Task</th
										>
										<th
											scope="col"
											class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
											>Dataset</th
										>
										<th
											scope="col"
											class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
											>Resolution</th
										>
										<th
											scope="col"
											class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
											>Bounds</th
										>
										<th
											scope="col"
											class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
											>Actions</th
										>
									</tr>
								</thead>
								<tbody class="bg-white divide-y divide-gray-200">
									{#each tasks as task, index}
										<TaskRow {task} {index} variant="archived" />
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</main>

	<!-- Settings Sidebar -->
	<SettingsSidebar bind:showSettings bind:apiToken {user} variant="archived" {saveApiToken} />
</div>
