import type { TaskInDB } from './api';

/**
 * Neuroglancer utility functions for BossyPaints
 * Centralizes all neuroglancer-related functionality
 */

/**
 * Neuroglancer layer configuration interface
 */
interface NeuroglancerLayer {
    source?: string | {
        url: string;
        transform?: {
            outputDimensions?: {
                x?: (string | number)[];
                y?: (string | number)[];
                z?: (string | number)[];
            };
        };
    };
    type: string;
    name: string;
    tool?: string;
    tab?: string;
    annotations?: NeuroglancerAnnotation[];
    filterBySegmentation?: string[];
    opacity?: number;
    blend?: string;
}

/**
 * Neuroglancer annotation interface
 */
interface NeuroglancerAnnotation {
    pointA?: number[];
    pointB?: number[];
    type: string;
    id: string;
    description?: string;
}

/**
 * Neuroglancer state configuration interface
 */
interface NeuroglancerState {
    layers: NeuroglancerLayer[];
    navigation: {
        pose: {
            position: {
                voxelCoordinates: number[];
            };
        };
        zoomFactor: number;
    };
    showAxisLines: boolean;
    layout: string;
}

/**
 * New neuroglancer state configuration interface (used by neuroglancer.bossdb.io)
 */
interface NewNeuroglancerState {
    dimensions?: {
        x?: (number | string)[];
        y?: (number | string)[];
        z?: (number | string)[];
    };
    position?: number[];
    crossSectionScale?: number;
    projectionScale?: number;
    layers: NeuroglancerLayer[];
    showAxisLines?: boolean;
    selectedLayer?: {
        visible: boolean;
        layer: string;
    };
    layout?: string;
}

/**
 * Generate a neuroglancer URL from a BossyPaints task
 * @param task - The task object containing volume information
 * @returns The complete neuroglancer URL
 */
export function generateNeuroglancerLink(task: TaskInDB): string {
    const state = createNeuroglancerState(task);
    return `https://neuroglancer.bossdb.io/#!` + JSON.stringify(state);
}

/**
 * Create a neuroglancer state object from a task
 * @param task - The task object containing volume information
 * @returns A complete neuroglancer state configuration
 */
export function createNeuroglancerState(task: TaskInDB): NeuroglancerState {
    return {
        layers: [
            createImageLayer(task),
            createAnnotationLayer(task)
        ],
        navigation: createNavigationConfig(task),
        showAxisLines: false,
        layout: 'xy'
    };
}

/**
 * Create an image layer configuration for neuroglancer
 * @param task - The task object containing volume information
 * @returns Image layer configuration
 */
export function createImageLayer(task: TaskInDB): NeuroglancerLayer {
    return {
        source: `boss://https://api.bossdb.io/${task.collection}/${task.experiment}/${task.channel}`,
        type: 'image',
        name: task.experiment
    };
}

/**
 * Create an annotation layer configuration for neuroglancer
 * @param task - The task object containing volume information
 * @returns Annotation layer configuration
 */
export function createAnnotationLayer(task: TaskInDB): NeuroglancerLayer {
    return {
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
        annotations: [createBoundingBoxAnnotation(task)],
        filterBySegmentation: ['segments'],
        name: 'annotation'
    };
}

/**
 * Create a bounding box annotation from task bounds
 * @param task - The task object containing volume information
 * @returns Bounding box annotation configuration
 */
export function createBoundingBoxAnnotation(task: TaskInDB): NeuroglancerAnnotation {
    return {
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
        id: '1b560fcfeb61c65bca6396b1938020176c7dcc35',
        description: `Task region: ${task.collection}/${task.experiment}/${task.channel}`
    };
}

/**
 * Create navigation configuration for neuroglancer
 * @param task - The task object containing volume information
 * @returns Navigation configuration
 */
export function createNavigationConfig(task: TaskInDB) {
    return {
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
    };
}

/**
 * Generate a neuroglancer URL for a specific coordinate
 * @param collection - BossDB collection name
 * @param experiment - BossDB experiment name
 * @param channel - BossDB channel name
 * @param coordinates - [x, y, z] coordinates to center on
 * @param resolution - Resolution level (default: 0)
 * @param zoomFactor - Zoom level (default: 8)
 * @returns The complete neuroglancer URL
 */
export function generateNeuroglancerLinkForCoordinate(
    collection: string,
    experiment: string,
    channel: string,
    coordinates: [number, number, number],
    resolution: number = 0,
    zoomFactor: number = 8
): string {
    const state: NeuroglancerState = {
        layers: [
            {
                source: `boss://https://api.bossdb.io/${collection}/${experiment}/${channel}`,
                type: 'image',
                name: experiment
            }
        ],
        navigation: {
            pose: {
                position: {
                    voxelCoordinates: [
                        Math.round(coordinates[0] * Math.pow(2, resolution)),
                        Math.round(coordinates[1] * Math.pow(2, resolution)),
                        Math.round(coordinates[2])
                    ]
                }
            },
            zoomFactor
        },
        showAxisLines: false,
        layout: 'xy'
    };

    return `https://neuroglancer.bossdb.io/#!` + JSON.stringify(state);
}

