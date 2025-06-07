import p5 from "p5";
import { type NavigationStore } from "./stores/NavigationStore.svelte";
import { segmentIdToRGB } from "./colorutils";
import APP_CONFIG from "./config";
import type { AnnotationManagerStore } from "./stores/AnnotationManagerStore.svelte";

class PolygonAnnotation {

    // Positive/negative regions approach
    positiveRegions: Array<Array<[number, number]>>;
    negativeRegions: Array<Array<[number, number]>>;

    editing: boolean;
    segmentID: number;
    color: number[];
    z: number;


    constructor(
        input?: {
            positiveRegions?: Array<Array<[number, number]>>;
            negativeRegions?: Array<Array<[number, number]>>;
        },
        segmentID?: number,
        editing = true,
        z = 0
    ) {
        this.editing = editing;
        this.segmentID = segmentID || 1;
        this.color = segmentIdToRGB(this.segmentID);
        this.z = z;

        // Initialize regions
        this.positiveRegions = input?.positiveRegions || [];
        this.negativeRegions = input?.negativeRegions || [];
    }


    addVertex(pt: [number, number]): void {
        this.color = segmentIdToRGB(this.segmentID);

        // Add to the first positive region (or create one if none exists)
        if (this.positiveRegions.length === 0) {
            this.positiveRegions.push([]);
        }
        this.positiveRegions[0].push(pt);
    }

    draw(p: p5, nav: NavigationStore, annoMgr: AnnotationManagerStore) {
        const mouseDataPos = nav.sceneToData(p.mouseX, p.mouseY);
        const hover = this.pointIsInside([mouseDataPos.x, mouseDataPos.y]);

        // Pick a fill color:
        const opacity = 255 * (this.editing ? APP_CONFIG.editingOpacity : (
            hover ? APP_CONFIG.hoveredOpacity : (
                annoMgr.currentSegmentID === this.segmentID ? APP_CONFIG.activeOpacity : APP_CONFIG.nonActiveOpacity)
        ));
        p.fill(this.color[0], this.color[1], this.color[2], opacity);
        p.stroke(this.color[0], this.color[1], this.color[2], opacity + 10);
        p.strokeWeight(2);

        // Draw each positive region with only the negative regions that are contained within it
        this.positiveRegions.forEach((positiveRegion) => {
            p.beginShape();

            // Draw the positive region
            positiveRegion.forEach((pt: [number, number]) => {
                p.vertex(pt[0], pt[1]);
            });

            // Only add negative regions that are actually contained within this positive region
            this.negativeRegions.forEach((negativeRegion: Array<[number, number]>) => {
                if (this.isRegionContainedInRegion(negativeRegion, positiveRegion)) {
                    p.beginContour();
                    negativeRegion.forEach((pt: [number, number]) => {
                        p.vertex(pt[0], pt[1]);
                    });
                    p.endContour();
                }
            });

            p.endShape();
        });

        if (hover && !this.editing && this.positiveRegions.length > 0 && this.positiveRegions[0].length > 0) {
            p.fill(0, 0, 0, 255);
            p.textSize(12 / nav.zoom);
            p.noStroke();
            p.text("Segment ID: " + this.segmentID, this.positiveRegions[0][0][0], this.positiveRegions[0][0][1]);
        }
    }

    pointIsInside(pt: [number, number]): boolean {
        // Check if point is inside any positive region
        const insideAnyPositive = this.positiveRegions.some(region => this.raycast(pt, region));

        if (!insideAnyPositive) {
            return false;
        }

        // Check if point is inside any negative region (hole)
        const insideAnyNegative = this.negativeRegions.some(region => this.raycast(pt, region));

        // Point is inside shape if it's in any positive region but not in any negative region
        return !insideAnyNegative;
    }

    private raycast(pt: [number, number], polygon: Array<[number, number]>): boolean {
        // ray-casting algorithm
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i][0], yi = polygon[i][1];
            const xj = polygon[j][0], yj = polygon[j][1];

            const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
                (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    /**
     * Calculate the signed area of a polygon to determine winding order.
     * Positive area = counter-clockwise (outer boundary)
     * Negative area = clockwise (hole)
     */
    private calculateSignedArea(polygon: Array<[number, number]>): number {
        if (polygon.length < 3) return 0;

        let area = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            area += (polygon[j][0] - polygon[i][0]) * (polygon[j][1] + polygon[i][1]);
        }
        return area / 2;
    }

