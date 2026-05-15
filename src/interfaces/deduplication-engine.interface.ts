/**
 * Deduplication Engine Interface
 *
 * Detects and eliminates duplicate chunks using content-based hashing.
 */

import { ReplicaLocation } from './replication-service.interface';

export interface DeduplicationEngine {
  /**
   * Check if chunk already exists and return existing hash or null
   * @param chunkHash - SHA-256 hash of the chunk
   * @returns Duplicate check result
   */
  checkDuplicate(chunkHash: string): Promise<DuplicateCheckResult>;

  /**
   * Increment reference count for existing chunk
   * @param chunkHash - SHA-256 hash of the chunk
   * @param fileId - File identifier referencing this chunk
   */
  incrementReference(chunkHash: string, fileId: string): Promise<void>;

  /**
   * Decrement reference count when file is deleted
   * @param chunkHash - SHA-256 hash of the chunk
   * @param fileId - File identifier that was referencing this chunk
   */
  decrementReference(chunkHash: string, fileId: string): Promise<void>;

  /**
   * Get chunks with zero references for garbage collection
   * @returns Array of chunk hashes with zero references
   */
  getOrphanedChunks(): Promise<string[]>;

  /**
   * Calculate deduplication ratio
   * @returns Deduplication ratio (logical size / physical size)
   */
  getDeduplicationRatio(): Promise<number>;
}

export interface DuplicateCheckResult {
  exists: boolean;
  chunkHash: string;
  referenceCount: number;
  replicaLocations?: ReplicaLocation[];
}
