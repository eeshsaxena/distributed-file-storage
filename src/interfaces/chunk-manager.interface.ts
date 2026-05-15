/**
 * Chunk Manager Interface
 *
 * Responsible for splitting files into fixed-size chunks and reassembling them.
 */

export interface ChunkManager {
  /**
   * Split file into chunks and return chunk metadata
   * @param fileId - Unique identifier for the file
   * @param fileData - File content as Buffer
   * @returns Array of chunk metadata
   */
  chunkFile(fileId: string, fileData: Buffer): Promise<ChunkMetadata[]>;

  /**
   * Reassemble chunks into original file
   * @param fileId - Unique identifier for the file
   * @param version - Version number of the file
   * @returns Reassembled file as Buffer
   */
  assembleFile(fileId: string, version: number): Promise<Buffer>;

  /**
   * Verify chunk integrity using SHA-256 hash
   * @param chunkHash - Expected SHA-256 hash
   * @param chunkData - Chunk data to verify
   * @returns True if hash matches, false otherwise
   */
  verifyChunk(chunkHash: string, chunkData: Buffer): boolean;
}

export interface ChunkMetadata {
  fileId: string;
  sequenceNumber: number;
  contentHash: string; // SHA-256 hash
  size: number; // Bytes
  encryptedSize: number; // Bytes after encryption
}
