/**
 * @module config
 *
 * Application-level configuration.
 */

const APP_CONFIG = {

    /**
     * Global debug flag.
     * When set to false, all console debugging statements will be suppressed.
     * Set to true to enable debug logging for development and troubleshooting.
     */
    debug: false,

    /**
     * Zoom speed.
     * Controls how quickly the zoom level changes when the user scrolls.
     */
    scrollingZoomSpeed: 0.005,

    /**
     * Pinch zoom speed.
     * Controls how quickly the zoom level changes when the user pinches.
     */
    pinchZoomSpeed: 0.01,

    /**
     * Resolution system configuration.
     * Defines different resolution levels with zoom thresholds.
     * Higher resolution levels are downsampled versions (res 1 = 2x downsample, res 2 = 4x downsample, etc.)
     */
    resolutionLevels: [
        { threshold: 0.8, resolution: 0, color: [255, 255, 0], name: 'Res 0' },      // Yellow - full resolution
        { threshold: 0.4, resolution: 1, color: [255, 165, 0], name: 'Res 1' },      // Orange - 2x downsample
        { threshold: 0.2, resolution: 2, color: [255, 69, 0], name: 'Res 2' },       // Red-Orange - 4x downsample
        { threshold: 0.1, resolution: 3, color: [255, 0, 0], name: 'Res 3' },        // Red - 8x downsample
        { threshold: 0.0, resolution: 4, color: [128, 0, 128], name: 'Res 4' }       // Purple - 16x downsample
    ],

    /**
     * Fixed chunk dimensions for consistent performance.
     * All chunks will be exactly these sizes regardless of resolution.
     */
    fixedChunkSize: {
        width: 256,   // Fixed chunk width in pixels
        height: 256,  // Fixed chunk height in pixels
        depth: 16     // Fixed chunk depth in Z-slices
    },

    /**
     * Filmstrip configuration for efficient Z-batch fetching.
     * BossDB performs much better when fetching multiple Z-slices in one request.
     * Now aligned with fixed chunk depth.
     */
    filmstrip: {
        batchSize: 16,  // Fetch 16 Z-slices at a time (matches fixedChunkSize.depth)
        preloadRadius: 1,  // Number of filmstrip batches to preload around current batch
        cacheMaxBatches: 8  // Maximum number of filmstrip batches to keep in memory
    },

    /**
     * Chunk loading configuration.
     * Controls how many chunks to load around the camera focus.
     */
    chunkLoading: {
        radius: 2,  // Load chunks in a (2*radius+1) x (2*radius+1) grid around camera (default: 5x5 grid)
        prioritizeCenter: true  // Load chunks closest to camera first
    },

    /**
     * Zoom speed with keys.
     */
    slowKeyZoomSpeed: 0.1,
    fastKeyZoomSpeed: 0.3,

    /**
     * Pan speed with keys.
     */
    slowKeyPanSpeed: 10,

    /**
     * Opacity for rendering.
     */
    // Default opacity for annotations when editing:
    editingOpacity: 0.2,
    // Default non-active opacity for annotations:
    nonActiveOpacity: 0.3,
    // Hovered opacity for annotations:
    hoveredOpacity: 0.5,
    // Active opacity for annotations:
    activeOpacity: 0.4,

};

export default APP_CONFIG;