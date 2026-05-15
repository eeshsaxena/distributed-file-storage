import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import * as os from 'os';
import { StorageNode, NodeHealth } from './interfaces/storage-node.interface';

/**
 * StorageNode Implementation
 *
 * Stores encrypted chunk data on disk with hash-prefix subdirectories
 * for efficient file organization and retrieval.
 */
export class StorageNodeImpl implements StorageNode {
  private readonly storagePath: string;
  private readonly nodeId: string;
  private readonly availabilityZone: string;
  private chunkCount: number = 0;

  constructor(
    storagePath: string,
    nodeId: string,
    availabilityZone: string = 'default'
  ) {
    this.storagePath = storagePath;
    this.nodeId = nodeId;
    this.availabilityZone = availabilityZone;
  }

  /**
   * Initialize storage directory structure
   * Creates the base storage directory if it doesn't exist
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to initialize storage directory: ${(error as Error).message}`);
    }
  }

  /**
   * Write chunk to disk
   * Organizes chunks in subdirectories based on first 2 characters of hash
   *
   * @param chunkHash - SHA-256 hash (64 hex characters)
   * @param data - Encrypted chunk data
   */
  async writeChunk(chunkHash: string, data: Buffer): Promise<void> {
    this.validateChunkHash(chunkHash);

    const chunkPath = this.getChunkPath(chunkHash);
    const chunkDir = join(this.storagePath, chunkHash.substring(0, 2));

    try {
      // Create subdirectory if it doesn't exist
      await fs.mkdir(chunkDir, { recursive: true });

      // Write chunk data to disk
      await fs.writeFile(chunkPath, data);

      this.chunkCount++;
    } catch (error) {
      throw new Error(
        `Failed to write chunk ${chunkHash}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Read chunk from disk
   *
   * @param chunkHash - SHA-256 hash of the chunk
   * @returns Encrypted chunk data
   */
  async readChunk(chunkHash: string): Promise<Buffer> {
    this.validateChunkHash(chunkHash);

    const chunkPath = this.getChunkPath(chunkHash);

    try {
      const data = await fs.readFile(chunkPath);
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Chunk not found: ${chunkHash}`);
      }
      throw new Error(
        `Failed to read chunk ${chunkHash}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Delete chunk from disk
   *
   * @param chunkHash - SHA-256 hash of the chunk
   */
  async deleteChunk(chunkHash: string): Promise<void> {
    this.validateChunkHash(chunkHash);

    const chunkPath = this.getChunkPath(chunkHash);

    try {
      await fs.unlink(chunkPath);
      this.chunkCount = Math.max(0, this.chunkCount - 1);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Chunk already deleted, not an error
        return;
      }
      throw new Error(
        `Failed to delete chunk ${chunkHash}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Verify chunk integrity by computing SHA-256 hash
   *
   * @param chunkHash - Expected SHA-256 hash
   * @returns True if chunk exists and hash matches, false otherwise
   */
  async verifyChunkIntegrity(chunkHash: string): Promise<boolean> {
    this.validateChunkHash(chunkHash);

    try {
      const data = await this.readChunk(chunkHash);
      const computedHash = this.computeHash(data);
      return computedHash === chunkHash;
    } catch (error) {
      // Chunk doesn't exist or can't be read
      return false;
    }
  }

  /**
   * Get node health metrics
   *
   * @returns Current health metrics for this storage node
   */
  async getHealthMetrics(): Promise<NodeHealth> {
    const diskUsage = await this.getDiskUsage();
    const cpuUsage = this.getCpuUsage();

    return {
      nodeId: this.nodeId,
      availabilityZone: this.availabilityZone,
      diskUsagePercent: diskUsage,
      cpuUsagePercent: cpuUsage,
      networkLatency: 0, // Would be measured by external monitoring
      chunkCount: this.chunkCount,
      lastHeartbeat: new Date(),
    };
  }

  /**
   * Get chunk file path based on hash-prefix organization
   * First 2 characters of hash are used as subdirectory
   *
   * @param chunkHash - SHA-256 hash
   * @returns Full path to chunk file
   */
  private getChunkPath(chunkHash: string): string {
    const prefix = chunkHash.substring(0, 2);
    return join(this.storagePath, prefix, chunkHash);
  }

  /**
   * Validate chunk hash format
   *
   * @param chunkHash - Hash to validate
   * @throws Error if hash is invalid
   */
  private validateChunkHash(chunkHash: string): void {
    if (!/^[a-f0-9]{64}$/.test(chunkHash)) {
      throw new Error(`Invalid chunk hash format: ${chunkHash}`);
    }
  }

  /**
   * Compute SHA-256 hash of data
   *
   * @param data - Data to hash
   * @returns SHA-256 hash as hex string
   */
  private computeHash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Calculate disk usage percentage for storage path
   *
   * @returns Disk usage percentage (0-100)
   */
  private async getDiskUsage(): Promise<number> {
    try {
      // Get total size of all chunks
      let totalSize = 0;
      const subdirs = await this.getSubdirectories();

      for (const subdir of subdirs) {
        const subdirPath = join(this.storagePath, subdir);
        const files = await fs.readdir(subdirPath);

        for (const file of files) {
          const filePath = join(subdirPath, file);
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
        }
      }

      // For simplicity, assume 1TB capacity per node
      const capacity = 1024 * 1024 * 1024 * 1024; // 1TB in bytes
      return (totalSize / capacity) * 100;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get CPU usage percentage
   * Uses Node.js os module to calculate CPU usage
   *
   * @returns CPU usage percentage (0-100)
   */
  private getCpuUsage(): number {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - (100 * idle) / total;

    return Math.max(0, Math.min(100, usage));
  }

  /**
   * Get list of subdirectories in storage path
   *
   * @returns Array of subdirectory names
   */
  private async getSubdirectories(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.storagePath, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get total number of chunks stored on this node
   *
   * @returns Total chunk count
   */
  async getChunkCount(): Promise<number> {
    try {
      let count = 0;
      const subdirs = await this.getSubdirectories();

      for (const subdir of subdirs) {
        const subdirPath = join(this.storagePath, subdir);
        const files = await fs.readdir(subdirPath);
        count += files.length;
      }

      this.chunkCount = count;
      return count;
    } catch (error) {
      return 0;
    }
  }

  /**
   * List all chunk hashes stored on this node
   *
   * @returns Array of chunk hashes
   */
  async listChunks(): Promise<string[]> {
    const chunks: string[] = [];

    try {
      const subdirs = await this.getSubdirectories();

      for (const subdir of subdirs) {
        const subdirPath = join(this.storagePath, subdir);
        const files = await fs.readdir(subdirPath);
        chunks.push(...files);
      }

      return chunks;
    } catch (error) {
      return [];
    }
  }
}
