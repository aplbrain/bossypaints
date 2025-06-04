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
    resolution: number;
    multiplier: number;
}

export interface FilmstripBatch {
    x_min: number;
    x_max: number;
    y_min: number;
    y_max: number;
    z_min: number;  // Start of filmstrip batch (aligned to batch boundaries)
    z_max: number;  // End of filmstrip batch
    resolution: number;
    multiplier: number;
    batchSize: number;  // Number of z-slices in this batch
}

export interface CacheEntry {
    image: any; // p5.Image
    lastAccessed: number;
    key: string;
    size: number; // Memory footprint estimate
}

export interface FilmstripEntry {
    filmstrip: any; // p5.Image - The full filmstrip image (concatenated z-slices)
    slices: Map<number, any>; // Map<number, p5.Image> - Individual slices extracted from filmstrip
    lastAccessed: number;
    key: string;
    size: number;
    batchInfo: FilmstripBatch;
}

export interface LoadingEntry {
    promise: Promise<any | null>; // Promise<p5.Image | null>
    abortController: AbortController;
}

/**
 * LRU Cache for image chunks with support for different LOD levels and filmstrip batches
 */
export class ImageCache {
    private cache: Map<string, CacheEntry> = new Map();
    private filmstripCache: Map<string, FilmstripEntry> = new Map();
    private loading: Map<string, LoadingEntry> = new Map();
    private filmstripLoading: Map<string, LoadingEntry> = new Map();
    private maxCacheSize: number;
    private currentCacheSize: number = 0;
    private remote: BossRemote;
    private datasetURI: string;
    private p5Instance: any; // p5 instance
    private browserStorage: BrowserStorage;

    constructor(
        remote: BossRemote,
        datasetURI: string,
        p5Instance: any, // p5 instance
        maxCacheSizeMB: number = 100
    ) {
        this.remote = remote;
        this.datasetURI = datasetURI;
        this.p5Instance = p5Instance;
        this.maxCacheSize = maxCacheSizeMB * 1024 * 1024; // Convert MB to bytes
        this.browserStorage = new BrowserStorage();

        // Initialize from stored data
        this.initializeFromStorage();
    }

    /**
     * Initialize cache from browser storage
     */
    private async initializeFromStorage(): Promise<void> {
        try {
            // Clean up old chunks on startup (older than 7 days)
            await this.browserStorage.cleanupOldChunks();

            console.log('ImageCache initialized with browser storage support');
        } catch (error) {
            console.error('Failed to initialize from storage:', error);
        }
    }

    /**
     * Generate a unique cache key for a chunk
     */
    private generateKey(chunk: ChunkIdentifier): string {
        return `${chunk.resolution}_${chunk.multiplier}x_${chunk.x_min}-${chunk.x_max}_${chunk.y_min}-${chunk.y_max}_${chunk.z_min}-${chunk.z_max}`;
    }

    /**
     * Estimate memory footprint of an image
     */
    private estimateImageSize(width: number, height: number, depth: number): number {
        // 4 bytes per pixel (RGBA) * width * height * depth
        return width * height * depth * 4;
    }

    /**
     * Remove least recently used entries until cache is under size limit
     */
    private evictLRU(): void {
        if (this.currentCacheSize <= this.maxCacheSize) return;

        // Sort entries by last accessed time (oldest first)
        const entries = Array.from(this.cache.entries()).sort(
            (a, b) => a[1].lastAccessed - b[1].lastAccessed
        );

        for (const [key, entry] of entries) {
            this.cache.delete(key);
            this.currentCacheSize -= entry.size;

            console.log(`Evicted cache entry: ${key} (${(entry.size / 1024 / 1024).toFixed(1)}MB)`);

            if (this.currentCacheSize <= this.maxCacheSize * 0.8) {
                // Stop when we're 20% below the limit to avoid immediate re-eviction
                break;
            }
        }
    }

