/**
 * @module PolygonAnnotationStore
 *
 * @description A store for managing polygon annotations created by the user.
 */
import type PolygonAnnotation from '../PolygonAnnotation';

export function createAnnotationStore(anno: PolygonAnnotation) {
    let annotation: PolygonAnnotation = $state(anno);
    let _vertices: Array<[number, number]> = $state(annotation.positiveRegions[0] || []);

    return {
        get annotation() { return annotation; },
        setAnnotation: (newAnnotation: PolygonAnnotation) => {
            annotation = newAnnotation;
        },
        addVertex: (pt: [number, number]) => {
            annotation.addVertex(pt);
            _vertices = annotation.positiveRegions[0] || [];
        },
        removeLatestVertex: () => {
            annotation.removeLatestVertex();
            _vertices = annotation.positiveRegions[0] || [];
        },
        get vertices() { return _vertices; }

    };
}