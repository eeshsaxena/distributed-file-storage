/**
 * Version Manager Interface
 *
 * Manages file version history and retention.
 */

export interface VersionManager {
  /**
   * Create new version of file
   * @param fileId - File identifier
   * @param chunkHashes - Array of chunk hashes for this version
   * @param userId - User identifier
   * @returns File version
   */
  createVersion(fileId: string, chunkHashes: string[], userId: string): Promise<FileVersion>;

  /**
   * Get specific version of file
   * @param fileId - File identifier
   * @param version - Version number
   * @returns File version
   */
  getVersion(fileId: string, version: number): Promise<FileVersion>;

  /**
   * List all versions of file
   * @param fileId - File identifier
   * @returns Array of file versions
   */
  listVersions(fileId: string): Promise<FileVersion[]>;

  /**
   * Delete old versions based on retention policy
   * @param fileId - File identifier
   * @param retentionDays - Number of days to retain versions
   * @returns Number of versions deleted
   */
  pruneVersions(fileId: string, retentionDays: number): Promise<number>;
}

export interface FileVersion {
  fileId: string;
  version: number;
  chunkHashes: string[];
  size: number;
  createdAt: Date;
  userId: string;
  metadata: Record<string, unknown>;
}