    /**
     * Remove least recently used filmstrip entries until cache is under size limit
     */
    private evictFilmstripLRU(): void {
        if (this.currentCacheSize <= this.maxCacheSize) return;

        // Sort filmstrip entries by last accessed time (oldest first)
        const entries = Array.from(this.filmstripCache.entries()).sort(
            (a, b) => a[1].lastAccessed - b[1].lastAccessed
        );

        for (const [key, entry] of entries) {
            this.filmstripCache.delete(key);
            this.currentCacheSize -= entry.size;

            console.log(`Evicted filmstrip cache entry: ${key} (${(entry.size / 1024 / 1024).toFixed(1)}MB)`);

            if (this.currentCacheSize <= this.maxCacheSize * 0.8) {
                // Stop when we're 20% below the limit to avoid immediate re-eviction
                break;
            }
        }
    }

    /**
     * Get an image from cache or load it if not available (uses filmstrip batches)
     */
    async getImage(chunk: ChunkIdentifier): Promise<any | null> { // Promise<p5.Image | null>
        const key = this.generateKey(chunk);

        // Check if already in individual cache
        const cached = this.cache.get(key);
        if (cached) {
            cached.lastAccessed = Date.now();
            console.log(`Cache hit: ${key}`);
            return cached.image;
        }

        // Check filmstrip cache for this slice
        const batch = this.getFilmstripBatch(chunk);
        const filmstripKey = this.generateFilmstripKey(batch);
        const filmstripEntry = this.filmstripCache.get(filmstripKey);
        
        if (filmstripEntry) {
            // Extract slice from filmstrip if not already extracted
            const sliceImage = filmstripEntry.slices.get(chunk.z_min);
            if (sliceImage) {
                filmstripEntry.lastAccessed = Date.now();
                console.log(`Filmstrip slice hit: ${key}`);
                return sliceImage;
            } else {
                // Don't extract slice - will be rendered directly via filmstrip at render-time
                // This encourages use of getFilmstripRenderInfo() for performance
                filmstripEntry.lastAccessed = Date.now();
                console.log(`Filmstrip available for render-time extraction: ${key}`);
                return null;
            }
        }

        // Check if filmstrip is already loading
        const filmstripLoading = this.filmstripLoading.get(filmstripKey);
        if (filmstripLoading) {
            console.log(`Filmstrip already loading, waiting: ${filmstripKey}`);
            const filmstrip = await filmstripLoading.promise;
            if (filmstrip) {
                // Try to get filmstrip entry for render-time extraction
                const filmstripEntry = this.filmstripCache.get(filmstripKey);
                if (filmstripEntry) {
                    // Don't extract slice - will be rendered directly via filmstrip
                    // Return null to force use of getFilmstripRenderInfo() at render time
                    console.log(`Filmstrip loaded, available for render-time extraction: ${key}`);
                    return null;
                }
            }
            return null;
        }

        // Check if available in browser storage (filmstrip batch)
        try {
            const storedImage = await this.browserStorage.getStoredChunk(
                { ...batch, z_min: batch.z_min, z_max: batch.z_max }, 
                this.datasetURI, 
                this.p5Instance
            );
            if (storedImage) {
                // Add filmstrip to cache and extract slice
                const size = this.estimateImageSize(
                    batch.x_max - batch.x_min,
                    batch.y_max - batch.y_min,
                    batch.batchSize
                );

                const filmstripEntry: FilmstripEntry = {
                    filmstrip: storedImage,
                    slices: new Map(),
                    lastAccessed: Date.now(),
                    key: filmstripKey,
                    size,
                    batchInfo: batch
                };

                this.filmstripCache.set(filmstripKey, filmstripEntry);
                this.currentCacheSize += size;
                this.evictFilmstripLRU();

                console.log(`Storage filmstrip hit: ${filmstripKey}`);
                
                // Don't extract the requested slice - will be rendered directly via filmstrip
                // This encourages use of getFilmstripRenderInfo() for performance
                return null;
            }
        } catch (error) {
            console.warn(`Failed to load filmstrip from storage: ${filmstripKey}`, error);
        }

        // Start loading filmstrip batch
        console.log(`Loading new filmstrip batch: ${filmstripKey}`);
        return this.loadFilmstripBatch(batch, chunk.z_min);
    }

