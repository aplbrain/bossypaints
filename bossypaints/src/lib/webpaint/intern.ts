type BossRemoteOptions = {
	protocol?: string;
	host?: string;
	token?: string;
};

import { baseUrl } from '$lib/api';
import { debug } from './debug';

class BossRemote {
	/*
	A BossRemote -- a JS analogy of `intern.remote.BossRemote`.
	*/

	protocol: string;
	host: string;
	token: string;

	constructor(opts: BossRemoteOptions = {}) {
		/*
		Create a new BossRemote.

		Options:
			protocol (String: 'https')
			host (String: 'api.bossdb.io')
			token (String: 'public')

		*/
		opts = opts || {};
		this.protocol = opts.protocol || 'https';
		this.host = opts.host || 'api.bossdb.io';
		this.token = opts.token || 'public';
	}

	_url(urlSuffix: string) {
		return `${this.protocol}://${this.host}/v1/${urlSuffix}`;
	}

	async _fetchJSONWithHeaders(urlSuffix: string, additionalHeaders: object = {}) {
		additionalHeaders = additionalHeaders || {};
		return fetch(this._url(urlSuffix), {
			headers: { Authorization: `Token ${this.token}`, ...additionalHeaders }
		})
			.then((res) => res.json())
			.catch((err) => debug.error(err));
	}

	async getCutoutPNG(uri: string, res: number, xs: [number, number], ys: [number, number], zs: [number, number]) {
		/*
		Get a cutout in PNG filmstrip format

		/:resolution/:x_range/:y_range/:z_range/:time_range/?iso=:iso
		*/
		// For CloudVolume URIs, use our backend filmstrip endpoint. Heuristic: if uri contains 'precomputed://' or starts with gs://, s3://, file://, https:// (non-Boss host)
		let url: string;
		const isCloudVolume = uri.startsWith('precomputed://') || uri.startsWith('gs://') || uri.startsWith('s3://') || uri.startsWith('file://') || uri.startsWith('https://');
		if (isCloudVolume) {
			// Backend serves at http://localhost:8000/api/filmstrip/cloudvolume
			const backend = baseUrl;
			const params = new URLSearchParams({
				uri,
				res: String(res),
				x: xs.join(':'),
				y: ys.join(':'),
				z: zs.join(':'),
			});
			url = `${backend}/api/filmstrip/cloudvolume?${params.toString()}`;
		} else {
			url = `${this.protocol}://${this.host}/v1/cutout/${uri}/${res}/${xs.join(':')}/${ys.join(':')}/${zs.join(':')}/`;
		}
		const requestTime = Date.now();
		const requestId = Math.random().toString(36).substring(2, 8);

		debug.log(`NETWORK REQUEST [${requestId}]: Fetching from ${url} (${zs[1] - zs[0]} z-slices)`);

		try {
			// Try to request with both PNG and JPEG formats to ensure compatibility
			const headers = {
				Authorization: `Token ${this.token}`,
				Accept: 'image/png, image/jpeg' // Accept both PNG and JPEG formats
			};

			const response = await fetch(url, {
				headers: headers,
				// Add cache busting to prevent browser caching
				cache: 'no-store'
			});

			if (!response.ok) {
				debug.error(`NETWORK ERROR [${requestId}]: ${response.status} ${response.statusText} from ${url}`);
				return null;
			}

			const contentType = response.headers.get('content-type');
			const blob = await response.blob();

			if (!blob || blob.size === 0) {
				debug.error(`NETWORK ERROR [${requestId}]: Received empty blob from ${url} (content-type: ${contentType})`);
				return null;
			}

			const duration = Date.now() - requestTime;
			debug.log(`NETWORK SUCCESS [${requestId}]: Received ${(blob.size / 1024).toFixed(1)}KB from ${url} (content-type: ${contentType}, took ${duration}ms)`);
			return blob;
		} catch (err) {
			const duration = Date.now() - requestTime;
			debug.error(`NETWORK FAILURE [${requestId}]: Error fetching from ${url} after ${duration}ms`, err);
			return null;
		}
	}

	async getCoordFrame(coordFrameName: string) {
		/*
		Get a coordinate frame by its name.

		Arguments:
			coordFrameName (String): The name of the coordframe to check

		Returns:
			Promise<CoordinateFrameObject>

		*/
		return this._fetchJSONWithHeaders(`coord/${coordFrameName}`);
	}

	async getCoordFrameForExperiment(collectionName: string, experimentName: string) {
		/*
		Get a coordinate frame given a collection and experiment name.

		Arguments:
			collectionName (String)
			experimentName (String)

		Returns:
			Promise<String>: CoordinateFrame name

		*/
		// Return the name of the coordinate frame for this resource
		return this._fetchJSONWithHeaders(
			`collection/${collectionName}/experiment/${experimentName}/`
		).then((experiment) => experiment.coord_frame);
	}

	async listCollections() {
		/*
		Get a list of all collections for this Remote

		Arguments:
			None

		Returns:
			Promise<Array<String>>
		*/
		// https://api.theboss.io/v1/collection/
		return this._fetchJSONWithHeaders(`collection/`).then((res) => res.collections);
	}

	async getCollectionMetadata(collectionName: string) {
		const key = '__public_metadata__';
		const link = await this._fetchJSONWithHeaders(`meta/${collectionName}/?key=${key}`);
		const response = await fetch(link.value);
		return response.json();
	}
}

export default BossRemote;
