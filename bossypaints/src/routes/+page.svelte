<script lang="ts">
	import API from '$lib/api';
	import type { TaskInDB } from '$lib/api';
	import Header from '$lib/Header.svelte';
	import { generateNeuroglancerLink } from '$lib/neuroglancer';
	import { getTaskDisplayName, formatCloudVolumePath } from '$lib/utils/task';
	import {
		ArchiveIcon,
		EyeIcon,
		ExternalLinkIcon,
		CheckIcon,
		SpinnerIcon,
		EmptyIcon,
		PlusIcon,
		HelpIcon,
		BrandIcon,
		LockIcon,
		AnnotationIcon,
		LightningIcon,
		CloseIcon
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

	function nglLink(task: TaskInDB) {
		return generateNeuroglancerLink(task);
	}

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
			<!-- Welcome Section -->
			<div class="max-w-2xl mx-auto text-center">
				<div class="bg-white rounded-2xl shadow-sm p-8 border border-gray-200">
					<div
						class="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl mx-auto mb-6 flex items-center justify-center"
					>
						<BrandIcon class="w-8 h-8 text-white" />
					</div>
					<h2 class="text-3xl font-bold text-gray-900 mb-4">Welcome to BossyPaints</h2>
					<p class="text-lg text-gray-600 mb-8">
						A powerful neural annotation platform for precise volumetric data analysis and
						annotation tasks.
					</p>
					<div class="bg-blue-50 rounded-lg p-6 mb-6">
						<h3 class="text-lg font-semibold text-blue-900 mb-2">Get Started</h3>
						<p class="text-blue-800 mb-4">
							Please enter your BossDB API token to access your annotation tasks.
						</p>
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
						onclick={() => (showSettings = true)}
						aria-label="Open API token settings"
						class="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm"
					>
						<LockIcon class="w-4 h-4 mr-2" />
						Enter API Token
					</button>
				</div>
			</div>
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
										<tr class="hover:bg-gray-50 transition-colors duration-150">
											<td class="px-6 py-4 whitespace-nowrap">
												<div class="flex items-center">
													<div
														class="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white text-xs font-bold"
													>
														{index + 1}
													</div>
													<div class="ml-3">
														<div class="text-sm font-medium text-gray-900">
															<a href="/app/{task.id}" class="text-blue-600 hover:text-blue-800">
																{getTaskDisplayName(task)}
															</a>
														</div>
														<div class="text-xs text-gray-500">
															ID: {task.id.substring(0, 8)}...
														</div>
													</div>
												</div>
											</td>
											<td class="px-6 py-4 whitespace-nowrap">
												{#if task.data_source_type === 'cloudvolume'}
													<div class="flex items-center space-x-2">
														<span
															class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200"
															>CV</span
														>
														<div class="text-sm text-gray-900">
															{formatCloudVolumePath(task.cloudvolume_uri) || task.cloudvolume_uri}
														</div>
													</div>
													<div
														class="text-xs text-gray-500 truncate max-w-xs"
														title={task.cloudvolume_uri}
													>
														{task.cloudvolume_uri}
													</div>
												{:else}
													<div class="text-sm text-gray-900">{task.collection}</div>
													<div class="text-xs text-gray-500">
														{task.experiment} / {task.channel}
													</div>
												{/if}
											</td>
											<td class="px-6 py-4 whitespace-nowrap">
												<span
													class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
												>
													{task.resolution}
												</span>
											</td>
											<td class="px-6 py-4 text-sm text-gray-700">
												<div class="space-y-1 font-mono">
													<div class="flex items-center">
														<span
															class="inline-flex items-center px-1.5 py-0.5 mr-2 rounded-full text-[10px] font-semibold bg-black text-white"
															>X</span
														>
														<span>{task.x_min}–{task.x_max}</span>
													</div>
													<div class="flex items-center">
														<span
															class="inline-flex items-center px-1.5 py-0.5 mr-2 rounded-full text-[10px] font-semibold bg-black text-white"
															>Y</span
														>
														<span>{task.y_min}–{task.y_max}</span>
													</div>
													<div class="flex items-center">
														<span
															class="inline-flex items-center px-1.5 py-0.5 mr-2 rounded-full text-[10px] font-semibold bg-black text-white"
															>Z</span
														>
														<span>{task.z_min}–{task.z_max}</span>
													</div>
												</div>
											</td>
											<td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
												<a
													href="/task/{task.id}"
													class="inline-flex items-center px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-md transition-colors duration-200"
												>
													<EyeIcon className="w-3 h-3 mr-1" />
													Details
												</a>
												<a
													href={nglLink(task)}
													target="_blank"
													class="inline-flex items-center px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-xs font-medium rounded-md transition-colors duration-200"
												>
													<ExternalLinkIcon className="w-3 h-3 mr-1" />
													Neuroglancer
												</a>
											</td>
										</tr>
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
	{#if showSettings}
		<div class="fixed inset-0 z-50 overflow-hidden">
			<div class="absolute inset-0 overflow-hidden">
				<!-- Backdrop -->
				<button
					class="absolute inset-0 bg-black bg-opacity-50 transition-opacity w-full h-full cursor-default"
					onclick={() => (showSettings = false)}
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
									onclick={() => (showSettings = false)}
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
										class="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
									/>
									<button
										onclick={saveApiToken}
										aria-label="Save API token"
										class="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 text-sm"
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
										class="flex items-center text-sm text-blue-600 hover:text-blue-800"
									>
										<LockIcon class="w-4 h-4 mr-2" />
										Generate API Token
									</a>
									<a
										href="https://bossdb.org/help"
										target="_blank"
										class="flex items-center text-sm text-blue-600 hover:text-blue-800"
									>
										<HelpIcon class="w-4 h-4 mr-2" />
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
</div>