    /**
     * Get an image from cache synchronously (won't trigger loading)
     * Now relies entirely on filmstrip render-time extraction - no pixel copying
     */
    getCachedImage(chunk: ChunkIdentifier): any | null { // p5.Image | null
        const key = this.generateKey(chunk);
        const cached = this.cache.get(key);
        if (cached) {
            cached.lastAccessed = Date.now();
            return cached.image;
        }

        // Check filmstrip cache - but DON'T extract individual slices
        // Individual slices are now only rendered at render-time using getFilmstripRenderInfo()
        const batch = this.getFilmstripBatch(chunk);
        const filmstripKey = this.generateFilmstripKey(batch);
        const filmstripEntry = this.filmstripCache.get(filmstripKey);
        
        if (filmstripEntry) {
            // Check if slice is already extracted (legacy support)
            const sliceImage = filmstripEntry.slices.get(chunk.z_min);
            if (sliceImage) {
                filmstripEntry.lastAccessed = Date.now();
                return sliceImage;
            }
            
            // Don't extract slice here - will be rendered directly via filmstrip
            // This forces the render system to use getFilmstripRenderInfo() instead
            filmstripEntry.lastAccessed = Date.now();
        }
        
        return null;
    }

    /**
     * Load an image from BossDB and add it to cache
     */
    private async loadImage(chunk: ChunkIdentifier): Promise<any | null> { // Promise<p5.Image | null>
        const key = this.generateKey(chunk);
        const abortController = new AbortController();

        const loadPromise = this.loadImageInternal(chunk, abortController.signal);

        // Track loading state
        this.loading.set(key, {
            promise: loadPromise,
            abortController
        });

        try {
            const image = await loadPromise;

            if (image) {
                // Calculate size and add to cache
                const size = this.estimateImageSize(
                    chunk.x_max - chunk.x_min,
                    chunk.y_max - chunk.y_min,
                    chunk.z_max - chunk.z_min
                );

                const entry: CacheEntry = {
                    image,
                    lastAccessed: Date.now(),
                    key,
                    size
                };

                this.cache.set(key, entry);
                this.currentCacheSize += size;

                console.log(`Cached: ${key} (${(size / 1024 / 1024).toFixed(1)}MB) - Total: ${(this.currentCacheSize / 1024 / 1024).toFixed(1)}MB`);

                // Store in browser storage for persistence
                this.browserStorage.storeChunk(chunk, image, this.datasetURI, size).catch(err => {
                    console.warn(`Failed to store chunk in browser storage: ${key}`, err);
                });

                // Evict old entries if needed
                this.evictLRU();
            }

            return image;
        } finally {
            // Remove from loading state
            this.loading.delete(key);
        }
    }

    /**
     * Internal method to actually load the image from BossDB
     */
    private async loadImageInternal(chunk: ChunkIdentifier, signal: AbortSignal): Promise<any | null> { // Promise<p5.Image | null>
        try {
            const blob = await this.remote.getCutoutPNG(
                this.datasetURI,
                chunk.resolution,
                [chunk.x_min, chunk.x_max],
                [chunk.y_min, chunk.y_max],
                [chunk.z_min, chunk.z_max]
            );

            if (!blob || signal.aborted) {
                return null;
            }

            // Create object URL and load with p5
            const url = URL.createObjectURL(blob);

            return new Promise<any | null>((resolve) => { // Promise<p5.Image | null>
                const img = this.p5Instance.loadImage(url,
                    () => {
                        // Success callback
                        URL.revokeObjectURL(url); // Clean up
                        resolve(img);
                    },
                    () => {
                        // Error callback
                        URL.revokeObjectURL(url); // Clean up
                        resolve(null);
                    }
                );
            });

        } catch (error) {
            console.error(`Failed to load image chunk ${this.generateKey(chunk)}:`, error);
            return null;
        }
    }

