/**
 * @module ImageCache
 *
 * LRU Cache for managing image chunks with different LOD levels.
 * Handles loading, caching, and eviction of image data from BossDB.
 */

// Note: p5 types are not available, using any for p5.Image
// import type p5 from 'p5';
import type BossRemote from './intern';
import { BrowserStorage } from './BrowserStorage';
import APP_CONFIG from './config';

export interface ChunkIdentifier {
    x_min: number;
    x_max: number;
    y_min: number;
    y_max: number;
    z_min: number;
    z_max: number;
    lod: number;
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
export class ImageCache {
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
        } else {
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
     * Generate a unique key for a chunk identifier
     */
    private generateKey(identifier: ChunkIdentifier): string {
        return `${identifier.x_min}-${identifier.x_max}-${identifier.y_min}-${identifier.y_max}-${identifier.z_min}-${identifier.z_max}-${identifier.lod}`;
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
            return cached.image;
        }

        this.stats.misses++;
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
                identifier.lod, // resolution level
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
            console.warn('Failed to preload chunk:', error);
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
                console.log('Cache metadata loaded from persistent storage');
            }
        } catch (error) {
            console.warn('Failed to load cache from persistent storage:', error);
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
            console.warn('Failed to save cache to persistent storage:', error);
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
            console.warn('Failed to clear persistent storage:', error);
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
            const lod = chunk.identifier.lod;
            const key = `LOD${lod}`;
            usage[key] = (usage[key] || 0) + chunk.size;
        }

        return usage;
    }

    /**
     * Legacy method: Get an image for a chunk identifier
     * This method loads the image if not cached and returns it
     */
    async getImage(identifier: ChunkIdentifier): Promise<any> {
        // First check if it's already cached
        const cached = this.get(identifier);
        if (cached) {
            return cached;
        }

        // If not cached, we need to load it
        if (!this.bossRemote || !this.datasetURI) {
            console.warn('ImageCache.getImage: Image not in cache and BossRemote/URI not available for loading');
            return null;
        }

        try {
            // Use getCutoutPNG method to load the image
            const blob = await this.bossRemote.getCutoutPNG(
                this.datasetURI,
                identifier.lod, // resolution level
                [identifier.x_min, identifier.x_max], // x range
                [identifier.y_min, identifier.y_max], // y range
                [identifier.z_min, identifier.z_max]  // z range
            );

            if (blob && this.p5Instance) {
                // Convert blob to p5.Image
                const url = URL.createObjectURL(blob);
                const image = this.p5Instance.loadImage(url, () => {
                    // Clean up the object URL after the image loads
                    URL.revokeObjectURL(url);
                });

                // Cache the image
                this.set(identifier, image);
                return image;
            }

            return null;
        } catch (error) {
            console.warn('ImageCache.getImage: Failed to load image:', error);
            return null;
        }
    }

    /**
     * Legacy method: Get a cached image (alias for get method)
     */
    getCachedImage(identifier: ChunkIdentifier): any | null {
        return this.get(identifier);
    }

    /**
     * Legacy method: Check if cache is enabled (always true now)
     */
    isCacheEnabled(): boolean {
        return true; // Cache is always enabled now
    }

    /**
     * Legacy method: Get cache statistics (alias for getStatistics)
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
     * Legacy method: Clear all cache data (alias for clear)
     */
    async clearAll(): Promise<void> {
        this.clear();
    }

    /**
     * Legacy method: Preload neighboring chunks around a center chunk
     */
    async preloadNeighboringChunks(centerIdentifier: ChunkIdentifier, radius: number): Promise<void> {
        // For now, just log that this would preload neighbors
        console.log(`ImageCache: Would preload ${radius} radius neighbors around chunk`, centerIdentifier);
    }

    /**
     * Legacy method: Preload neighboring filmstrip batches
     */
    async preloadNeighboringFilmstrips(centerIdentifier: ChunkIdentifier): Promise<void> {
        // For now, just log that this would preload filmstrips
        console.log('ImageCache: Would preload neighboring filmstrips for chunk', centerIdentifier);
    }

    /**
     * Legacy method: Evict all chunks of a specific LOD level
     */
    evictLODLevel(multiplier: number): void {
        const toRemove: string[] = [];

        for (const [key, chunk] of this.cache.entries()) {
            if (chunk.identifier.lod === multiplier) {
                toRemove.push(key);
            }
        }

        for (const key of toRemove) {
            const chunk = this.cache.get(key)!;
            this.cache.delete(key);
            this.currentSize -= chunk.size;
        }

        console.log(`ImageCache: Evicted ${toRemove.length} chunks from LOD level ${multiplier}`);
    }

    /**
     * Legacy method: Get filmstrip render info for a chunk
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
            console.warn(`Target layer ${layerToExtract} is outside filmstrip range [${identifier.z_min}, ${identifier.z_max})`);
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
        
        console.log(`Filmstrip extraction: layer ${layerToExtract}, offset ${layerOffsetInFilmstrip}, sourceY=${sourceY}, sourceHeight=${sourceHeight}, total height=${filmstripChunk.image.height}`);
        
        return {
            filmstrip: filmstripChunk.image,
            sourceX: sourceX,
            sourceY: sourceY,
            sourceWidth: sourceWidth,
            sourceHeight: sourceHeight
        };
    }

    /**
     * Legacy method: Get combined cache and storage statistics
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