    /**
     * Classify regions from polybool result based on winding order.
     * According to polybool docs: exterior paths are counter-clockwise, holes are clockwise.
     * Now returns ALL outer boundaries instead of just the largest one.
     */
    private classifyRegionsByWindingOrder(regions: Array<Array<[number, number]>>): {
        outerBoundaries: Array<Array<[number, number]>>;
        holes: Array<Array<[number, number]>>;
    } {
        if (regions.length === 0) {
            return { outerBoundaries: [], holes: [] };
        }

        const classified = regions.map(region => ({
            region,
            signedArea: this.calculateSignedArea(region),
            isOuterBoundary: this.calculateSignedArea(region) > 0 // counter-clockwise = positive area
        }));

        // Debug: log the classification results
        console.log('Classifying regions:', classified.map(c => ({
            area: c.signedArea,
            isOuter: c.isOuterBoundary,
            pointCount: c.region.length
        })));

        const outerBoundaries = classified.filter(c => c.isOuterBoundary).map(c => c.region);
        const holes = classified.filter(c => !c.isOuterBoundary).map(c => c.region);

        console.log(`Classification result: ${outerBoundaries.length} outer boundaries, ${holes.length} holes`);

        return {
            outerBoundaries,
            holes
        };
    }

    removeLatestVertex() {
        // Remove from the first positive region
        if (this.positiveRegions.length > 0 && this.positiveRegions[0].length > 0) {
            this.positiveRegions[0].pop();
        }
    }

    /**
     * Create a SINGLE PolygonAnnotation from polybool results using positive/negative geometry.
     */
    static fromPolyboolRegions(regions: Array<Array<[number, number]>>, segmentID: number, editing: boolean, z: number): PolygonAnnotation {
        if (regions.length === 0) {
            return new PolygonAnnotation({}, segmentID, editing, z);
        }

        // Classify all regions by winding order
        const classified = regions.map(region => ({
            region,
            signedArea: PolygonAnnotation.calculateSignedAreaStatic(region),
            isOuterBoundary: PolygonAnnotation.calculateSignedAreaStatic(region) > 0
        }));

        const positiveRegions = classified.filter(c => c.isOuterBoundary).map(c => c.region);
        const negativeRegions = classified.filter(c => !c.isOuterBoundary).map(c => c.region);

        console.log(`Creating single PolygonAnnotation: ${positiveRegions.length} positive regions, ${negativeRegions.length} negative regions`);

        // Always create exactly ONE PolygonAnnotation containing all positive and negative regions
        return new PolygonAnnotation({
            positiveRegions,
            negativeRegions
        }, segmentID, editing, z);
    }

    /**
     * Static version of calculateSignedArea for use in static methods
     */
    private static calculateSignedAreaStatic(polygon: Array<[number, number]>): number {
        if (polygon.length < 3) return 0;

        let area = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            area += (polygon[j][0] - polygon[i][0]) * (polygon[j][1] + polygon[i][1]);
        }
        return area / 2;
    }

    /**
     * Check if a region (potential hole) is contained within another region (potential container).
     * Uses the centroid approach - if the centroid of the hole is inside the container,
     * we consider the hole to belong to that container.
     */
    private isRegionContainedInRegion(holeRegion: Array<[number, number]>, containerRegion: Array<[number, number]>): boolean {
        if (holeRegion.length === 0 || containerRegion.length === 0) {
            return false;
        }

        // Calculate centroid of the hole region
        const centroid = this.calculateCentroid(holeRegion);

        // Check if centroid is inside the container region
        return this.raycast(centroid, containerRegion);
    }

    /**
     * Calculate the centroid (geometric center) of a polygon.
     */
    private calculateCentroid(polygon: Array<[number, number]>): [number, number] {
        if (polygon.length === 0) {
            return [0, 0];
        }

        let centroidX = 0;
        let centroidY = 0;
        let signedArea = 0;

        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            const x0 = polygon[i][0];
            const y0 = polygon[i][1];
            const x1 = polygon[j][0];
            const y1 = polygon[j][1];

            const a = x0 * y1 - x1 * y0;
            signedArea += a;
            centroidX += (x0 + x1) * a;
            centroidY += (y0 + y1) * a;
        }

        signedArea *= 0.5;

        if (Math.abs(signedArea) < 1e-10) {
            // Fallback to simple average if signed area is too small
            const avgX = polygon.reduce((sum, pt) => sum + pt[0], 0) / polygon.length;
            const avgY = polygon.reduce((sum, pt) => sum + pt[1], 0) / polygon.length;
            return [avgX, avgY];
        }

        centroidX /= (6.0 * signedArea);
        centroidY /= (6.0 * signedArea);

        return [centroidX, centroidY];
    }
}

export default PolygonAnnotation;