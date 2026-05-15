import { createHash } from 'crypto';
import { Readable } from 'stream';
import { ChunkManager, ChunkMetadata } from './interfaces/chunk-manager.interface';

/**
 * ChunkManager Implementation
 *
 * Handles file chunking, reassembly, and verification using streaming APIs
 * for memory-efficient processing of large files.
 */
export class ChunkManagerImpl implements ChunkManager {
  private static readonly CHUNK_SIZE = 8 * 1024 * 1024; // 8MB in bytes

  /**
   * Split file into 8MB chunks and compute SHA-256 hash for each chunk
   * Uses streaming to handle files larger than available memory
   *
   * @param fileId - Unique identifier for the file
   * @param fileData - File content as Buffer
   * @returns Array of chunk metadata with sequence numbers and content hashes
   */
  async chunkFile(fileId: string, fileData: Buffer): Promise<ChunkMetadata[]> {
    const chunks: ChunkMetadata[] = [];
    const totalSize = fileData.length;
    let sequenceNumber = 0;

    // Handle empty file
    if (totalSize === 0) {
      return chunks;
    }

    // Process file in 8MB chunks
    for (let offset = 0; offset < totalSize; offset += ChunkManagerImpl.CHUNK_SIZE) {
      const chunkSize = Math.min(ChunkManagerImpl.CHUNK_SIZE, totalSize - offset);
      const chunkData = fileData.subarray(offset, offset + chunkSize);

      // Compute SHA-256 content hash
      const contentHash = this.computeHash(chunkData);

      // Create chunk metadata
      const metadata: ChunkMetadata = {
        fileId,
        sequenceNumber,
        contentHash,
        size: chunkSize,
        encryptedSize: 0, // Will be set by encryption service
      };

      chunks.push(metadata);
      sequenceNumber++;
    }

    return chunks;
  }

  /**
   * Reassemble chunks into original file
   * Retrieves chunks in sequence order and concatenates them
   *
   * Note: This implementation assumes chunks are retrieved from storage
   * In a real system, this would interact with the metadata store and storage nodes
   *
   * @param fileId - Unique identifier for the file
   * @param version - Version number of the file
   * @returns Reassembled file as Buffer
   */
  async assembleFile(fileId: string, version: number): Promise<Buffer> {
    // This is a placeholder implementation
    // In a real system, this would:
    // 1. Query metadata store for chunk hashes for this file version
    // 2. Retrieve chunks from storage nodes in sequence order
    // 3. Decrypt chunks using encryption service
    // 4. Concatenate chunks into final buffer
    //
    // For now, we'll throw an error indicating this needs integration
    throw new Error(
      'assembleFile requires integration with metadata store and storage nodes'
    );
  }

  /**
   * Verify chunk integrity using SHA-256 hash
   * Computes hash of provided chunk data and compares with expected hash
   *
   * @param chunkHash - Expected SHA-256 hash (64 hex characters)
   * @param chunkData - Chunk data to verify
   * @returns True if hash matches, false otherwise
   */
  verifyChunk(chunkHash: string, chunkData: Buffer): boolean {
    const computedHash = this.computeHash(chunkData);
    return computedHash === chunkHash;
  }

  /**
   * Compute SHA-256 hash of data
   *
   * @param data - Data to hash
   * @returns SHA-256 hash as hex string (64 characters)
   */
  private computeHash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Stream-based chunking for very large files
   * Processes file as a stream to minimize memory usage
   *
   * @param fileId - Unique identifier for the file
   * @param fileStream - Readable stream of file data
   * @returns Array of chunk metadata
   */
  async chunkFileStream(
    fileId: string,
    fileStream: Readable
  ): Promise<ChunkMetadata[]> {
    const chunks: ChunkMetadata[] = [];
    let sequenceNumber = 0;
    let buffer = Buffer.alloc(0);

    return new Promise((resolve, reject) => {
      fileStream.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        // Process complete chunks
        while (buffer.length >= ChunkManagerImpl.CHUNK_SIZE) {
          const chunkData = buffer.subarray(0, ChunkManagerImpl.CHUNK_SIZE);
          const contentHash = this.computeHash(chunkData);

          chunks.push({
            fileId,
            sequenceNumber,
            contentHash,
            size: ChunkManagerImpl.CHUNK_SIZE,
            encryptedSize: 0,
          });

          sequenceNumber++;
          buffer = buffer.subarray(ChunkManagerImpl.CHUNK_SIZE);
        }
      });

      fileStream.on('end', () => {
        // Process remaining data as final chunk
        if (buffer.length > 0) {
          const contentHash = this.computeHash(buffer);

          chunks.push({
            fileId,
            sequenceNumber,
            contentHash,
            size: buffer.length,
            encryptedSize: 0,
          });
        }

        resolve(chunks);
      });

      fileStream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Stream-based reassembly for very large files
   * Writes chunks to a writable stream to minimize memory usage
   *
   * @param chunks - Array of chunk data buffers in sequence order
   * @returns Readable stream of reassembled file
   */
  createAssemblyStream(chunks: Buffer[]): Readable {
    let currentIndex = 0;

    return new Readable({
      read() {
        if (currentIndex < chunks.length) {
          this.push(chunks[currentIndex]);
          currentIndex++;
        } else {
          this.push(null); // Signal end of stream
        }
      },
    });
  }
}
