import {
  DeduplicationEngine,
  DuplicateCheckResult,
} from './interfaces/deduplication-engine.interface';
import { MetadataStore, ChunkRecord } from './interfaces/metadata-store.interface';

/**
 * Deduplication Engine Implementation
 *
 * Detects and eliminates duplicate chunks using content-based hashing (SHA-256).
 * Maintains reference counts for each unique chunk and coordinates garbage collection.
 */
export class DeduplicationEngineImpl implements DeduplicationEngine {
  constructor(private metadataStore: MetadataStore) {}

  /**
   * Check if chunk already exists in the system
   *
   * @param chunkHash - SHA-256 hash of the chunk
   * @returns Duplicate check result with existence status and metadata
   */
  async checkDuplicate(chunkHash: string): Promise<DuplicateCheckResult> {
    const chunk = await this.metadataStore.getChunk(chunkHash);

    if (!chunk) {
      return {
        exists: false,
        chunkHash,
        referenceCount: 0,
      };
    }

    // Get replica locations for existing chunk
    const replicas = await this.metadataStore.getChunkReplicas(chunkHash);

    return {
      exists: true,
      chunkHash,
      referenceCount: chunk.referenceCount,
      replicaLocations: replicas.map((replica) => ({
        nodeId: replica.nodeId,
        availabilityZone: replica.availabilityZone,
        timestamp: replica.createdAt,
      })),
    };
  }

  /**
   * Increment reference count for existing chunk
   * Uses atomic increment operation in metadata store
   *
   * @param chunkHash - SHA-256 hash of the chunk
   * @param fileId - File identifier referencing this chunk
   */
  async incrementReference(chunkHash: string, fileId: string): Promise<void> {
    // Verify chunk exists before incrementing
    const chunk = await this.metadataStore.getChunk(chunkHash);
    if (!chunk) {
      throw new Error(`Cannot increment reference: chunk ${chunkHash} does not exist`);
    }

    // Atomic increment operation
    await this.metadataStore.incrementChunkReference(chunkHash, fileId);
  }

  /**
   * Decrement reference count when file is deleted
   * Uses atomic decrement operation in metadata store
   *
   * @param chunkHash - SHA-256 hash of the chunk
   * @param fileId - File identifier that was referencing this chunk
   */
  async decrementReference(chunkHash: string, fileId: string): Promise<void> {
    // Verify chunk exists before decrementing
    const chunk = await this.metadataStore.getChunk(chunkHash);
    if (!chunk) {
      throw new Error(`Cannot decrement reference: chunk ${chunkHash} does not exist`);
    }

    // Prevent reference count from going negative
    if (chunk.referenceCount <= 0) {
      throw new Error(
        `Cannot decrement reference: chunk ${chunkHash} already has zero references`
      );
    }

    // Atomic decrement operation
    await this.metadataStore.decrementChunkReference(chunkHash, fileId);
  }

  /**
   * Get chunks with zero references for garbage collection
   * These chunks can be safely deleted as no files reference them
   *
   * @returns Array of chunk hashes with zero references
   */
  async getOrphanedChunks(): Promise<string[]> {
    return await this.metadataStore.getOrphanedChunks();
  }

  /**
   * Calculate deduplication ratio
   * Ratio = logical data size / physical storage used
   * Higher ratio indicates better deduplication efficiency
   *
   * @returns Deduplication ratio (e.g., 2.5 means 2.5x compression)
   */
  async getDeduplicationRatio(): Promise<number> {
    // Get all chunks to calculate logical and physical sizes
    // Note: In a production system, this would be optimized with aggregation queries
    const chunks = await this.getAllChunks();

    if (chunks.length === 0) {
      return 1.0; // No deduplication when no chunks exist
    }

    // Physical storage: sum of unique chunk sizes (stored once each)
    const physicalStorage = chunks.reduce((sum, chunk) => sum + chunk.size, 0);

    // Logical storage: sum of (chunk size × reference count) for all chunks
    const logicalStorage = chunks.reduce(
      (sum, chunk) => sum + chunk.size * chunk.referenceCount,
      0
    );

    if (physicalStorage === 0) {
      return 1.0;
    }

    return logicalStorage / physicalStorage;
  }

  /**
   * Helper method to get all chunks from metadata store
   * In production, this would use pagination or aggregation queries
   *
   * @returns Array of all chunk records
   */
  private async getAllChunks(): Promise<ChunkRecord[]> {
    // This is a simplified implementation
    // In production, we would need a method in MetadataStore to efficiently
    // query all chunks or get aggregated statistics
    //
    // For now, we'll throw an error indicating this needs proper implementation
    // The property tests will use a mock that provides this functionality
    throw new Error(
      'getAllChunks requires implementation of chunk listing in MetadataStore'
    );
  }

  /**
   * Calculate deduplication ratio with provided chunk data
   * This method is useful for testing and when chunk data is already available
   *
   * @param chunks - Array of chunk records
   * @returns Deduplication ratio
   */
  calculateDeduplicationRatioFromChunks(chunks: ChunkRecord[]): number {
    if (chunks.length === 0) {
      return 1.0;
    }

    const physicalStorage = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
    const logicalStorage = chunks.reduce(
      (sum, chunk) => sum + chunk.size * chunk.referenceCount,
      0
    );

    if (physicalStorage === 0) {
      return 1.0;
    }

    return logicalStorage / physicalStorage;
  }
}
