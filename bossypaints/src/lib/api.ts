import type PolygonAnnotation from "$lib/webpaint/PolygonAnnotation";

const baseUrl = 'http://192.168.0.216:8000';
// const baseUrl = "https://api.paint.labs.bossdb.org";

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
    destination_collection?: string;
    destination_experiment?: string;
    destination_channel?: string;
}

export type TaskInDB = Task & {
    id: TaskID;
}

class API {
    async get(url: string) {
        url = url.startsWith('/') ? url : `/${url}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (localStorage.getItem('apiToken')) {
            headers['Authorization'] = `Token ${localStorage.getItem('apiToken')}`;
        }
        const response = await fetch(`${baseUrl}${url}`, {
            headers,
        });
        return response.json();
    }

    async post(url: string, data: any) {
        url = url.startsWith('/') ? url : `/${url}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (localStorage.getItem('apiToken')) {
            headers['Authorization'] = `Token ${localStorage.getItem('apiToken')}`;
        }
        const response = await fetch(`${baseUrl}${url}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data),
        });
        return response.json();
    }

    async getTasks(): Promise<{ tasks: TaskInDB[] }> {
        return this.get('/api/tasks');
    }

    async getTask(taskId: TaskID): Promise<{ task: TaskInDB }> {
        return this.get(`/api/tasks/${taskId}`);
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

    async createTask(task: Task): Promise<{ message: string }> {
        return this.post('/api/tasks/create', task);
    }

    async getBossDBUsernameFromToken(token: string): Promise<{ username: string }> {
        const response = await fetch(`${baseUrl}/api/bossdb/username`, {
            headers: {
                "Authorization": `Token ${token}`,
                "Accept": "application/json",
            }
        });
        return response.json();
    }

    async autocompleteBossDBResource({
        collection,
        experiment,
        channel,
    }: {
        collection: string;
        experiment: string | null;
        channel: string | null;
    }): Promise<{ resources: string[] }> {
        let res = await this.get(`/api/bossdb/autocomplete?collection=${collection}&experiment=${experiment || ''}&channel=${channel || ''}`);
        return res;
    }

    async getCoordFrame(collection: string, experiment: string): Promise<{ x_start: number, x_stop: number, y_start: number, y_stop: number, z_start: number, z_stop: number }> {
        return this.get(`/api/bossdb/coord_frame/${collection}/${experiment}`);
    }
};

export default new API();