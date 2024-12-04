<!--
@component InfoTable

A table that displays information about the current state of the annotation
manager and navigation store.

@prop annotationStore {AnnotationManagerStore} - The annotation manager store to
  display information about.
@prop nav {NavigationStore} - The navigation store to display information about.
-->
<script lang="ts">
	import { type AnnotationManagerStore } from '$lib/stores/AnnotationManagerStore.svelte';
	import { type NavigationStore } from '$lib/stores/NavigationStore.svelte';

	export let annotationStore: AnnotationManagerStore;
	export let nav: NavigationStore;

	console.log(annotationStore.getLayerAnnotations);
</script>

<table id="info-table">
	<tbody>
		<tr>
			<td>Layer:</td>
			<td>{nav.layer}</td>
		</tr>
		<tr>
			<td>Segment ID:</td>
			<td>{annotationStore.currentSegmentID}</td>
		</tr>
		<tr>
			<td>Number of Points:</td>
			<td>{annotationStore.currentAnnotation.vertices.length}</td>
		</tr>
		<tr>
			<td>Number of Annotations on L{nav.layer}:</td>
			<td>{annotationStore.getLayerAnnotations(nav.layer).length}</td>
		</tr>
		<tr>
			<td>Total Annotation Count</td>
			<td>{annotationStore.getAllAnnotations().flat().length}</td>
		</tr>
	</tbody>
</table>

<style>
	#info-table {
		position: fixed;
		top: 0;
		right: 0;
		background-color: white;
	}
</style>
