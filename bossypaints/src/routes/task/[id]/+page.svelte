<script lang="ts">
	import Header from '$lib/Header.svelte';
	import { generateNeuroglancerLink } from '$lib/neuroglancer';
	import { getTaskDisplayName, formatCloudVolumePath } from '$lib/utils/task';
	import API from '$lib/api';
	import type { TaskInDB, TaskExports } from '$lib/api';
	import {
		ArchiveIcon,
		UnarchiveIcon,
		ExportIcon,
		SpinnerIcon,
		EyeIcon,
		ExternalLinkIcon,
		AnnotationIcon,
		DownloadIcon,
		CheckIcon,
		AlertIcon,
		InfoIcon
	} from '$lib/icons';

	let { data } = $props();

	let task: TaskInDB = $state(data.task);
	const exports: TaskExports = data.exports || { meshes: [], segments: [] };

	interface User {
		username: string;
		[key: string]: any;
	}

	let user: User | null = $state(null);
	let showSettings = $state(false);

	// Get user from local storage if available
	if (localStorage.getItem('user')) {
		user = !!localStorage.getItem('user')
			? JSON.parse(localStorage.getItem('user') || '{}')
			: undefined;
	}

	function nglLink(task: TaskInDB) {
		return generateNeuroglancerLink(task);
	}

	let isExporting = $state(false);
	let exportMessage = $state('');
	let isArchiving = $state(false);
	let archiveMessage = $state('');

	// Task name editing state
	let isEditingName = $state(false);
	let editingName = $state('');
	let isUpdatingName = $state(false);

	async function toggleArchive() {
		if (isArchiving) return;

		isArchiving = true;
		archiveMessage = '';

		try {
			if (task.archived) {
				await API.unarchiveTask(task.id);
				task.archived = false;
				archiveMessage = 'Task unarchived successfully!';
			} else {
				await API.archiveTask(task.id);
				task.archived = true;
				archiveMessage = 'Task archived successfully!';
			}

			// Clear message after 3 seconds
			setTimeout(() => {
				archiveMessage = '';
			}, 3000);
		} catch (error) {
			console.error('Archive operation failed:', error);
			archiveMessage = 'Archive operation failed. Please try again.';
		} finally {
			isArchiving = false;
		}
	}

	async function triggerExport() {
		if (isExporting || task.export_pending) return;

		isExporting = true;
		exportMessage = 'Triggering export...';

		try {
			// Get the latest checkpoints for this task
			const checkpointsResponse = await API.getTaskCheckpoints(task.id);
			const checkpoints = checkpointsResponse.checkpoints;

			if (!checkpoints || checkpoints.length === 0) {
				exportMessage = 'No annotations found to export. Please annotate the task first.';
				isExporting = false;
				return;
			}

			// Get the latest checkpoint polygons
			const latestCheckpoint = checkpoints[checkpoints.length - 1];

			// Trigger the save/export process
			await API.saveTask({
				taskId: task.id,
				checkpoint: latestCheckpoint.polygons
			});

			exportMessage = 'Export started! Processing in background...';

			// Update the task's export_pending flag in the UI
			task.export_pending = true;

			// Reload the page after a delay to check for completion
			setTimeout(() => {
				window.location.reload();
			}, 3000);
		} catch (error) {
			console.error('Export failed:', error);
			if (error.response && error.response.status === 409) {
				exportMessage = 'Export is already in progress for this task.';
			} else {
				exportMessage = 'Export failed. Please try again.';
			}
		} finally {
			isExporting = false;
		}
	}

	// Additional utility functions
	function calculateVolume() {
		const x_size = task.x_max - task.x_min;
		const y_size = task.y_max - task.y_min;
		const z_size = task.z_max - task.z_min;
		return { x_size, y_size, z_size, total: x_size * y_size * z_size };
	}

	const volume = $derived(calculateVolume());

	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}

	async function startEditingName() {
		console.log('startEditingName called'); // Debug log
		isEditingName = true;
		editingName = task.name || '';
		console.log('isEditingName set to:', isEditingName); // Debug log
	}

	async function saveTaskName() {
		if (isUpdatingName) return;

		isUpdatingName = true;
		try {
			const trimmedName = editingName.trim();
			const nameToSave = trimmedName === '' ? null : trimmedName;

			await API.updateTaskName(task.id, nameToSave);
			task.name = nameToSave;
			isEditingName = false;
		} catch (error) {
			console.error('Failed to update task name:', error);
		} finally {
			isUpdatingName = false;
		}
	}

	function cancelEditingName() {
		isEditingName = false;
		editingName = '';
	}

	function handleNameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			saveTaskName();
		} else if (event.key === 'Escape') {
			cancelEditingName();
		}
	}

	function formatDate(timestamp: number): string {
		return new Date(timestamp * 1000).toLocaleDateString();
	}

	function getDownloadUrl(filename: string): string {
		return API.getTaskExportDownloadUrl(task.id, filename);
	}

	function getDownloadAllUrl(): string {
		return API.getTaskExportDownloadAllUrl(task.id);
	}

	const totalExports = $derived((exports?.meshes?.length || 0) + (exports?.segments?.length || 0));
	const hasExports = $derived(totalExports > 0);
