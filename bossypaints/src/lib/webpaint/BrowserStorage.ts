/**
 * @module BrowserStorage
 *
 * Utility for persisting image cache data and navigation state to browser storage.
 * Uses IndexedDB for large image data and localStorage for configuration.
 */

import type { ChunkIdentifier } from './ImageCache';

export interface StoredChunk {
    chunkId: ChunkIdentifier;
    imageData: ArrayBuffer;
    lastAccessed: number;
    size: number;
}

export interface NavigationState {
    x: number;
    y: number;
    zoom: number;
    layer: number;
}

export interface CacheConfig {
    maxCacheSize: number;
    datasetURI: string;
    resolution: number;
}

/**
 * Browser storage manager for image cache persistence
 */
export class BrowserStorage {
    private dbName = 'BossyPaintsCache';
    private dbVersion = 2;
    private db: IDBDatabase | null = null;
    private storeName = 'imageChunks';

    constructor() {
        this.initDB();
    }

    /**
     * Initialize IndexedDB
     */
    private async initDB(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('Failed to open IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('IndexedDB initialized successfully, version:', this.db.version);
                console.log('Object stores:', Array.from(this.db.objectStoreNames));
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Create object store for image chunks
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
                    store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
                    store.createIndex('datasetURI', 'datasetURI', { unique: false });
                    console.log('Created IndexedDB object store');
                }
            };
        });
    }

    /**
     * Generate a storage key for a chunk
     */
    private generateStorageKey(chunkId: ChunkIdentifier, datasetURI: string): string {
        return `${datasetURI}_${chunkId.resolution}_${chunkId.multiplier}x_${chunkId.x_min}-${chunkId.x_max}_${chunkId.y_min}-${chunkId.y_max}_${chunkId.z_min}-${chunkId.z_max}`;
    }

    /**
     * Convert p5.Image to ArrayBuffer for storage
     */
    private async imageToArrayBuffer(image: any): Promise<ArrayBuffer> {
        // Create a canvas and draw the p5 image to it
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            throw new Error('Failed to get 2D context');
        }

        // Draw the p5 image to the canvas
        ctx.drawImage(image.canvas, 0, 0);

        // Convert to blob then to ArrayBuffer
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Failed to create blob'));
                    return;
                }

                const reader = new FileReader();
                reader.onload = () => {
                    resolve(reader.result as ArrayBuffer);
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsArrayBuffer(blob);
            }, 'image/png');
        });
    }

    /**
     * Convert ArrayBuffer back to Image for p5
     */
    private async arrayBufferToImage(buffer: ArrayBuffer, p5Instance: any): Promise<any> {
        const blob = new Blob([buffer], { type: 'image/png' });
        const url = URL.createObjectURL(blob);

        return new Promise((resolve, reject) => {
            const img = p5Instance.loadImage(url,
                () => {
                    URL.revokeObjectURL(url);
                    resolve(img);
                },
                () => {
                    URL.revokeObjectURL(url);
                    reject(new Error('Failed to load image from storage'));
                }
            );
        });
    }

    /**
     * Store a chunk in IndexedDB
     */
    async storeChunk(chunkId: ChunkIdentifier, image: any, datasetURI: string, size: number): Promise<void> {
        if (!this.db) {
            await this.initDB();
        }

        if (!this.db) {
            console.warn('IndexedDB not available, skipping storage');
            return;
        }

        try {
            const imageData = await this.imageToArrayBuffer(image);
            const key = this.generateStorageKey(chunkId, datasetURI);

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            const storedChunk = {
                key,
                chunkId,
                imageData,
                lastAccessed: Date.now(),
                size,
                datasetURI
            };

            await new Promise<void>((resolve, reject) => {
                const request = store.put(storedChunk);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            console.log(`Stored chunk in IndexedDB: ${key}`);
        } catch (error) {
            console.error('Failed to store chunk:', error);
        }
    }

    /**
     * Retrieve a chunk from IndexedDB
     */
    async getStoredChunk(chunkId: ChunkIdentifier, datasetURI: string, p5Instance: any): Promise<any | null> {
        if (!this.db) {
            await this.initDB();
        }

        if (!this.db) {
            return null;
        }

        try {
            const key = this.generateStorageKey(chunkId, datasetURI);
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);

            const storedChunk = await new Promise<any>((resolve, reject) => {
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            if (!storedChunk) {
                return null;
            }

            // Update last accessed time
            storedChunk.lastAccessed = Date.now();
            const updateTransaction = this.db.transaction([this.storeName], 'readwrite');
            const updateStore = updateTransaction.objectStore(this.storeName);
            updateStore.put(storedChunk);

            // Convert back to p5 image
            const image = await this.arrayBufferToImage(storedChunk.imageData, p5Instance);
            console.log(`Retrieved chunk from IndexedDB: ${key}`);
            return image;

        } catch (error) {
            console.error('Failed to retrieve chunk:', error);
            return null;
        }
    }

    /**
     * Get all stored chunks for a dataset
     */
    async getStoredChunks(datasetURI: string): Promise<ChunkIdentifier[]> {
        if (!this.db) {
            await this.initDB();
        }

        if (!this.db) {
            return [];
        }

        try {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('datasetURI');

            const chunks = await new Promise<any[]>((resolve, reject) => {
                const request = index.getAll(datasetURI);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            return chunks.map(chunk => chunk.chunkId);
        } catch (error) {
            console.error('Failed to get stored chunks:', error);
            return [];
        }
    }

    /**
     * Clean up old cached chunks to free space
     */
    async cleanupOldChunks(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> { // 7 days default
        if (!this.db) {
            return;
        }

        try {
            const cutoffTime = Date.now() - maxAge;
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('lastAccessed');

            const range = IDBKeyRange.upperBound(cutoffTime);
            const request = index.openCursor(range);

            let deletedCount = 0;
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                } else {
                    console.log(`Cleaned up ${deletedCount} old chunks from storage`);
                }
            };
        } catch (error) {
            console.error('Failed to cleanup old chunks:', error);
        }
    }

    /**
     * Save navigation state to localStorage
     */
    saveNavigationState(state: NavigationState, datasetURI: string): void {
        try {
            const key = `nav_${datasetURI}`;
            localStorage.setItem(key, JSON.stringify(state));
            console.log('Saved navigation state to localStorage');
        } catch (error) {
            console.error('Failed to save navigation state:', error);
        }
    }

    /**
     * Load navigation state from localStorage
     */
    loadNavigationState(datasetURI: string): NavigationState | null {
        try {
            const key = `nav_${datasetURI}`;
            const stored = localStorage.getItem(key);
            if (stored) {
                const state = JSON.parse(stored);
                console.log('Loaded navigation state from localStorage');
                return state;
            }
        } catch (error) {
            console.error('Failed to load navigation state:', error);
        }
        return null;
    }

    /**
     * Save cache configuration to localStorage
     */
    saveCacheConfig(config: CacheConfig): void {
        try {
            localStorage.setItem('cacheConfig', JSON.stringify(config));
        } catch (error) {
            console.error('Failed to save cache config:', error);
        }
    }

    /**
     * Load cache configuration from localStorage
     */
    loadCacheConfig(): CacheConfig | null {
        try {
            const stored = localStorage.getItem('cacheConfig');
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.error('Failed to load cache config:', error);
        }
        return null;
    }

    /**
     * Clear all stored data for a dataset
     */
    async clearDataset(datasetURI: string): Promise<void> {
        if (!this.db) {
            return;
        }

        try {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('datasetURI');

            const request = index.openCursor(IDBKeyRange.only(datasetURI));
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    console.log(`Cleared all data for dataset: ${datasetURI}`);
                }
            };

            // Also clear navigation state
            localStorage.removeItem(`nav_${datasetURI}`);
        } catch (error) {
            console.error('Failed to clear dataset:', error);
        }
    }

    /**
     * Get storage usage statistics
     */
    async getStorageStats(): Promise<{
        totalChunks: number;
        estimatedSize: number;
        oldestAccess: number;
        newestAccess: number;
    }> {
        if (!this.db) {
            return { totalChunks: 0, estimatedSize: 0, oldestAccess: 0, newestAccess: 0 };
        }

        try {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);

            const chunks = await new Promise<any[]>((resolve, reject) => {
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            let totalSize = 0;
            let oldestAccess = Date.now();
            let newestAccess = 0;

            for (const chunk of chunks) {
                totalSize += chunk.size || 0;
                if (chunk.lastAccessed < oldestAccess) {
                    oldestAccess = chunk.lastAccessed;
                }
                if (chunk.lastAccessed > newestAccess) {
                    newestAccess = chunk.lastAccessed;
                }
            }

            return {
                totalChunks: chunks.length,
                estimatedSize: totalSize,
                oldestAccess,
                newestAccess
            };
        } catch (error) {
            console.error('Failed to get storage stats:', error);
            return { totalChunks: 0, estimatedSize: 0, oldestAccess: 0, newestAccess: 0 };
        }
    }
}
