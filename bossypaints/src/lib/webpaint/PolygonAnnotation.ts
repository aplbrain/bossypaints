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
            // Multi-region format: first region is outer boundary, rest are holes
            const regions = startingPoints as Array<Array<[number, number]>>;
            this.points = regions[0] || [];
            this.holes = regions.slice(1) || [];
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

    removeLatestVertex() {
        if (this.points.length > 0) {
            this.points.pop();
        }
    }
}

export default PolygonAnnotation;