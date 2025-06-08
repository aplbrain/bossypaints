<script lang="ts">
	import API from '$lib/api';
	import type { TaskInDB } from '$lib/api';

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
		let state = {
			layers: [
				{
					source: `boss://https://api.bossdb.io/${task.collection}/${task.experiment}/${task.channel}`,
					type: 'image',
					name: task.experiment
				},
				{
					type: 'annotation',
					source: {
						url: 'local://annotations',
						transform: {
							outputDimensions: {
								x: [1e-9, 'm'],
								y: [1e-9, 'm'],
								z: [3e-8, 'm']
							}
						}
					},
					tool: 'annotateBoundingBox',
					tab: 'annotations',
					annotations: [
						{
							pointA: [
								task.x_min * Math.pow(2, task.resolution),
								task.y_min * Math.pow(2, task.resolution),
								task.z_min
							],
							pointB: [
								task.x_max * Math.pow(2, task.resolution),
								task.y_max * Math.pow(2, task.resolution),
								task.z_max
							],
							type: 'axis_aligned_bounding_box',
							id: '1b560fcfeb61c65bca6396b1938020176c7dcc35'
						}
					],
					filterBySegmentation: ['segments'],
					name: 'annotation'
				}
			],
			navigation: {
				pose: {
					position: {
						voxelCoordinates: [
							Math.round(((task.x_max + task.x_min) / 2) * Math.pow(2, task.resolution)),
							Math.round(((task.y_max + task.y_min) / 2) * Math.pow(2, task.resolution)),
							Math.round((task.z_max + task.z_min) / 2)
						]
					}
				},
				zoomFactor: 8
			},
			showAxisLines: false,
			layout: 'xy'
		};

		return `https://neuroglancer.bossdb.io/#!` + JSON.stringify(state);
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
			}
		}
	}

	function formatTaskId(id: string) {
		return id.split('-')[0];
	}

	function formatBounds(task: TaskInDB) {
		return `${task.x_min}–${task.x_max} × ${task.y_min}–${task.y_max} × ${task.z_min}–${task.z_max}`;
	}
</script>

