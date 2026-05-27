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
import { createSplitPreviewForLayer, type SplitBounds, type SplitModel } from '../split';

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
	let mergedSegmentGroups: Array<Array<number>> = $state([]);
	const toLayerIndex = (z: number): number => z - zOffset;

	function normalizeSegmentIDs(segmentIDs: Array<number>): Array<number> {
		return [
			...new Set(segmentIDs.filter((segmentID) => Number.isInteger(segmentID) && segmentID > 0))
		].sort((a, b) => a - b);
	}

	function sortMergedSegmentGroups(groups: Array<Array<number>>): Array<Array<number>> {
		return groups
			.map((group) => normalizeSegmentIDs(group))
			.filter((group) => group.length > 1)
			.sort((a, b) => a[0] - b[0]);
	}

	function getMergedGroupForSegmentID(segmentID: number): Array<number> | null {
		return mergedSegmentGroups.find((group) => group.includes(segmentID)) || null;
	}

	function getCanonicalSegmentIDForDisplay(segmentID: number): number {
		return getMergedGroupForSegmentID(segmentID)?.[0] ?? segmentID;
	}

	function getSegmentDisplayColor(segmentID: number): [number, number, number] {
		return segmentIdToRGB(getCanonicalSegmentIDForDisplay(segmentID));
	}

	function applyDisplayColor(annotation: PolygonAnnotation): PolygonAnnotation {
		annotation.color = getSegmentDisplayColor(annotation.segmentID);
		return annotation;
	}

	function refreshMergedColors() {
		layerwiseAnnotations.forEach((layerAnnotations) => {
			layerAnnotations.forEach((annotation) => {
				annotation.color = getSegmentDisplayColor(annotation.segmentID);
			});
		});
		currentAnnotation.annotation.color = getSegmentDisplayColor(currentSegmentID);
	}

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
			layerwiseAnnotations[idx].push(applyDisplayColor(annotation));
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

		get knownSegmentIDs(): Array<number> {
			return normalizeSegmentIDs([
				...layerwiseAnnotations.flat().map((annotation) => annotation.segmentID),
				...mergedSegmentGroups.flat(),
				currentSegmentID
			]);
		},

		get mergedSegmentGroups(): Array<Array<number>> {
			return mergedSegmentGroups.map((group) => [...group]);
		},

		getNextAvailableSegmentID: (): number => Math.max(0, ...store.knownSegmentIDs) + 1,

		getMergedSegmentGroups: (): Array<Array<number>> =>
			mergedSegmentGroups.map((group) => [...group]),

		setMergedSegmentGroups: (groups: Array<Array<number>>): void => {
			mergedSegmentGroups = sortMergedSegmentGroups(groups);
			refreshMergedColors();
		},

		getMergedGroup: (segmentID: number): Array<number> | null => {
			const group = getMergedGroupForSegmentID(segmentID);
			return group ? [...group] : null;
		},

		isSegmentMerged: (segmentID: number): boolean => getMergedGroupForSegmentID(segmentID) !== null,

		getCanonicalSegmentID: (segmentID: number): number =>
			getCanonicalSegmentIDForDisplay(segmentID),

		getSegmentColor: (segmentID: number): [number, number, number] =>
			getSegmentDisplayColor(segmentID),

		mergeSegments: (segmentIDs: Array<number>): void => {
			const normalizedSegmentIDs = normalizeSegmentIDs(segmentIDs);
			if (normalizedSegmentIDs.length < 2) {
				return;
			}

			const overlappingGroups = mergedSegmentGroups.filter((group) =>
				group.some((segmentID) => normalizedSegmentIDs.includes(segmentID))
			);
			const untouchedGroups = mergedSegmentGroups.filter(
				(group) => !group.some((segmentID) => normalizedSegmentIDs.includes(segmentID))
			);
			const mergedGroup = normalizeSegmentIDs([
				...normalizedSegmentIDs,
				...overlappingGroups.flat()
			]);

			mergedSegmentGroups = sortMergedSegmentGroups([...untouchedGroups, mergedGroup]);
			refreshMergedColors();
		},

		unmergeSegment: (segmentID: number): void => {
			const existingGroup = getMergedGroupForSegmentID(segmentID);
			if (!existingGroup) {
				return;
			}

			const remainingGroup = existingGroup.filter((id) => id !== segmentID);
			const nextGroups = mergedSegmentGroups.filter((group) => group !== existingGroup);
			mergedSegmentGroups = sortMergedSegmentGroups(
				remainingGroup.length > 1 ? [...nextGroups, remainingGroup] : nextGroups
			);
			refreshMergedColors();
		},

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
			currentAnnotation.annotation.color = getSegmentDisplayColor(currentSegmentID);
		},

		/**
		 * Increment the segment ID.
		 * @returns {void}
		 */
		incrementSegmentID: (): void => {
			currentSegmentID += 1;
			// Always update the current annotation's segment ID and color
			currentAnnotation.annotation.segmentID = currentSegmentID;
			currentAnnotation.annotation.color = getSegmentDisplayColor(currentSegmentID);
		},

		/**
		 * Decrement the segment ID.
		 * @returns {void}
		 */
		decrementSegmentID: (): void => {
			currentSegmentID = Math.max(1, currentSegmentID - 1);
			// Always update the current annotation's segment ID and color
			currentAnnotation.annotation.segmentID = currentSegmentID;
			currentAnnotation.annotation.color = getSegmentDisplayColor(currentSegmentID);
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
			layerwiseAnnotations[idx].push(applyDisplayColor(currentAnnotation.annotation));
			currentAnnotation = createAnnotationStore(
				new PolygonAnnotation({}, currentSegmentID, true, layerIndex)
			);
			currentAnnotation.annotation.color = getSegmentDisplayColor(currentSegmentID);

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
					layerwiseAnnotations[idx].push(applyDisplayColor(mergedAnnotation));
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
			currentAnnotation.annotation.color = getSegmentDisplayColor(currentSegmentID);

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
				layerwiseAnnotations[idx].push(applyDisplayColor(resultAnnotation));
			}
		},

		/**
		 * Clear the current annotation.
		 * @returns {void}
		 */
		resetCurrentAnnotation: (): void => {
			currentAnnotation = createAnnotationStore(new PolygonAnnotation({}, currentSegmentID));
			currentAnnotation.annotation.color = getSegmentDisplayColor(currentSegmentID);
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
				return applyDisplayColor(annotation);
			});

			layerwiseAnnotations[idx] = [...otherAnnotations, ...replacementAnnotations];
		},

		replaceSegmentAcrossLayers: ({
			sourceSegmentID,
			annotations
		}: {
			sourceSegmentID: number;
			annotations: Array<PolygonAnnotation>;
		}): number => {
			const annotationsByLayer = new Map<number, Array<PolygonAnnotation>>();
			annotations.forEach((annotation) => {
				const layerAnnotations = annotationsByLayer.get(annotation.z) ?? [];
				layerAnnotations.push(annotation);
				annotationsByLayer.set(annotation.z, layerAnnotations);
			});

			const touchedLayerIndices = new Set<number>();
			layerwiseAnnotations.forEach((layerAnnotations, layerArrayIndex) => {
				if (layerAnnotations.some((annotation) => annotation.segmentID === sourceSegmentID)) {
					touchedLayerIndices.add(layerArrayIndex);
				}
			});
			annotationsByLayer.forEach((_, absoluteZ) => {
				const layerArrayIndex = toLayerIndex(absoluteZ);
				if (layerArrayIndex >= 0 && layerArrayIndex < layerwiseAnnotations.length) {
					touchedLayerIndices.add(layerArrayIndex);
				}
			});

			if (touchedLayerIndices.size === 0) {
				return 0;
			}

			touchedLayerIndices.forEach((layerArrayIndex) => {
				const absoluteZ = layerArrayIndex + zOffset;
				const otherAnnotations = layerwiseAnnotations[layerArrayIndex].filter(
					(annotation) => annotation.segmentID !== sourceSegmentID
				);
				const replacementAnnotations = (annotationsByLayer.get(absoluteZ) ?? []).map(
					(annotation) => {
						annotation.z = absoluteZ;
						return applyDisplayColor(annotation);
					}
				);

				layerwiseAnnotations[layerArrayIndex] = [...otherAnnotations, ...replacementAnnotations];
			});

			hoveredAnnotation = null;
			currentAnnotation = createAnnotationStore(new PolygonAnnotation({}, currentSegmentID, true));
			currentAnnotation.annotation.color = getSegmentDisplayColor(currentSegmentID);
			refreshMergedColors();
			return touchedLayerIndices.size;
		},

		splitSegmentAcrossLayers: ({
			sourceSegmentID,
			newSegmentID,
			model,
			bounds
		}: {
			sourceSegmentID: number;
			newSegmentID: number;
			model: SplitModel;
			bounds: SplitBounds;
		}): {
			applied: boolean;
			modifiedLayerCount: number;
			redLayerCount: number;
			blueLayerCount: number;
		} => {
			const layerReplacements: Array<{
				layerArrayIndex: number;
				absoluteZ: number;
				replacements: Array<PolygonAnnotation>;
			}> = [];
			let redLayerCount = 0;
			let blueLayerCount = 0;

			for (
				let layerArrayIndex = 0;
				layerArrayIndex < layerwiseAnnotations.length;
				layerArrayIndex += 1
			) {
				const absoluteZ = layerArrayIndex + zOffset;
				const sameIDAnnotations = layerwiseAnnotations[layerArrayIndex].filter(
					(annotation) => annotation.segmentID === sourceSegmentID
				);
				if (sameIDAnnotations.length === 0) {
					continue;
				}

				const preview = createSplitPreviewForLayer({
					annotations: sameIDAnnotations,
					sourceSegmentID,
					newSegmentID,
					model,
					bounds,
					z: absoluteZ
				});
				const replacements = [preview.red, preview.blue].filter(
					(annotation): annotation is PolygonAnnotation => annotation !== null
				);

				if (replacements.length === 0) {
					continue;
				}

				if (preview.red) {
					redLayerCount += 1;
				}
				if (preview.blue) {
					blueLayerCount += 1;
				}

				layerReplacements.push({
					layerArrayIndex,
					absoluteZ,
					replacements
				});
			}

			if (layerReplacements.length === 0 || redLayerCount === 0 || blueLayerCount === 0) {
				return {
					applied: false,
					modifiedLayerCount: 0,
					redLayerCount,
					blueLayerCount
				};
			}

			for (const replacement of layerReplacements) {
				const otherAnnotations = layerwiseAnnotations[replacement.layerArrayIndex].filter(
					(annotation) => annotation.segmentID !== sourceSegmentID
				);
				const replacementAnnotations = replacement.replacements.map((annotation) => {
					annotation.z = replacement.absoluteZ;
					return applyDisplayColor(annotation);
				});

				layerwiseAnnotations[replacement.layerArrayIndex] = [
					...otherAnnotations,
					...replacementAnnotations
				];
			}

			hoveredAnnotation = null;
			currentAnnotation = createAnnotationStore(new PolygonAnnotation({}, currentSegmentID, true));
			currentAnnotation.annotation.color = getSegmentDisplayColor(currentSegmentID);
			refreshMergedColors();

			return {
				applied: true,
				modifiedLayerCount: layerReplacements.length,
				redLayerCount,
				blueLayerCount
			};
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
