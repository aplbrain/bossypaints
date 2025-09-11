// Don't render this route on the server:
export const ssr = false;

import API, { baseUrl } from '$lib/api';
import type { TaskExports } from '$lib/api';

import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
    try {
        const taskResponse = await API.getTask(params.id);
        if (!taskResponse.task) {
            throw error(404, 'Task not found');
        }

        // Try to get exports, but don't fail if they don't exist
        let exports: TaskExports = { meshes: [], segments: [], cloudvolumes: [] };
        try {
            const exportsResponse = await API.getTaskExports(params.id);
            exports = exportsResponse.exports || { meshes: [], segments: [] };
        } catch (e) {
            // Exports don't exist yet, use empty arrays
            console.log('No exports found for task, using empty arrays');
        }

        return {
            task: taskResponse.task,
            exports
        };
    } catch (e) {
        throw error(404, 'Task not found');
    }
};
