import * as fc from 'fast-check';
import { DeduplicationEngineImpl } from '../../src/deduplication-engine';
import { ChunkRecord, MetadataStore } from '../../src/interfaces/metadata-store.interface';

/**
 * Property-Based Tests for Deduplication
 *
 * Feature: distributed-file-storage
 * Tests Properties 7-9, 32 from the design document
 */
describe('Deduplication Properties', () => {
  /**
   * Mock MetadataStore for testing
   * Simulates chunk storage and reference counting
   */
  class MockMetadataStore {
    private chunks: Map<string, ChunkRecord> = new Map();
    private replicas: Map<string, any[]> = new Map();

    async getChunk(chunkHash: string): Promise<ChunkRecord | null> {
      return this.chunks.get(chunkHash) || null;
    }

    async createChunk(chunk: ChunkRecord): Promise<void> {
      this.chunks.set(chunk.chunkHash, { ...chunk });
    }

    async incrementChunkReference(chunkHash: string, fileId: string): Promise<void> {
      const chunk = this.chunks.get(chunkHash);
      if (chunk) {
        chunk.referenceCount++;
      }
    }

    async decrementChunkReference(chunkHash: string, fileId: string): Promise<void> {
      const chunk = this.chunks.get(chunkHash);
      if (chunk) {
        chunk.referenceCount--;
      }
    }

    async getOrphanedChunks(): Promise<string[]> {
      const orphaned: string[] = [];
      for (const [hash, chunk] of this.chunks.entries()) {
        if (chunk.referenceCount === 0) {
          orphaned.push(hash);
        }
      }
      return orphaned;
    }

    async getChunkReplicas(chunkHash: string): Promise<any[]> {
      return this.replicas.get(chunkHash) || [];
    }

    async deleteChunk(chunkHash: string): Promise<void> {
      this.chunks.delete(chunkHash);
    }

    // Helper methods for testing
    getAllChunks(): ChunkRecord[] {
      return Array.from(this.chunks.values());
    }

    reset(): void {
      this.chunks.clear();
      this.replicas.clear();
    }

    setReplicas(chunkHash: string, replicas: any[]): void {
      this.replicas.set(chunkHash, replicas);
    }
  }

  let mockStore: MockMetadataStore;
  let deduplicationEngine: DeduplicationEngineImpl;

  beforeEach(() => {
    mockStore = new MockMetadataStore();
    deduplicationEngine = new DeduplicationEngineImpl(mockStore as any);
  });

  /**
   * Property 7: Deduplication increments reference count
   *
   * For any chunk, uploading the same chunk content N times SHALL result in
   * a reference count of N and only one physical copy stored.
   *
   * **Validates: Requirements 3.2, 3.3**
   */
  test('Property 7: Deduplication increments reference count', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 64 }), // Chunk hash
        fc.integer({ min: 1, max: 20 }), // Number of times to upload
        fc.integer({ min: 1000, max: 10000 }), // Chunk size
        async (chunkHash, uploadCount, chunkSize) => {
          mockStore.reset();

          // Create initial chunk with reference count 0
          await mockStore.createChunk({
            chunkHash,
            size: chunkSize,
            encryptedSize: chunkSize + 16, // Simulated encryption overhead
            referenceCount: 0,
            createdAt: new Date(),
          });

          // Upload the same chunk N times (increment reference count)
          for (let i = 0; i < uploadCount; i++) {
            await deduplicationEngine.incrementReference(chunkHash, `file-${i}`);
          }

          // Verify reference count equals N
          const result = await deduplicationEngine.checkDuplicate(chunkHash);
          expect(result.exists).toBe(true);
          expect(result.referenceCount).toBe(uploadCount);

          // Verify only one physical copy exists
          const allChunks = mockStore.getAllChunks();
          const matchingChunks = allChunks.filter((c) => c.chunkHash === chunkHash);
          expect(matchingChunks).toHaveLength(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 8: Delete decrements reference count
   *
   * For any file, adding the file (which increments reference counts for its chunks)
   * and then deleting the file SHALL return all chunk reference counts to their
   * original values.
   *
   * **Validates: Requirements 3.4**
   */
  test('Property 8: Delete decrements reference count', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 64 }), {
          minLength: 1,
          maxLength: 10,
        }), // Chunk hashes for a file
        fc.integer({ min: 1000, max: 10000 }), // Chunk size
        async (chunkHashes, chunkSize) => {
          mockStore.reset();

          // Create chunks with initial reference counts
          const initialReferenceCounts = new Map<string, number>();
          for (const hash of chunkHashes) {
            const initialCount = Math.floor(Math.random() * 5); // Random initial count 0-4
            initialReferenceCounts.set(hash, initialCount);

            await mockStore.createChunk({
              chunkHash: hash,
              size: chunkSize,
              encryptedSize: chunkSize + 16,
              referenceCount: initialCount,
              createdAt: new Date(),
            });
          }

          // Add file (increment all chunk references)
          for (const hash of chunkHashes) {
            await deduplicationEngine.incrementReference(hash, 'test-file');
          }

          // Delete file (decrement all chunk references)
          for (const hash of chunkHashes) {
            await deduplicationEngine.decrementReference(hash, 'test-file');
          }

          // Verify all reference counts returned to original values
          for (const hash of chunkHashes) {
            const result = await deduplicationEngine.checkDuplicate(hash);
            expect(result.referenceCount).toBe(initialReferenceCounts.get(hash));
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 9: Reference count accuracy across operations
   *
   * For any sequence of file upload and delete operations, the reference count
   * for each chunk SHALL accurately equal the number of files currently
   * referencing that chunk.
   *
   * **Validates: Requirements 3.6**
   */
  test('Property 9: Reference count accuracy across operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            operation: fc.constantFrom('add', 'delete'),
            fileId: fc.string({ minLength: 1, maxLength: 20 }),
            chunkHashes: fc.array(fc.string({ minLength: 1, maxLength: 64 }), {
              minLength: 1,
              maxLength: 5,
            }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        fc.integer({ min: 1000, max: 10000 }), // Chunk size
        async (operations, chunkSize) => {
          mockStore.reset();

          // Track which files reference which chunks
          const fileChunkMap = new Map<string, Set<string>>();
          const chunkFileMap = new Map<string, Set<string>>();

          // Initialize all chunks that will be used
          const allChunks = new Set<string>();
          for (const op of operations) {
            for (const hash of op.chunkHashes) {
              allChunks.add(hash);
            }
          }

          for (const hash of allChunks) {
            await mockStore.createChunk({
              chunkHash: hash,
              size: chunkSize,
              encryptedSize: chunkSize + 16,
              referenceCount: 0,
              createdAt: new Date(),
            });
            chunkFileMap.set(hash, new Set());
          }

          // Execute operations
          for (const op of operations) {
            if (op.operation === 'add') {
              // Add file
              if (!fileChunkMap.has(op.fileId)) {
                // Use Set to deduplicate chunk hashes within the same file
                const uniqueChunks = new Set(op.chunkHashes);
                fileChunkMap.set(op.fileId, uniqueChunks);

                // Increment references for all unique chunks
                for (const hash of uniqueChunks) {
                  await deduplicationEngine.incrementReference(hash, op.fileId);
                  chunkFileMap.get(hash)!.add(op.fileId);
                }
              }
            } else if (op.operation === 'delete') {
              // Delete file
              const chunks = fileChunkMap.get(op.fileId);
              if (chunks) {
                // Decrement references for all chunks
                for (const hash of chunks) {
                  await deduplicationEngine.decrementReference(hash, op.fileId);
                  chunkFileMap.get(hash)!.delete(op.fileId);
                }
                fileChunkMap.delete(op.fileId);
              }
            }
          }

          // Verify reference counts match actual file references
          for (const [hash, files] of chunkFileMap.entries()) {
            const result = await deduplicationEngine.checkDuplicate(hash);
            expect(result.referenceCount).toBe(files.size);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 32: Deduplication ratio formula is correct
   *
   * For any set of files with known logical size and physical storage used,
   * the deduplication ratio SHALL equal logical size divided by physical storage used.
   *
   * **Validates: Requirements 14.2**
   */
  test('Property 32: Deduplication ratio formula is correct', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            chunkHash: fc.string({ minLength: 1, maxLength: 64 }),
            size: fc.integer({ min: 1000, max: 10000 }),
            referenceCount: fc.integer({ min: 1, max: 10 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        async (chunkData) => {
          mockStore.reset();

          // Deduplicate chunk hashes to ensure uniqueness (as would happen in real system)
          const uniqueChunks = new Map<string, typeof chunkData[0]>();
          for (const data of chunkData) {
            if (!uniqueChunks.has(data.chunkHash)) {
              uniqueChunks.set(data.chunkHash, data);
            } else {
              // If duplicate hash, add reference counts together
              const existing = uniqueChunks.get(data.chunkHash)!;
              existing.referenceCount += data.referenceCount;
            }
          }

          const deduplicatedChunkData = Array.from(uniqueChunks.values());

          // Create chunks with specified reference counts
          for (const data of deduplicatedChunkData) {
            await mockStore.createChunk({
              chunkHash: data.chunkHash,
              size: data.size,
              encryptedSize: data.size + 16,
              referenceCount: data.referenceCount,
              createdAt: new Date(),
            });
          }

          // Calculate expected deduplication ratio
          const physicalStorage = deduplicatedChunkData.reduce(
            (sum, chunk) => sum + chunk.size,
            0
          );
          const logicalStorage = deduplicatedChunkData.reduce(
            (sum, chunk) => sum + chunk.size * chunk.referenceCount,
            0
          );
          const expectedRatio = logicalStorage / physicalStorage;

          // Get actual ratio from deduplication engine
          const chunks = mockStore.getAllChunks();
          const actualRatio = deduplicationEngine.calculateDeduplicationRatioFromChunks(chunks);

          // Verify ratio is correct (with small tolerance for floating point)
          expect(Math.abs(actualRatio - expectedRatio)).toBeLessThan(0.0001);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Orphaned chunks are correctly identified
   */
  test('Property: Orphaned chunks have zero references', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            chunkHash: fc.string({ minLength: 1, maxLength: 64 }),
            size: fc.integer({ min: 1000, max: 10000 }),
            referenceCount: fc.integer({ min: 0, max: 5 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        async (chunkData) => {
          mockStore.reset();

          // Deduplicate chunk hashes to ensure uniqueness
          const uniqueChunks = new Map<string, typeof chunkData[0]>();
          for (const data of chunkData) {
            if (!uniqueChunks.has(data.chunkHash)) {
              uniqueChunks.set(data.chunkHash, data);
            }
          }

          const deduplicatedChunkData = Array.from(uniqueChunks.values());

          // Create chunks
          for (const data of deduplicatedChunkData) {
            await mockStore.createChunk({
              chunkHash: data.chunkHash,
              size: data.size,
              encryptedSize: data.size + 16,
              referenceCount: data.referenceCount,
              createdAt: new Date(),
            });
          }

          // Get orphaned chunks
          const orphaned = await deduplicationEngine.getOrphanedChunks();

          // Verify all orphaned chunks have zero references
          for (const hash of orphaned) {
            const chunk = await mockStore.getChunk(hash);
            expect(chunk).not.toBeNull();
            expect(chunk!.referenceCount).toBe(0);
          }

          // Verify all zero-reference chunks are in orphaned list
          const expectedOrphaned = deduplicatedChunkData
            .filter((c) => c.referenceCount === 0)
            .map((c) => c.chunkHash);

          expect(orphaned.sort()).toEqual(expectedOrphaned.sort());
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Deduplication ratio is always >= 1.0
   */
  test('Property: Deduplication ratio is always >= 1.0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            chunkHash: fc.string({ minLength: 1, maxLength: 64 }),
            size: fc.integer({ min: 1, max: 10000 }),
            referenceCount: fc.integer({ min: 1, max: 10 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        async (chunkData) => {
          mockStore.reset();

          for (const data of chunkData) {
            await mockStore.createChunk({
              chunkHash: data.chunkHash,
              size: data.size,
              encryptedSize: data.size + 16,
              referenceCount: data.referenceCount,
              createdAt: new Date(),
            });
          }

          const chunks = mockStore.getAllChunks();
          const ratio = deduplicationEngine.calculateDeduplicationRatioFromChunks(chunks);

          // Ratio should always be >= 1.0 (logical >= physical)
          expect(ratio).toBeGreaterThanOrEqual(1.0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Cannot decrement below zero
   */
  test('Property: Cannot decrement reference count below zero', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 64 }),
        fc.integer({ min: 1000, max: 10000 }),
        async (chunkHash, chunkSize) => {
          mockStore.reset();

          // Create chunk with zero references
          await mockStore.createChunk({
            chunkHash,
            size: chunkSize,
            encryptedSize: chunkSize + 16,
            referenceCount: 0,
            createdAt: new Date(),
          });

          // Attempt to decrement should throw error
          await expect(
            deduplicationEngine.decrementReference(chunkHash, 'test-file')
          ).rejects.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });
});