</script>

<svelte:head>
	<title>{getTaskDisplayName(task)} - BossyPaints</title>
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
							{getTaskDisplayName(task)}
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
						{getTaskDisplayName(task).slice(0, 2).toUpperCase()}
					</div>
					<div class="flex-1">
						{#if isEditingName}
							<div class="flex items-center space-x-2">
								<input
									type="text"
									bind:value={editingName}
									onkeydown={handleNameKeydown}
									placeholder="Enter task name..."
									class="text-3xl font-bold text-gray-900 bg-transparent border-b-2 border-blue-500 focus:outline-none focus:border-blue-600 min-w-0 flex-1"
									disabled={isUpdatingName}
								/>
								<button
									onclick={saveTaskName}
									disabled={isUpdatingName}
									class="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"
									title="Save"
									aria-label="Save task name"
								>
									<CheckIcon className="w-5 h-5" />
								</button>
								<button
									onclick={cancelEditingName}
									disabled={isUpdatingName}
									class="p-1 text-gray-600 hover:text-gray-700 disabled:opacity-50"
									title="Cancel"
									aria-label="Cancel editing task name"
								>
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M6 18L18 6M6 6l12 12"
										></path>
									</svg>
								</button>
							</div>
						{:else}
							<div class="flex items-center space-x-2">
								<h1 class="text-3xl font-bold text-gray-900">{getTaskDisplayName(task)}</h1>
								<button
									onclick={startEditingName}
									class="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors duration-200 cursor-pointer"
									title="Edit task name"
									type="button"
									aria-label="Edit task name"
								>
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
										></path>
									</svg>
								</button>
							</div>
						{/if}
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
						<AnnotationIcon className="w-4 h-4 mr-2" />
						Start Annotation
					</a>
					<a
						href={nglLink(task)}
						target="_blank"
						class="inline-flex items-center px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm"
					>
						<ExternalLinkIcon className="w-4 h-4 mr-2" />
						Open in Neuroglancer
					</a>
					<button
						onclick={triggerExport}
						disabled={isExporting || task.export_pending}
						aria-label="Export task data"
						class="inline-flex items-center px-4 py-2 {isExporting || task.export_pending
							? 'bg-green-400 cursor-not-allowed'
							: 'bg-green-600 hover:bg-green-700'} text-white font-medium rounded-lg transition-colors duration-200 shadow-sm"
					>
						{#if isExporting || task.export_pending}
							<SpinnerIcon className="w-4 h-4 mr-2 animate-spin" />
							{task.export_pending ? 'Export Pending...' : 'Exporting...'}
						{:else}
							<ExportIcon className="w-4 h-4 mr-2" />
							Export
						{/if}
					</button>
					<button
						onclick={toggleArchive}
						disabled={isArchiving}
						aria-label={task.archived ? 'Unarchive task' : 'Archive task'}
						class="inline-flex items-center px-4 py-2 {task.archived
							? 'bg-blue-600 hover:bg-blue-700'
							: 'bg-orange-600 hover:bg-orange-700'} text-white font-medium rounded-lg transition-colors duration-200 shadow-sm"
					>
						{#if isArchiving}
							<SpinnerIcon className="w-4 h-4 mr-2 animate-spin" />
							Processing...
						{:else if task.archived}
							<UnarchiveIcon className="w-4 h-4 mr-2" />
							Unarchive
						{:else}
							<ArchiveIcon className="w-4 h-4 mr-2" />
							Archive
						{/if}
					</button>
				</div>
			</div>
		</div>

		<!-- Export Status Message -->
		{#if exportMessage || task.export_pending}
			<div
				class="mb-8 p-4 rounded-lg {exportMessage &&
				(exportMessage.includes('failed') || exportMessage.includes('No annotations'))
					? 'bg-red-50 border border-red-200 text-red-800'
					: 'bg-blue-50 border border-blue-200 text-blue-800'}"
			>
				<div class="flex items-center">
					{#if exportMessage && (exportMessage.includes('failed') || exportMessage.includes('No annotations'))}
						<AlertIcon className="w-5 h-5 mr-2" />
					{:else}
						<InfoIcon className="w-5 h-5 mr-2" />
					{/if}
					<span class="font-medium">
						{#if task.export_pending && !exportMessage}
							Export is currently being processed in the background. Please wait...
						{:else}
							{exportMessage}
						{/if}
					</span>
				</div>
			</div>
		{/if}

		<!-- Archive Status Message -->
		{#if archiveMessage}
			<div
				class="mb-8 p-4 rounded-lg {archiveMessage.includes('failed')
					? 'bg-red-50 border border-red-200 text-red-800'
					: 'bg-green-50 border border-green-200 text-green-800'}"
			>
				<div class="flex items-center">
					{#if archiveMessage.includes('failed')}
						<AlertIcon className="w-5 h-5 mr-2" />
					{:else}
						<CheckIcon className="w-5 h-5 mr-2" />
					{/if}
					<span class="font-medium">{archiveMessage}</span>
				</div>
			</div>
		{/if}

		<!-- Archived Task Banner -->
		{#if task.archived}
			<div class="mb-8 p-4 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800">
				<div class="flex items-center">
					<ArchiveIcon className="w-5 h-5 mr-2" />
					<span class="font-medium"
						>This task is archived and will not appear in your main dashboard.</span
					>
				</div>
			</div>
		{/if}

		<!-- Exports Section -->
		<div class="bg-white rounded-2xl shadow-sm p-8 border border-gray-200 mb-8">
			<div class="flex items-center justify-between mb-6">
				<div class="flex items-center">
					<div class="w-8 h-8 bg-cyan-100 rounded-lg flex items-center justify-center mr-3">
						<svg
							class="w-4 h-4 text-cyan-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							></path>
						</svg>
					</div>
					<div>
						<h2 class="text-xl font-semibold text-gray-900">Available Exports</h2>
						<p class="text-sm text-gray-600">
							{#if hasExports}
								{totalExports} file{totalExports === 1 ? '' : 's'} available for download
							{:else}
								No exports available yet
							{/if}
						</p>
					</div>
				</div>
				{#if hasExports}
					<a
						href={getDownloadAllUrl()}
						download
						class="inline-flex items-center px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm"
					>
						<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
							></path>
						</svg>
						Download All
					</a>
				{/if}
			</div>

			{#if hasExports}
				<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
					<!-- Meshes -->
					{#if exports?.meshes && exports.meshes.length > 0}
						<div class="bg-gray-50 rounded-xl p-6">
							<div class="flex items-center mb-4">
								<div class="w-6 h-6 bg-purple-100 rounded-lg flex items-center justify-center mr-3">
									<svg
										class="w-3 h-3 text-purple-600"
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
								</div>
								<h3 class="text-lg font-medium text-gray-900">
									3D Meshes ({exports?.meshes?.length || 0})
								</h3>
							</div>
							<div class="space-y-2 max-h-60 overflow-y-auto">
								{#each exports.meshes as mesh}
									<div
										class="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200 hover:border-purple-200 transition-colors duration-200"
									>
										<div class="flex items-center min-w-0 flex-1">
											<svg
												class="w-4 h-4 text-purple-600 mr-2 flex-shrink-0"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v6a2 2 0 002 2h4a2 2 0 002-2V5z"
												></path>
											</svg>
											<div class="min-w-0 flex-1">
												<p class="text-sm font-medium text-gray-900 truncate">
													{mesh.filename}
												</p>
												<p class="text-xs text-gray-500">
													{formatFileSize(mesh.size)} • {formatDate(mesh.modified)}
												</p>
											</div>
										</div>
										<a
											href={getDownloadUrl(mesh.filename)}
											download
											class="ml-3 inline-flex items-center px-2 py-1 bg-purple-100 hover:bg-purple-200 text-purple-800 text-xs font-medium rounded transition-colors duration-200"
										>
											<svg
												class="w-3 h-3 mr-1"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
												></path>
											</svg>
											Download
										</a>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Segmentation Channels -->
					{#if exports?.segments && exports.segments.length > 0}
						<div class="bg-gray-50 rounded-xl p-6">
							<div class="flex items-center mb-4">
								<div class="w-6 h-6 bg-green-100 rounded-lg flex items-center justify-center mr-3">
									<svg
										class="w-3 h-3 text-green-600"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
										></path>
									</svg>
								</div>
								<h3 class="text-lg font-medium text-gray-900">
									Segmentation Slices ({exports?.segments?.length || 0})
								</h3>
							</div>
							<div class="space-y-2 max-h-60 overflow-y-auto">
								{#each exports.segments as segment}
									<div
										class="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200 hover:border-green-200 transition-colors duration-200"
									>
										<div class="flex items-center min-w-0 flex-1">
											<svg
												class="w-4 h-4 text-green-600 mr-2 flex-shrink-0"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
												></path>
											</svg>
											<div class="min-w-0 flex-1">
												<p class="text-sm font-medium text-gray-900 truncate">
													{segment.filename}
												</p>
												<p class="text-xs text-gray-500">
													{formatFileSize(segment.size)} • {formatDate(segment.modified)}
												</p>
											</div>
										</div>
										<a
											href={getDownloadUrl(segment.filename)}
											download
											class="ml-3 inline-flex items-center px-2 py-1 bg-green-100 hover:bg-green-200 text-green-800 text-xs font-medium rounded transition-colors duration-200"
										>
											<svg
												class="w-3 h-3 mr-1"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
												></path>
											</svg>
											Download
										</a>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Show placeholder if only one type exists -->
					{#if (!exports?.meshes || exports.meshes.length === 0) && exports?.segments && exports.segments.length > 0}
						<div class="bg-gray-50 rounded-xl p-6 flex items-center justify-center">
							<div class="text-center">
								<div
									class="w-12 h-12 bg-gray-200 rounded-full mx-auto mb-3 flex items-center justify-center"
								>
									<svg
										class="w-6 h-6 text-gray-400"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v6a2 2 0 002 2h4a2 2 0 002-2V5z"
										></path>
									</svg>
								</div>
								<p class="text-sm text-gray-500">No 3D meshes available</p>
							</div>
						</div>
					{:else if (!exports?.segments || exports.segments.length === 0) && exports?.meshes && exports.meshes.length > 0}
						<div class="bg-gray-50 rounded-xl p-6 flex items-center justify-center">
							<div class="text-center">
								<div
									class="w-12 h-12 bg-gray-200 rounded-full mx-auto mb-3 flex items-center justify-center"
								>
									<svg
										class="w-6 h-6 text-gray-400"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
										></path>
									</svg>
								</div>
								<p class="text-sm text-gray-500">No segmentation channels available</p>
							</div>
						</div>
					{/if}
				</div>
			{:else}
				<div class="text-center py-12">
					<div
						class="w-16 h-16 bg-gray-100 rounded-full mx-auto mb-4 flex items-center justify-center"
					>
						<svg
							class="w-8 h-8 text-gray-400"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							></path>
						</svg>
					</div>
					<h3 class="text-lg font-medium text-gray-900 mb-2">No Exports Available</h3>
					<p class="text-gray-600 mb-6 max-w-md mx-auto">
						Complete an annotation and hit "Export Annotations" to generate downloadable exports
						including 3D meshes and segmentation channels.
					</p>
					<a
						href="/app/{task.id}"
						class="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200"
					>
						<AnnotationIcon className="w-4 h-4 mr-2" />
						Start Annotating
					</a>
					<button
						onclick={triggerExport}
						disabled={isExporting || task.export_pending}
						aria-label="Export task data"
						class="inline-flex items-center px-4 py-2 {isExporting || task.export_pending
							? 'bg-green-400 cursor-not-allowed'
							: 'bg-green-600 hover:bg-green-700'} text-white font-medium rounded-lg transition-colors duration-200 ml-3"
					>
						{#if isExporting || task.export_pending}
							<SpinnerIcon className="w-4 h-4 mr-2 animate-spin" />
							{task.export_pending ? 'Export Pending...' : 'Exporting...'}
						{:else}
							<ExportIcon className="w-4 h-4 mr-2" />
							Export
						{/if}
					</button>
				</div>
			{/if}
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
								{formatCloudVolumePath(task.cloudvolume_uri) || 'N/A'}
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
							<AnnotationIcon className="w-5 h-5 text-blue-600 mr-3" />
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
