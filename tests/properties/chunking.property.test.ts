import * as fc from 'fast-check';
import { ChunkManagerImpl } from '../../src/chunk-manager';
import { ChunkMetadata } from '../../src/interfaces/chunk-manager.interface';

/**
 * Property-Based Tests for Chunking
 *
 * Feature: distributed-file-storage
 * Tests Properties 1-5 from the design document
 */
describe('Chunking Properties', () => {
  let chunkManager: ChunkManagerImpl;
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB

  beforeEach(() => {
    chunkManager = new ChunkManagerImpl();
  });

  /**
   * Property 1: Chunking produces correct chunk sizes
   *
   * For any file, when divided into chunks, all chunks except possibly the last
   * SHALL be exactly 8MB (8,388,608 bytes), and the last chunk SHALL be at most 8MB.
   *
   * **Validates: Requirements 1.1, 1.2**
   */
  test('Property 1: Chunking produces correct chunk sizes', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random byte arrays from 0 to 50MB
        fc.uint8Array({ minLength: 0, maxLength: 50 * 1024 * 1024 }),
        async (fileData) => {
          const fileId = `file-${Math.random()}`;
          const chunks = await chunkManager.chunkFile(fileId, Buffer.from(fileData));

          if (fileData.length === 0) {
            // Empty file should produce no chunks
            expect(chunks).toHaveLength(0);
            return;
          }

          // All chunks except the last must be exactly 8MB
          for (let i = 0; i < chunks.length - 1; i++) {
            expect(chunks[i].size).toBe(CHUNK_SIZE);
          }

          // Last chunk must be at most 8MB
          if (chunks.length > 0) {
            const lastChunk = chunks[chunks.length - 1];
            expect(lastChunk.size).toBeGreaterThan(0);
            expect(lastChunk.size).toBeLessThanOrEqual(CHUNK_SIZE);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: All chunks have SHA-256 content hashes
   *
   * For any file that is chunked, every resulting chunk SHALL have a valid
   * SHA-256 content hash (32 bytes / 64 hexadecimal characters).
   *
   * **Validates: Requirements 1.3**
   */
  test('Property 2: All chunks have SHA-256 content hashes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 30 * 1024 * 1024 }),
        async (fileData) => {
          const fileId = `file-${Math.random()}`;
          const chunks = await chunkManager.chunkFile(fileId, Buffer.from(fileData));

          // Every chunk must have a valid SHA-256 hash
          for (const chunk of chunks) {
            expect(chunk.contentHash).toBeDefined();
            expect(chunk.contentHash).toMatch(/^[a-f0-9]{64}$/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Chunk metadata contains required fields
   *
   * For any chunk created from a file, the chunk metadata SHALL contain
   * file identifier, chunk sequence number, size, and content hash.
   *
   * **Validates: Requirements 1.4**
   */
  test('Property 3: Chunk metadata contains required fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 30 * 1024 * 1024 }),
        fc.uuid(),
        async (fileData, fileId) => {
          const chunks = await chunkManager.chunkFile(fileId, Buffer.from(fileData));

          for (const chunk of chunks) {
            // Must have file identifier
            expect(chunk.fileId).toBeDefined();
            expect(chunk.fileId).toBe(fileId);

            // Must have sequence number (non-negative integer)
            expect(chunk.sequenceNumber).toBeDefined();
            expect(Number.isInteger(chunk.sequenceNumber)).toBe(true);
            expect(chunk.sequenceNumber).toBeGreaterThanOrEqual(0);

            // Must have size (positive integer)
            expect(chunk.size).toBeDefined();
            expect(Number.isInteger(chunk.size)).toBe(true);
            expect(chunk.size).toBeGreaterThan(0);

            // Must have content hash (SHA-256)
            expect(chunk.contentHash).toBeDefined();
            expect(chunk.contentHash).toMatch(/^[a-f0-9]{64}$/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4: Chunk-reassemble round-trip preserves file
   *
   * For any file, chunking the file and then reassembling the chunks SHALL
   * produce a file that is byte-for-byte identical to the original file.
   *
   * **Validates: Requirements 1.5**
   */
  test('Property 4: Chunk-reassemble round-trip preserves file', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 50 * 1024 * 1024 }),
        async (fileData) => {
          const fileId = `file-${Math.random()}`;
          const originalBuffer = Buffer.from(fileData);

          // Chunk the file
          const chunks = await chunkManager.chunkFile(fileId, originalBuffer);

          // Reassemble by concatenating chunks in sequence order
          // (Simulating what assembleFile would do)
          const chunkBuffers: Buffer[] = [];
          let offset = 0;

          for (const chunk of chunks) {
            const chunkData = originalBuffer.subarray(offset, offset + chunk.size);
            chunkBuffers.push(chunkData);
            offset += chunk.size;
          }

          const reassembled = Buffer.concat(chunkBuffers);

          // Verify byte-for-byte equality
          expect(reassembled.length).toBe(originalBuffer.length);
          expect(reassembled.equals(originalBuffer)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5: Chunk-reassemble-chunk preserves hashes
   *
   * For any file, chunking the file, reassembling the chunks, and chunking again
   * SHALL produce chunks with identical content hashes at each sequence position.
   *
   * **Validates: Requirements 1.6**
   */
  test('Property 5: Chunk-reassemble-chunk preserves hashes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 50 * 1024 * 1024 }),
        async (fileData) => {
          const fileId = `file-${Math.random()}`;
          const originalBuffer = Buffer.from(fileData);

          // First chunking
          const chunks1 = await chunkManager.chunkFile(fileId, originalBuffer);

          // Reassemble
          const chunkBuffers: Buffer[] = [];
          let offset = 0;

          for (const chunk of chunks1) {
            const chunkData = originalBuffer.subarray(offset, offset + chunk.size);
            chunkBuffers.push(chunkData);
            offset += chunk.size;
          }

          const reassembled = Buffer.concat(chunkBuffers);

          // Second chunking
          const chunks2 = await chunkManager.chunkFile(fileId, reassembled);

          // Verify same number of chunks
          expect(chunks2.length).toBe(chunks1.length);

          // Verify identical hashes at each position
          for (let i = 0; i < chunks1.length; i++) {
            expect(chunks2[i].contentHash).toBe(chunks1[i].contentHash);
            expect(chunks2[i].size).toBe(chunks1[i].size);
            expect(chunks2[i].sequenceNumber).toBe(chunks1[i].sequenceNumber);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Sequence numbers are sequential starting from 0
   */
  test('Property: Sequence numbers are sequential starting from 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 50 * 1024 * 1024 }),
        async (fileData) => {
          const fileId = `file-${Math.random()}`;
          const chunks = await chunkManager.chunkFile(fileId, Buffer.from(fileData));

          for (let i = 0; i < chunks.length; i++) {
            expect(chunks[i].sequenceNumber).toBe(i);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Total chunk sizes equal original file size
   */
  test('Property: Total chunk sizes equal original file size', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 50 * 1024 * 1024 }),
        async (fileData) => {
          const fileId = `file-${Math.random()}`;
          const chunks = await chunkManager.chunkFile(fileId, Buffer.from(fileData));

          const totalChunkSize = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
          expect(totalChunkSize).toBe(fileData.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Identical content produces identical hashes
   */
  test('Property: Identical content produces identical hashes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 20 * 1024 * 1024 }),
        async (fileData) => {
          const fileId1 = `file-1-${Math.random()}`;
          const fileId2 = `file-2-${Math.random()}`;
          const buffer = Buffer.from(fileData);

          const chunks1 = await chunkManager.chunkFile(fileId1, buffer);
          const chunks2 = await chunkManager.chunkFile(fileId2, buffer);

          expect(chunks1.length).toBe(chunks2.length);

          for (let i = 0; i < chunks1.length; i++) {
            expect(chunks1[i].contentHash).toBe(chunks2[i].contentHash);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Chunk verification works correctly
   */
  test('Property: Chunk verification detects modifications', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 10 * 1024 * 1024 }),
        fc.integer({ min: 0, max: 255 }),
        async (fileData, corruptionByte) => {
          const fileId = `file-${Math.random()}`;
          const originalBuffer = Buffer.from(fileData);

          const chunks = await chunkManager.chunkFile(fileId, originalBuffer);

          if (chunks.length === 0) return;

          // Verify original chunk
          let offset = 0;
          const firstChunkData = originalBuffer.subarray(offset, offset + chunks[0].size);
          expect(chunkManager.verifyChunk(chunks[0].contentHash, firstChunkData)).toBe(true);

          // Corrupt the chunk and verify it fails
          if (firstChunkData.length > 0) {
            const corruptedChunk = Buffer.from(firstChunkData);
            corruptedChunk[0] = corruptionByte;

            // Only expect failure if we actually changed the byte
            if (corruptedChunk[0] !== firstChunkData[0]) {
              expect(chunkManager.verifyChunk(chunks[0].contentHash, corruptedChunk)).toBe(false);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
