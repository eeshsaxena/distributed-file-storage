/**
 * CDN Gateway Interface
 *
 * Routes content delivery requests to optimal edge locations.
 */

export interface CDNGateway {
  /**
   * Retrieve chunk from cache or origin
   * @param chunkHash - SHA-256 hash of the chunk
   * @param clientLocation - Geographic location of the client
   * @returns Chunk data
   */
  getChunk(chunkHash: string, clientLocation: GeoLocation): Promise<Buffer>;

  /**
   * Invalidate cached chunks for a file version
   * @param fileId - File identifier
   * @param version - Version number
   */
  invalidateCache(fileId: string, version: number): Promise<void>;

  /**
   * Handle byte-range request
   * @param chunkHash - SHA-256 hash of the chunk
   * @param startByte - Start byte position
   * @param endByte - End byte position
   * @returns Chunk data for the specified range
   */
  getChunkRange(chunkHash: string, startByte: number, endByte: number): Promise<Buffer>;

  /**
   * Get cache statistics
   * @param edgeLocation - Edge location identifier
   * @returns Cache statistics
   */
  getCacheStats(edgeLocation: string): Promise<CacheStats>;
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
  region?: string;
}

export interface CacheStats {
  hitRate: number;
  missRate: number;
  evictionRate: number;
  averageLatency: number;
}
