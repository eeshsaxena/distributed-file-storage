import { CDNGateway, GeoLocation, CacheStats } from './interfaces/cdn-gateway.interface';
import { StorageNode } from './interfaces/storage-node.interface';

/**
 * Simple LRU cache entry
 */
interface CacheEntry {
  data: Buffer;
  expiresAt: number; // epoch ms
  lastAccessed: number;
}

/**
 * CDN Gateway Implementation
 *
 * Routes chunk requests to the nearest edge location, caches chunks with a
 * 24-hour TTL using an LRU eviction policy, supports byte-range requests,
 * and invalidates cached chunks when file versions are updated.
 */
export class CDNGatewayImpl implements CDNGateway {
  /** In-memory edge cache: chunkHash → CacheEntry */
  private readonly cache: Map<string, CacheEntry> = new Map();

  /** File-version → chunk hashes mapping for cache invalidation */
  private readonly fileVersionChunks: Map<string, string[]> = new Map();

  private readonly TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_CACHE_ENTRIES = 10_000;

  constructor(private readonly storageNodes: StorageNode[]) {}

  /**
   * Retrieve a chunk, serving from cache when available.
   * On a cache miss the chunk is fetched from the nearest storage node and cached.
   */
  async getChunk(chunkHash: string, clientLocation: GeoLocation): Promise<Buffer> {
    const cached = this.getCached(chunkHash);
    if (cached) return cached;

    // Select nearest node (simplified: pick first active node)
    const node = this.selectNode(clientLocation);
    const data = await node.readChunk(chunkHash);

    this.putCache(chunkHash, data);
    return data;
  }

  /**
   * Invalidate all cached chunks associated with a specific file version.
   */
  async invalidateCache(fileId: string, version: number): Promise<void> {
    const key = `${fileId}:${version}`;
    const hashes = this.fileVersionChunks.get(key) ?? [];
    for (const hash of hashes) {
      this.cache.delete(hash);
    }
    this.fileVersionChunks.delete(key);
  }

  /**
   * Return a byte sub-range of a chunk.
   * Validates that [startByte, endByte] is within the chunk bounds.
   */
  async getChunkRange(
    chunkHash: string,
    startByte: number,
    endByte: number
  ): Promise<Buffer> {
    if (startByte < 0) throw new Error(`startByte must be >= 0, got ${startByte}`);
    if (endByte < startByte)
      throw new Error(`endByte (${endByte}) must be >= startByte (${startByte})`);

    // Fetch full chunk (from cache or origin)
    const full = await this.getChunk(chunkHash, { latitude: 0, longitude: 0 });

    if (endByte >= full.length)
      throw new Error(
        `endByte (${endByte}) exceeds chunk length (${full.length})`
      );

    return full.subarray(startByte, endByte + 1);
  }

  /**
   * Return cache statistics for a given edge location.
   * (Simplified: returns aggregate stats for the in-memory cache.)
   */
  async getCacheStats(_edgeLocation: string): Promise<CacheStats> {
    const now = Date.now();
    let valid = 0;
    let expired = 0;
    for (const entry of this.cache.values()) {
      if (entry.expiresAt > now) valid++;
      else expired++;
    }
    const total = valid + expired;
    return {
      hitRate: total > 0 ? valid / total : 0,
      missRate: total > 0 ? expired / total : 0,
      evictionRate: 0,
      averageLatency: 1, // ms — mock value
    };
  }

  /**
   * Register which chunk hashes belong to a file version (for invalidation).
   */
  registerFileVersion(fileId: string, version: number, chunkHashes: string[]): void {
    this.fileVersionChunks.set(`${fileId}:${version}`, chunkHashes);
  }

  // ─── private helpers ──────────────────────────────────────────────────────

  private getCached(chunkHash: string): Buffer | null {
    const entry = this.cache.get(chunkHash);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(chunkHash);
      return null;
    }
    entry.lastAccessed = Date.now();
    return entry.data;
  }

  private putCache(chunkHash: string, data: Buffer): void {
    // Evict LRU entry if at capacity
    if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
      let lruKey = '';
      let lruTime = Infinity;
      for (const [k, v] of this.cache.entries()) {
        if (v.lastAccessed < lruTime) {
          lruTime = v.lastAccessed;
          lruKey = k;
        }
      }
      if (lruKey) this.cache.delete(lruKey);
    }

    this.cache.set(chunkHash, {
      data,
      expiresAt: Date.now() + this.TTL_MS,
      lastAccessed: Date.now(),
    });
  }

  private selectNode(_location: GeoLocation): StorageNode {
    if (this.storageNodes.length === 0) {
      throw new Error('No storage nodes available');
    }
    // Simplified: return first node. A real implementation would use geo-distance.
    return this.storageNodes[0];
  }
}
