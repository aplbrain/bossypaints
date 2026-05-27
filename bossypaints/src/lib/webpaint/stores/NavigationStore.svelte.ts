/**
 * @module NavigationStore
 */
import APP_CONFIG from '../config';

/**
 * Create a store for managing navigation in a multi-layered volume.
 * @param x - The x-coordinate of the center of the viewport, in scene coordinates.
 * @param y - The y-coordinate of the center of the viewport, in scene coordinates.
 * @param layer - The z-layer of the viewport.
 * @param zoom - The zoom level of the viewport.
 * @param minLayer - The minimum z-layer. (Default: 0)
 * @param maxLayer - The maximum z-layer.
 * @param imageWidth - The width of the image.
 * @param imageHeight - The height of the image.
 */
export function createNavigationStore({
	x = 0,
	y = 0,
	layer = 16,
	zoom = 1,
	minLayer = 0,
	maxLayer = 32,
	imageWidth = 512,
	imageHeight = 512
}) {
	const clampZoom = (value: number): number => {
		if (!Number.isFinite(value)) {
			return APP_CONFIG.zoomBounds.min;
		}
		return Math.min(APP_CONFIG.zoomBounds.max, Math.max(APP_CONFIG.zoomBounds.min, value));
	};

	let _x = $state(x);
	let _y = $state(y);
	let _layer = $state(layer);
	let _zoom = $state(clampZoom(zoom));
	const _minLayer = $state(minLayer);
	const _maxLayer = $state(maxLayer);
	let _drawing = $state(false);
	let _annotationsVisible = $state(true);
	let _restrictLayerBounds = $state(true);
	const _imageWidth = $state(imageWidth);
	const _imageHeight = $state(imageHeight);

	const clampLayerToTaskBounds = (value: number): number => {
		if (!Number.isFinite(value)) {
			return _minLayer;
		}
		return Math.max(_minLayer, Math.min(_maxLayer - 1, Math.floor(value)));
	};

	const normalizeLayer = (value: number): number => {
		if (_restrictLayerBounds) {
			return clampLayerToTaskBounds(value);
		}
		if (!Number.isFinite(value)) {
			return _minLayer;
		}
		return Math.max(0, Math.floor(value));
	};

	// Store original task center coordinates in native resolution
	let _originalTaskCenterX = $state<number | null>(null);
	let _originalTaskCenterY = $state<number | null>(null);

	return {
		/** Get the status "drawing" (true/false).
		 * If true, the user is currently drawing.
		 * If false, the user is not drawing (panning, zooming, etc.).
		 */
		get drawing() {
			return _drawing;
		},

		/** Set the status "drawing" (true/false).
		 * If true, the user is currently drawing.
		 * If false, the user is not drawing (panning, zooming, etc.).
		 * @param newDrawing - The new value for "drawing".
		 * @returns {void}
		 */
		setDrawing: (newDrawing: boolean) => {
			_drawing = newDrawing;
		},

		/** Get the annotation visibility status.
		 * If true, annotations are visible.
		 * If false, annotations are hidden.
		 */
		get annotationsVisible() {
			return _annotationsVisible;
		},

		/** Set the annotation visibility status.
		 * @param newVisible - The new visibility state for annotations.
		 * @returns {void}
		 */
		setAnnotationsVisible: (newVisible: boolean) => {
			_annotationsVisible = newVisible;
		},

		/** Toggle annotation visibility.
		 * @returns {void}
		 */
		toggleAnnotationsVisible: () => {
			_annotationsVisible = !_annotationsVisible;
		},

		get restrictLayerBounds() {
			return _restrictLayerBounds;
		},

		setRestrictLayerBounds: (restrict: boolean) => {
			_restrictLayerBounds = restrict;
			if (_restrictLayerBounds) {
				_layer = clampLayerToTaskBounds(_layer);
			}
		},

		get layerWithinTaskBounds() {
			return _layer >= _minLayer && _layer < _maxLayer;
		},

		get taskBoundedLayer() {
			return clampLayerToTaskBounds(_layer);
		},

		/** Get the image width of the underlying data. */
		get imageWidth() {
			return _imageWidth;
		},
		/** Get the image height of the underlying data. */
		get imageHeight() {
			return _imageHeight;
		},

		/** Set the original task center coordinates in native resolution */
		setOriginalTaskCenter: (centerX: number, centerY: number) => {
			_originalTaskCenterX = centerX;
			_originalTaskCenterY = centerY;
		},

		/** Pan to the original task center (used by escape key and initial load) */
		panToOriginalTaskCenter: (canvasWidth: number, canvasHeight: number) => {
			if (_originalTaskCenterX !== null && _originalTaskCenterY !== null) {
				_x = canvasWidth / 2 - _originalTaskCenterX;
				_y = canvasHeight / 2 - _originalTaskCenterY;
			}
		},

		get x() {
			return _x;
		},
		setX: (newX: number) => {
			_x = newX;
		},
		incrementX: (delta: number = 1) => {
			_x += delta;
		},
		decrementX: (delta: number = 1) => {
			_x -= delta;
		},

		get y() {
			return _y;
		},
		setY: (newY: number) => {
			_y = newY;
		},
		incrementY: (delta: number = 1) => {
			_y += delta;
		},
		decrementY: (delta: number = 1) => {
			_y -= delta;
		},

		get layer() {
			return _layer;
		},
		setLayer: (newLayer: number) => {
			_layer = normalizeLayer(newLayer);
		},
		incrementLayer: (delta: number = 1) => {
			_layer = normalizeLayer(_layer + delta);
		},
		decrementLayer: (delta: number = 1) => {
			_layer = normalizeLayer(_layer - delta);
		},
		get zoom() {
			return _zoom;
		},

		/** Set the scene zoom.
		 * Note that you _probably_ want to use this via the centerfullyZoom
		 * method in the keybindings.
		 */
		setZoom: (newZoom: number) => {
			_zoom = clampZoom(newZoom);
		},
		get minLayer() {
			return _minLayer;
		},
		get maxLayer() {
			return _maxLayer;
		},
		reset: () => {
			_zoom = clampZoom(1);
			_layer = clampLayerToTaskBounds(Math.floor((_minLayer + _maxLayer) / 2));
		},

		/**
		 * Convert data coordinates to scene coordinates.
		 * @param dataX - The x-coordinate in data coordinates.
		 * @param dataY - The y-coordinate in data coordinates.
		 */
		dataToScene: (dataX: number, dataY: number): { x: number; y: number } => {
			return {
				x: (dataX + _x) * _zoom,
				y: (dataY + _y) * _zoom
			};
		},

		/**
		 * Convert scene coordinates to data coordinates.
		 * @param sceneX - The x-coordinate in scene coordinates.
		 * @param sceneY - The y-coordinate in scene coordinates.
		 */
		sceneToData: (sceneX: number, sceneY: number): { x: number; y: number } => {
			return {
				x: sceneX / _zoom - _x,
				y: sceneY / _zoom - _y
			};
		}
	};
}

export type NavigationStore = ReturnType<typeof createNavigationStore>;
