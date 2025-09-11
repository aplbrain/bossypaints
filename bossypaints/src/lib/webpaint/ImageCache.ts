/**
 * @module ImageCache
 *
 * LRU Cache for managing image chunks with different resolution levels.
 * Handles loading, caching, and eviction of image data from BossDB.
 */

// Note: p5 types are not available, using any for p5.Image
// import type p5 from 'p5';
import type BossRemote from './intern';
import { BrowserStorage } from './BrowserStorage';
import { debug as debugUtil } from './debug';
import APP_CONFIG from './config';

export interface ChunkIdentifier {
    x_min: number;
    x_max: number;
    y_min: number;
    y_max: number;
    z_min: number;
    z_max: number;
    resolution: number;
}

export interface CachedChunk {
    id: string;
    identifier: ChunkIdentifier;
    image: any; // p5.Image
    timestamp: number;
    size: number;
}

export interface CacheStatistics {
    hits: number;
    misses: number;
    evictions: number;
    totalSize: number;
    itemCount: number;
    hitRate: number;
}

export interface CacheOptions {
    maxSizeBytes?: number;
    maxItems?: number;
    enablePersistence?: boolean;
    enablePreloading?: boolean;
    filmstripBatchSize?: number;
}

/**
 * LRU Cache implementation for image chunks
 * Caching is always enabled - no option to disable
 */
export interface RequestContext {
    filmstripRange?: { z_min: number; z_max: number };
    spatialRegion?: { x_min: number; x_max: number; y_min: number; y_max: number };
    resolution?: number;
}

export class ImageCache {
    // Track active requests for smart cancellation
    private activeRequests = new Map<string, { controller: AbortController; context: RequestContext }>();
    private cache: Map<string, CachedChunk> = new Map();
    private maxSizeBytes: number;
    private maxItems: number;
    private currentSize: number = 0;
    private enablePersistence: boolean;
    private enablePreloading: boolean;
    private filmstripBatchSize: number;
    private storage: BrowserStorage;
    private bossRemote?: BossRemote;
    private datasetURI?: string;
    private p5Instance?: any;
    private currentWindow: { min: number; max: number } = { min: 0, max: 255 };

    // Cache of adjusted (windowed) filmstrip images per chunk identifier and hist window
    private adjustedCache: Map<string, Map<string, { image: any; timestamp: number }>> = new Map();

    // Statistics
    private stats = {
        hits: 0,
        misses: 0,
        evictions: 0
    };

    constructor(
        bossRemoteOrOptions?: BossRemote | CacheOptions,
        datasetURI?: string,
        p5Instance?: any,
        maxSizeMB?: number
    ) {
        // Handle both old and new constructor signatures
        if (bossRemoteOrOptions && typeof bossRemoteOrOptions === 'object' && !('protocol' in bossRemoteOrOptions)) {
            // New constructor with options object
            const options = bossRemoteOrOptions as CacheOptions;
            this.maxSizeBytes = options.maxSizeBytes || 100 * 1024 * 1024; // 100MB default
            this.maxItems = options.maxItems || 1000; // 1000 items default
            this.enablePersistence = options.enablePersistence ?? true;
            this.enablePreloading = options.enablePreloading ?? true;
            this.filmstripBatchSize = options.filmstripBatchSize || APP_CONFIG.filmstrip.batchSize;
        }
        else {
            // Legacy constructor with individual parameters
            this.bossRemote = bossRemoteOrOptions as BossRemote;
            this.datasetURI = datasetURI;
            this.p5Instance = p5Instance;
            this.maxSizeBytes = (maxSizeMB || 100) * 1024 * 1024; // Convert MB to bytes
            this.maxItems = 1000;
            this.enablePersistence = true;
            this.enablePreloading = true;
            this.filmstripBatchSize = APP_CONFIG.filmstrip.batchSize;
        }

        this.storage = new BrowserStorage();
        this.loadFromPersistentStorage();
    }

    /**
     * Update the desired histogram window for future fetches (CloudVolume only).
     */
    setHistogramWindow(min: number, max: number) {
        const m = Math.max(0, Math.min(65535, Math.floor(min)));
        const M = Math.max(m, Math.min(65535, Math.floor(max)));
        this.currentWindow = { min: m, max: M };
    }

