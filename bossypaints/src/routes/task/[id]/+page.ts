// Don't render this route on the server:
export const ssr = false;

import API from '$lib/api';

import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
    // Use the fetch function passed to load for better SSR support
    const baseUrl = 'http://localhost:8000';

    const makeRequest = async (url: string) => {
        url = url.startsWith('/') ? url : `/${url}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (typeof localStorage !== 'undefined' && localStorage.getItem('apiToken')) {
            headers['Authorization'] = `Token ${localStorage.getItem('apiToken')}`;
        }
        const response = await fetch(`${baseUrl}${url}`, {
            headers,
        });
        return response.json();
    };

    try {
        const taskResponse = await makeRequest(`/api/tasks/${params.id}`);
        if (!taskResponse.task) {
            throw error(404, 'Task not found');
        }

        // Try to get exports, but don't fail if they don't exist
        let exports = { meshes: [], segments: [] };
        try {
            const exportsResponse = await makeRequest(`/api/tasks/${params.id}/exports`);
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
