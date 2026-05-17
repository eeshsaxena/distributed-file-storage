import { VersionManager, FileVersion } from './interfaces/version-manager.interface';
import { MetadataStore } from './interfaces/metadata-store.interface';
import { DeduplicationEngine } from './interfaces/deduplication-engine.interface';

/**
 * Version Manager Implementation
 *
 * Creates and manages immutable file versions with sequential numbering.
 * Coordinates with the Deduplication Engine to maintain correct reference counts
 * when versions share chunks.
 */
export class VersionManagerImpl implements VersionManager {
  constructor(
    private readonly metadataStore: MetadataStore,
    private readonly deduplicationEngine: DeduplicationEngine
  ) {}

  /**
   * Create a new version of a file.
   * Increments reference counts for all chunks in the new version.
   */
  async createVersion(
    fileId: string,
    chunkHashes: string[],
    userId: string
  ): Promise<FileVersion> {
    // Determine next version number
    const existingVersions = await this.metadataStore.listFileVersions(fileId);
    const nextVersion = existingVersions.length + 1;

    // Calculate total size from chunk metadata
    let totalSize = 0;
    for (const hash of chunkHashes) {
      const chunk = await this.metadataStore.getChunk(hash);
      if (chunk) {
        totalSize += chunk.size;
      }
    }

    const now = new Date();

    // Persist version record
    await this.metadataStore.createFileVersion({
      fileId,
      version: nextVersion,
      chunkHashes,
      size: totalSize,
      createdAt: now,
      userId,
    });

    // Increment reference counts for all chunks in this version
    for (const hash of chunkHashes) {
      try {
        await this.deduplicationEngine.incrementReference(hash, fileId);
      } catch {
        // Chunk may not exist in dedup engine yet (e.g. brand-new chunk)
        // Silently continue — the caller is responsible for registering chunks first
      }
    }

    // Update file's current version
    await this.metadataStore.updateFile(fileId, {
      currentVersion: nextVersion,
      updatedAt: now,
    });

    return {
      fileId,
      version: nextVersion,
      chunkHashes,
      size: totalSize,
      createdAt: now,
      userId,
      metadata: {},
    };
  }

  /**
   * Retrieve a specific version of a file.
   */
  async getVersion(fileId: string, version: number): Promise<FileVersion> {
    const record = await this.metadataStore.getFileVersion(fileId, version);
    if (!record) {
      throw new Error(`Version ${version} not found for file ${fileId}`);
    }

    return {
      fileId: record.fileId,
      version: record.version,
      chunkHashes: record.chunkHashes,
      size: record.size,
      createdAt: record.createdAt,
      userId: record.userId,
      metadata: {},
    };
  }

  /**
   * List all versions of a file, ordered by version number ascending.
   */
  async listVersions(fileId: string): Promise<FileVersion[]> {
    const records = await this.metadataStore.listFileVersions(fileId);
    return records
      .sort((a, b) => a.version - b.version)
      .map((r) => ({
        fileId: r.fileId,
        version: r.version,
        chunkHashes: r.chunkHashes,
        size: r.size,
        createdAt: r.createdAt,
        userId: r.userId,
        metadata: {},
      }));
  }

  /**
   * Delete versions older than retentionDays.
   * Decrements reference counts for chunks belonging to pruned versions.
   * Returns the number of versions deleted.
   */
  async pruneVersions(fileId: string, retentionDays: number): Promise<number> {
    const versions = await this.metadataStore.listFileVersions(fileId);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    // Never prune the latest version
    const sorted = versions.sort((a, b) => a.version - b.version);
    const latestVersion = sorted[sorted.length - 1]?.version ?? -1;

    let deleted = 0;
    for (const v of sorted) {
      if (v.version === latestVersion) continue; // always keep latest
      if (v.createdAt < cutoff) {
        // Decrement reference counts for chunks in this version
        for (const hash of v.chunkHashes) {
          try {
            await this.deduplicationEngine.decrementReference(hash, fileId);
          } catch {
            // Ignore if already at zero
          }
        }
        await this.metadataStore.deleteFileVersion(fileId, v.version);
        deleted++;
      }
    }

    return deleted;
  }
}