    /**
     * Load a filmstrip batch from BossDB
     */
    private async loadFilmstripBatch(batch: FilmstripBatch, requestedZ: number): Promise<any | null> { // Promise<p5.Image | null>
        const filmstripKey = this.generateFilmstripKey(batch);
        
        // Create abort controller
        const abortController = new AbortController();
        
        const loadingPromise = this.loadFilmstripInternal(batch, abortController.signal);
        
        // Store loading promise
        this.filmstripLoading.set(filmstripKey, {
            promise: loadingPromise,
            abortController
        });

        try {
            const filmstrip = await loadingPromise;
            
            if (filmstrip && !abortController.signal.aborted) {
                // Calculate size and add to cache
                const size = this.estimateImageSize(
                    batch.x_max - batch.x_min,
                    batch.y_max - batch.y_min,
                    batch.batchSize
                );

                const filmstripEntry: FilmstripEntry = {
                    filmstrip,
                    slices: new Map(),
                    lastAccessed: Date.now(),
                    key: filmstripKey,
                    size,
                    batchInfo: batch
                };

                this.filmstripCache.set(filmstripKey, filmstripEntry);
                this.currentCacheSize += size;
                this.evictFilmstripLRU();

                // Store in browser storage for persistence
                try {
                    await this.browserStorage.storeChunk(
                        { ...batch, z_min: batch.z_min, z_max: batch.z_max },
                        filmstrip,
                        this.datasetURI,
                        size
                    );
                } catch (storageError) {
                    console.warn(`Failed to store filmstrip in browser storage: ${filmstripKey}`, storageError);
                }

                // Don't extract the requested slice - will be rendered directly via filmstrip  
                // This forces use of getFilmstripRenderInfo() for better performance
                return null;
            }
            
            return null;
        } catch (error) {
            console.error(`Failed to load filmstrip batch: ${filmstripKey}`, error);
            return null;
        } finally {
            // Clean up loading entry
            this.filmstripLoading.delete(filmstripKey);
        }
    }

    /**
     * Internal method to load filmstrip from BossDB
     */
    private async loadFilmstripInternal(batch: FilmstripBatch, signal: AbortSignal): Promise<any | null> { // Promise<p5.Image | null>
        try {
            const blob = await this.remote.getCutoutPNG(
                this.datasetURI,
                batch.resolution,
                [batch.x_min, batch.x_max],
                [batch.y_min, batch.y_max],
                [batch.z_min, batch.z_max]  // This will fetch the full filmstrip batch
            );

            if (!blob || signal.aborted) {
                return null;
            }

            // Create object URL and load with p5
            const url = URL.createObjectURL(blob);

            return new Promise<any | null>((resolve) => { // Promise<p5.Image | null>
                const img = this.p5Instance.loadImage(url,
                    () => {
                        // Success callback
                        URL.revokeObjectURL(url); // Clean up
                        resolve(img);
                    },
                    () => {
                        // Error callback
                        URL.revokeObjectURL(url); // Clean up
                        resolve(null);
                    }
                );
            });

        } catch (error) {
            console.error(`Failed to load filmstrip batch ${this.generateFilmstripKey(batch)}:`, error);
            return null;
        }
    }