<!-- Main Container -->
<div class="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
	<!-- Header -->
	<header class="bg-white shadow-sm border-b">
		<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
			<div class="flex justify-between items-center py-6">
				<div class="flex items-center space-x-4">
					<!-- Logo/Icon -->
					<div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
						<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v6a2 2 0 002 2h4a2 2 0 002-2V5z"></path>
						</svg>
					</div>
					<div>
						<h1 class="text-2xl font-bold text-gray-900">BossyPaints</h1>
						{#if user?.username}
							<p class="text-sm text-gray-600">Welcome back, {user.username}</p>
						{:else}
							<p class="text-sm text-gray-600">Neural annotation platform</p>
						{/if}
					</div>
				</div>
				
				<!-- Header Actions -->
				<div class="flex items-center space-x-4">
					{#if user?.username}
						<a
							href="/tasks/new"
							class="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm"
						>
							<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
							</svg>
							New Task
						</a>
					{/if}
					<button
						on:click={() => showSettings = !showSettings}
						class="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors duration-200"
						title="Settings"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
						</svg>
					</button>
				</div>
			</div>
		</div>
	</header>

	<!-- Main Content -->
	<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
		{#if !apiToken}
			<!-- Welcome Section -->
			<div class="max-w-2xl mx-auto text-center">
				<div class="bg-white rounded-2xl shadow-sm p-8 border border-gray-200">
					<div class="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl mx-auto mb-6 flex items-center justify-center">
						<svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v6a2 2 0 002 2h4a2 2 0 002-2V5z"></path>
						</svg>
					</div>
					<h2 class="text-3xl font-bold text-gray-900 mb-4">Welcome to BossyPaints</h2>
					<p class="text-lg text-gray-600 mb-8">
						A powerful neural annotation platform for precise volumetric data analysis and annotation tasks.
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
							<svg class="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
							</svg>
						</a>
					</div>
					<button
						on:click={() => showSettings = true}
						class="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm"
					>
						<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
						</svg>
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
							<div class="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
								<svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
								</svg>
							</div>
							<div class="ml-4">
								<p class="text-sm font-medium text-gray-500">Total Tasks</p>
								<p class="text-2xl font-bold text-gray-900">{tasks.length}</p>
							</div>
						</div>
					</div>
					
					<div class="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
						<div class="flex items-center">
							<div class="flex-shrink-0 w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
								<svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
								</svg>
							</div>
							<div class="ml-4">
								<p class="text-sm font-medium text-gray-500">Available</p>
								<p class="text-2xl font-bold text-gray-900">{tasks.length}</p>
							</div>
						</div>
					</div>
					
					<div class="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
						<div class="flex items-center">
							<div class="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
								<svg class="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
								</svg>
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
							<div class="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4">
								<svg class="animate-spin w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
							</div>
							<p class="text-gray-600">Loading tasks...</p>
						</div>
					</div>
				{:else if tasks.length === 0}
					<div class="bg-white rounded-xl shadow-sm border border-gray-200">
						<div class="p-8 text-center">
							<div class="w-12 h-12 bg-gray-100 rounded-full mx-auto mb-4 flex items-center justify-center">
								<svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
								</svg>
							</div>
							<h3 class="text-lg font-medium text-gray-900 mb-2">No tasks available</h3>
							<p class="text-gray-600 mb-6">Create your first annotation task to get started.</p>
							<a
								href="/tasks/new"
								class="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200"
							>
								<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
								</svg>
								Create Task
							</a>
						</div>
					</div>
				{:else}
					<div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
						<div class="px-6 py-4 border-b border-gray-200">
							<h3 class="text-lg font-semibold text-gray-900">Annotation Tasks</h3>
							<p class="text-sm text-gray-600">Manage and access your volumetric annotation tasks</p>
						</div>
						
						<div class="overflow-x-auto">
							<table class="min-w-full divide-y divide-gray-200">
								<thead class="bg-gray-50">
									<tr>
										<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Task</th>
										<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dataset</th>
										<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Resolution</th>
										<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bounds</th>
										<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
									</tr>
								</thead>
								<tbody class="bg-white divide-y divide-gray-200">
									{#each tasks as task, index}
										<tr class="hover:bg-gray-50 transition-colors duration-150">
											<td class="px-6 py-4 whitespace-nowrap">
												<div class="flex items-center">
													<div class="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white text-xs font-bold">
														{index + 1}
													</div>
													<div class="ml-3">
														<div class="text-sm font-medium text-gray-900">
															<a href="/app/{task.id}" class="text-blue-600 hover:text-blue-800">
																{formatTaskId(task.id)}
															</a>
														</div>
														<div class="text-xs text-gray-500">ID: {task.id.substring(0, 8)}...</div>
													</div>
												</div>
											</td>
											<td class="px-6 py-4 whitespace-nowrap">
												<div class="text-sm text-gray-900">{task.collection}</div>
												<div class="text-xs text-gray-500">{task.experiment} / {task.channel}</div>
											</td>
											<td class="px-6 py-4 whitespace-nowrap">
												<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
													{task.resolution}
												</span>
											</td>
											<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-mono">
												{formatBounds(task)}
											</td>
											<td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
												<a
													href="/app/{task.id}"
													class="inline-flex items-center px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md transition-colors duration-200"
												>
													<svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M19 10a9 9 0 11-18 0 9 9 0 0118 0z"></path>
													</svg>
													Start
												</a>
												<a
													href={nglLink(task)}
													target="_blank"
													class="inline-flex items-center px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-xs font-medium rounded-md transition-colors duration-200"
												>
													<svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
													</svg>
													View
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
					on:click={() => showSettings = false}
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
									on:click={() => showSettings = false}
									class="text-gray-400 hover:text-gray-600 transition-colors duration-200"
								>
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
									</svg>
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
										on:click={saveApiToken}
										class="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 text-sm"
									>
										Save Token
									</button>
								</div>
								{#if user?.username}
									<div class="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
										<div class="flex items-center">
											<svg class="w-4 h-4 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
											</svg>
											<span class="text-sm font-medium text-green-800">Connected as {user.username}</span>
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
										<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
										</svg>
										Generate API Token
									</a>
									<a 
										href="https://bossdb.org/help" 
										target="_blank"
										class="flex items-center text-sm text-blue-600 hover:text-blue-800"
									>
										<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
										</svg>
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
