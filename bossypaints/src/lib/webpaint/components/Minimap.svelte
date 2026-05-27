<!--
@component Minimap

@desc A compact vertical layer scrubber that shows task z bounds, annotated layers, and current z position.
@prop {AnnotationManagerStore} annotationStore - The store that contains all annotations.
@prop {NavigationStore} nav - The store that contains the current layer and bounds.
@prop {number} height - Preferred track height for the minimap.
-->
<script lang="ts">
	import { ArrowDownIcon, ArrowUpIcon } from '$lib/icons';
	import type { NavigationStore } from '../stores/NavigationStore.svelte';
	import type { AnnotationManagerStore } from '../stores/AnnotationManagerStore.svelte';

	export let annotationStore: AnnotationManagerStore;
	export let nav: NavigationStore;
	export let height = 320;
	export let footprint = 0;
	export let show = true;
	export let onToggle: () => void = () => {};

	const width = 110;
	const minTrackHeight = 210;
	const maxTrackHeight = 320;
	const trackTopInset = 26;
	const trackBottomInset = 26;
	const guideLeft = 24;
	const guideRight = 84;
	const markerBandLeft = 24;
	const markerBandWidth = 34;
	const maxGuideRows = 22;
	const markerIdealDiameter = 8;
	const markerIdealGap = 1.75;

	type LayerMarker = {
		segmentID: number;
		fill: string;
		shape: 'circle' | 'rect';
		centerX: number;
		radius: number;
		rectX: number;
		rectWidth: number;
		rectHeight: number;
		rectRx: number;
	};

	let viewportHeight = 0;
	let trackEl: HTMLDivElement | null = null;
	let layerInputEl: HTMLInputElement | null = null;
	let isScrubbing = false;
	let editingLayer = false;
	let trackHeight = height;
	let displayedLayer = nav.layer;
	let layerOutsideTaskBounds = false;
	let currentLayerY = 0;
	let outsideDirection: 'Above task' | 'Below task' | null = null;
	let sliderValueText = '';
	let layerInputValue = nav.layer.toString();
	let relativeLayer = 0;
	let maxRelativeLayer = 0;
	let taskSliceText = '';
	let guideStep = 1;
	let guideLayers: Array<number> = [];
	let occupiedLayers: Array<{
		layer: number;
		y: number;
		markers: Array<LayerMarker>;
	}> = [];

	function getLayerCount(): number {
		return Math.max(1, nav.maxLayer - nav.minLayer);
	}

	function getTrackRange(currentTrackHeight: number): number {
		return Math.max(1, currentTrackHeight - trackTopInset - trackBottomInset);
	}

	function clampLayerToTaskBounds(layer: number): number {
		return Math.max(nav.minLayer, Math.min(nav.maxLayer - 1, layer));
	}

	function isLayerOutsideTaskBounds(layer: number): boolean {
		return layer < nav.minLayer || layer >= nav.maxLayer;
	}

	function layerToY(layer: number, currentTrackHeight: number): number {
		const normalized = (layer - nav.minLayer + 0.5) / getLayerCount();
		return trackTopInset + normalized * getTrackRange(currentTrackHeight);
	}

	function colorToCss([red, green, blue]: [number, number, number]): string {
		return `rgb(${red} ${green} ${blue})`;
	}

	function buildMarkers(segmentIDs: Array<number>): Array<LayerMarker> {
		if (segmentIDs.length === 0) {
			return [];
		}

		const totalIdealWidth =
			segmentIDs.length * markerIdealDiameter +
			Math.max(0, segmentIDs.length - 1) * markerIdealGap;
		const scale = totalIdealWidth > markerBandWidth ? markerBandWidth / totalIdealWidth : 1;
		const diameter = markerIdealDiameter * scale;
		const gap = markerIdealGap * scale;

		return segmentIDs.map((segmentID, index) => {
			const centerX = markerBandLeft + diameter / 2 + index * (diameter + gap);
			const fill = colorToCss(annotationStore.getSegmentColor(segmentID));

			if (diameter >= 3.25) {
				return {
					segmentID,
					fill,
					shape: 'circle',
					centerX,
					radius: diameter / 2,
					rectX: 0,
					rectWidth: 0,
					rectHeight: 0,
					rectRx: 0
				};
			}

			const rectWidth = Math.max(0.9, diameter * 0.92);
			const rectHeight = Math.max(3.8, 5.5 * scale);
			return {
				segmentID,
				fill,
				shape: 'rect',
				centerX,
				radius: 0,
				rectX: centerX - rectWidth / 2,
				rectWidth,
				rectHeight,
				rectRx: Math.min(rectWidth / 2, 1.6)
			};
		});
	}

	function setLayerFromClientY(clientY: number) {
		if (!trackEl) {
			return;
		}

		const rect = trackEl.getBoundingClientRect();
		const relativeY = Math.max(
			0,
			Math.min(getTrackRange(trackHeight) - 1, clientY - rect.top - trackTopInset)
		);
		const targetLayer =
			nav.minLayer + Math.floor((relativeY / getTrackRange(trackHeight)) * getLayerCount());
		nav.setLayer(targetLayer);
	}

	function handlePointerDown(event: PointerEvent) {
		if (!trackEl) {
			return;
		}

		isScrubbing = true;
		trackEl.setPointerCapture?.(event.pointerId);
		setLayerFromClientY(event.clientY);
		event.preventDefault();
	}

	function handlePointerMove(event: PointerEvent) {
		if (!isScrubbing) {
			return;
		}

		setLayerFromClientY(event.clientY);
		event.preventDefault();
	}

	function handlePointerRelease(event: PointerEvent) {
		if (trackEl?.hasPointerCapture?.(event.pointerId)) {
			trackEl.releasePointerCapture(event.pointerId);
		}
		isScrubbing = false;
	}

	function handleRestrictToggle(event: Event) {
		const checked = (event.currentTarget as HTMLInputElement).checked;
		nav.setRestrictLayerBounds(checked);
	}

	function startEditingLayer() {
		editingLayer = true;
		layerInputValue = nav.layer.toString();
		setTimeout(() => {
			layerInputEl?.focus();
			layerInputEl?.select();
		}, 0);
	}

	function saveLayerInput() {
		const nextLayer = Number.parseInt(layerInputValue, 10);
		if (!Number.isNaN(nextLayer)) {
			nav.setLayer(nextLayer);
		}
		layerInputValue = nav.layer.toString();
		editingLayer = false;
	}

	$: trackHeight =
		viewportHeight > 0
			? Math.max(minTrackHeight, Math.min(maxTrackHeight, viewportHeight - 340))
			: height;
	$: displayedLayer = nav.taskBoundedLayer;
	$: layerOutsideTaskBounds = isLayerOutsideTaskBounds(nav.layer);
	$: currentLayerY = layerToY(displayedLayer, trackHeight);
	$: outsideDirection =
		nav.layer < nav.minLayer ? 'Above task' : nav.layer >= nav.maxLayer ? 'Below task' : null;
	$: relativeLayer = nav.layer - nav.minLayer;
	$: maxRelativeLayer = Math.max(0, getLayerCount() - 1);
	$: taskSliceText =
		nav.layer < nav.minLayer
			? `task 0 - ${nav.minLayer - nav.layer}`
			: nav.layer >= nav.maxLayer
				? `task ${maxRelativeLayer} + ${nav.layer - (nav.maxLayer - 1)}`
				: `task ${relativeLayer} / ${maxRelativeLayer}`;
	$: sliderValueText = layerOutsideTaskBounds
		? `${outsideDirection}, z ${nav.layer}, ${taskSliceText}`
		: `z ${nav.layer}, ${taskSliceText}`;
	$: guideStep = Math.max(1, Math.ceil(getLayerCount() / maxGuideRows));
	$: guideLayers = Array.from({ length: Math.ceil(getLayerCount() / guideStep) + 1 }, (_, index) =>
		clampLayerToTaskBounds(nav.minLayer + index * guideStep)
	).filter((layer, index, allLayers) => index === 0 || layer !== allLayers[index - 1]);
	$: occupiedLayers = annotationStore.annotations.flatMap((layerAnnotations, layerIndex) => {
		if (!layerAnnotations || layerAnnotations.length === 0) {
			return [];
		}

		const absoluteLayer = nav.minLayer + layerIndex;
		if (absoluteLayer < nav.minLayer || absoluteLayer >= nav.maxLayer) {
			return [];
		}

		const segmentIDs = Array.from(
			new Set(
				layerAnnotations.map((annotation) =>
					annotationStore.getCanonicalSegmentID(annotation.segmentID)
				)
			)
		).sort((left, right) => left - right);

		return [
			{
				layer: absoluteLayer,
				y: layerToY(absoluteLayer, trackHeight),
				markers: buildMarkers(segmentIDs)
			}
		];
	});
	$: if (!editingLayer) {
		layerInputValue = nav.layer.toString();
	}
