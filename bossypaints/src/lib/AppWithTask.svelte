<script lang="ts">
	import MergePanel from '$lib/MergePanel.svelte';
	import PaintApp from '$lib/webpaint/components/PaintApp.svelte';
	import InfoTable from '$lib/webpaint/components/InfoTable.svelte';
	import KeybindingsTable from '$lib/webpaint/components/KeybindingsTable.svelte';
	import {
		createAnnotationManagerStore,
		type AnnotationManagerStore
	} from '$lib/webpaint/stores/AnnotationManagerStore.svelte';
	import {
		createNavigationStore,
		type NavigationStore
	} from '$lib/webpaint/stores/NavigationStore.svelte';
	import { goto } from '$app/navigation';
	import API, { type PolygonAnnotationPayload, type TaskInDB } from '$lib/api';
	import { Notyf } from 'notyf';
	import 'notyf/notyf.min.css';
	import PolygonAnnotation from '$lib/webpaint/PolygonAnnotation';
	import { onMount, onDestroy } from 'svelte';
	import { type SplitMethod, type SplitSeed, type SplitSeedLabel } from '$lib/webpaint/split';
	import {
		AnnotationIcon,
		CheckIcon,
		HelpIcon,
		LockIcon,
		InfoIcon,
		DownloadIcon,
		CloseIcon
	} from '$lib/icons';
	import { substractSegment, saveSegment } from './utils/annotation';

	const notyf = new Notyf();
	type AdjacentDirection = -1 | 1;
	type CheckpointSubmission = {
		checkpoint: Array<PolygonAnnotationPayload>;
		mergeGroups: Array<Array<number>>;
	};

	export let task: TaskInDB;
	let annotationStore: AnnotationManagerStore;
	let nav: NavigationStore;
	let showKeybindings = false;
	let showInfo = true;
	let showMerges = false;
	let currentSegmentColor: [number, number, number] = [59, 130, 246];
	let splitModeActive = false;
	let splitTargetSegmentID: number | null = null;
	let splitPreviewSegmentID: number | null = null;
	let splitMethod: SplitMethod = 'linear';
	let splitSeedColor: SplitSeedLabel = 'red';
	let splitSeeds: Array<SplitSeed> = [];
	let splitSeedIDCounter = 1;
	let splitPreviewAnnotations: Array<PolygonAnnotation> = [];
	let splitPreviewLoading = false;
	let splitPreviewError: string | null = null;
	let splitPreviewMeta: Record<string, unknown> | null = null;
	let latestSplitPreviewRequestID = 0;
	let lastSplitPreviewRequestKey = '';
	let splitSeedCounts = { red: 0, blue: 0 };
	let canApplySplit = false;
	const CHECKPOINT_DEBOUNCE_MS = 1000;
	let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
	let checkpointInFlight = false;
	let queuedCheckpoint: CheckpointSubmission | null = null;

	// Navigation confirmation modal
	let showNavigationModal = false;
	let pendingNavigation: (() => void) | null = null;
	let hasUnsavedChanges = false;
	let lastCheckpointState = '';
	let lastVisitedLayer: number | null = null;
	let trackedLayer: number | null = null;
	let isPropagatingSegment = false;
	let latestPropagationRequestID = 0;
	let propagationMode = 'RW';
	const SEGMENT_PROPAGATION_METHOD = 'random_walker';
	const SEGMENT_PROPAGATION_LABEL = 'Propagate from last slice';
	const PROPAGATION_MODE_OPTIONS = ['RW'];

	// Histogram window state (default 8-bit window)
	let histMin = 0;
	let histMax = 255;

	const SPLIT_METHOD_LABELS: Record<SplitMethod, string> = {
		linear: 'Linear',
		geodesic: 'Geodesic',
		graph_cut: 'Graph Cut'
	};

	function handleHistogramChange(min: number, max: number) {
		// Ensure ordered and within reasonable bounds
		const newMin = Math.max(0, Math.min(min, max));
		const newMax = Math.max(newMin, Math.min(max, 65535));
		histMin = newMin;
		histMax = newMax;
	}

	function resetSplitState() {
		latestSplitPreviewRequestID += 1;
		lastSplitPreviewRequestKey = '';
		splitModeActive = false;
		splitTargetSegmentID = null;
		splitPreviewSegmentID = null;
		splitSeedColor = 'red';
		splitSeeds = [];
		splitSeedIDCounter = 1;
		splitPreviewAnnotations = [];
		splitPreviewLoading = false;
		splitPreviewError = null;
		splitPreviewMeta = null;
	}

	function startSplitMode() {
		if (!annotationStore) {
			return;
		}

		splitTargetSegmentID = annotationStore.currentSegmentID;
		splitPreviewSegmentID = annotationStore.getNextAvailableSegmentID();
		splitSeedColor = 'red';
		splitSeeds = [];
		splitPreviewAnnotations = [];
		splitPreviewLoading = false;
		splitPreviewError = null;
		splitPreviewMeta = null;
		lastSplitPreviewRequestKey = '';
		splitModeActive = true;
		showMerges = true;
		annotationStore.setCurrentSegmentID(splitTargetSegmentID);
		notyf.success(`Split mode active for segment ${splitTargetSegmentID}.`);
	}

	function cancelSplitMode() {
		if (!splitModeActive) {
			return;
		}

		resetSplitState();
	}

	function addSplitSeed(point: { x: number; y: number; z: number }) {
		if (!annotationStore || !splitModeActive || splitTargetSegmentID === null) {
			return;
		}

		const targetAnnotations = annotationStore.getSegmentAnnotations(point.z, splitTargetSegmentID);
		const isInsideTargetSegment = targetAnnotations.some((annotation) =>
			annotation.pointIsInside([point.x, point.y])
		);
		if (!isInsideTargetSegment) {
			notyf.error(`Split seeds must be placed on segment ${splitTargetSegmentID}.`);
			return;
		}

		splitSeeds = [
			...splitSeeds,
			{
				id: splitSeedIDCounter,
				x: point.x,
				y: point.y,
				z: point.z,
				label: splitSeedColor
			}
		];
		splitSeedIDCounter += 1;
	}

	function undoSplitSeed() {
		if (splitSeeds.length === 0) {
			return;
		}

		splitSeeds = splitSeeds.slice(0, -1);
	}

	function clearSplitSeeds() {
		splitSeeds = [];
	}

	function removeSplitSeed(seedID: number) {
		splitSeeds = splitSeeds.filter((seed) => seed.id !== seedID);
	}

	function getSplitSourcePolygons(segmentID: number): Array<PolygonAnnotationPayload> {
		return annotationStore
			.getAllAnnotations()
			.filter((annotation) => annotation.segmentID === segmentID)
			.map(annotationToPayload);
	}

	async function requestSplitPreview(previewKey: string) {
		if (!annotationStore || splitTargetSegmentID === null || splitPreviewSegmentID === null) {
			return;
		}

		const sourcePolygons = getSplitSourcePolygons(splitTargetSegmentID);
		if (sourcePolygons.length === 0) {
			splitPreviewLoading = false;
			splitPreviewError = `No saved polygons found for segment ${splitTargetSegmentID}.`;
			splitPreviewAnnotations = [];
			splitPreviewMeta = null;
			return;
		}

		const requestID = latestSplitPreviewRequestID + 1;
		latestSplitPreviewRequestID = requestID;
		splitPreviewLoading = true;
		splitPreviewError = null;
		splitPreviewMeta = null;
		splitPreviewAnnotations = [];

		try {
			const response = await API.splitSegment({
				taskId: task.id,
				method: splitMethod,
				segmentID: splitTargetSegmentID,
				newSegmentID: splitPreviewSegmentID,
				sourcePolygons,
				seeds: splitSeeds
			});

			if (
				requestID !== latestSplitPreviewRequestID ||
				!splitModeActive ||
				previewKey !== lastSplitPreviewRequestKey
			) {
				return;
			}

			splitPreviewAnnotations = response.polygons.map(polygonPayloadToAnnotation);
			splitPreviewMeta = response.meta || null;
			if (splitPreviewAnnotations.length === 0) {
				splitPreviewError = 'The current split preview is empty.';
			}
		} catch (error) {
			if (requestID !== latestSplitPreviewRequestID || previewKey !== lastSplitPreviewRequestKey) {
				return;
			}
			splitPreviewError =
				error instanceof Error ? error.message : 'Failed to compute the 3D split preview.';
		} finally {
			if (requestID === latestSplitPreviewRequestID && previewKey === lastSplitPreviewRequestKey) {
				splitPreviewLoading = false;
			}
		}
	}

	function applySplit() {
		if (
			!annotationStore ||
			!splitModeActive ||
			splitTargetSegmentID === null ||
			splitPreviewSegmentID === null ||
			splitPreviewAnnotations.length === 0
		) {
			return;
		}

		const modifiedLayerCount = annotationStore.replaceSegmentAcrossLayers({
			sourceSegmentID: splitTargetSegmentID,
			annotations: splitPreviewAnnotations
		});
		if (modifiedLayerCount === 0) {
			notyf.error('The current split does not separate the selected segment.');
			return;
		}

		queueCheckpoint(buildCheckpointSubmission());
		hasUnsavedChanges = checkForUnsavedChanges();
		annotationStore.setCurrentSegmentID(splitTargetSegmentID);
		const methodLabel = SPLIT_METHOD_LABELS[splitMethod];
		const previewSliceCounts = splitPreviewMeta?.slice_counts;
		const previewModifiedSliceCount =
			previewSliceCounts &&
			typeof previewSliceCounts === 'object' &&
			'modified' in previewSliceCounts &&
			typeof previewSliceCounts['modified'] === 'number'
				? previewSliceCounts['modified']
				: modifiedLayerCount;
		notyf.success(
			`Split segment ${splitTargetSegmentID} into ${splitTargetSegmentID} and ${splitPreviewSegmentID} across ${previewModifiedSliceCount} slices with ${methodLabel}.`
		);
		resetSplitState();
	}

	function annotationToPayload(annotation: PolygonAnnotation): PolygonAnnotationPayload {
		return {
			positiveRegions: annotation.positiveRegions.map((region) =>
				region.map(([x, y]) => [x, y] as [number, number])
			),
			negativeRegions: annotation.negativeRegions.map((region) =>
				region.map(([x, y]) => [x, y] as [number, number])
			),
			editing: annotation.editing,
			segmentID: annotation.segmentID,
			color: annotation.color ? [...annotation.color] : null,
			z: annotation.z
		};
	}

	function buildCheckpointSubmission(
		annotations: Array<PolygonAnnotation> = annotationStore.getAllAnnotations()
	): CheckpointSubmission {
		return {
			checkpoint: annotations.map(annotationToPayload),
			mergeGroups: annotationStore.getMergedSegmentGroups()
		};
	}

	function serializeCheckpointSubmission(submission: CheckpointSubmission): string {
		return JSON.stringify(submission);
	}

	// Function to check if there are unsaved changes
	function checkForUnsavedChanges() {
		if (!annotationStore) return false;
		return serializeCheckpointSubmission(buildCheckpointSubmission()) !== lastCheckpointState;
	}

	// Function to handle navigation with confirmation
	function handleNavigation(navigationFn: () => void) {
		hasUnsavedChanges = checkForUnsavedChanges();

		if (hasUnsavedChanges) {
			pendingNavigation = navigationFn;
			showNavigationModal = true;
		} else {
			navigationFn();
		}
	}

	// Function to confirm navigation (discard changes)
	function confirmNavigation() {
		showNavigationModal = false;
		if (pendingNavigation) {
			pendingNavigation();
			pendingNavigation = null;
		}
	}

	// Function to cancel navigation
	function cancelNavigation() {
		showNavigationModal = false;
		pendingNavigation = null;
	}

	// Function to save and then navigate
	async function saveAndNavigate() {
		try {
			const payload = buildCheckpointSubmission();
			await API.checkpointTask({
				taskId: task.id,
				...payload
			});

			// Update last checkpoint to current state
			lastCheckpointState = serializeCheckpointSubmission(payload);
			hasUnsavedChanges = false;

			notyf.success('Changes saved successfully!');

			// Proceed with navigation after a brief delay
			setTimeout(() => {
				if (pendingNavigation) {
					pendingNavigation();
					pendingNavigation = null;
				}
				showNavigationModal = false;
			}, 500);
		} catch (error) {
			notyf.error('Failed to save changes. Please try again.');
			console.error('Save failed:', error);
		}
	}

	async function runCheckpoint() {
		if (checkpointInFlight || !queuedCheckpoint) return;
		checkpointInFlight = true;
		const payload = queuedCheckpoint;
		queuedCheckpoint = null;

		try {
			await API.checkpointTask({ taskId: task.id, ...payload });
			lastCheckpointState = serializeCheckpointSubmission(payload);
			hasUnsavedChanges = false;
			notyf.success('Checkpoint saved.');
		} catch (error) {
			notyf.error('Failed to save checkpoint. Please try again.');
			console.error('Checkpoint failed:', error);
		} finally {
			checkpointInFlight = false;
			if (queuedCheckpoint) {
				runCheckpoint();
			}
		}
	}

	function queueCheckpoint(payload: CheckpointSubmission) {
		queuedCheckpoint = payload;
		if (checkpointTimer) {
			clearTimeout(checkpointTimer);
		}
		checkpointTimer = setTimeout(() => {
			checkpointTimer = null;
			runCheckpoint();
		}, CHECKPOINT_DEBOUNCE_MS);
	}

	function layerHasSegment(layer: number, segmentID: number): boolean {
		return annotationStore.getSegmentAnnotations(layer, segmentID).length > 0;
	}

	function getAdjacentSegmentSourceLayer(): number | null {
		if (!annotationStore || !nav) return null;

		const currentLayer = nav.layer;
		const segmentID = annotationStore.currentSegmentID;
		const lowerLayer = currentLayer - 1;
		const upperLayer = currentLayer + 1;
		const lowerHasSegment = lowerLayer >= nav.minLayer && layerHasSegment(lowerLayer, segmentID);
		const upperHasSegment = upperLayer < nav.maxLayer && layerHasSegment(upperLayer, segmentID);

		if (
			lastVisitedLayer !== null &&
			(lastVisitedLayer === lowerLayer || lastVisitedLayer === upperLayer) &&
			layerHasSegment(lastVisitedLayer, segmentID)
		) {
			return lastVisitedLayer;
		}

		if (lowerHasSegment && !upperHasSegment) {
			return lowerLayer;
		}
		if (!lowerHasSegment && upperHasSegment) {
			return upperLayer;
		}
		if (lowerHasSegment && upperHasSegment) {
			return lowerLayer;
		}
		return null;
	}

	function getAdjacentTargetLayer(direction: AdjacentDirection): number | null {
		if (!nav) return null;

		const targetLayer = nav.layer + direction;
		if (targetLayer < nav.minLayer || targetLayer >= nav.maxLayer) {
			return null;
		}
		return targetLayer;
	}

	function getDirectionLabel(direction: AdjacentDirection): 'previous' | 'next' {
		return direction < 0 ? 'previous' : 'next';
	}

	function getSavedSegmentAnnotations(layer: number, segmentID: number): Array<PolygonAnnotation> {
		if (!annotationStore) return [];
		return annotationStore.getSegmentAnnotations(layer, segmentID);
	}

	function replaceSegmentFromSourceLayer(
		sourceLayer: number,
		targetLayer: number,
		segmentID: number,
		sourceAnnotations: Array<PolygonAnnotation>
	) {
		const copiedAnnotations = sourceAnnotations.map((annotation) =>
			annotation.cloneToLayer(targetLayer, false)
		);

		annotationStore.replaceSegmentAnnotations(targetLayer, segmentID, copiedAnnotations);
		annotationStore.resetCurrentAnnotation();
		hasUnsavedChanges = checkForUnsavedChanges();
	}

	function copyCurrentSegmentFromLastSlice() {
		if (!annotationStore || !nav || isPropagatingSegment || splitModeActive) return;

		const sourceLayer = getAdjacentSegmentSourceLayer();
		const targetLayer = nav.layer;
		const segmentID = annotationStore.currentSegmentID;

		if (sourceLayer === null) {
			notyf.error(`No nearby slice contains segment ${segmentID}.`);
			return;
		}

		const sourceAnnotations = getSavedSegmentAnnotations(sourceLayer, segmentID);
		if (sourceAnnotations.length === 0) {
			notyf.error(`No annotations found for segment ${segmentID} on z ${sourceLayer}.`);
			return;
		}

		replaceSegmentFromSourceLayer(sourceLayer, targetLayer, segmentID, sourceAnnotations);
		notyf.success(`Copied segment ${segmentID} from z ${sourceLayer} to z ${targetLayer}.`);
	}

	function copyCurrentSegmentToAdjacentSlice(direction: AdjacentDirection) {
		if (!annotationStore || !nav || isPropagatingSegment || splitModeActive) return;

		const sourceLayer = nav.layer;
		const targetLayer = getAdjacentTargetLayer(direction);
		const segmentID = annotationStore.currentSegmentID;

		if (targetLayer === null) {
			notyf.error(`No ${getDirectionLabel(direction)} slice is available from z ${sourceLayer}.`);
			return;
		}

		const sourceAnnotations = getSavedSegmentAnnotations(sourceLayer, segmentID);
		if (sourceAnnotations.length === 0) {
			notyf.error(`No annotations found for segment ${segmentID} on z ${sourceLayer}.`);
			return;
		}

		replaceSegmentFromSourceLayer(sourceLayer, targetLayer, segmentID, sourceAnnotations);
		nav.setLayer(targetLayer);
		notyf.success(`Copied segment ${segmentID} from z ${sourceLayer} to z ${targetLayer}.`);
	}

	function polygonPayloadToAnnotation(annotation: PolygonAnnotationPayload): PolygonAnnotation {
		return new PolygonAnnotation(
			{
				positiveRegions: annotation.positiveRegions,
				negativeRegions: annotation.negativeRegions || []
			},
			annotation.segmentID,
			false,
			annotation.z
		);
	}

	async function propagateCurrentSegmentFromLastSlice() {
		if (!annotationStore || !nav || splitModeActive) return;

		const sourceLayer = getAdjacentSegmentSourceLayer();
		const targetLayer = nav.layer;
		const segmentID = annotationStore.currentSegmentID;

		if (sourceLayer === null) {
			notyf.error(`No nearby slice contains segment ${segmentID}.`);
			return;
		}

		await propagateSegmentBetweenLayers({
			sourceLayer,
			targetLayer,
			segmentID,
			expectedLayerAtResponse: targetLayer,
			navigateToTargetOnSuccess: false
		});
	}

	async function propagateCurrentSegmentToAdjacentSlice(direction: AdjacentDirection) {
		if (!annotationStore || !nav || isPropagatingSegment || splitModeActive) return;

		const sourceLayer = nav.layer;
		const targetLayer = getAdjacentTargetLayer(direction);
		const segmentID = annotationStore.currentSegmentID;

		if (targetLayer === null) {
			notyf.error(`No ${getDirectionLabel(direction)} slice is available from z ${sourceLayer}.`);
			return;
		}

		await propagateSegmentBetweenLayers({
			sourceLayer,
			targetLayer,
			segmentID,
			expectedLayerAtResponse: sourceLayer,
			navigateToTargetOnSuccess: true
		});
	}

	async function propagateSegmentBetweenLayers({
		sourceLayer,
		targetLayer,
		segmentID,
		expectedLayerAtResponse,
		navigateToTargetOnSuccess
	}: {
		sourceLayer: number;
		targetLayer: number;
		segmentID: number;
		expectedLayerAtResponse: number;
		navigateToTargetOnSuccess: boolean;
	}) {
		if (!annotationStore || !nav || isPropagatingSegment || splitModeActive) return;

		const sourceAnnotations = getSavedSegmentAnnotations(sourceLayer, segmentID);
		if (sourceAnnotations.length === 0) {
			notyf.error(`No annotations found for segment ${segmentID} on z ${sourceLayer}.`);
			return;
		}

		const requestID = latestPropagationRequestID + 1;
		latestPropagationRequestID = requestID;
		isPropagatingSegment = true;

		const targetAnnotationsSnapshot = JSON.stringify(
			annotationStore.getSegmentAnnotations(targetLayer, segmentID)
		);
		const draftSnapshot = JSON.stringify(annotationStore.currentAnnotation.annotation);

		try {
			const response = await API.propagateSegment({
				taskId: task.id,
				method: SEGMENT_PROPAGATION_METHOD,
				sourceZ: sourceLayer,
				targetZ: targetLayer,
				segmentID,
				sourcePolygons: sourceAnnotations
			});

			const targetStillMatches =
				nav.layer === expectedLayerAtResponse &&
				annotationStore.currentSegmentID === segmentID &&
				JSON.stringify(annotationStore.getSegmentAnnotations(targetLayer, segmentID)) ===
					targetAnnotationsSnapshot &&
				JSON.stringify(annotationStore.currentAnnotation.annotation) === draftSnapshot;

			if (requestID !== latestPropagationRequestID || !targetStillMatches) {
				console.info('Discarded propagation result because the target slice state changed.');
				return;
			}

			const propagatedAnnotations = response.polygons.map(polygonPayloadToAnnotation);
			annotationStore.replaceSegmentAnnotations(targetLayer, segmentID, propagatedAnnotations);
			annotationStore.resetCurrentAnnotation();
			hasUnsavedChanges = checkForUnsavedChanges();
			if (navigateToTargetOnSuccess) {
				nav.setLayer(targetLayer);
			}
			notyf.success(
				`Propagated segment ${segmentID} from z ${sourceLayer} to z ${targetLayer} with ${response.display_name}.`
			);
		} catch (error) {
			console.error('Segment propagation failed:', error);
			notyf.error(
				error instanceof Error ? error.message : 'Failed to propagate the active segment.'
			);
		} finally {
			if (requestID === latestPropagationRequestID) {
				isPropagatingSegment = false;
			}
		}
	}

	async function loadTask() {
		annotationStore = createAnnotationManagerStore(
			Math.max(1, task.z_max - task.z_min),
			task.z_min
		);
		nav = createNavigationStore({
			minLayer: task.z_min,
			maxLayer: task.z_max,
			layer: Math.floor((task.z_max + task.z_min) / 2),
			imageWidth: task.x_max - task.x_min,
			imageHeight: task.y_max - task.y_min
		});

		let checkpointResponse = await API.getTaskCheckpoints(task.id);
		if (checkpointResponse.checkpoints) {
			checkpointResponse.checkpoints.forEach((checkpoint) => {
				checkpoint.polygons.forEach((annotation) => {
					// Use the new positive/negative regions format
					const polygonAnnotation = new PolygonAnnotation(
						{
							positiveRegions: annotation.positiveRegions,
							negativeRegions: annotation.negativeRegions || []
						},
						annotation.segmentID,
						annotation.editing,
						annotation.z
					);

					annotationStore.addAnnotation(annotation.z, polygonAnnotation);
				});
			});

			const latestCheckpoint =
				checkpointResponse.checkpoints[checkpointResponse.checkpoints.length - 1];
			annotationStore.setMergedSegmentGroups(latestCheckpoint?.mergeGroups || []);
		}

		// Set initial checkpoint state after loading
		lastCheckpointState = serializeCheckpointSubmission(buildCheckpointSubmission());
		hasUnsavedChanges = false;
	}

	function calculatePolygonArea(points: Array<[number, number]>) {
		let n = points.length;
		let area = 0;

		for (let i = 0; i < n; i++) {
			let [x1, y1] = points[i];
			let [x2, y2] = points[(i + 1) % n]; // Wrap around to the first point
			area += x1 * y2 - y1 * x2;
		}

		return Math.abs(area) / 2;
	}

	function getPercentageComplete(task: TaskInDB, annoStore: AnnotationManagerStore) {
		// Using the shoelace formula for area.
		const totalArea =
			(task.x_max - task.x_min) * (task.y_max - task.y_min) * (task.z_max - task.z_min);
		let annotatedArea = 0;
		annoStore.getAllAnnotations().forEach((annotation) => {
			// Calculate total positive area
			let positiveArea = 0;
			annotation.positiveRegions.forEach((region) => {
				positiveArea += calculatePolygonArea(region);
			});

			// Subtract negative area (holes)
			let negativeArea = 0;
			annotation.negativeRegions.forEach((region) => {
				negativeArea += calculatePolygonArea(region);
			});

			// Net area for this annotation
			const netArea = positiveArea - negativeArea;
			annotatedArea += Math.max(0, netArea); // Ensure non-negative
		});
		return (annotatedArea / totalArea) * 100;
	}

	function handleSelectSegmentID(segmentID: number) {
		if (splitModeActive) {
			return;
		}
		annotationStore.setCurrentSegmentID(segmentID);
	}

	function handleMergeSegments(segmentIDs: Array<number>) {
		if (!annotationStore || splitModeActive || segmentIDs.length < 2) {
			return;
		}

		annotationStore.mergeSegments(segmentIDs);
		queueCheckpoint(buildCheckpointSubmission());
		hasUnsavedChanges = checkForUnsavedChanges();
		notyf.success(`Merged IDs ${segmentIDs.join(', ')} under segment ${segmentIDs[0]}.`);
	}

	function handleUnmergeSegment(segmentID: number) {
		if (!annotationStore || splitModeActive || !annotationStore.isSegmentMerged(segmentID)) {
			return;
		}

		annotationStore.unmergeSegment(segmentID);
		queueCheckpoint(buildCheckpointSubmission());
		hasUnsavedChanges = checkForUnsavedChanges();
		notyf.success(`Unmerged ID ${segmentID}.`);
	}

	loadTask();

	$: if (nav) {
		const currentLayer = nav.layer;
		if (trackedLayer === null) {
			trackedLayer = currentLayer;
		} else if (trackedLayer !== currentLayer) {
			lastVisitedLayer = trackedLayer;
			trackedLayer = currentLayer;
		}
	}

	$: splitSeedCounts = splitSeeds.reduce(
		(counts, seed) => {
			if (seed.label === 'red') {
				counts.red += 1;
			} else {
				counts.blue += 1;
			}
			return counts;
		},
		{ red: 0, blue: 0 }
	);
	$: canApplySplit =
		splitModeActive &&
		!splitPreviewLoading &&
		splitTargetSegmentID !== null &&
		splitPreviewSegmentID !== null &&
		splitPreviewAnnotations.some((annotation) => annotation.segmentID === splitTargetSegmentID) &&
		splitPreviewAnnotations.some((annotation) => annotation.segmentID === splitPreviewSegmentID);

	$: {
		const nextSplitPreviewRequestKey =
			splitModeActive &&
			annotationStore &&
			splitTargetSegmentID !== null &&
			splitPreviewSegmentID !== null &&
			splitSeedCounts.red > 0 &&
			splitSeedCounts.blue > 0
				? JSON.stringify({
						method: splitMethod,
						targetSegmentID: splitTargetSegmentID,
						newSegmentID: splitPreviewSegmentID,
						seeds: splitSeeds.map(({ x, y, z, label }) => ({ x, y, z, label }))
					})
				: '';

		if (!nextSplitPreviewRequestKey) {
			if (lastSplitPreviewRequestKey !== '' || splitPreviewLoading) {
				latestSplitPreviewRequestID += 1;
			}
			lastSplitPreviewRequestKey = '';
			splitPreviewAnnotations = [];
			splitPreviewLoading = false;
			splitPreviewError = null;
			splitPreviewMeta = null;
		} else if (nextSplitPreviewRequestKey !== lastSplitPreviewRequestKey) {
			lastSplitPreviewRequestKey = nextSplitPreviewRequestKey;
			splitPreviewAnnotations = [];
			splitPreviewLoading = false;
			splitPreviewError = null;
			splitPreviewMeta = null;
			void requestSplitPreview(nextSplitPreviewRequestKey);
		}
	}

	$: if (
		splitModeActive &&
		annotationStore &&
		splitTargetSegmentID !== null &&
		annotationStore.currentSegmentID !== splitTargetSegmentID
	) {
		annotationStore.setCurrentSegmentID(splitTargetSegmentID);
	}

	$: currentSegmentColor = annotationStore
		? annotationStore.getSegmentColor(annotationStore.currentSegmentID)
		: ([59, 130, 246] as [number, number, number]);

	// Set up paint app body styles on mount and clean up on destroy
	onMount(() => {
		// Apply paint app specific styles
		document.body.style.margin = '0';
		document.body.style.padding = '0';
		document.body.style.overflow = 'hidden';
	});

	onDestroy(() => {
		// Restore normal body styles when leaving paint app
		document.body.style.margin = '';
		document.body.style.padding = '';
		document.body.style.overflow = '';
		if (checkpointTimer) {
			clearTimeout(checkpointTimer);
			checkpointTimer = null;
		}
	});
