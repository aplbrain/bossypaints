/**
 * @module AnnotationManagerStore
 * @description A store for managing annotations in a multi-layered volume.
 */
import PolygonAnnotation from '../PolygonAnnotation';
import type p5 from 'p5';
import { createAnnotationStore } from './PolygonAnnotationStore.svelte';
import polybool, { type Polygon } from '@velipso/polybool';
import type { NavigationStore } from './NavigationStore.svelte';
import { segmentIdToRGB } from '../colorutils';

/**
 * Create a store for managing annotations in a multi-layered volume.
 * @param numberOfLayers - The number of z-layers in the volume.
 * @param zOffset - Absolute z value corresponding to layer index 0.
 * @returns {AnnotationManagerStore}
 */
export function createAnnotationManagerStore(numberOfLayers: number, zOffset: number = 0) {
	const layerwiseAnnotations: Array<Array<PolygonAnnotation>> = $state(
		new Array(numberOfLayers).fill(0).map(() => [])
	);
	let currentSegmentID = $state(1);
	let currentAnnotation = createAnnotationStore(new PolygonAnnotation({}, currentSegmentID));
	let hoveredAnnotation: PolygonAnnotation | null = $state(null);
	const toLayerIndex = (z: number): number => z - zOffset;

	const store = {
		/**
		 * Get the raw annotations array.
		 * @returns {Array<Array<PolygonAnnotation>>}
		 */
		get annotations(): Array<Array<PolygonAnnotation>> {
			return layerwiseAnnotations;
		},

		/**
		 * Add an annotation to a layer.
		 * @param layerIndex - The index of the layer.
		 * @param annotation - The annotation to add.
		 * @returns {void}
		 */
		addAnnotation: (layerIndex: number, annotation: PolygonAnnotation): void => {
			const idx = toLayerIndex(layerIndex);
			annotation.z = layerIndex;
			if (idx < 0 || idx >= layerwiseAnnotations.length) {
				return;
			}
			if (layerwiseAnnotations[idx] === undefined) {
				layerwiseAnnotations[idx] = [];
			}
			layerwiseAnnotations[idx].push(annotation);
			layerwiseAnnotations[idx] = layerwiseAnnotations[idx].slice();
		},

		/**
		 * Get the annotations for a layer.
		 * @param layerIndex - The index of the layer.
		 * @returns {Array<PolygonAnnotation>}
		 */
		getLayerAnnotations: (layerIndex: number): Array<PolygonAnnotation> => {
			const idx = toLayerIndex(layerIndex);
			// Defensive programming: return empty array if layer index is out of bounds
			if (idx < 0 || idx >= layerwiseAnnotations.length) {
				return [];
			}
			return layerwiseAnnotations[idx];
		},

		getSegmentAnnotations: (layerIndex: number, segmentID: number): Array<PolygonAnnotation> => {
			return store
				.getLayerAnnotations(layerIndex)
				.filter((annotation) => annotation.segmentID === segmentID);
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
		get currentSegmentID(): number {
			return currentSegmentID;
		},

		/**
		 * Set the current segment ID.
		 * @param id - The new segment ID.
		 * @returns {void}
		 */
		setCurrentSegmentID: (id: number): void => {
			currentSegmentID = id;
			// Always update the current annotation's segment ID and color to match the new ID
			currentAnnotation.annotation.segmentID = currentSegmentID;
			currentAnnotation.annotation.color = segmentIdToRGB(currentSegmentID);
		},

		/**
		 * Increment the segment ID.
		 * @returns {void}
		 */
		incrementSegmentID: (): void => {
			currentSegmentID += 1;
			// Always update the current annotation's segment ID and color
			currentAnnotation.annotation.segmentID = currentSegmentID;
			currentAnnotation.annotation.color = segmentIdToRGB(currentSegmentID);
		},

		/**
		 * Decrement the segment ID.
		 * @returns {void}
		 */
		decrementSegmentID: (): void => {
			currentSegmentID = Math.max(1, currentSegmentID - 1);
			// Always update the current annotation's segment ID and color
			currentAnnotation.annotation.segmentID = currentSegmentID;
			currentAnnotation.annotation.color = segmentIdToRGB(currentSegmentID);
		},

		/**
		 * Get the current annotation.
		 */
		get currentAnnotation() {
			return currentAnnotation;
		},

		/**
		 * Get the hovered annotation.
		 */
		get hoveredAnnotation() {
			return hoveredAnnotation;
		},

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
			const idx = toLayerIndex(layerIndex);
			currentAnnotation.annotation.z = layerIndex;
			if (idx < 0 || idx >= layerwiseAnnotations.length) {
				return;
			}
			if (layerwiseAnnotations[idx] === undefined) {
				layerwiseAnnotations[idx] = [];
			}
			layerwiseAnnotations[idx].push(currentAnnotation.annotation);
			currentAnnotation = createAnnotationStore(
				new PolygonAnnotation({}, currentSegmentID, true, layerIndex)
			);

			if (mergeByID) {
				const sameIDAnnotations = (layerwiseAnnotations[idx] || []).filter(
					(a) => a.segmentID === currentSegmentID
				);

				if (sameIDAnnotations.length > 1) {
					let polyboolPolys: Polygon[] = sameIDAnnotations.map((a) => {
						// Use positive/negative regions for polybool operations
						const allRegions = [...a.positiveRegions, ...a.negativeRegions];
						return {
							regions: allRegions,
							inverted: false
						};
					});

					// Reduce using union operations
					let result: Polygon = polyboolPolys[0];
					for (let i = 1; i < polyboolPolys.length; i++) {
						result = polybool.union(result, polyboolPolys[i]);
					}

					// Create single PolygonAnnotation with positive/negative regions
					const mergedAnnotation = PolygonAnnotation.fromPolyboolRegions(
						result.regions as Array<Array<[number, number]>>,
						currentSegmentID,
						false,
						layerIndex
					);
					layerwiseAnnotations[idx] = layerwiseAnnotations[idx].filter(
						(a) => a.segmentID !== currentSegmentID
					);
					layerwiseAnnotations[idx].push(mergedAnnotation);
				}
			}
		},

		/**
		 * Subtract the current annotation from all annotations with the same segment ID.
		 * Useful for slicing chunks off of existing annotations.
		 * @param layerIndex - The index of the layer.
		 */
		subtractCurrentAnnotation: (layerIndex: number) => {
			const idx = toLayerIndex(layerIndex);
			if (idx < 0 || idx >= layerwiseAnnotations.length) {
				return;
			}
			const sameIDAnnotations = layerwiseAnnotations[idx].filter(
				(a) => a.segmentID === currentSegmentID
			);
			// Use the first positive region for subtraction (or empty array if none exists)
			const currentRegion = currentAnnotation.annotation.positiveRegions[0] || [];
			const subtractingAnnotation = { regions: [currentRegion], inverted: false };
			currentAnnotation = createAnnotationStore(
				new PolygonAnnotation({}, currentSegmentID, false, layerIndex)
			);

			if (sameIDAnnotations.length > 0) {
				// Step 1: First, union all existing annotations with the same segment ID into one shape
				let combinedExistingPolygon: Polygon;

				if (sameIDAnnotations.length === 1) {
					// Single annotation to subtract from
					const allRegions = [
						...sameIDAnnotations[0].positiveRegions,
						...sameIDAnnotations[0].negativeRegions
					];
					combinedExistingPolygon = {
						regions: allRegions,
						inverted: false
					};
				} else {
					// Multiple annotations - union them first
					let polyboolPolys: Polygon[] = sameIDAnnotations.map((a) => {
						const allRegions = [...a.positiveRegions, ...a.negativeRegions];
						return {
							regions: allRegions,
							inverted: false
						};
					});

					combinedExistingPolygon = polyboolPolys[0];
					for (let i = 1; i < polyboolPolys.length; i++) {
						combinedExistingPolygon = polybool.union(combinedExistingPolygon, polyboolPolys[i]);
					}
				}

				// Step 2: Subtract the current annotation from the combined shape
				const subtractedResult = polybool.difference(
					combinedExistingPolygon,
					subtractingAnnotation
				);

				console.log('Subtraction result:', {
					inputRegions: combinedExistingPolygon.regions.length,
					outputRegions: subtractedResult.regions.length,
					outputRegionSizes: subtractedResult.regions.map((r) => r.length)
				});

				// Step 3: Create a SINGLE PolygonAnnotation from the result with positive/negative regions
				const resultAnnotation = PolygonAnnotation.fromPolyboolRegions(
					subtractedResult.regions as Array<Array<[number, number]>>,
					currentSegmentID,
					false,
					layerIndex
				);

				console.log('Result annotation created with positive/negative regions:', {
					positiveRegions: resultAnnotation.positiveRegions.length,
					negativeRegions: resultAnnotation.negativeRegions.length
				});

				// Step 4: Replace all old annotations with the new single result annotation
				layerwiseAnnotations[idx] = layerwiseAnnotations[idx].filter(
					(a) => a.segmentID !== currentSegmentID
				);
				layerwiseAnnotations[idx].push(resultAnnotation);
			}
		},

		/**
		 * Clear the current annotation.
		 * @returns {void}
		 */
		resetCurrentAnnotation: (): void => {
			currentAnnotation = createAnnotationStore(new PolygonAnnotation({}, currentSegmentID));
		},

		/**
		 * Remove an annotation from a layer by pointer to the annotation.
		 * @param layerIndex - The index of the layer.
		 * @param annotation - The annotation to remove.
		 * @returns {void}
		 */
		removeAnnotation: (layerIndex: number, annotation: PolygonAnnotation): void => {
			const idx = toLayerIndex(layerIndex);
			if (idx < 0 || idx >= layerwiseAnnotations.length) {
				return;
			}
			const index = layerwiseAnnotations[idx].indexOf(annotation);
			if (index !== -1) {
				layerwiseAnnotations[idx].splice(index, 1);
				layerwiseAnnotations[idx] = layerwiseAnnotations[idx].slice(); // Trigger reactivity
			}
		},

		replaceSegmentAnnotations: (
			layerIndex: number,
			segmentID: number,
			annotations: Array<PolygonAnnotation>
		): void => {
			const idx = toLayerIndex(layerIndex);
			if (idx < 0 || idx >= layerwiseAnnotations.length) {
				return;
			}

			const otherAnnotations = layerwiseAnnotations[idx].filter(
				(annotation) => annotation.segmentID !== segmentID
			);
			const replacementAnnotations = annotations.map((annotation) => {
				annotation.z = layerIndex;
				return annotation;
			});

			layerwiseAnnotations[idx] = [...otherAnnotations, ...replacementAnnotations];
		},

		/**
		 * Trigger a draw of all annotations.
		 * @param p - The p5 instance.
		 * @param nav - The navigation store.
		 * @returns {void}
		 */
		draw: (p: p5, nav: NavigationStore) => {
			// Draw the annotations with bounds checking
			const idx = toLayerIndex(nav.layer);
			if (idx >= 0 && idx < layerwiseAnnotations.length) {
				layerwiseAnnotations[idx].forEach((annotation) => {
					annotation.draw(p, nav, store);
				});
			}
		}
	};

	return store;
}

export type AnnotationManagerStore = ReturnType<typeof createAnnotationManagerStore>;