/**
 * Create a custom neuroglancer state with multiple layers
 * @param layers - Array of layer configurations
 * @param coordinates - [x, y, z] coordinates to center on
 * @param options - Additional options (zoomFactor, layout, showAxisLines)
 * @returns Complete neuroglancer state
 */
export function createCustomNeuroglancerState(
    layers: NeuroglancerLayer[],
    coordinates: [number, number, number],
    options: {
        zoomFactor?: number;
        layout?: string;
        showAxisLines?: boolean;
    } = {}
): NeuroglancerState {
    return {
        layers,
        navigation: {
            pose: {
                position: {
                    voxelCoordinates: coordinates
                }
            },
            zoomFactor: options.zoomFactor ?? 8
        },
        showAxisLines: options.showAxisLines ?? false,
        layout: options.layout ?? 'xy'
    };
}

/**
 * Parse a neuroglancer URL to extract state information
 * @param url - Neuroglancer URL
 * @returns Parsed state object or null if invalid
 */
export function parseNeuroglancerUrl(url: string): NeuroglancerState | null {
    try {
        const hashIndex = url.indexOf('#!');
        if (hashIndex === -1) return null;

        const stateJson = url.substring(hashIndex + 2);
        return JSON.parse(stateJson) as NeuroglancerState;
    } catch (error) {
        console.error('Failed to parse neuroglancer URL:', error);
        return null;
    }
}

/**
 * Parse a neuroglancer URL to extract new state information
 * This handles the format used by neuroglancer.bossdb.io with dimensions, crossSectionScale, etc.
 * @param url - Neuroglancer URL
 * @returns Parsed new state object or null if invalid
 */
export function parseNewNeuroglancerUrl(url: string): NewNeuroglancerState | null {
    try {
        const hashIndex = url.indexOf('#!');
        if (hashIndex === -1) return null;

        const stateJson = decodeURIComponent(url.substring(hashIndex + 2));
        return JSON.parse(stateJson) as NewNeuroglancerState;
    } catch (error) {
        console.error('Failed to parse new neuroglancer URL:', error);
        return null;
    }
}

/**
 * Convert a new neuroglancer state to the simplified format used by this app
 * @param newState - New neuroglancer state
 * @returns Simplified neuroglancer state or null if conversion fails
 */
export function convertNewToSimpleState(newState: NewNeuroglancerState): NeuroglancerState | null {
    try {
        // Convert crossSectionScale and projectionScale to zoomFactor
        // This is an approximation since the formats are quite different
        const zoomFactor = newState.crossSectionScale || 8;

        return {
            layers: newState.layers,
            navigation: {
                pose: {
                    position: {
                        voxelCoordinates: newState.position || [0, 0, 0]
                    }
                },
                zoomFactor
            },
            showAxisLines: newState.showAxisLines ?? false,
            layout: newState.layout || 'xy'
        };
    } catch (error) {
        console.error('Failed to convert new state to simple state:', error);
        return null;
    }
}

/**
 * Parse a neuroglancer URL and return it in the app's simplified format
 * This function handles both simple and new neuroglancer URL formats
 * @param url - Neuroglancer URL
 * @returns Parsed state in simplified format or null if invalid
 */
export function parseNeuroglancerUrlToSimpleState(url: string): NeuroglancerState | null {
    // Try parsing as simple state first
    const simpleState = parseNeuroglancerUrl(url);
    if (simpleState && simpleState.navigation) {
        return simpleState;
    }

    // Try parsing as new state
    const newState = parseNewNeuroglancerUrl(url);
    if (newState) {
        return convertNewToSimpleState(newState);
    }

    return null;
}

/**
 * Extract BossDB information from a neuroglancer URL
 * @param url - Neuroglancer URL
 * @returns Object containing collection, experiment, and channel, or null if not found
 */
export function extractBossDBInfoFromUrl(url: string): { collection: string; experiment: string; channel: string } | null {
    try {
        const newState = parseNewNeuroglancerUrl(url);
        if (!newState) return null;

        for (const layer of newState.layers) {
            if (typeof layer.source === 'string' && layer.source.startsWith('boss://')) {
                const bossUrl = layer.source.replace('boss://', '');
                const urlParts = bossUrl.split('/');

                // Expected format: https://api.bossdb.io/collection/experiment/channel
                if (urlParts.length >= 5 && urlParts[0] === 'https:' && urlParts[2] === 'api.bossdb.io') {
                    return {
                        collection: urlParts[3],
                        experiment: urlParts[4],
                        channel: urlParts[5] || urlParts[4] // fallback if channel is same as experiment
                    };
                }
            }
        }

        return null;
    } catch (error) {
        console.error('Failed to extract BossDB info from URL:', error);
        return null;
    }
}
