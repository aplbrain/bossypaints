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