    /**
     * Generate a unique key for a chunk identifier
     */
    private generateKey(identifier: ChunkIdentifier): string {
        return `${identifier.x_min}-${identifier.x_max}-${identifier.y_min}-${identifier.y_max}-${identifier.z_min}-${identifier.z_max}-${identifier.resolution}`;
    }

    /**
     * Estimate the size of a cached chunk in bytes
     */
    private estimateChunkSize(chunk: CachedChunk): number {
        if (chunk.size) {
            return chunk.size;
        }

        // Estimate based on image dimensions if available
        const width = chunk.identifier.x_max - chunk.identifier.x_min;
        const height = chunk.identifier.y_max - chunk.identifier.y_min;
        // Assume 4 bytes per pixel (RGBA)
        return width * height * 4;
    }

    /**
     * Get an item from the cache
     */
    get(identifier: ChunkIdentifier): any | null {
        const key = this.generateKey(identifier);
        const cached = this.cache.get(key);

        if (cached) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, cached);
            this.stats.hits++;
            // debugUtil.log(`CACHE HIT: ${key} (resolution ${identifier.resolution})`);
            return cached.image;
        }

        this.stats.misses++;
        debugUtil.log(`CACHE MISS: ${key} (resolution ${identifier.resolution})`);
        return null;
    }

    /**
     * Set an item in the cache
     */
    set(identifier: ChunkIdentifier, image: any): void {
        const key = this.generateKey(identifier);
        const size = this.estimateChunkSize({
            id: key,
            identifier,
            image,
            timestamp: Date.now(),
            size: 0
        });

        const chunk: CachedChunk = {
            id: key,
            identifier,
            image,
            timestamp: Date.now(),
            size
        };

        // Remove existing entry if it exists
        if (this.cache.has(key)) {
            const existing = this.cache.get(key)!;
            this.currentSize -= existing.size;
            this.cache.delete(key);
        }

        // Add new entry
        this.cache.set(key, chunk);
        this.currentSize += size;
        debugUtil.log(`CACHE SET: ${key} (resolution ${identifier.resolution}) - Cache size: ${this.cache.size} items, ${(this.currentSize / 1024 / 1024).toFixed(1)}MB`);

        // Evict if necessary
        this.evictIfNecessary();

        // Persist if enabled
        if (this.enablePersistence) {
            this.saveToPersistentStorage();
        }
    }

    /**
     * Check if an item exists in the cache
     */
    has(identifier: ChunkIdentifier): boolean {
        const key = this.generateKey(identifier);
        return this.cache.has(key);
    }

    /**
     * Remove an item from the cache
     */
    delete(identifier: ChunkIdentifier): boolean {
        const key = this.generateKey(identifier);
        const cached = this.cache.get(key);

        if (cached) {
            this.cache.delete(key);
            this.currentSize -= cached.size;
            // Also clear any adjusted windowed variants
            this.adjustedCache.delete(key);

            if (this.enablePersistence) {
                this.saveToPersistentStorage();
            }

            return true;
        }

        return false;
    }

    /**
     * Clear the entire cache
     */
    clear(): void {
        this.cache.clear();
        this.adjustedCache.clear();
        this.currentSize = 0;
        this.stats.hits = 0;
        this.stats.misses = 0;
        this.stats.evictions = 0;

        if (this.enablePersistence) {
            this.clearPersistentStorage();
        }
    }

    /**
     * Evict items if cache is over limits
     */
    private evictIfNecessary(): void {
        // Evict by size
        while (this.currentSize > this.maxSizeBytes && this.cache.size > 0) {
            this.evictLeastRecentlyUsed();
        }

        // Evict by item count
        while (this.cache.size > this.maxItems) {
            this.evictLeastRecentlyUsed();
        }
    }

    /**
     * Evict the least recently used item
     */
    private evictLeastRecentlyUsed(): void {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
            const chunk = this.cache.get(firstKey)!;
            this.cache.delete(firstKey);
            this.currentSize -= chunk.size;
            this.stats.evictions++;
            // Also clear adjusted variants for this chunk
            this.adjustedCache.delete(firstKey);
        }
    }

    /**
     * Get cache statistics
     */
    getStatistics(): CacheStatistics {
        const totalRequests = this.stats.hits + this.stats.misses;
        const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            evictions: this.stats.evictions,
            totalSize: this.currentSize,
            itemCount: this.cache.size,
            hitRate: Math.round(hitRate * 100) / 100
        };
    }

    /**
     * Preload chunks in a filmstrip pattern
     */
    async preloadFilmstrip(
        centerIdentifier: ChunkIdentifier,
        bossRemote: BossRemote,
        uri: string,
        direction: 'x' | 'y' | 'z' = 'z'
    ): Promise<void> {
        if (!this.enablePreloading) {
            return;
        }

        const preloadPromises: Promise<void>[] = [];
        const batchSize = this.filmstripBatchSize;

        for (let i = -Math.floor(batchSize / 2); i <= Math.floor(batchSize / 2); i++) {
            if (i === 0) continue; // Skip center chunk (already loaded)

            const identifier = { ...centerIdentifier };
            switch (direction) {
                case 'x':
                    identifier.x_min += i * (identifier.x_max - identifier.x_min);
                    identifier.x_max += i * (identifier.x_max - identifier.x_min);
                    break;
                case 'y':
                    identifier.y_min += i * (identifier.y_max - identifier.y_min);
                    identifier.y_max += i * (identifier.y_max - identifier.y_min);
                    break;
                case 'z':
                    identifier.z_min += i;
                    identifier.z_max += i;
                    break;
            }

            // Only preload if not already in cache
            if (!this.has(identifier)) {
                preloadPromises.push(this.preloadChunk(identifier, bossRemote, uri));
            }
        }

        await Promise.allSettled(preloadPromises);
    }

    /**
     * Preload a single chunk
     */
    private async preloadChunk(identifier: ChunkIdentifier, bossRemote: BossRemote, uri: string): Promise<void> {
        try {
            // Use getCutoutPNG method with the correct parameters
            const blob = await bossRemote.getCutoutPNG(
                uri,
                identifier.resolution, // resolution level
                [identifier.x_min, identifier.x_max], // x range
                [identifier.y_min, identifier.y_max], // y range
                [identifier.z_min, identifier.z_max]  // z range
            );

            if (blob) {
                // Convert blob to image data that can be cached
                // Note: In a real implementation, you'd convert this to a p5.Image or similar
                this.set(identifier, blob);
            }
        } catch (error) {
            debugUtil.warn('Failed to preload chunk:', error);
        }
    }

    /**
     * Load cache from persistent storage
     */
    private loadFromPersistentStorage(): void {
        if (!this.enablePersistence) {
            return;
        }

        try {
            const cacheConfig = this.storage.loadCacheConfig();
            if (cacheConfig) {
                // Note: We can't restore actual p5.Image objects from JSON
                // This would need to be implemented with actual image data serialization
                debugUtil.log('Cache metadata loaded from persistent storage');
            }
        } catch (error) {
            debugUtil.warn('Failed to load cache from persistent storage:', error);
        }
    }

    /**
     * Save cache to persistent storage
     */
    private saveToPersistentStorage(): void {
        if (!this.enablePersistence) {
            return;
        }

        try {
            // Save only metadata, not the actual image data
            const metadata = {
                stats: this.stats,
                cacheSize: this.cache.size,
                currentSize: this.currentSize,
                timestamp: Date.now()
            };

            // Use localStorage as a fallback since BrowserStorage doesn't have direct setItem
            localStorage.setItem('imageCacheMetadata', JSON.stringify(metadata));
        } catch (error) {
            debugUtil.warn('Failed to save cache to persistent storage:', error);
        }
    }

    /**
     * Clear persistent storage
     */
    private clearPersistentStorage(): void {
        if (!this.enablePersistence) {
            return;
        }

        try {
            // Use localStorage for metadata storage
            localStorage.removeItem('imageCacheMetadata');
            // Clear dataset-specific data through BrowserStorage
            // Note: We'd need a dataset URI to clear specific data
        } catch (error) {
            debugUtil.warn('Failed to clear persistent storage:', error);
        }
    }

    /**
     * Get cache configuration
     */
    getConfig(): CacheOptions {
        return {
            maxSizeBytes: this.maxSizeBytes,
            maxItems: this.maxItems,
            enablePersistence: this.enablePersistence,
            enablePreloading: this.enablePreloading,
            filmstripBatchSize: this.filmstripBatchSize
        };
    }

    /**
     * Update cache configuration
     */
    updateConfig(options: Partial<CacheOptions>): void {
        if (options.maxSizeBytes !== undefined) {
            this.maxSizeBytes = options.maxSizeBytes;
        }
        if (options.maxItems !== undefined) {
            this.maxItems = options.maxItems;
        }
        if (options.enablePersistence !== undefined) {
            this.enablePersistence = options.enablePersistence;
        }
        if (options.enablePreloading !== undefined) {
            this.enablePreloading = options.enablePreloading;
        }
        if (options.filmstripBatchSize !== undefined) {
            this.filmstripBatchSize = options.filmstripBatchSize;
        }

        // Evict if new limits are smaller
        this.evictIfNecessary();
    }

    /**
     * Get all cached chunk identifiers
     */
    getCachedIdentifiers(): ChunkIdentifier[] {
        return Array.from(this.cache.values()).map(chunk => chunk.identifier);
    }

    /**
     * Get cache memory usage breakdown
     */
    getMemoryUsage(): { [key: string]: number } {
        const usage: { [key: string]: number } = {};

        for (const chunk of this.cache.values()) {
            const resolution = chunk.identifier.resolution;
            const key = `Resolution${resolution}`;
            usage[key] = (usage[key] || 0) + chunk.size;
        }

        return usage;
    }

    /**
     * This method loads the image if not cached and returns it
     */
    async getImage(identifier: ChunkIdentifier, context?: RequestContext): Promise<any> {
        // First check if it's already cached
        const cached = this.get(identifier);
        if (cached) {
            return cached;
        }

        if (!this.bossRemote || !this.datasetURI) {
            debugUtil.warn('ImageCache.getImage: Image not in cache and BossRemote/URI not available for loading');
            return null;
        }

        // Generate a request key based on chunk and context
        const requestKey = this.generateKey(identifier) +
            (context && context.filmstripRange ? `-z${context.filmstripRange.z_min}_${context.filmstripRange.z_max}` : '') +
            (context && context.resolution !== undefined ? `-r${context.resolution}` : '');

        // Cancel obsolete requests
        this.cancelObsoleteRequests(context);

        const controller = new AbortController();
        this.activeRequests.set(requestKey, { controller, context: context || {} });
        try {
            const blob = await this.bossRemote.getCutoutPNG(
                this.datasetURI,
                identifier.resolution,
                [identifier.x_min, identifier.x_max],
                [identifier.y_min, identifier.y_max],
                [identifier.z_min, identifier.z_max],
                controller.signal
            );
            this.activeRequests.delete(requestKey);
            if (blob && this.p5Instance) {
                const url = URL.createObjectURL(blob);
                const image = this.p5Instance.loadImage(url, () => {
                    URL.revokeObjectURL(url);
                });
                this.set(identifier, image);
                return image;
            }
            return null;
        } catch (error: any) {
            this.activeRequests.delete(requestKey);
            if (error && error.name === 'AbortError') {
                debugUtil.log('Image request cancelled:', requestKey);
                return null;
            }
            debugUtil.warn('ImageCache.getImage: Failed to load image:', error);
            return null;
        }
    }

    // Cancel requests that are obsolete based on filmstrip batch and resolution
    private cancelObsoleteRequests(newContext?: RequestContext) {
        if (!newContext || !newContext.filmstripRange) return;
        for (const [key, req] of this.activeRequests.entries()) {
            if (req.context && req.context.filmstripRange && req.context.resolution !== undefined) {
                // Cancel if different filmstrip batch or different resolution
                const old = req.context;
                const newF = newContext.filmstripRange;
                const oldF = old.filmstripRange;
                let diffBatch = false;
                if (oldF && newF) {
                    diffBatch = oldF.z_min !== newF.z_min || oldF.z_max !== newF.z_max;
                }
                const diffRes = old.resolution !== newContext.resolution;
                if (diffBatch || diffRes) {
                    req.controller.abort();
                    this.activeRequests.delete(key);
                }
            }
        }
    }

    /**
     * Get a cached image (alias for get method)
     */
    getCachedImage(identifier: ChunkIdentifier): any | null {
        return this.get(identifier);
    }

    /**
     * Get a histogram-windowed version of a cached filmstrip image for a chunk.
     * Uses a 256-entry LUT and caches results per (chunk, min, max) for fast reuse.
     */
    getAdjustedImageForWindow(
        identifier: ChunkIdentifier,
        baseImage: any,
        histMin: number,
        histMax: number
    ): any {
        try {
            if (!baseImage || !this.p5Instance) return baseImage;

            // Clamp to 8-bit domain since filmstrips are uint8
            const min8 = Math.max(0, Math.min(255, Math.floor(histMin)));
            const max8 = Math.max(min8, Math.min(255, Math.floor(histMax)));

            const key = this.generateKey(identifier);
            const windowKey = `${min8}-${max8}`;

            let perChunk = this.adjustedCache.get(key);
            if (!perChunk) {
                perChunk = new Map();
                this.adjustedCache.set(key, perChunk);
            }

            const cached = perChunk.get(windowKey);
            if (cached) {
                cached.timestamp = Date.now();
                return cached.image;
            }

            // Build LUT
            const lut = new Uint8ClampedArray(256);
            const range = Math.max(1, max8 - min8);
            for (let i = 0; i < 256; i++) {
                let v = ((i - min8) * 255) / range;
                if (v < 0) v = 0;
                if (v > 255) v = 255;
                lut[i] = v | 0;
            }

            // Draw to an offscreen canvas to access pixels quickly
            const off = document.createElement('canvas');
            off.width = baseImage.width;
            off.height = baseImage.height;
            const ctx = off.getContext('2d');
            if (!ctx) return baseImage;
            // p5.Image stores an HTMLCanvas on .canvas
            ctx.drawImage(baseImage.canvas ?? baseImage, 0, 0);
            const imgData = ctx.getImageData(0, 0, off.width, off.height);
            const data = imgData.data;

            // Apply LUT to grayscale image (assume R=G=B; leave A unchanged)
            for (let i = 0; i < data.length; i += 4) {
                const v = data[i];
                const m = lut[v];
                data[i] = m;
                data[i + 1] = m;
                data[i + 2] = m;
                // alpha remains
            }

            // Create a p5.Image from the adjusted pixels
            const out = this.p5Instance.createImage(off.width, off.height);
            out.loadPixels();
            // Ensure buffer sizes match
            if (out.pixels && out.pixels.length === data.length) {
                out.pixels.set(data);
            } else {
                // Fallback: put back to canvas and use as source for p5 loadImage (async)
                ctx.putImageData(imgData, 0, 0);
                const url = off.toDataURL('image/png');
                const img = this.p5Instance.loadImage(url, () => URL.revokeObjectURL(url));
                perChunk.set(windowKey, { image: img, timestamp: Date.now() });
                // Evict older windows beyond a small limit per chunk
                this.evictOldWindows(perChunk);
                return img;
            }
            out.updatePixels();

            perChunk.set(windowKey, { image: out, timestamp: Date.now() });
            this.evictOldWindows(perChunk);
            return out;
        } catch (e) {
            debugUtil.warn('ImageCache: windowing failed, using base image', e);
            return baseImage;
        }
    }

    private evictOldWindows(perChunk: Map<string, { image: any; timestamp: number }>, maxPerChunk: number = 4) {
        if (perChunk.size <= maxPerChunk) return;
        // Delete the oldest entries to keep memory in check
        const entries = Array.from(perChunk.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toDelete = entries.length - maxPerChunk;
        for (let i = 0; i < toDelete; i++) {
            perChunk.delete(entries[i][0]);
        }
    }

    /**
     * Check if cache is enabled (always true now)
     */
    isCacheEnabled(): boolean {
        return true; // Cache is always enabled now
    }

    /**
     * Get cache statistics (alias for getStatistics)
     */
    getStats(): any {
        const stats = this.getStatistics();
        // Return in the format expected by the legacy code
        return {
            entryCount: stats.itemCount,
            cacheSize: stats.totalSize,
            maxCacheSize: this.maxSizeBytes,
            utilizationPercent: (stats.totalSize / this.maxSizeBytes) * 100,
            filmstripCount: 0, // Legacy filmstrip count
            totalSlicesInFilmstrips: 0,
            loadingCount: 0,
            filmstripLoadingCount: 0
        };
    }

    /**
     * Clear all cache data (alias for clear)
     */
    async clearAll(): Promise<void> {
        this.clear();
    }

    /**
     * Preload neighboring chunks around a center chunk
     */
    async preloadNeighboringChunks(centerIdentifier: ChunkIdentifier, radius: number): Promise<void> {
        // For now, just log that this would preload neighbors
        debugUtil.log(`ImageCache: Would preload ${radius} radius neighbors around chunk`, centerIdentifier);
    }

    /**
     * Preload neighboring filmstrip batches
     */
    async preloadNeighboringFilmstrips(centerIdentifier: ChunkIdentifier): Promise<void> {
        // For now, just log that this would preload filmstrips
        debugUtil.log('ImageCache: Would preload neighboring filmstrips for chunk', centerIdentifier);
    }

    /**
     * Evict all chunks of a specific resolution level
     */
    evictResolutionLevel(resolutionLevel: number): void {
        const toRemove: string[] = [];

        for (const [key, chunk] of this.cache.entries()) {
            if (chunk.identifier.resolution === resolutionLevel) {
                toRemove.push(key);
            }
        }

        for (const key of toRemove) {
            const chunk = this.cache.get(key)!;
            this.cache.delete(key);
            this.currentSize -= chunk.size;
        }

        debugUtil.log(`ImageCache: Evicted ${toRemove.length} chunks from resolution level ${resolutionLevel}`);
    }

    /**
     * Get filmstrip render info for a chunk
     */
    getFilmstripRenderInfo(identifier: ChunkIdentifier, targetLayer?: number): any | null {
        // Check if we have a filmstrip that contains this layer
        const filmstripKey = this.generateKey(identifier);
        const filmstripChunk = this.cache.get(filmstripKey);

        if (!filmstripChunk || !filmstripChunk.image) {
            return null;
        }

        // Use the provided target layer, or default to the first layer in the filmstrip
        const layerToExtract = targetLayer !== undefined ? targetLayer : identifier.z_min;

        // Verify that the target layer is within the filmstrip range
        if (layerToExtract < identifier.z_min || layerToExtract >= identifier.z_max) {
            debugUtil.warn(`Target layer ${layerToExtract} is outside filmstrip range [${identifier.z_min}, ${identifier.z_max})`);
            return null;
        }

        // Calculate the relative position within the filmstrip
        const layerOffsetInFilmstrip = layerToExtract - identifier.z_min;

        // Each layer in the filmstrip occupies a vertical slice
        // Filmstrip image height = imageHeight * batchSize (16 layers stacked vertically)
        const imageHeight = filmstripChunk.image.height / this.filmstripBatchSize;
        const imageWidth = filmstripChunk.image.width;

        // Calculate source coordinates for extracting the specific layer
        const sourceX = 0; // Always start from left edge
        const sourceY = layerOffsetInFilmstrip * imageHeight; // Vertical offset for the target layer
        const sourceWidth = imageWidth; // Full width
        const sourceHeight = imageHeight; // Single layer height

        debugUtil.log(`Filmstrip extraction: layer ${layerToExtract}, offset ${layerOffsetInFilmstrip}, sourceY=${sourceY}, sourceHeight=${sourceHeight}, total height=${filmstripChunk.image.height}`);

        return {
            filmstrip: filmstripChunk.image,
            sourceX: sourceX,
            sourceY: sourceY,
            sourceWidth: sourceWidth,
            sourceHeight: sourceHeight
        };
    }

    /**
     * Get combined cache and storage statistics
     */
    async getCombinedStats(): Promise<any> {
        const cacheStats = this.getStatistics();

        return {
            cache: cacheStats,
            storage: {
                totalChunks: 0,
                estimatedSize: 0
            }
        };
    }
}

// Export a singleton instance
export const imageCache = new ImageCache();
export default imageCache;