    /**
     * Preload chunks that are likely to be needed soon
     */
    async preloadNeighboringChunks(centerChunk: ChunkIdentifier, radius: number = 1): Promise<void> {
        const promises: Promise<any | null>[] = []; // Promise<p5.Image | null>[]

        const chunkWidth = centerChunk.x_max - centerChunk.x_min;
        const chunkHeight = centerChunk.y_max - centerChunk.y_min;
        const chunkDepth = centerChunk.z_max - centerChunk.z_min;

        const centerX = Math.floor(centerChunk.x_min / chunkWidth);
        const centerY = Math.floor(centerChunk.y_min / chunkHeight);
        const centerZ = Math.floor(centerChunk.z_min / chunkDepth);

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    // Skip the center chunk (already loaded)
                    if (dx === 0 && dy === 0 && dz === 0) continue;

                    const chunkX = centerX + dx;
                    const chunkY = centerY + dy;
                    const chunkZ = centerZ + dz;

                    // Skip negative coordinates
                    if (chunkX < 0 || chunkY < 0 || chunkZ < 0) continue;

                    const neighborChunk: ChunkIdentifier = {
                        x_min: chunkX * chunkWidth,
                        x_max: (chunkX + 1) * chunkWidth,
                        y_min: chunkY * chunkHeight,
                        y_max: (chunkY + 1) * chunkHeight,
                        z_min: chunkZ * chunkDepth,
                        z_max: (chunkZ + 1) * chunkDepth,
                        resolution: centerChunk.resolution,
                        multiplier: centerChunk.multiplier
                    };

                    promises.push(this.getImage(neighborChunk));
                }
            }
        }

        // Fire and forget - don't wait for all to complete
        Promise.allSettled(promises).then(results => {
            const successful = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
            console.log(`Preloaded ${successful}/${promises.length} neighboring chunks`);
        });
    }

    /**
     * Preload filmstrip batches around the current position for efficient Z-navigation
     */
    async preloadNeighboringFilmstrips(centerChunk: ChunkIdentifier): Promise<void> {
        const promises: Promise<any | null>[] = []; // Promise<p5.Image | null>[]
        const batchSize = APP_CONFIG.filmstrip.batchSize;
        const preloadRadius = APP_CONFIG.filmstrip.preloadRadius;

        const centerBatch = this.getFilmstripBatch(centerChunk);
        const centerBatchIndex = Math.floor(centerBatch.z_min / batchSize);

        // Preload neighboring filmstrip batches
        for (let batchOffset = -preloadRadius; batchOffset <= preloadRadius; batchOffset++) {
            if (batchOffset === 0) continue; // Skip current batch (should already be loaded)

            const targetBatchIndex = centerBatchIndex + batchOffset;
            if (targetBatchIndex < 0) continue; // Skip negative z ranges

            const targetBatch: FilmstripBatch = {
                ...centerBatch,
                z_min: targetBatchIndex * batchSize,
                z_max: (targetBatchIndex + 1) * batchSize
            };

            const filmstripKey = this.generateFilmstripKey(targetBatch);
            
            // Check if already cached or loading
            if (this.filmstripCache.has(filmstripKey) || this.filmstripLoading.has(filmstripKey)) {
                continue;
            }

            // Create a temporary chunk identifier for the first slice of this batch
            const tempChunk: ChunkIdentifier = {
                ...centerChunk,
                z_min: targetBatch.z_min,
                z_max: targetBatch.z_min + 1
            };

            promises.push(this.getImage(tempChunk));
        }

        // Don't wait for preloads to complete - let them run in background
        if (promises.length > 0) {
            console.log(`Preloading ${promises.length} filmstrip batches around z=${centerChunk.z_min}`);
            Promise.all(promises).catch(error => {
                console.warn('Some filmstrip preloads failed:', error);
            });
        }
    }

    /**
     * Cancel all pending loads and clear cache
     */
    clear(): void {
        // Cancel all pending loads
        for (const loading of this.loading.values()) {
            loading.abortController.abort();
        }
        this.loading.clear();

        // Cancel all pending filmstrip loads
        for (const loading of this.filmstripLoading.values()) {
            loading.abortController.abort();
        }
        this.filmstripLoading.clear();

        // Clear caches
        this.cache.clear();
        this.filmstripCache.clear();
        this.currentCacheSize = 0;

        console.log('Image cache and filmstrip cache cleared');
    }

    /**
     * Clear all stored data and reset cache
     */
    async clearAll(): Promise<void> {
        // Clear memory cache
        this.clear();

        // Clear browser storage for this dataset
        await this.browserStorage.clearDataset(this.datasetURI);

        console.log('All cache data cleared');
    }

    /**
     * Get cache statistics including filmstrip data
     */
    getStats(): {
        cacheSize: number;
        maxCacheSize: number;
        entryCount: number;
        filmstripCount: number;
        totalSlicesInFilmstrips: number;
        loadingCount: number;
        filmstripLoadingCount: number;
        utilizationPercent: number;
    } {
        // Count total slices available in filmstrip cache
        let totalSlicesInFilmstrips = 0;
        for (const entry of this.filmstripCache.values()) {
            totalSlicesInFilmstrips += entry.slices.size;
        }

        return {
            cacheSize: this.currentCacheSize,
            maxCacheSize: this.maxCacheSize,
            entryCount: this.cache.size,
            filmstripCount: this.filmstripCache.size,
            totalSlicesInFilmstrips,
            loadingCount: this.loading.size,
            filmstripLoadingCount: this.filmstripLoading.size,
            utilizationPercent: (this.currentCacheSize / this.maxCacheSize) * 100
        };
    }

    /**
     * Get combined cache and storage statistics
     */
    async getCombinedStats(): Promise<{
        memory: {
            cacheSize: number;
            maxCacheSize: number;
            entryCount: number;
            loadingCount: number;
            utilizationPercent: number;
        };
        storage: {
            totalChunks: number;
            estimatedSize: number;
            oldestAccess: number;
            newestAccess: number;
        };
    }> {
        const memoryStats = this.getStats();
        const storageStats = await this.browserStorage.getStorageStats();

        return {
            memory: memoryStats,
            storage: storageStats
        };
    }

    /**
     * Remove entries for a specific LOD level (useful when switching between levels)
     */
    evictLODLevel(multiplier: number): void {
        const keysToRemove: string[] = [];
        const filmstripKeysToRemove: string[] = [];

        // Evict regular cache entries
        for (const [key, entry] of this.cache.entries()) {
            if (key.includes(`_${multiplier}x_`)) {
                keysToRemove.push(key);
                this.currentCacheSize -= entry.size;
            }
        }

        // Evict filmstrip cache entries
        for (const [key, entry] of this.filmstripCache.entries()) {
            if (key.includes(`_${multiplier}x_`)) {
                filmstripKeysToRemove.push(key);
                this.currentCacheSize -= entry.size;
            }
        }

        for (const key of keysToRemove) {
            this.cache.delete(key);
        }

        for (const key of filmstripKeysToRemove) {
            this.filmstripCache.delete(key);
        }

        console.log(`Evicted ${keysToRemove.length} regular entries and ${filmstripKeysToRemove.length} filmstrip entries for LOD level ${multiplier}x`);
    }

    /**
     * Check if an image is cached without triggering loading
     */
    isCached(chunk: ChunkIdentifier): boolean {
        const key = this.generateKey(chunk);
        if (this.cache.has(key)) {
            return true;
        }

        // Check if it's available in filmstrip cache
        const batch = this.getFilmstripBatch(chunk);
        const filmstripKey = this.generateFilmstripKey(batch);
        const filmstripEntry = this.filmstripCache.get(filmstripKey);
        
        return filmstripEntry !== undefined && filmstripEntry.slices.has(chunk.z_min);
    }

    /**
     * Calculate which filmstrip batch a chunk belongs to
     * Now uses fixed chunk depth aligned with filmstrip batch size
     */
    private getFilmstripBatch(chunk: ChunkIdentifier): FilmstripBatch {
        const batchSize = APP_CONFIG.filmstrip.batchSize;
        
        // Calculate which batch this z-slice belongs to
        const batchIndex = Math.floor(chunk.z_min / batchSize);
        const batchStart = batchIndex * batchSize;
        const batchEnd = batchStart + batchSize;

        return {
            x_min: chunk.x_min,
            x_max: chunk.x_max,
            y_min: chunk.y_min,
            y_max: chunk.y_max,
            z_min: batchStart,
            z_max: batchEnd,
            resolution: chunk.resolution,
            multiplier: chunk.multiplier,
            batchSize: batchSize
        };
    }

    /**
     * Generate a unique cache key for a filmstrip batch
     */
    private generateFilmstripKey(batch: FilmstripBatch): string {
        return `filmstrip_${batch.resolution}_${batch.multiplier}x_${batch.x_min}-${batch.x_max}_${batch.y_min}-${batch.y_max}_${batch.z_min}-${batch.z_max}`;
    }

    /**
     * Get filmstrip render info for a slice (for render-time extraction)
     * Returns information needed to render directly from filmstrip without copying pixels
     * This is now the ONLY way to access individual slices from filmstrips
     */
    getFilmstripRenderInfo(chunk: ChunkIdentifier): {
        filmstrip: any; // p5.Image
        sourceX: number;
        sourceY: number;
        sourceWidth: number;
        sourceHeight: number;
    } | null {
        const batch = this.getFilmstripBatch(chunk);
        const filmstripKey = this.generateFilmstripKey(batch);
        const filmstripEntry = this.filmstripCache.get(filmstripKey);
        
        if (!filmstripEntry) {
            return null;
        }

        const sliceIndex = chunk.z_min - batch.z_min;
        
        if (sliceIndex < 0 || sliceIndex >= batch.batchSize) {
            return null;
        }

        const sliceWidth = batch.x_max - batch.x_min;
        const sliceHeight = batch.y_max - batch.y_min;
        
        // Calculate the Y offset for this slice in the filmstrip
        const yOffset = sliceIndex * sliceHeight;
        
        // Update access time
        filmstripEntry.lastAccessed = Date.now();
        
        return {
            filmstrip: filmstripEntry.filmstrip,
            sourceX: 0,
            sourceY: yOffset,
            sourceWidth: sliceWidth,
            sourceHeight: sliceHeight
        };
    }
}
