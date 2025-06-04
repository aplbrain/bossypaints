/**
 * @module AnnotationManagerStore
 * @description A store for managing annotations in a multi-layered volume.
 */
import PolygonAnnotation from '../PolygonAnnotation';
import type p5 from 'p5';
import { createAnnotationStore } from './PolygonAnnotationStore.svelte';
import polybool, { type Polygon } from '@velipso/polybool';
import type { NavigationStore } from './NavigationStore.svelte';

/**
 * Create a store for managing annotations in a multi-layered volume.
 * @param numberOfLayers - The number of z-layers in the volume.
 * @returns {AnnotationManagerStore}
 */
export function createAnnotationManagerStore(numberOfLayers: number) {

    const layerwiseAnnotations: Array<Array<PolygonAnnotation>> = $state(new Array(numberOfLayers).fill(0).map(() => []));
    let currentSegmentID = $state(1);
    let currentAnnotation = createAnnotationStore(new PolygonAnnotation([], currentSegmentID));
    let hoveredAnnotation: PolygonAnnotation | null = $state(null);

    return {
        /**
         * Get the raw annotations array.
         * @returns {Array<Array<PolygonAnnotation>>}
         */
        get annotations(): Array<Array<PolygonAnnotation>> { return layerwiseAnnotations; },

        /**
         * Add an annotation to a layer.
         * @param layerIndex - The index of the layer.
         * @param annotation - The annotation to add.
         * @returns {void}
         */
        addAnnotation: (layerIndex: number, annotation: PolygonAnnotation): void => {
            annotation.z = layerIndex;
            layerwiseAnnotations[layerIndex].push(annotation);
            layerwiseAnnotations[layerIndex] = layerwiseAnnotations[layerIndex].slice();
        },

        /**
         * Get the annotations for a layer.
         * @param layerIndex - The index of the layer.
         * @returns {Array<PolygonAnnotation>}
         */
        getLayerAnnotations: (layerIndex: number): Array<PolygonAnnotation> => {
            // Defensive programming: return empty array if layer index is out of bounds
            if (layerIndex < 0 || layerIndex >= layerwiseAnnotations.length) {
                return [];
            }
            return layerwiseAnnotations[layerIndex];
        },

        /**
         * Get all annotations as a flat array.
         * Note that this is only useful if you need some operation on all
         * annotations, since you will lose the layer information.
         * @returns {Array<PolygonAnnotation>}
         */
        getAllAnnotations: (): Array<PolygonAnnotation> => layerwiseAnnotations.flat(),

        /**
         * Get the current segment ID.
         * @returns {number}
         */
        get currentSegmentID(): number { return currentSegmentID; },

        /**
         * Set the current segment ID.
         * @param id - The new segment ID.
         * @returns {void}
         */
        setCurrentSegmentID: (id: number): void => {
            currentSegmentID = id;
        },

        /**
         * Increment the segment ID.
         * @returns {void}
         */
        incrementSegmentID: (): void => {
            currentSegmentID += 1;
            // If the current annotation has no vertices, also update its segment ID:
            if (currentAnnotation.annotation.points.length === 0) {
                currentAnnotation.annotation.segmentID = currentSegmentID;
            }
        },

        /**
         * Decrement the segment ID.
         * @returns {void}
         */
        decrementSegmentID: (): void => {
            currentSegmentID = Math.max(1, currentSegmentID - 1);
            // If the current annotation has no vertices, also update its segment ID:
            if (currentAnnotation.annotation.points.length === 0) {
                currentAnnotation.annotation.segmentID = currentSegmentID;
            }
        },

        /**
         * Get the current annotation.
         */
        get currentAnnotation() { return currentAnnotation; },

        /**
         * Get the hovered annotation.
         */
        get hoveredAnnotation() { return hoveredAnnotation; },

        /**
         * Set the hovered annotation.
         * @param annotation - The annotation to set as hovered.
         */
        setHoveredAnnotation: (annotation: PolygonAnnotation | null) => {
            hoveredAnnotation = annotation;
        },

        /**
         * Save the current annotation and create a new one.
         * @param layerIndex - The index of the layer.
         * @param mergeByID - Whether to merge annotations with the same segment ID.
         */
        saveCurrentAndCreateNewAnnotation: (layerIndex: number, mergeByID: boolean = true) => {
            currentAnnotation.annotation.z = layerIndex;
            layerwiseAnnotations[layerIndex].push(currentAnnotation.annotation);
            currentAnnotation = createAnnotationStore(new PolygonAnnotation([], currentSegmentID, true, layerIndex));

            if (mergeByID) {
                const sameIDAnnotations = layerwiseAnnotations[layerIndex].filter((a) => a.segmentID === currentSegmentID);

                if (sameIDAnnotations.length > 1) {
                    let polyboolPolys: Polygon[] = sameIDAnnotations.map((a) => {
                        return {
                            regions: [a.points],
                            inverted: false
                        };
                    });

                    // Reduce:
                    // TODO: https://github.com/velipso/polybool?tab=readme-ov-file#advanced-example-1
                    let result: Polygon;
                    for (let i = 1; i < polyboolPolys.length; i++) {
                        result = polybool.union(polyboolPolys[0], polyboolPolys[i]);
                        polyboolPolys[0] = result;
                    }

                    // TODO: Support genus > 0
                    const mergedAnnotations = result.regions.map((r) => new PolygonAnnotation(r as Array<[number, number]>, currentSegmentID, false, layerIndex));
                    layerwiseAnnotations[layerIndex] = layerwiseAnnotations[layerIndex].filter((a) => a.segmentID !== currentSegmentID);
                    layerwiseAnnotations[layerIndex] = layerwiseAnnotations[layerIndex].concat(mergedAnnotations);
                }
            }
        },

        /**
         * Subtract the current annotation from all annotations with the same segment ID.
         * Useful for slicing chunks off of existing annotations.
         * @param layerIndex - The index of the layer.
         */
        subtractCurrentAnnotation: (layerIndex: number) => {
            const sameIDAnnotations = layerwiseAnnotations[layerIndex].filter((a) => a.segmentID === currentSegmentID);
            const subtractingAnnotation = { regions: [currentAnnotation.annotation.points], inverted: false };
            currentAnnotation = createAnnotationStore(new PolygonAnnotation([], currentSegmentID, false, layerIndex));

            // If there are multiple annotations with the same segment ID, subtract the current annotation from each:
            console.log(sameIDAnnotations.length);
            if (sameIDAnnotations.length > 0) {
                let polyboolPolys: Polygon[] = sameIDAnnotations.map((a) => {
                    return {
                        regions: [a.points],
                        inverted: false
                    };
                });

                // Subtract the current annotation from each:
                const subtractedPolys = polyboolPolys.map((p) => {
                    // TODO: Support genus > 0
                    return polybool.difference(p, subtractingAnnotation);
                });
                const subtractedAnnotations = subtractedPolys.map((p) => new PolygonAnnotation(p.regions[0] as Array<[number, number]>, currentSegmentID, false, layerIndex));
                layerwiseAnnotations[layerIndex] = layerwiseAnnotations[layerIndex].filter((a) => a.segmentID !== currentSegmentID);
                layerwiseAnnotations[layerIndex] = layerwiseAnnotations[layerIndex].concat(subtractedAnnotations);
            }
        },

        /**
         * Clear the current annotation.
         * @returns {void}
        */
        resetCurrentAnnotation: (): void => {
            currentAnnotation = createAnnotationStore(new PolygonAnnotation([], currentSegmentID));
        },

        /**
         * Remove an annotation from a layer by pointer to the annotation.
         * @param layerIndex - The index of the layer.
         * @param annotation - The annotation to remove.
         * @returns {void}
         */
        removeAnnotation: (layerIndex: number, annotation: PolygonAnnotation): void => {
            const index = layerwiseAnnotations[layerIndex].indexOf(annotation);
            if (index !== -1) {
                layerwiseAnnotations[layerIndex].splice(index, 1);
                layerwiseAnnotations[layerIndex] = layerwiseAnnotations[layerIndex].slice(); // Trigger reactivity
            }
        },

        /**
         * Trigger a draw of all annotations.
         * @param p - The p5 instance.
         * @param nav - The navigation store.
         * @returns {void}
         */
        draw: (p: p5, nav: NavigationStore) => {
            // Draw the annotations with bounds checking
            if (nav.layer >= 0 && nav.layer < layerwiseAnnotations.length) {
                layerwiseAnnotations[nav.layer].forEach((annotation) => {
                    annotation.draw(p, nav, this);
                });
            }
        }
    };
}

export type AnnotationManagerStore = ReturnType<typeof createAnnotationManagerStore>;