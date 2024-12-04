import p5 from "p5";
import { type NavigationStore } from "./stores/NavigationStore.svelte";
import { segmentIdToRGB } from "./colorutils";
import APP_CONFIG from "./config";
import type { AnnotationManagerStore } from "./stores/AnnotationManagerStore.svelte";

class PolygonAnnotation {

    points: Array<[number, number]>;
    editing: boolean;
    segmentID: number;
    color: number[];
    z: number;


    constructor(startingPoints?: Array<[number, number]>, segmentID?: number, editing = true, z = 0) {
        this.points = startingPoints || [];
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
        p.endShape();

        if (hover && !this.editing) {
            p.fill(0, 0, 0, 255);
            p.textSize(12 / nav.zoom);
            p.noStroke();
            p.text("Segment ID: " + this.segmentID, this.points[0][0], this.points[0][1]);

        }
    }

    pointIsInside(pt: [number, number]): boolean {
        // is point inside polygon?

        // ray-casting algorithm
        let inside = false;
        for (let i = 0, j = this.points.length - 1; i < this.points.length; j = i++) {
            const xi = this.points[i][0], yi = this.points[i][1];
            const xj = this.points[j][0], yj = this.points[j][1];

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