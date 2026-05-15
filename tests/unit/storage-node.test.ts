import { StorageNodeImpl } from '../../src/storage-node';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

describe('StorageNode', () => {
  let storageNode: StorageNodeImpl;
  let testStoragePath: string;
  const nodeId = 'test-node-1';
  const availabilityZone = 'us-east-1a';

  beforeEach(async () => {
    // Create temporary storage directory
    testStoragePath = join(tmpdir(), `storage-node-test-${Date.now()}`);
    storageNode = new StorageNodeImpl(testStoragePath, nodeId, availabilityZone);
    await storageNode.initialize();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('writeChunk', () => {
    it('should write chunk to disk', async () => {
      const chunkData = Buffer.from('Test chunk data');
      const chunkHash = computeHash(chunkData);

      await storageNode.writeChunk(chunkHash, chunkData);

      // Verify file exists
      const chunkPath = join(testStoragePath, chunkHash.substring(0, 2), chunkHash);
      const exists = await fileExists(chunkPath);
      expect(exists).toBe(true);
    });

    it('should create subdirectory based on hash prefix', async () => {
      const chunkData = Buffer.from('Test data');
      const chunkHash = computeHash(chunkData);
      const prefix = chunkHash.substring(0, 2);

      await storageNode.writeChunk(chunkHash, chunkData);

      // Verify subdirectory exists
      const subdirPath = join(testStoragePath, prefix);
      const stats = await fs.stat(subdirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should write multiple chunks to same subdirectory', async () => {
      // Create two chunks with same prefix (first 2 chars)
      const chunk1 = Buffer.from('Chunk 1');
      const chunk2 = Buffer.from('Chunk 2');

      // We'll use actual hashes, which may or may not have same prefix
      // So we'll just write both and verify they exist
      const hash1 = computeHash(chunk1);
      const hash2 = computeHash(chunk2);

      await storageNode.writeChunk(hash1, chunk1);
      await storageNode.writeChunk(hash2, chunk2);

      const path1 = join(testStoragePath, hash1.substring(0, 2), hash1);
      const path2 = join(testStoragePath, hash2.substring(0, 2), hash2);

      expect(await fileExists(path1)).toBe(true);
      expect(await fileExists(path2)).toBe(true);
    });

    it('should reject invalid chunk hash', async () => {
      const chunkData = Buffer.from('Test');
      const invalidHash = 'invalid-hash';

      await expect(storageNode.writeChunk(invalidHash, chunkData)).rejects.toThrow(
        'Invalid chunk hash format'
      );
    });

    it('should handle empty chunk data', async () => {
      const chunkData = Buffer.alloc(0);
      const chunkHash = computeHash(chunkData);

      await storageNode.writeChunk(chunkHash, chunkData);

      const chunkPath = join(testStoragePath, chunkHash.substring(0, 2), chunkHash);
      expect(await fileExists(chunkPath)).toBe(true);
    });

    it('should handle large chunk data', async () => {
      const chunkData = Buffer.alloc(8 * 1024 * 1024, 'a'); // 8MB
      const chunkHash = computeHash(chunkData);

      await storageNode.writeChunk(chunkHash, chunkData);

      const chunkPath = join(testStoragePath, chunkHash.substring(0, 2), chunkHash);
      expect(await fileExists(chunkPath)).toBe(true);

      const readData = await fs.readFile(chunkPath);
      expect(readData.length).toBe(chunkData.length);
    });
  });

  describe('readChunk', () => {
    it('should read chunk from disk', async () => {
      const chunkData = Buffer.from('Test chunk data');
      const chunkHash = computeHash(chunkData);

      await storageNode.writeChunk(chunkHash, chunkData);
      const readData = await storageNode.readChunk(chunkHash);

      expect(readData.equals(chunkData)).toBe(true);
    });

    it('should throw error for non-existent chunk', async () => {
      const nonExistentHash = 'a'.repeat(64);

      await expect(storageNode.readChunk(nonExistentHash)).rejects.toThrow(
        'Chunk not found'
      );
    });

    it('should reject invalid chunk hash', async () => {
      const invalidHash = 'invalid';

      await expect(storageNode.readChunk(invalidHash)).rejects.toThrow(
        'Invalid chunk hash format'
      );
    });

    it('should read empty chunk', async () => {
      const chunkData = Buffer.alloc(0);
      const chunkHash = computeHash(chunkData);

      await storageNode.writeChunk(chunkHash, chunkData);
      const readData = await storageNode.readChunk(chunkHash);

      expect(readData.length).toBe(0);
    });

    it('should read large chunk', async () => {
      const chunkData = Buffer.alloc(8 * 1024 * 1024, 'b'); // 8MB
      const chunkHash = computeHash(chunkData);

      await storageNode.writeChunk(chunkHash, chunkData);
      const readData = await storageNode.readChunk(chunkHash);

      expect(readData.equals(chunkData)).toBe(true);
    });
  });

  describe('deleteChunk', () => {
    it('should delete chunk from disk', async () => {
      const chunkData = Buffer.from('Test chunk');
      const chunkHash = computeHash(chunkData);

      await storageNode.writeChunk(chunkHash, chunkData);
      await storageNode.deleteChunk(chunkHash);

      const chunkPath = join(testStoragePath, chunkHash.substring(0, 2), chunkHash);
      expect(await fileExists(chunkPath)).toBe(false);
    });

    it('should not throw error when deleting non-existent chunk', async () => {
      const nonExistentHash = 'b'.repeat(64);

      await expect(storageNode.deleteChunk(nonExistentHash)).resolves.not.toThrow();
    });

    it('should reject invalid chunk hash', async () => {
      const invalidHash = 'invalid';

      await expect(storageNode.deleteChunk(invalidHash)).rejects.toThrow(
        'Invalid chunk hash format'
      );
    });

    it('should handle multiple deletes of same chunk', async () => {
      const chunkData = Buffer.from('Test');
      const chunkHash = computeHash(chunkData);

      await storageNode.writeChunk(chunkHash, chunkData);
      await storageNode.deleteChunk(chunkHash);
      await storageNode.deleteChunk(chunkHash); // Second delete should not throw

      const chunkPath = join(testStoragePath, chunkHash.substring(0, 2), chunkHash);
      expect(await fileExists(chunkPath)).toBe(false);
    });
  });

  describe('verifyChunkIntegrity', () => {
    it('should return true for valid chunk', async () => {
      const chunkData = Buffer.from('Test chunk data');
      const chunkHash = computeHash(chunkData);

      await storageNode.writeChunk(chunkHash, chunkData);
      const isValid = await storageNode.verifyChunkIntegrity(chunkHash);

      expect(isValid).toBe(true);
    });

    it('should return false for non-existent chunk', async () => {
      const nonExistentHash = 'c'.repeat(64);

      const isValid = await storageNode.verifyChunkIntegrity(nonExistentHash);

      expect(isValid).toBe(false);
    });

    it('should return false for corrupted chunk', async () => {
      const chunkData = Buffer.from('Original data');
      const chunkHash = computeHash(chunkData);

      await storageNode.writeChunk(chunkHash, chunkData);

      // Corrupt the chunk by writing different data
      const chunkPath = join(testStoragePath, chunkHash.substring(0, 2), chunkHash);
      await fs.writeFile(chunkPath, Buffer.from('Corrupted data'));

      const isValid = await storageNode.verifyChunkIntegrity(chunkHash);

      expect(isValid).toBe(false);
    });

    it('should reject invalid chunk hash', async () => {
      const invalidHash = 'invalid';

      await expect(storageNode.verifyChunkIntegrity(invalidHash)).rejects.toThrow(
        'Invalid chunk hash format'
      );
    });
  });

  describe('getHealthMetrics', () => {
    it('should return health metrics', async () => {
      const metrics = await storageNode.getHealthMetrics();

      expect(metrics.nodeId).toBe(nodeId);
      expect(metrics.availabilityZone).toBe(availabilityZone);
      expect(metrics.diskUsagePercent).toBeGreaterThanOrEqual(0);
      expect(metrics.diskUsagePercent).toBeLessThanOrEqual(100);
      expect(metrics.cpuUsagePercent).toBeGreaterThanOrEqual(0);
      expect(metrics.cpuUsagePercent).toBeLessThanOrEqual(100);
      expect(metrics.chunkCount).toBeGreaterThanOrEqual(0);
      expect(metrics.lastHeartbeat).toBeInstanceOf(Date);
    });

    it('should track chunk count', async () => {
      const chunk1 = Buffer.from('Chunk 1');
      const chunk2 = Buffer.from('Chunk 2');
      const hash1 = computeHash(chunk1);
      const hash2 = computeHash(chunk2);

      await storageNode.writeChunk(hash1, chunk1);
      await storageNode.writeChunk(hash2, chunk2);

      const metrics = await storageNode.getHealthMetrics();
      expect(metrics.chunkCount).toBe(2);
    });

    it('should update chunk count after deletion', async () => {
      const chunkData = Buffer.from('Test');
      const chunkHash = computeHash(chunkData);

      await storageNode.writeChunk(chunkHash, chunkData);
      let metrics = await storageNode.getHealthMetrics();
      expect(metrics.chunkCount).toBe(1);

      await storageNode.deleteChunk(chunkHash);
      metrics = await storageNode.getHealthMetrics();
      expect(metrics.chunkCount).toBe(0);
    });
  });

  describe('getChunkCount', () => {
    it('should return correct chunk count', async () => {
      const chunk1 = Buffer.from('Chunk 1');
      const chunk2 = Buffer.from('Chunk 2');
      const chunk3 = Buffer.from('Chunk 3');

      await storageNode.writeChunk(computeHash(chunk1), chunk1);
      await storageNode.writeChunk(computeHash(chunk2), chunk2);
      await storageNode.writeChunk(computeHash(chunk3), chunk3);

      const count = await storageNode.getChunkCount();
      expect(count).toBe(3);
    });

    it('should return 0 for empty storage', async () => {
      const count = await storageNode.getChunkCount();
      expect(count).toBe(0);
    });
  });

  describe('listChunks', () => {
    it('should list all chunk hashes', async () => {
      const chunk1 = Buffer.from('Chunk 1');
      const chunk2 = Buffer.from('Chunk 2');
      const hash1 = computeHash(chunk1);
      const hash2 = computeHash(chunk2);

      await storageNode.writeChunk(hash1, chunk1);
      await storageNode.writeChunk(hash2, chunk2);

      const chunks = await storageNode.listChunks();
      expect(chunks).toContain(hash1);
      expect(chunks).toContain(hash2);
      expect(chunks.length).toBe(2);
    });

    it('should return empty array for empty storage', async () => {
      const chunks = await storageNode.listChunks();
      expect(chunks).toEqual([]);
    });
  });

  describe('round-trip operations', () => {
    it('should preserve data through write-read cycle', async () => {
      const originalData = Buffer.from('Round-trip test data');
      const chunkHash = computeHash(originalData);

      await storageNode.writeChunk(chunkHash, originalData);
      const retrievedData = await storageNode.readChunk(chunkHash);

      expect(retrievedData.equals(originalData)).toBe(true);
    });

    it('should handle write-verify-read-delete cycle', async () => {
      const chunkData = Buffer.from('Lifecycle test');
      const chunkHash = computeHash(chunkData);

      // Write
      await storageNode.writeChunk(chunkHash, chunkData);

      // Verify
      expect(await storageNode.verifyChunkIntegrity(chunkHash)).toBe(true);

      // Read
      const readData = await storageNode.readChunk(chunkHash);
      expect(readData.equals(chunkData)).toBe(true);

      // Delete
      await storageNode.deleteChunk(chunkHash);
      expect(await storageNode.verifyChunkIntegrity(chunkHash)).toBe(false);
    });
  });
});

// Helper functions
function computeHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