</script>

<svelte:window bind:innerHeight={viewportHeight} />

<div
	class="minimap-wrap"
	style="transform: translateX({show ? '0' : 'calc(-100% - 16px)'});"
>
	<div class="minimap-shell" bind:clientHeight={footprint}>
		<button
			class="minimap-toggle"
			on:click={onToggle}
			title="Toggle Minimap (Z)"
			aria-label="Toggle Minimap"
		>
			{#if show}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M15 5l-7 7 7 7"
					/>
				</svg>
			{:else}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			{/if}
			<span class="minimap-toggle-key">z</span>
		</button>

		<div
			bind:this={trackEl}
			class="minimap-track-shell"
			role="slider"
			aria-label="Z layer minimap"
			aria-valuemin={nav.minLayer}
			aria-valuemax={Math.max(nav.minLayer, nav.maxLayer - 1)}
			aria-valuenow={displayedLayer}
			aria-valuetext={sliderValueText}
			on:pointerdown={handlePointerDown}
			on:pointermove={handlePointerMove}
			on:pointerup={handlePointerRelease}
			on:pointercancel={handlePointerRelease}
			on:lostpointercapture={() => (isScrubbing = false)}
		>
			<svg {width} height={trackHeight} viewBox={`0 0 ${width} ${trackHeight}`} class="minimap-svg">
				<rect
					x="0.5"
					y="0.5"
					width={width - 1}
					height={trackHeight - 1}
					rx="18"
					class="frame"
				/>
				<rect
					x="12"
					y="12"
					width={width - 24}
					height={trackHeight - 24}
					rx="14"
					class="inner-frame"
				/>

				{#each guideLayers as layer}
					<line
						x1={guideLeft}
						x2={guideRight}
						y1={layerToY(layer, trackHeight)}
						y2={layerToY(layer, trackHeight)}
						class="guide-line"
					/>
				{/each}

				{#each occupiedLayers as layer}
					<g transform={`translate(0 ${layer.y})`}>
						<line x1={guideLeft} x2={guideRight} y1="0" y2="0" class="activity-line" />
						{#each layer.markers as marker}
							{#if marker.shape === 'circle'}
								<circle cx={marker.centerX} cy="0" r={marker.radius} fill={marker.fill} />
							{:else}
								<rect
									x={marker.rectX}
									y={-marker.rectHeight / 2}
									width={marker.rectWidth}
									height={marker.rectHeight}
									rx={marker.rectRx}
									fill={marker.fill}
								/>
							{/if}
						{/each}
					</g>
				{/each}

				<line
					x1={guideLeft - 2}
					x2={guideRight + 5}
					y1={currentLayerY}
					y2={currentLayerY}
					class:current-layer={true}
					class:current-layer-outside={layerOutsideTaskBounds}
				/>
				<circle
					cx={guideRight + 5}
					cy={currentLayerY}
					r="5.8"
					class:current-layer-dot={true}
					class:current-layer-dot-outside={layerOutsideTaskBounds}
				/>
			</svg>
		</div>

		<label class="bounds-toggle">
			<input
				type="checkbox"
				checked={nav.restrictLayerBounds}
				on:change={handleRestrictToggle}
			/>
			<span class="bounds-toggle-text">Restrict to task z</span>
		</label>

		<div class:layer-readout={true} class:layer-readout-outside={layerOutsideTaskBounds}>
			<div class="layer-values">
				<div class="layer-primary">
					<span class="layer-label">z</span>
					{#if editingLayer}
						<input
							bind:this={layerInputEl}
							type="number"
							bind:value={layerInputValue}
							on:blur={saveLayerInput}
							class="layer-input"
							aria-label="Current z layer"
						/>
					{:else}
						<button
							type="button"
							class="layer-value-button"
							on:click={startEditingLayer}
							title="Edit current z layer"
						>
							{nav.layer}
						</button>
					{/if}
				</div>
				<div class="layer-secondary">{taskSliceText}</div>
				{#if outsideDirection}
					<div class="layer-status">{outsideDirection}</div>
				{/if}
			</div>

			<div class="layer-controls">
				<button
					type="button"
					class="layer-step"
					on:click={() => nav.decrementLayer(1)}
					title="Previous z layer"
					aria-label="Previous z layer"
				>
					<ArrowUpIcon className="w-3 h-3" />
				</button>

				<button
					type="button"
					class="layer-step"
					on:click={() => nav.incrementLayer(1)}
					title="Next z layer"
					aria-label="Next z layer"
				>
					<ArrowDownIcon className="w-3 h-3" />
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	.minimap-wrap {
		position: absolute;
		left: 16px;
		bottom: 16px;
		z-index: 100;
		pointer-events: auto;
		transition: transform 300ms ease-in-out;
	}

	.minimap-shell {
		position: relative;
		width: 140px;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 9px;
		padding: 10px 10px 11px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 28px;
		background: rgba(44, 50, 67, 0.9);
		backdrop-filter: blur(10px);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.06),
			0 14px 32px rgba(15, 23, 42, 0.35);
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}

	.minimap-toggle {
		position: absolute;
		right: -28px;
		top: 28px;
		transform: translateY(-50%);
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 0 0.375rem 0.375rem 0;
		border: 1px solid rgb(209 213 219);
		background: white;
		color: rgb(55 65 81);
		box-shadow:
			0 1px 2px rgb(0 0 0 / 0.08),
			0 1px 3px rgb(0 0 0 / 0.12);
		cursor: pointer;
	}

	.minimap-toggle:hover {
		background: rgb(249 250 251);
	}

	.minimap-toggle-key {
		position: absolute;
		bottom: 2px;
		left: 2px;
		font-size: 10px;
		line-height: 1;
		color: rgb(107 114 128);
		opacity: 0.7;
	}

	.minimap-track-shell {
		border-radius: 20px;
		outline: none;
	}

	.minimap-track-shell:focus-visible {
		box-shadow:
			0 0 0 2px rgba(255, 255, 255, 0.82),
			0 0 0 5px rgba(15, 23, 42, 0.32);
	}

	.minimap-svg {
		display: block;
		cursor: ns-resize;
	}

	.frame {
		fill: rgba(62, 68, 86, 0.98);
		stroke: rgba(255, 255, 255, 0.08);
	}

	.inner-frame {
		fill: none;
		stroke: rgba(255, 255, 255, 0.16);
		stroke-width: 1.4;
	}

	.guide-line {
		stroke: rgba(255, 255, 255, 0.12);
		stroke-width: 1.7;
		stroke-linecap: round;
	}

	.activity-line {
		stroke: rgba(255, 255, 255, 0.16);
		stroke-width: 1.85;
		stroke-linecap: round;
	}

	.current-layer {
		stroke: rgba(255, 255, 255, 0.96);
		stroke-width: 2.5;
		stroke-linecap: round;
		transition:
			opacity 120ms ease,
			stroke 120ms ease;
	}

	.current-layer-outside {
		stroke: rgba(255, 255, 255, 0.42);
		opacity: 0.58;
	}

	.current-layer-dot {
		fill: rgba(255, 255, 255, 0.98);
		transition:
			opacity 120ms ease,
			fill 120ms ease;
	}

	.current-layer-dot-outside {
		fill: rgba(255, 255, 255, 0.52);
		opacity: 0.58;
	}

	.bounds-toggle {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		padding: 7px 9px;
		border-radius: 14px;
		background: rgba(25, 29, 42, 0.34);
		color: rgba(255, 255, 255, 0.76);
		font-size: 10px;
		line-height: 1.2;
		cursor: pointer;
		text-align: left;
	}

	.bounds-toggle input {
		margin: 0;
		accent-color: rgb(96 165 250);
	}

	.bounds-toggle-text {
		display: block;
	}

	.layer-readout {
		display: flex;
		flex-direction: column;
		gap: 9px;
		padding: 10px 10px 11px;
		border-radius: 18px;
		background: rgba(25, 29, 42, 0.95);
		color: rgba(255, 255, 255, 0.96);
		font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
		line-height: 1;
		transition:
			opacity 120ms ease,
			background 120ms ease;
	}

	.layer-readout-outside {
		background: rgba(2, 6, 23, 0.34);
		opacity: 0.7;
	}

	.layer-step {
		width: 100%;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.06);
		color: rgba(255, 255, 255, 0.92);
		cursor: pointer;
		transition:
			background 120ms ease,
			border-color 120ms ease;
	}

	.layer-step:hover {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.2);
	}

	.layer-values {
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 5px;
	}

	.layer-primary {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
		width: 100%;
	}

	.layer-label {
		font-size: 10px;
		opacity: 0.7;
		text-transform: uppercase;
	}

	.layer-value-button {
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 15px;
		font-weight: 700;
		cursor: text;
		text-align: left;
	}

	.layer-input {
		width: 100%;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 15px;
		font-weight: 700;
		outline: none;
	}

	.layer-input::-webkit-outer-spin-button,
	.layer-input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	.layer-secondary,
	.layer-status {
		font-size: 10px;
		letter-spacing: 0.02em;
		line-height: 1.2;
	}

	.layer-secondary {
		opacity: 0.7;
	}

	.layer-status {
		padding: 3px 7px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.8);
		text-transform: uppercase;
	}

	.layer-controls {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 7px;
	}
</style>
