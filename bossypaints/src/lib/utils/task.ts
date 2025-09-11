import type { TaskInDB } from '$lib/api';

/**
 * Get the display name for a task, using the custom name if available,
 * otherwise falling back to "Task [hash]"
 */
export function getTaskDisplayName(task: TaskInDB): string {
    return task.name || `Task ${formatTaskId(task.id)}`;
}

/**
 * Format a task ID to show only the first part (before the first dash)
 */
export function formatTaskId(id: string): string {
    return id.split('-')[0];
}

/**
 * Format task bounds for display
 */
export function formatTaskBounds(task: TaskInDB): string {
    return `${task.x_min}–${task.x_max} × ${task.y_min}–${task.y_max} × ${task.z_min}–${task.z_max}`;
}

/**
 * For CloudVolume URIs, show path without protocol and bucket/domain
 */
export function formatCloudVolumePath(uri?: string): string {
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
