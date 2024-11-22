import type PolygonAnnotation from "webpaint/src/lib/PolygonAnnotation";

const baseUrl = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8000';

export type TaskID = string;

export type Task = {
    collection: string;
    experiment: string;
    channel: string;
    resolution: number;
    x_min: number;
    x_max: number;
    y_min: number;
    y_max: number;
    z_min: number;
    z_max: number;
    priority?: number;
}

export type TaskInDB = Task & {
    id: TaskID;
}

class API {
    async get(url: string) {
        url = url.startsWith('/') ? url : `/${url}`;
        const response = await fetch(`${baseUrl}${url}`);
        return response.json();
    }

    async post(url: string, data: any) {
        url = url.startsWith('/') ? url : `/${url}`;
        const response = await fetch(`${baseUrl}${url}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });
        return response.json();
    }

    async getNextTask(): Promise<{ task: TaskInDB }> {
        return this.get('/api/tasks/next');
    }

    async checkpointTask({ taskId, checkpoint }: { taskId: TaskID, checkpoint: PolygonAnnotation[] }) {
        return this.post(`/api/tasks/${taskId}/checkpoint`, { checkpoint });
    }

    async getTaskCheckpoints(taskId: TaskID): Promise<{ checkpoints: Array<{ polygons: Array<PolygonAnnotation>, taskID: TaskID }> }> {
        return this.get(`/api/tasks/${taskId}/checkpoints`);
    }
    async saveTask({ taskId, checkpoint }: { taskId: TaskID, checkpoint: PolygonAnnotation[] }) {
        return this.post(`/api/tasks/${taskId}/save`, { checkpoint });
    }
}

export default new API();