import p5 from 'p5';
import type { NavigationStore } from './stores/NavigationStore.svelte';
import type { AnnotationManagerStore } from './stores/AnnotationManagerStore.svelte';
import APP_CONFIG from './config';

export type EventType = 'key' | 'mouse';
export type MouseEventType = 'mousePressed' | 'mouseDragged' | 'mouseReleased' | 'mouseWheel';

export interface Keybinding {
    key: string;
    action: string;
    matcher: (s: p5) => boolean;
    handler: (s: p5, annotationStore: AnnotationManagerStore, nav: NavigationStore, rawEvent: MouseEvent | KeyboardEvent) => void;
    eventType: EventType;
    mouseEventType?: MouseEventType;
}


export const keybindings: Keybinding[] = [
    // Mouse event handlers
    {
        key: 'Space',
        action: 'Switch between drawing and panning',
        matcher: (s) => s.key === ' ',
        handler: (s, annotationStore, nav) => {
            // Toggle between drawing and panning
            nav.setDrawing(!nav.drawing);
        },
        eventType: 'key',
    },
    {
        key: 'Click',
        action: 'Add vertex to annotation',
        matcher: (s) => s.mouseButton === s.LEFT && !s.keyIsDown(s.SHIFT),
        handler: (s, annotationStore, nav) => {
            if (!nav.drawing) {
                // Pan view
                nav.incrementX(s.movedX);
                nav.incrementY(s.movedY);
                return;
            }
            const dataSpaceCoord = nav.sceneToData(s.mouseX, s.mouseY);
            annotationStore.currentAnnotation.addVertex([dataSpaceCoord.x, dataSpaceCoord.y]);
        },
        eventType: 'mouse',
        mouseEventType: 'mousePressed',
    },
    {
        key: 'Right Click',
        action: 'Select annotation',
        matcher: (s) => s.mouseButton === s.RIGHT && !s.keyIsDown(s.SHIFT),
        handler: (s, annotationStore, nav, evt) => {
            const mouseDataPos = nav.sceneToData(s.mouseX, s.mouseY);
            const annoUnderMouse = annotationStore.getAllAnnotations().find((a) => {
                return a.pointIsInside([mouseDataPos.x, mouseDataPos.y]);
            });
            if (!annoUnderMouse) {
                annotationStore.setHoveredAnnotation(null);
                return;
            }
            annotationStore.setHoveredAnnotation(annoUnderMouse);
            annotationStore.setCurrentSegmentID(annoUnderMouse.segmentID);
            annotationStore.currentAnnotation.annotation.segmentID = annoUnderMouse.segmentID;

            evt.preventDefault();
            return false;

        },
        eventType: 'mouse',
        mouseEventType: 'mousePressed',
    },
    {
        key: 'Drag',
        action: 'Add vertices (freehand)',
        matcher: (s) => s.mouseButton === s.LEFT && !s.keyIsDown(s.SHIFT),
        handler: (s, annotationStore, nav) => {
            if (!nav.drawing) {
                // Pan view
                nav.incrementX(s.movedX / nav.zoom);
                nav.incrementY(s.movedY / nav.zoom);
                return;
            }
            const dataSpaceCoord = nav.sceneToData(s.mouseX, s.mouseY);
            annotationStore.currentAnnotation.addVertex([dataSpaceCoord.x, dataSpaceCoord.y]);
        },
        eventType: 'mouse',
        mouseEventType: 'mouseDragged',
    },
    {
        key: 'SHIFT + Drag',
        action: 'Pan view',
        matcher: (s) => s.mouseButton === s.LEFT && s.keyIsDown(s.SHIFT),
        handler: (s, annotationStore, nav) => {
            nav.incrementX(s.movedX / nav.zoom);
            nav.incrementY(s.movedY / nav.zoom);
        },
        eventType: 'mouse',
        mouseEventType: 'mouseDragged',
    },
    // Key event handlers
    {
        key: 'Left Arrow',
        action: 'Move view left',
        matcher: (s) => s.keyCode === s.LEFT_ARROW,
        handler: (s, annotationStore, nav) => nav.incrementX(APP_CONFIG.slowKeyPanSpeed),
        eventType: 'key',
    },
    {
        key: 'Right Arrow',
        action: 'Move view right',
        matcher: (s) => s.keyCode === s.RIGHT_ARROW,
        handler: (s, annotationStore, nav) => nav.decrementX(APP_CONFIG.slowKeyPanSpeed),
        eventType: 'key',
    },
    {
        key: 'Up Arrow',
        action: 'Move view up',
        matcher: (s) => s.keyCode === s.UP_ARROW,
        handler: (s, annotationStore, nav) => nav.incrementY(APP_CONFIG.slowKeyPanSpeed),
        eventType: 'key',
    },
    {
        key: 'Down Arrow',
        action: 'Move view down',
        matcher: (s) => s.keyCode === s.DOWN_ARROW,
        handler: (s, annotationStore, nav) => nav.decrementY(APP_CONFIG.slowKeyPanSpeed),
        eventType: 'key',
    },
    {
        key: ', (comma)',
        action: 'Previous z',
        matcher: (s) => s.key === ',',
        handler: (s, annotationStore, nav) => nav.decrementLayer(),
        eventType: 'key',
    },
    {
        key: '. (period)',
        action: 'Next z',
        matcher: (s) => s.key === '.',
        handler: (s, annotationStore, nav) => nav.incrementLayer(),
        eventType: 'key',
    },
    {
        key: 'ESC',
        action: 'Reset view',
        matcher: (s) => s.keyCode === s.ESCAPE,
        handler: (s, annotationStore, nav) => {
            nav.reset();
            // Pan to the original task center (ROI), or fallback to centering the data in viewport
            nav.panToOriginalTaskCenter(s.width, s.height);
        },
        eventType: 'key',
    },
    {
        key: 'ENTER',
        action: 'Submit current annotation',
        matcher: (s) => s.keyCode === s.ENTER,
        handler: (s, annotationStore, nav) => {
            annotationStore.currentAnnotation.annotation.editing = false;
            annotationStore.saveCurrentAndCreateNewAnnotation(nav.layer);
        },
        eventType: 'key',
    },
    {
        key: 'a',
        action: 'Toggle axes and task region visibility',
        matcher: (s) => s.key === 'a' || s.key === 'A',
        handler: () => {
            // Note: This handler is not actually used - functionality is implemented directly in PaintApp.svelte
            // This entry is here only for display in the keybindings table
        },
        eventType: 'key',
    },
    {
        key: 'v',
        action: 'Toggle annotation visibility',
        matcher: (s) => s.key === 'v' || s.key === 'V',
        handler: (s, annotationStore, nav) => {
            nav.toggleAnnotationsVisible();
        },
        eventType: 'key',
    },
    {
        key: 'n',
        action: 'Increment segment ID',
        matcher: (s) => s.key === 'n' || s.key === 'N',
        handler: (s, annotationStore,) => annotationStore.incrementSegmentID(),
        eventType: 'key',
    },
    {
        key: 'b',
        action: 'Decrement segment ID',
        matcher: (s) => s.key === 'b' || s.key === 'B',
        handler: (s, annotationStore,) => annotationStore.decrementSegmentID(),
        eventType: 'key',
    },
    {
        key: 'd',
        action: 'Delete current annotation',
        matcher: (s) => s.key === 'd' || s.key === 'D',
        handler: (s, annotationStore) => {
            annotationStore.resetCurrentAnnotation();
        },
        eventType: 'key',
    },
    {
        key: 'Backspace',
        action: 'Subtract the active segment',
        matcher: (s) => s.keyCode === s.BACKSPACE,
        handler: (s, annotationStore, nav) => {
            annotationStore.currentAnnotation.annotation.editing = false;
            annotationStore.subtractCurrentAnnotation(nav.layer);
        },
        eventType: 'key',
    },
    // {
    //     key: 'Backspace',
    //     action: 'Remove latest vertex',
    //     matcher: (s) => s.keyCode === s.BACKSPACE,
    //     handler: (s, annotationStore,) => {
    //         annotationStore.currentAnnotation.removeLatestVertex();
    //     },
    //     eventType: 'key',
    // },
    {
        key: 'x',
        action: 'Delete hovered annotation',
        handler: (s, annotationStore, nav) => {
            const hoveredAnnotation = annotationStore.hoveredAnnotation;
            if (hoveredAnnotation) {
                const layerIndex = nav.layer;
                annotationStore.removeAnnotation(layerIndex, hoveredAnnotation);

                // Reset hoveredAnnotation after deletion
                annotationStore.setHoveredAnnotation(null);
            }
        },
        eventType: 'key',
        matcher: (s) => s.key === 'x' || s.key === 'X',
    },
    {
        key: '+',
        action: 'Zoom in',
        matcher: (s) => s.key == "+" || s.key == "=",
        handler: (s, annotationStore, nav) => {
            centerfullyZoom(
                nav.zoom + (
                    s.keyIsDown(s.SHIFT) ? APP_CONFIG.fastKeyZoomSpeed : APP_CONFIG.slowKeyZoomSpeed
                ), s, nav
            );
        },
        eventType: 'key',
    },
    {
        key: '-',
        action: 'Zoom out',
        matcher: (s) => s.key == "-",
        handler: (s, annotationStore, nav) => {
            centerfullyZoom(
                nav.zoom - (
                    s.keyIsDown(s.SHIFT) ? APP_CONFIG.fastKeyZoomSpeed : APP_CONFIG.slowKeyZoomSpeed
                ), s, nav
            );
        },
        eventType: 'key',
    },
    {
        key: '0',
        action: 'Reset zoom',
        matcher: (s) => s.key === '0',
        handler: (s, annotationStore, nav) => nav.setZoom(1),
        eventType: 'key',
    },

    // Scroll.
    // "Vanilla" scroll is +/- in z.
    // Ctrl+scroll is zoom.
    {
        key: 'Scroll',
        action: 'Zoom in/out',
        matcher: (s) => !!s,
        // @ts-expect-error This particular Wheel Event is a janky p5 type
        handler: (s, annotationStore, nav, event: WheelEvent & { delta: number }) => {
            // Check both p5's keyIsDown and the event's ctrlKey for Mac compatibility
            if (s.keyIsDown(s.CONTROL) || event.ctrlKey) {
                // Use a faster speed for pinch gestures (when ctrlKey is set by trackpad)
                const zoomSpeed = event.ctrlKey ? APP_CONFIG.pinchZoomSpeed : APP_CONFIG.scrollingZoomSpeed;
                centerfullyZoom(
                    nav.zoom + -event.delta * zoomSpeed, s, nav, true
                );
                event.preventDefault();
                return false;
            } else {
                nav.incrementLayer(event.delta > 0 ? 1 : -1);
                event.preventDefault();
                return false;
            }
        },
        eventType: 'mouse',
        mouseEventType: 'mouseWheel',
    },
];


function centerfullyZoom(newZoom: number, s: p5, nav: NavigationStore, zoomToMouse = true) {
    const oldZoom = nav.zoom;
    nav.setZoom(newZoom);

    if (zoomToMouse) {
        nav.decrementX((s.mouseX) * (1 / oldZoom - 1 / nav.zoom));
        nav.decrementY((s.mouseY) * (1 / oldZoom - 1 / nav.zoom));
    } else {
        nav.decrementX((s.width / 2) * (1 / oldZoom - 1 / nav.zoom));
        nav.decrementY((s.height / 2) * (1 / oldZoom - 1 / nav.zoom));
    }
}

