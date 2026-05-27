import type PolygonAnnotation from '$lib/webpaint/PolygonAnnotation';
import type { SplitMethod, SplitSeed } from '$lib/webpaint/split';

const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
	/\/$/,
	''
);
const baseUrl = configuredBaseUrl || 'https://api.paint.labs.bossdb.org';

export { baseUrl };

export type TaskID = string;

export type Task = {
	data_source_type: 'bossdb' | 'cloudvolume';
	name?: string;
	collection?: string;
	experiment?: string;
	channel?: string;
	cloudvolume_uri?: string;
	resolution: number;
	x_min: number;
	x_max: number;
	y_min: number;
	y_max: number;
	z_min: number;
	z_max: number;
	priority?: number;
	output_type?: 'bossdb' | 'download';
	destination_collection?: string;
	destination_experiment?: string;
	destination_channel?: string;
	assigned_to?: string;
	export_pending?: boolean;
	archived?: boolean;
};

export type TaskInDB = Task & {
	id: TaskID;
};

export type ExportFile = {
	filename: string;
	size: number;
	modified: number;
};

export type TaskExports = {
	meshes: ExportFile[];
	segments: ExportFile[];
	cloudvolumes?: ExportFile[];
};

export type PolygonAnnotationPayload = {
	positiveRegions: Array<Array<[number, number]>>;
	negativeRegions?: Array<Array<[number, number]>>;
	editing: boolean;
	segmentID: number;
	color?: number[] | null;
	z: number;
};

export type CheckpointPayload = {
	polygons: Array<PolygonAnnotationPayload>;
	taskID: TaskID;
	mergeGroups?: Array<Array<number>>;
};

export type PropagateSegmentResponse = {
	method: string;
	display_name: string;
	source_z: number;
	target_z: number;
	segment_id: number;
	polygons: PolygonAnnotationPayload[];
	meta?: Record<string, unknown>;
};

export type SplitSegmentResponse = {
	method: string;
	display_name: string;
	segment_id: number;
	new_segment_id: number;
	polygons: PolygonAnnotationPayload[];
	meta?: Record<string, unknown>;
};

