<script lang="ts">
	import API from '$lib/api';
	import type { TaskInDB } from '$lib/api';
	import Header from '$lib/Header.svelte';
	import TaskRow from '$lib/TaskRow.svelte';
	import SettingsSidebar from '$lib/SettingsSidebar.svelte';
	import WelcomeSection from '$lib/WelcomeSection.svelte';
	import {
		ArchiveIcon,
		EyeIcon,
		ExternalLinkIcon,
		CheckIcon,
		SpinnerIcon,
		EmptyIcon,
		PlusIcon,
		BrandIcon,
		AnnotationIcon,
		LightningIcon
	} from '$lib/icons';

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

	API.getTasks().then((response) => {
		tasks = response.tasks;
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
				const tasksResponse = await API.getTasks();
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
	<title>BossyPaints - Task Dashboard</title>
</svelte:head>

<!-- Main Container -->
<div class="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
	<Header {user} bind:showSettings />

	<!-- Main Content -->
	<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
		{#if !apiToken}
			<WelcomeSection
				title="Welcome to BossyPaints"
				subtitle="A powerful neural annotation platform for precise volumetric data analysis and annotation tasks."
				description="Please enter your BossDB API token to access your annotation tasks."
				icon={BrandIcon}
				showSettings={() => (showSettings = true)}
			/>
		{:else if user?.username}
			<!-- Tasks Section -->
			<div class="space-y-6">
				<!-- Stats Cards -->
				<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
					<div class="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
						<div class="flex items-center">
							<div
								class="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center"
							>
								<AnnotationIcon className="w-4 h-4 text-blue-600" />
							</div>
							<div class="ml-4">
								<p class="text-sm font-medium text-gray-500">Total Tasks</p>
								<p class="text-2xl font-bold text-gray-900">{tasks.length}</p>
							</div>
						</div>
					</div>

					<div class="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
						<div class="flex items-center">
							<div
								class="flex-shrink-0 w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center"
							>
								<CheckIcon className="w-4 h-4 text-green-600" />
							</div>
							<div class="ml-4">
								<p class="text-sm font-medium text-gray-500">Available</p>
								<p class="text-2xl font-bold text-gray-900">{tasks.length}</p>
							</div>
						</div>
					</div>

					<div class="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
						<div class="flex items-center">
							<div
								class="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center"
							>
								<LightningIcon class="w-4 h-4 text-purple-600" />
							</div>
							<div class="ml-4">
								<p class="text-sm font-medium text-gray-500">Quick Start</p>
								<p class="text-lg font-semibold text-gray-900">Ready to Go</p>
							</div>
						</div>
					</div>
				</div>

				<!-- Tasks Table -->
				{#if loading}
					<div class="bg-white rounded-xl shadow-sm border border-gray-200">
						<div class="p-8 text-center">
							<div
								class="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4"
							>
								<SpinnerIcon className="w-6 h-6 text-blue-600" />
							</div>
							<p class="text-gray-600">Loading tasks...</p>
						</div>
					</div>
				{:else if tasks.length === 0}
					<div class="bg-white rounded-xl shadow-sm border border-gray-200">
						<div class="p-8 text-center">
							<div
								class="w-12 h-12 bg-gray-100 rounded-full mx-auto mb-4 flex items-center justify-center"
							>
								<EmptyIcon class="w-6 h-6 text-gray-400" />
							</div>
							<h3 class="text-lg font-medium text-gray-900 mb-2">No tasks available</h3>
							<p class="text-gray-600 mb-6">Create your first annotation task to get started.</p>
							<div class="flex flex-col sm:flex-row gap-3 justify-center">
								<a
									href="/tasks/new"
									class="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200"
								>
									<PlusIcon class="w-4 h-4 mr-2" />
									Create Task
								</a>
								<a
									href="/archive"
									class="inline-flex items-center px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors duration-200"
								>
									<ArchiveIcon className="w-4 h-4 mr-2" />
									View Archived Tasks
								</a>
							</div>
						</div>
					</div>
				{:else}
					<div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
						<div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
							<div>
								<h3 class="text-lg font-semibold text-gray-900">Annotation Tasks</h3>
								<p class="text-sm text-gray-600">
									Manage and access your volumetric annotation tasks
								</p>
							</div>
							<a
								href="/archive"
								class="inline-flex items-center px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-md transition-colors duration-200"
							>
								<ArchiveIcon className="w-4 h-4 mr-1" />
								View Archived
							</a>
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
										<TaskRow {task} {index} variant="default" />
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
	<SettingsSidebar bind:showSettings bind:apiToken {user} variant="default" {saveApiToken} />
</div>
