// Don't render this route on the server:
export const ssr = false;

import API from '$lib/api';

import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
    const response = await API.getTask(params.slug);
    if (!response.task) {
        throw error(404, 'Not found');
    }
    return {
        task: response.task,
    };
};