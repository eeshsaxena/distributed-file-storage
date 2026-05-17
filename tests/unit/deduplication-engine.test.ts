import { DeduplicationEngineImpl } from '../../src/deduplication-engine';
import { ChunkRecord, MetadataStore } from '../../src/interfaces/metadata-store.interface';

/**
 * Unit Tests for Deduplication Engine
 *
 * Tests specific scenarios and edge cases for deduplication functionality
 */
describe('DeduplicationEngine', () => {
  let mockStore: jest.Mocked<MetadataStore>;
  let deduplicationEngine: DeduplicationEngineImpl;

  beforeEach(() => {
    // Create mock metadata store
    mockStore = {
      getChunk: jest.fn(),
      createChunk: jest.fn(),
      incrementChunkReference: jest.fn(),
      decrementChunkReference: jest.fn(),
      getOrphanedChunks: jest.fn(),
      getChunkReplicas: jest.fn(),
      deleteChunk: jest.fn(),
    } as any;

    deduplicationEngine = new DeduplicationEngineImpl(mockStore);
  });

  describe('checkDuplicate', () => {
    test('returns exists=false when chunk does not exist', async () => {
      mockStore.getChunk.mockResolvedValue(null);

      const result = await deduplicationEngine.checkDuplicate('nonexistent-hash');

      expect(result.exists).toBe(false);
      expect(result.chunkHash).toBe('nonexistent-hash');
      expect(result.referenceCount).toBe(0);
      expect(result.replicaLocations).toBeUndefined();
    });

    test('returns exists=true with metadata when chunk exists', async () => {
      const mockChunk: ChunkRecord = {
        chunkHash: 'existing-hash',
        size: 8388608,
        encryptedSize: 8388624,
        referenceCount: 3,
        createdAt: new Date(),
      };

      const mockReplicas = [
        {
          chunkHash: 'existing-hash',
          nodeId: 'node-1',
          availabilityZone: 'us-east-1a',
          createdAt: new Date('2024-01-01'),
        },
        {
          chunkHash: 'existing-hash',
          nodeId: 'node-2',
          availabilityZone: 'us-east-1b',
          createdAt: new Date('2024-01-01'),
        },
      ];

      mockStore.getChunk.mockResolvedValue(mockChunk);
      mockStore.getChunkReplicas.mockResolvedValue(mockReplicas);

      const result = await deduplicationEngine.checkDuplicate('existing-hash');

      expect(result.exists).toBe(true);
      expect(result.chunkHash).toBe('existing-hash');
      expect(result.referenceCount).toBe(3);
      expect(result.replicaLocations).toHaveLength(2);
      expect(result.replicaLocations![0].nodeId).toBe('node-1');
      expect(result.replicaLocations![1].nodeId).toBe('node-2');
    });

    test('returns empty replica locations when no replicas exist', async () => {
      const mockChunk: ChunkRecord = {
        chunkHash: 'hash-no-replicas',
        size: 8388608,
        encryptedSize: 8388624,
        referenceCount: 1,
        createdAt: new Date(),
      };

      mockStore.getChunk.mockResolvedValue(mockChunk);
      mockStore.getChunkReplicas.mockResolvedValue([]);

      const result = await deduplicationEngine.checkDuplicate('hash-no-replicas');

      expect(result.exists).toBe(true);
      expect(result.replicaLocations).toHaveLength(0);
    });
  });

  describe('incrementReference', () => {
    test('increments reference count for existing chunk', async () => {
      const mockChunk: ChunkRecord = {
        chunkHash: 'test-hash',
        size: 8388608,
        encryptedSize: 8388624,
        referenceCount: 2,
        createdAt: new Date(),
      };

      mockStore.getChunk.mockResolvedValue(mockChunk);
      mockStore.incrementChunkReference.mockResolvedValue(undefined);

      await deduplicationEngine.incrementReference('test-hash', 'file-123');

      expect(mockStore.incrementChunkReference).toHaveBeenCalledWith('test-hash', 'file-123');
    });

    test('throws error when chunk does not exist', async () => {
      mockStore.getChunk.mockResolvedValue(null);

      await expect(
        deduplicationEngine.incrementReference('nonexistent-hash', 'file-123')
      ).rejects.toThrow('Cannot increment reference: chunk nonexistent-hash does not exist');

      expect(mockStore.incrementChunkReference).not.toHaveBeenCalled();
    });
  });

  describe('decrementReference', () => {
    test('decrements reference count for existing chunk', async () => {
      const mockChunk: ChunkRecord = {
        chunkHash: 'test-hash',
        size: 8388608,
        encryptedSize: 8388624,
        referenceCount: 2,
        createdAt: new Date(),
      };

      mockStore.getChunk.mockResolvedValue(mockChunk);
      mockStore.decrementChunkReference.mockResolvedValue(undefined);

      await deduplicationEngine.decrementReference('test-hash', 'file-123');

      expect(mockStore.decrementChunkReference).toHaveBeenCalledWith('test-hash', 'file-123');
    });

    test('throws error when chunk does not exist', async () => {
      mockStore.getChunk.mockResolvedValue(null);

      await expect(
        deduplicationEngine.decrementReference('nonexistent-hash', 'file-123')
      ).rejects.toThrow('Cannot decrement reference: chunk nonexistent-hash does not exist');

      expect(mockStore.decrementChunkReference).not.toHaveBeenCalled();
    });

    test('throws error when reference count is already zero', async () => {
      const mockChunk: ChunkRecord = {
        chunkHash: 'test-hash',
        size: 8388608,
        encryptedSize: 8388624,
        referenceCount: 0,
        createdAt: new Date(),
      };

      mockStore.getChunk.mockResolvedValue(mockChunk);

      await expect(
        deduplicationEngine.decrementReference('test-hash', 'file-123')
      ).rejects.toThrow('Cannot decrement reference: chunk test-hash already has zero references');

      expect(mockStore.decrementChunkReference).not.toHaveBeenCalled();
    });

    test('throws error when reference count is negative (edge case)', async () => {
      const mockChunk: ChunkRecord = {
        chunkHash: 'test-hash',
        size: 8388608,
        encryptedSize: 8388624,
        referenceCount: -1, // Should never happen, but test defensive code
        createdAt: new Date(),
      };

      mockStore.getChunk.mockResolvedValue(mockChunk);

      await expect(
        deduplicationEngine.decrementReference('test-hash', 'file-123')
      ).rejects.toThrow('Cannot decrement reference: chunk test-hash already has zero references');
    });
  });

  describe('getOrphanedChunks', () => {
    test('returns list of orphaned chunk hashes', async () => {
      const orphanedHashes = ['hash-1', 'hash-2', 'hash-3'];
      mockStore.getOrphanedChunks.mockResolvedValue(orphanedHashes);

      const result = await deduplicationEngine.getOrphanedChunks();

      expect(result).toEqual(orphanedHashes);
      expect(mockStore.getOrphanedChunks).toHaveBeenCalled();
    });

    test('returns empty array when no orphaned chunks exist', async () => {
      mockStore.getOrphanedChunks.mockResolvedValue([]);

      const result = await deduplicationEngine.getOrphanedChunks();

      expect(result).toEqual([]);
    });
  });

  describe('calculateDeduplicationRatioFromChunks', () => {
    test('calculates correct ratio with multiple chunks', () => {
      const chunks: ChunkRecord[] = [
        {
          chunkHash: 'hash-1',
          size: 1000,
          encryptedSize: 1016,
          referenceCount: 3,
          createdAt: new Date(),
        },
        {
          chunkHash: 'hash-2',
          size: 2000,
          encryptedSize: 2016,
          referenceCount: 2,
          createdAt: new Date(),
        },
        {
          chunkHash: 'hash-3',
          size: 1500,
          encryptedSize: 1516,
          referenceCount: 1,
          createdAt: new Date(),
        },
      ];

      // Physical: 1000 + 2000 + 1500 = 4500
      // Logical: (1000 * 3) + (2000 * 2) + (1500 * 1) = 3000 + 4000 + 1500 = 8500
      // Ratio: 8500 / 4500 = 1.888...

      const ratio = deduplicationEngine.calculateDeduplicationRatioFromChunks(chunks);

      expect(ratio).toBeCloseTo(8500 / 4500, 5);
    });

    test('returns 1.0 for empty chunk array', () => {
      const ratio = deduplicationEngine.calculateDeduplicationRatioFromChunks([]);

      expect(ratio).toBe(1.0);
    });

    test('returns 1.0 when all chunks have reference count 1', () => {
      const chunks: ChunkRecord[] = [
        {
          chunkHash: 'hash-1',
          size: 1000,
          encryptedSize: 1016,
          referenceCount: 1,
          createdAt: new Date(),
        },
        {
          chunkHash: 'hash-2',
          size: 2000,
          encryptedSize: 2016,
          referenceCount: 1,
          createdAt: new Date(),
        },
      ];

      // Physical: 3000, Logical: 3000, Ratio: 1.0
      const ratio = deduplicationEngine.calculateDeduplicationRatioFromChunks(chunks);

      expect(ratio).toBe(1.0);
    });

    test('calculates high ratio when chunks are heavily deduplicated', () => {
      const chunks: ChunkRecord[] = [
        {
          chunkHash: 'hash-1',
          size: 1000,
          encryptedSize: 1016,
          referenceCount: 100, // Same chunk referenced 100 times
          createdAt: new Date(),
        },
      ];

      // Physical: 1000, Logical: 100000, Ratio: 100.0
      const ratio = deduplicationEngine.calculateDeduplicationRatioFromChunks(chunks);

      expect(ratio).toBe(100.0);
    });

    test('handles chunks with zero size gracefully', () => {
      const chunks: ChunkRecord[] = [
        {
          chunkHash: 'hash-1',
          size: 0,
          encryptedSize: 16,
          referenceCount: 5,
          createdAt: new Date(),
        },
      ];

      // Physical: 0, Logical: 0, Ratio: 1.0 (default)
      const ratio = deduplicationEngine.calculateDeduplicationRatioFromChunks(chunks);

      expect(ratio).toBe(1.0);
    });

    test('handles chunks with zero reference count', () => {
      const chunks: ChunkRecord[] = [
        {
          chunkHash: 'hash-1',
          size: 1000,
          encryptedSize: 1016,
          referenceCount: 0, // Orphaned chunk
          createdAt: new Date(),
        },
        {
          chunkHash: 'hash-2',
          size: 2000,
          encryptedSize: 2016,
          referenceCount: 3,
          createdAt: new Date(),
        },
      ];

      // Physical: 3000, Logical: 0 + 6000 = 6000, Ratio: 2.0
      const ratio = deduplicationEngine.calculateDeduplicationRatioFromChunks(chunks);

      expect(ratio).toBe(2.0);
    });
  });

  describe('edge cases', () => {
    test('handles very large reference counts', async () => {
      const mockChunk: ChunkRecord = {
        chunkHash: 'popular-chunk',
        size: 8388608,
        encryptedSize: 8388624,
        referenceCount: 1000000, // 1 million references
        createdAt: new Date(),
      };

      mockStore.getChunk.mockResolvedValue(mockChunk);
      mockStore.incrementChunkReference.mockResolvedValue(undefined);

      await deduplicationEngine.incrementReference('popular-chunk', 'file-new');

      expect(mockStore.incrementChunkReference).toHaveBeenCalled();
    });

    test('handles SHA-256 hash format validation', async () => {
      const validHash = 'a'.repeat(64); // 64 hex characters
      const mockChunk: ChunkRecord = {
        chunkHash: validHash,
        size: 8388608,
        encryptedSize: 8388624,
        referenceCount: 1,
        createdAt: new Date(),
      };

      mockStore.getChunk.mockResolvedValue(mockChunk);
      mockStore.getChunkReplicas.mockResolvedValue([]);

      const result = await deduplicationEngine.checkDuplicate(validHash);

      expect(result.exists).toBe(true);
      expect(result.chunkHash).toBe(validHash);
    });
  });
});