class API {
	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};
		if (localStorage.getItem('apiToken')) {
			headers['Authorization'] = `Token ${localStorage.getItem('apiToken')}`;
		}
		return headers;
	}

	async get(url: string) {
		url = url.startsWith('/') ? url : `/${url}`;
		const response = await fetch(`${baseUrl}${url}`, {
			headers: this.buildHeaders()
		});
		return response.json();
	}

	async post(url: string, data: any) {
		url = url.startsWith('/') ? url : `/${url}`;
		const response = await fetch(`${baseUrl}${url}`, {
			method: 'POST',
			headers: this.buildHeaders(),
			body: JSON.stringify(data)
		});
		return response.json();
	}

	async getTasks(): Promise<{ tasks: TaskInDB[] }> {
		return this.get('/api/tasks');
	}

	async getArchivedTasks(): Promise<{ tasks: TaskInDB[] }> {
		return this.get('/api/tasks/archived');
	}

	async getTask(taskId: TaskID): Promise<{ task: TaskInDB }> {
		return this.get(`/api/tasks/${taskId}`);
	}

	async getNextTask(): Promise<{ task: TaskInDB }> {
		return this.get('/api/tasks/next');
	}

	async checkpointTask({
		taskId,
		checkpoint,
		mergeGroups = []
	}: {
		taskId: TaskID;
		checkpoint: Array<PolygonAnnotation | PolygonAnnotationPayload>;
		mergeGroups?: Array<Array<number>>;
	}) {
		return this.post(`/api/tasks/${taskId}/checkpoint`, { checkpoint, mergeGroups });
	}

	async getTaskCheckpoints(taskId: TaskID): Promise<{ checkpoints: Array<CheckpointPayload> }> {
		return this.get(`/api/tasks/${taskId}/checkpoints`);
	}

	async saveTask({
		taskId,
		checkpoint,
		mergeGroups = []
	}: {
		taskId: TaskID;
		checkpoint: Array<PolygonAnnotation | PolygonAnnotationPayload>;
		mergeGroups?: Array<Array<number>>;
	}) {
		return this.post(`/api/tasks/${taskId}/save`, { checkpoint, mergeGroups });
	}

	async createTask(task: Task): Promise<{ message: string }> {
		return this.post('/api/tasks/create', task);
	}

	async archiveTask(taskId: TaskID): Promise<{ message: string }> {
		return this.post(`/api/tasks/${taskId}/archive`, {});
	}

	async unarchiveTask(taskId: TaskID): Promise<{ message: string }> {
		return this.post(`/api/tasks/${taskId}/unarchive`, {});
	}

	async updateTaskName(
		taskId: TaskID,
		name: string | null
	): Promise<{ message: string; name: string | null }> {
		return this.post(`/api/tasks/${taskId}/update-name`, { name });
	}

	async propagateSegment({
		taskId,
		method,
		sourceZ,
		targetZ,
		segmentID,
		sourcePolygons,
		options
	}: {
		taskId: TaskID;
		method: string;
		sourceZ: number;
		targetZ: number;
		segmentID: number;
		sourcePolygons: PolygonAnnotation[];
		options?: Record<string, unknown>;
	}): Promise<PropagateSegmentResponse> {
		const response = await fetch(`${baseUrl}/api/tasks/${taskId}/propagate-segment`, {
			method: 'POST',
			headers: this.buildHeaders(),
			body: JSON.stringify({
				method,
				source_z: sourceZ,
				target_z: targetZ,
				segment_id: segmentID,
				source_polygons: sourcePolygons,
				options: options || {}
			})
		});
		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.detail || payload.message || 'Segment propagation failed.');
		}
		return payload;
	}

	async splitSegment({
		taskId,
		method,
		segmentID,
		newSegmentID,
		sourcePolygons,
		seeds,
		options
	}: {
		taskId: TaskID;
		method: SplitMethod;
		segmentID: number;
		newSegmentID: number;
		sourcePolygons: Array<PolygonAnnotation | PolygonAnnotationPayload>;
		seeds: Array<SplitSeed>;
		options?: Record<string, unknown>;
	}): Promise<SplitSegmentResponse> {
		const response = await fetch(`${baseUrl}/api/tasks/${taskId}/split-segment`, {
			method: 'POST',
			headers: this.buildHeaders(),
			body: JSON.stringify({
				method,
				segment_id: segmentID,
				new_segment_id: newSegmentID,
				source_polygons: sourcePolygons,
				seeds,
				options: options || {}
			})
		});
		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.detail || payload.message || 'Segment split failed.');
		}
		return payload;
	}

	async getBossDBUsernameFromToken(token: string): Promise<{ username: string }> {
		const response = await fetch(`${baseUrl}/api/bossdb/username`, {
			headers: {
				Authorization: `Token ${token}`,
				Accept: 'application/json'
			}
		});
		return response.json();
	}

	async autocompleteBossDBResource({
		collection,
		experiment,
		channel
	}: {
		collection: string;
		experiment: string | null;
		channel: string | null;
	}): Promise<{ resources: string[] }> {
		let res = await this.get(
			`/api/bossdb/autocomplete?collection=${collection}&experiment=${experiment || ''}&channel=${channel || ''}`
		);
		return res;
	}

	async getCoordFrame(
		collection: string,
		experiment: string
	): Promise<{
		x_start: number;
		x_stop: number;
		y_start: number;
		y_stop: number;
		z_start: number;
		z_stop: number;
	}> {
		return this.get(`/api/bossdb/coord_frame/${collection}/${experiment}`);
	}

	async getTaskExports(taskId: TaskID): Promise<{ exports: TaskExports }> {
		return this.get(`/api/tasks/${taskId}/exports`);
	}

	getTaskExportDownloadUrl(taskId: TaskID, filename: string): string {
		const headers: Record<string, string> = {};
		if (localStorage.getItem('apiToken')) {
			headers['Authorization'] = `Token ${localStorage.getItem('apiToken')}`;
		}
		const params = new URLSearchParams();
		if (localStorage.getItem('apiToken')) {
			params.append('token', localStorage.getItem('apiToken') || '');
		}
		return `${baseUrl}/api/tasks/${taskId}/exports/download/${filename}?${params.toString()}`;
	}

	getTaskExportDownloadAllUrl(taskId: TaskID): string {
		const params = new URLSearchParams();
		if (localStorage.getItem('apiToken')) {
			params.append('token', localStorage.getItem('apiToken') || '');
		}
		return `${baseUrl}/api/tasks/${taskId}/exports/download-all?${params.toString()}`;
	}
}

export default new API();
