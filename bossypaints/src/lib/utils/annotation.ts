import type { AnnotationManagerStore } from "$lib/webpaint/stores/AnnotationManagerStore.svelte";

/**
 * Wrapper function for saving the current annotation.
 * 
 * @param annotationStore 
 * @param layerIndex 
 * @param mergeByID 
 */
export function saveSegment(annotationStore: AnnotationManagerStore, layerIndex: number, mergeByID: boolean = true) {
    annotationStore.currentAnnotation.annotation.editing = false;
    annotationStore.saveCurrentAndCreateNewAnnotation(layerIndex, mergeByID);
}

/**
 * Wrapper function for subtracting the current annotation.
 * 
 * @param annotationStore 
 * @param layerIndex 
 */
export function substractSegment(annotationStore: AnnotationManagerStore, layerIndex: number) {
    annotationStore.currentAnnotation.annotation.editing = false;
    annotationStore.subtractCurrentAnnotation(layerIndex);
}