import p5 from "p5";
import { type NavigationStore } from "./stores/NavigationStore.svelte";
import { segmentIdToRGB } from "./colorutils";
import APP_CONFIG from "./config";
import type { AnnotationManagerStore } from "./stores/AnnotationManagerStore.svelte";

class PolygonAnnotation {

    points: Array<[number, number]>;
    holes: Array<Array<[number, number]>>;
    editing: boolean;
    segmentID: number;
    color: number[];
    z: number;


    constructor(startingPoints?: Array<[number, number]> | Array<Array<[number, number]>>, segmentID?: number, editing = true, z = 0) {
        // Handle both old single-region format and new multi-region format
        if (startingPoints && startingPoints.length > 0 && Array.isArray(startingPoints[0]) && Array.isArray(startingPoints[0][0])) {
            // Multi-region format: classify regions by winding order
            const regions = startingPoints as Array<Array<[number, number]>>;
            const classifiedRegions = this.classifyRegionsByWindingOrder(regions);
            this.points = classifiedRegions.outerBoundary;
            this.holes = classifiedRegions.holes;
        } else {
            // Single region format (backward compatibility)
            this.points = (startingPoints as Array<[number, number]>) || [];
            this.holes = [];
        }

        this.editing = true;
        this.segmentID = segmentID || 1;
        this.color = segmentIdToRGB(this.segmentID);
        this.z = z;

        this.editing = editing;
    }


    addVertex(pt: [number, number]): void {
        this.color = segmentIdToRGB(this.segmentID);
        this.points.push(pt);
    }

    draw(p: p5, nav: NavigationStore, annoMgr: AnnotationManagerStore) {
        const mouseDataPos = nav.sceneToData(p.mouseX, p.mouseY);
        const hover = this.pointIsInside([mouseDataPos.x, mouseDataPos.y]);
        // const hover = this.pointIsInside([p.mouseX, p.mouseY]);
        // Pick a fill color:
        // If editing, low alpha:
        const opacity = 255 * (this.editing ? APP_CONFIG.editingOpacity : (
            // If mouse is inside, bump the opacity again:
            hover ? APP_CONFIG.hoveredOpacity : (
                annoMgr.currentSegmentID === this.segmentID ? APP_CONFIG.activeOpacity : APP_CONFIG.nonActiveOpacity)
        ));
        p.fill(this.color[0], this.color[1], this.color[2], opacity);
        p.stroke(this.color[0], this.color[1], this.color[2], opacity + 10);
        p.strokeWeight(2);

        p.beginShape();

        this.points.forEach((pt: [number, number]) => {
            p.vertex(pt[0], pt[1]);
        });

        // Add holes as contours
        this.holes.forEach((hole: Array<[number, number]>) => {
            p.beginContour();
            hole.forEach((pt: [number, number]) => {
                p.vertex(pt[0], pt[1]);
            });
            p.endContour();
        });

        p.endShape();

        if (hover && !this.editing) {
            p.fill(0, 0, 0, 255);
            p.textSize(12 / nav.zoom);
            p.noStroke();
            p.text("Segment ID: " + this.segmentID, this.points[0][0], this.points[0][1]);

        }
    }

    pointIsInside(pt: [number, number]): boolean {
        // Check if point is inside outer boundary
        const insideOuter = this.raycast(pt, this.points);

        // Check if point is inside any hole
        const insideAnyHole = this.holes.some(hole => this.raycast(pt, hole));

        // Point is inside shape if it's in outer boundary but not in any hole
        return insideOuter && !insideAnyHole;
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
     */
    private classifyRegionsByWindingOrder(regions: Array<Array<[number, number]>>): {
        outerBoundary: Array<[number, number]>;
        holes: Array<Array<[number, number]>>;
    } {
        if (regions.length === 0) {
            return { outerBoundary: [], holes: [] };
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

        // Find the outer boundary (should be the largest counter-clockwise region)
        const outerBoundaries = classified.filter(c => c.isOuterBoundary);
        const holes = classified.filter(c => !c.isOuterBoundary);

        // Use the largest outer boundary as the main boundary
        let outerBoundary: Array<[number, number]> = [];
        if (outerBoundaries.length > 0) {
            outerBoundary = outerBoundaries.reduce((largest, current) =>
                Math.abs(current.signedArea) > Math.abs(largest.signedArea) ? current : largest
            ).region;
        } else if (regions.length > 0) {
            // Fallback: if no counter-clockwise regions found, use the first region
            outerBoundary = regions[0];
        }

        console.log(`Classification result: ${outerBoundaries.length} outer boundaries, ${holes.length} holes`);

        return {
            outerBoundary,
            holes: holes.map(h => h.region)
        };
    }

    removeLatestVertex() {
        if (this.points.length > 0) {
            this.points.pop();
        }
    }
}

export default PolygonAnnotation;