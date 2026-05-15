/**
 * Storage Node Interface
 *
 * Responsible for storing encrypted chunk data on disk and serving retrieval requests.
 */

export interface StorageNode {
  /**
   * Write chunk to disk
   * @param chunkHash - SHA-256 hash of the chunk (used as filename)
   * @param data - Encrypted chunk data
   */
  writeChunk(chunkHash: string, data: Buffer): Promise<void>;

  /**
   * Read chunk from disk
   * @param chunkHash - SHA-256 hash of the chunk
   * @returns Encrypted chunk data
   */
  readChunk(chunkHash: string): Promise<Buffer>;

  /**
   * Delete chunk from disk
   * @param chunkHash - SHA-256 hash of the chunk
   */
  deleteChunk(chunkHash: string): Promise<void>;

  /**
   * Verify chunk integrity using SHA-256 hash
   * @param chunkHash - Expected SHA-256 hash
   * @returns True if chunk exists and hash matches, false otherwise
   */
  verifyChunkIntegrity(chunkHash: string): Promise<boolean>;

  /**
   * Get node health metrics
   * @returns Current health metrics for this storage node
   */
  getHealthMetrics(): Promise<NodeHealth>;
}

export interface NodeHealth {
  nodeId: string;
  availabilityZone: string;
  diskUsagePercent: number;
  cpuUsagePercent: number;
  networkLatency: number;
  chunkCount: number;
  lastHeartbeat: Date;
}
