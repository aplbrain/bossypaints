/**
 * @module config
 *
 * Application-level configuration.
 */

const APP_CONFIG = {

    /**
     * Debug-mode.
     * Show things like mouse position and axes.
     */
    debug: true,

    /**
     * Debug pinch zoom gestures.
     */
    debugPinch: true,

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
     * LOD (Level of Detail) system configuration.
     * Defines multiple levels of detail with zoom thresholds and chunk multipliers.
     * Lower zoom values trigger higher LOD levels (larger chunks).
     */
    lodLevels: [
        { threshold: 0.8, multiplier: 1, color: [255, 255, 0], name: 'Normal' },      // Yellow - 1x (normal)
        { threshold: 0.4, multiplier: 2, color: [255, 165, 0], name: 'LOD 2x' },      // Orange - 2x
        { threshold: 0.2, multiplier: 4, color: [255, 69, 0], name: 'LOD 4x' },       // Red-Orange - 4x  
        { threshold: 0.1, multiplier: 8, color: [255, 0, 0], name: 'LOD 8x' },        // Red - 8x
        { threshold: 0.0, multiplier: 16, color: [128, 0, 128], name: 'LOD 16x' }     // Purple - 16x
    ],

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