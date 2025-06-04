/**
 * @module ImageCache
 * 
 * LRU Cache for managing image chunks with different LOD levels.
 * Handles loading, caching, and eviction of image data from BossDB.
 */

import type p5 from 'p5';
import type BossRemote from './intern';
import { BrowserStorage } from './BrowserStorage';

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

export interface CacheEntry {
    image: p5.Image;
    lastAccessed: number;
    key: string;
    size: number; // Memory footprint estimate
}

export interface LoadingEntry {
    promise: Promise<p5.Image | null>;
    abortController: AbortController;
}

/**
 * LRU Cache for image chunks with support for different LOD levels
 */
export class ImageCache {
    private cache: Map<string, CacheEntry> = new Map();
    private loading: Map<string, LoadingEntry> = new Map();
    private maxCacheSize: number;
    private currentCacheSize: number = 0;
    private remote: BossRemote;
    private datasetURI: string;
    private p5Instance: p5;
    private browserStorage: BrowserStorage;

    constructor(
        remote: BossRemote, 
        datasetURI: string, 
        p5Instance: p5,
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
     * Get an image from cache or load it if not available
     */
    async getImage(chunk: ChunkIdentifier): Promise<p5.Image | null> {
        const key = this.generateKey(chunk);
        
        // Check if already in cache
        const cached = this.cache.get(key);
        if (cached) {
            cached.lastAccessed = Date.now();
            console.log(`Cache hit: ${key}`);
            return cached.image;
        }

        // Check if available in browser storage
        try {
            const storedImage = await this.browserStorage.getStoredChunk(chunk, this.datasetURI, this.p5Instance);
            if (storedImage) {
                // Add to memory cache
                const size = this.estimateImageSize(
                    chunk.x_max - chunk.x_min,
                    chunk.y_max - chunk.y_min,
                    chunk.z_max - chunk.z_min
                );

                const entry: CacheEntry = {
                    image: storedImage,
                    lastAccessed: Date.now(),
                    key,
                    size
                };

                this.cache.set(key, entry);
                this.currentCacheSize += size;
                this.evictLRU();

                console.log(`Storage hit: ${key}`);
                return storedImage;
            }
        } catch (error) {
            console.warn(`Failed to load from storage: ${key}`, error);
        }

        // Check if already loading
        const loading = this.loading.get(key);
        if (loading) {
            console.log(`Already loading: ${key}`);
            return loading.promise;
        }

        // Start loading
        console.log(`Loading new chunk: ${key}`);
        return this.loadImage(chunk);
    }

    /**
     * Get an image from cache synchronously (won't trigger loading)
     */
    getCachedImage(chunk: ChunkIdentifier): p5.Image | null {
        const key = this.generateKey(chunk);
        const cached = this.cache.get(key);
        if (cached) {
            cached.lastAccessed = Date.now();
            return cached.image;
        }
        return null;
    }

    /**
     * Load an image from BossDB and add it to cache
     */
    private async loadImage(chunk: ChunkIdentifier): Promise<p5.Image | null> {
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
    private async loadImageInternal(chunk: ChunkIdentifier, signal: AbortSignal): Promise<p5.Image | null> {
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
            
            return new Promise<p5.Image | null>((resolve) => {
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
     * Preload chunks that are likely to be needed soon
     */
    async preloadNeighboringChunks(centerChunk: ChunkIdentifier, radius: number = 1): Promise<void> {
        const promises: Promise<p5.Image | null>[] = [];
        
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
     * Cancel all pending loads and clear cache
     */
    clear(): void {
        // Cancel all pending loads
        for (const loading of this.loading.values()) {
            loading.abortController.abort();
        }
        this.loading.clear();

        // Clear cache
        this.cache.clear();
        this.currentCacheSize = 0;
        
        console.log('Image cache cleared');
    }

    /**
     * Get cache statistics
     */
    getStats(): { 
        cacheSize: number; 
        maxCacheSize: number; 
        entryCount: number; 
        loadingCount: number;
        utilizationPercent: number;
    } {
        return {
            cacheSize: this.currentCacheSize,
            maxCacheSize: this.maxCacheSize,
            entryCount: this.cache.size,
            loadingCount: this.loading.size,
            utilizationPercent: (this.currentCacheSize / this.maxCacheSize) * 100
        };
    }

    /**
     * Clear all stored data and reset cache
     */
    async clearAll(): Promise<void> {
        // Clear memory cache
        this.clear();
        
        // Clear browser storage
        await this.browserStorage.clearDataset(this.datasetURI);
        
        console.log('All cache data cleared');
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
        
        for (const [key, entry] of this.cache.entries()) {
            if (key.includes(`_${multiplier}x_`)) {
                keysToRemove.push(key);
                this.currentCacheSize -= entry.size;
            }
        }

        for (const key of keysToRemove) {
            this.cache.delete(key);
        }

        console.log(`Evicted ${keysToRemove.length} entries for LOD level ${multiplier}x`);
    }

    /**
     * Check if an image is cached without triggering loading
     */
    isCached(chunk: ChunkIdentifier): boolean {
        const key = this.generateKey(chunk);
        return this.cache.has(key);
    }
}
