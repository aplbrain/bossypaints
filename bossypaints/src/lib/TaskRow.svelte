<script lang="ts">
	import type { TaskInDB } from '$lib/api';
	import { generateNeuroglancerLink } from '$lib/neuroglancer';
	import { getTaskDisplayName, formatCloudVolumePath } from '$lib/utils/task';
	import { EyeIcon, ExternalLinkIcon, AnnotationIcon } from '$lib/icons';

	export let task: TaskInDB;
	export let index: number;
	export let variant: 'default' | 'archived' = 'default';

	function nglLink(task: TaskInDB) {
		return generateNeuroglancerLink(task);
	}

	// Define colors based on variant
	$: colors = {
		default: {
			indexBg: 'from-blue-500 to-purple-600',
			linkColor: 'text-blue-600 hover:text-blue-800',
			primaryActionBtn: 'bg-green-600 hover:bg-green-700'
		},
		archived: {
			indexBg: 'from-orange-500 to-red-600',
			linkColor: 'text-orange-600 hover:text-orange-800',
			primaryActionBtn: 'bg-orange-600 hover:bg-orange-700'
		}
	}[variant];
</script>

<tr class="hover:bg-gray-50 transition-colors duration-150">
	<td class="px-6 py-4 whitespace-nowrap">
		<div class="flex items-center">
			<div
				class="flex-shrink-0 w-8 h-8 bg-gradient-to-br {colors.indexBg} rounded-lg flex items-center justify-center text-white text-xs font-bold"
			>
				{index + 1}
			</div>
			<div class="ml-3">
				<div class="text-sm font-medium text-gray-900">
					<a href="/task/{task.id}" class={colors.linkColor}>
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
			<div class="text-xs text-gray-500 truncate max-w-xs" title={task.cloudvolume_uri}>
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
		{#if variant === 'default'}
			<a
				href="/app/{task.id}"
				class="inline-flex items-center px-3 py-1.5 {colors.primaryActionBtn} text-white text-xs font-medium rounded-md transition-colors duration-200"
			>
				<AnnotationIcon className="w-3 h-3 mr-1" />
				Continue
			</a>
		{:else}
			<a
				href="/task/{task.id}"
				class="inline-flex items-center px-3 py-1.5 {colors.primaryActionBtn} text-white text-xs font-medium rounded-md transition-colors duration-200"
			>
				<EyeIcon className="w-3 h-3 mr-1" />
				Details
			</a>
		{/if}
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