</script>

<div class="w-full" role="presentation" oncontextmenu={(event) => event.preventDefault()}>
	{#if task && annotationStore && nav}
		<PaintApp
			{annotationStore}
			{nav}
			datasetURI={task.data_source_type === 'cloudvolume'
				? task.cloudvolume_uri || ''
				: `${task.collection}/${task.experiment}/${task.channel}`}
			xs={[task.x_min, task.x_max]}
			ys={[task.y_min, task.y_max]}
			zs={[task.z_min, task.z_max]}
			resolution={task.resolution}
			{histMin}
			{histMax}
			{splitModeActive}
			{splitSeedColor}
			{splitSeeds}
			{splitPreviewAnnotations}
			{splitTargetSegmentID}
			{splitPreviewSegmentID}
			onCheckpointData={(data) => {
				queueCheckpoint(buildCheckpointSubmission(data));
			}}
			onAddSplitSeed={addSplitSeed}
			onRemoveSplitSeed={removeSplitSeed}
			onToggleInfo={() => (showInfo = !showInfo)}
			onToggleMerge={() => (showMerges = !showMerges)}
			onCopyToAdjacentSlice={copyCurrentSegmentToAdjacentSlice}
			onCopyFromLastSlice={copyCurrentSegmentFromLastSlice}
			onPropagateToAdjacentSlice={propagateCurrentSegmentToAdjacentSlice}
			onPropagateFromLastSlice={propagateCurrentSegmentFromLastSlice}
			onSubmitData={(data) => {
				API.saveTask({ taskId: task.id, ...buildCheckpointSubmission(data) }).then(() => {
					notyf.success('Volume finalized and saved.');
				});
			}}
		/>

		<MergePanel
			annotatedSegmentIDs={annotationStore.knownSegmentIDs}
			mergedSegmentGroups={annotationStore.mergedSegmentGroups}
			currentSegmentID={annotationStore.currentSegmentID}
			hoveredSegmentID={annotationStore.hoveredAnnotation?.segmentID ?? null}
			getSegmentColor={(segmentID) => annotationStore.getSegmentColor(segmentID)}
			splitMode={splitModeActive}
			{splitTargetSegmentID}
			splitNewSegmentID={splitPreviewSegmentID}
			{splitMethod}
			{splitSeedColor}
			splitRedSeedCount={splitSeedCounts.red}
			splitBlueSeedCount={splitSeedCounts.blue}
			{splitPreviewLoading}
			{splitPreviewError}
			{canApplySplit}
			onSelectSegmentID={handleSelectSegmentID}
			onMergeSegments={handleMergeSegments}
			onUnmergeSegment={handleUnmergeSegment}
			onStartSplit={startSplitMode}
			onCancelSplit={cancelSplitMode}
			onApplySplit={applySplit}
			onUndoSplitSeed={undoSplitSeed}
			onClearSplitSeeds={clearSplitSeeds}
			onSetSplitMethod={(method) => (splitMethod = method)}
			onSetSplitSeedColor={(label) => (splitSeedColor = label)}
			show={showMerges}
			onToggle={() => (showMerges = !showMerges)}
		/>

		<InfoTable
			currentLayer={nav.layer}
			currentSegmentID={annotationStore.currentSegmentID}
			{currentSegmentColor}
			layerAnnotationCount={annotationStore.getLayerAnnotations(nav.layer).length}
			onLayerChange={nav.setLayer}
			onSegmentIDChange={(id) => {
				if (!splitModeActive) {
					annotationStore.setCurrentSegmentID(id);
				}
			}}
			onCopyFromLastSlice={copyCurrentSegmentFromLastSlice}
			onPropagateFromLastSlice={propagateCurrentSegmentFromLastSlice}
			adjacentSegmentSourceLayer={getAdjacentSegmentSourceLayer()}
			propagationActionLabel={SEGMENT_PROPAGATION_LABEL}
			propagationInFlight={isPropagatingSegment}
			{propagationMode}
			propagationModes={PROPAGATION_MODE_OPTIONS}
			onPropagationModeChange={(mode) => (propagationMode = mode)}
			{histMin}
			{histMax}
			onHistogramChange={handleHistogramChange}
			show={showInfo}
			showLayerControls={false}
			onToggle={() => (showInfo = !showInfo)}
		/>
		<KeybindingsTable bind:show={showKeybindings} />

		<!-- Percentage Complete Bar - slides down to hide, hover to show -->
		<div
			class="fixed bottom-0 left-1/2 transform -translate-x-1/2 transition-transform duration-300 ease-in-out translate-y-16 hover:translate-y-0 z-20 pointer-events-auto"
		>
			<div class="p-4 bg-white border border-gray-300 rounded-t-lg text-center shadow-lg">
				<p class="text-sm font-medium">
					Percentage Complete: {getPercentageComplete(task, annotationStore).toFixed(2)}%
				</p>
				<p class="text-xs text-gray-600">Task ID: {task.id}</p>
			</div>
		</div>

		<!-- Floating Menu - Bottom Right -->
		<div class="fixed bottom-4 right-4 flex flex-col gap-2 z-30 pointer-events-auto">
			<!-- Paint/Pan Mode Toggle -->
			<button
				class="tooltip {nav.drawing
					? 'bg-green-500 hover:bg-green-600'
					: 'bg-gray-500 hover:bg-gray-600'} text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				style="touch-action: manipulation"
				onclick={() => nav.setDrawing(!nav.drawing)}
				aria-label={nav.drawing ? 'Switch to Pan Mode' : 'Switch to Paint Mode'}
				data-tooltip={nav.drawing ? 'Switch to Pan Mode' : 'Switch to Paint Mode'}
			>
				{#if nav.drawing}
					<AnnotationIcon className="w-5 h-5" />
				{:else}
					<LockIcon class="w-5 h-5" />
				{/if}
			</button>

			<!-- Save/Checkpoint Buttons -->
			<button
				class="tooltip bg-cyan-500 hover:bg-cyan-600 text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				onclick={() => {
					queueCheckpoint(buildCheckpointSubmission());
				}}
				aria-label="Save Progress (Alt+S)"
				data-tooltip="Save Progress (Alt+S)"
			>
				<DownloadIcon className="w-5 h-5" />
			</button>

			<!-- Comment out the complete button for now -->
			<!--
			<button
				class="bg-blue-500 hover:bg-blue-600 text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				on:click={() => {
					API.saveTask({ taskId: task.id, checkpoint: annotationStore.getAllAnnotations() }).then(
						() => {
							notyf.success('Volume finalized and saved.');
							// After the default 2000 timeout, nav back to home:
							// setTimeout(() => {
							// 	goto('/');
							// }, 2000);
						}
					);
				}}
				title="Submit (Alt+Shift+S)"
			>


				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
					></path>
				</svg>
			</button> -->

			<!-- Help/Keybindings Toggle -->
			<button
				class="tooltip bg-gray-500 hover:bg-gray-600 text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				style="touch-action: manipulation"
				onclick={() => (showKeybindings = !showKeybindings)}
				aria-label="Toggle Keybindings (H)"
				data-tooltip="Toggle Keybindings (H)"
			>
				<HelpIcon className="w-5 h-5" />
			</button>

			<!-- Go to Task Details Button -->
			<button
				class="tooltip bg-purple-500 hover:bg-purple-600 text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				style="touch-action: manipulation"
				onclick={() => handleNavigation(() => goto(`/task/${task.id}`))}
				aria-label="Go to Task Details"
				data-tooltip="Go to Task Details"
			>
				<InfoIcon className="w-5 h-5" />
			</button>

			<!-- Back to Home Button -->
			<button
				class="tooltip bg-indigo-500 hover:bg-indigo-600 text-white p-3 rounded-full shadow-lg transition-colors duration-200"
				style="touch-action: manipulation"
				onclick={() => handleNavigation(() => goto('/'))}
				aria-label="Back to Home"
				data-tooltip="Back to Home"
			>
				<CheckIcon className="w-5 h-5" />
			</button>
		</div>

		<!-- Subtract / Save Segment Buttons - For Touch Screen -->
		{#if nav.drawing && annotationStore.currentAnnotation && !splitModeActive}
			<!-- add check for if drawing/done drawing?? -->
			<div class="fixed top-10 left-1/3 flex gap-2 z-30 pointer-events-auto">
				<button
					class="tooltip bg-gray-500 hover:bg-gray-600 text-white p-2 rounded-full shadow-lg transition-colors duration-200"
					aria-label="Subtract Segment"
					data-tooltip="Subtract Segment"
					onclick={() => substractSegment(annotationStore, nav.layer)}
				>
					<CloseIcon class="w-4 h-4" />
				</button>
				<button
					class="tooltip bg-green-500 hover:bg-green-600 text-white p-2 rounded-full shadow-lg transition-colors duration-200"
					aria-label="Save Segment"
					data-tooltip="Save Segment"
					onclick={() => saveSegment(annotationStore, nav.layer)}
				>
					<CheckIcon className="w-4 h-4" />
				</button>
			</div>
		{/if}
	{/if}

	<!-- Navigation Confirmation Modal -->
	{#if showNavigationModal}
		<div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
			<div class="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl">
				<div class="flex items-center mb-4">
					<div class="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center mr-3">
						<svg
							class="w-6 h-6 text-yellow-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.081 16.5c-.77.833.192 2.5 1.732 2.5z"
							></path>
						</svg>
					</div>
					<h3 class="text-lg font-medium text-gray-900">Unsaved Changes</h3>
				</div>

				<p class="text-gray-600 mb-6">You have unsaved changes. What would you like to do?</p>

				<div class="flex flex-col space-y-3">
					<button
						class="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors duration-200"
						style="touch-action: manipulation"
						onclick={saveAndNavigate}
						aria-label="Save and Continue"
					>
						Save and Continue
					</button>

					<button
						class="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors duration-200"
						onclick={confirmNavigation}
						aria-label="Discard and Continue"
					>
						Discard Changes
					</button>

					<button
						class="w-full px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg transition-colors duration-200"
						onclick={cancelNavigation}
						aria-label="Cancel navigation"
					>
						Cancel
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* Custom tooltip styles for FAB buttons */
	.tooltip {
		position: relative;
	}

	.tooltip::after {
		content: attr(data-tooltip);
		position: absolute;
		right: 100%;
		top: 50%;
		transform: translateY(-50%);
		background: rgba(0, 0, 0, 0.9);
		color: white;
		padding: 8px 12px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s ease-in-out;
		margin-right: 10px;
		z-index: 1000;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
	}

	.tooltip::before {
		content: '';
		position: absolute;
		right: 100%;
		top: 50%;
		transform: translateY(-50%);
		border: 5px solid transparent;
		border-left-color: rgba(0, 0, 0, 0.9);
		margin-right: 5px;
		opacity: 0;
		transition: opacity 0.2s ease-in-out;
		z-index: 1000;
	}

	.tooltip:hover::after,
	.tooltip:hover::before {
		opacity: 1;
	}

	/* Ensure tooltips appear above other elements */
	.tooltip:hover {
		z-index: 1001;
	}
</style>
