import { BackgroundJobs } from '../../src/background-jobs';
import { MetadataStore, StorageNodeRecord } from '../../src/interfaces/metadata-store.interface';
import { ReplicationService } from '../../src/interfaces/replication-service.interface';
import { DeduplicationEngine } from '../../src/interfaces/deduplication-engine.interface';
import { StorageNode } from '../../src/interfaces/storage-node.interface';

describe('BackgroundJobs', () => {
  let mockStore: jest.Mocked<MetadataStore>;
  let mockReplication: jest.Mocked<ReplicationService>;
  let mockDedup: jest.Mocked<DeduplicationEngine>;
  let mockNode: jest.Mocked<StorageNode>;
  let jobs: BackgroundJobs;

  const makeNode = (overrides: Partial<StorageNodeRecord> = {}): StorageNodeRecord => ({
    nodeId: 'node-1',
    ipAddress: '127.0.0.1',
    port: 8080,
    availabilityZone: 'us-east-1a',
    region: 'us-east-1',
    capacity: 1_000_000,
    usedSpace: 100_000,
    status: 'active',
    registeredAt: new Date(),
    lastHeartbeat: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    mockStore = {
      listStorageNodes: jest.fn(),
      getOrphanedChunks: jest.fn(),
      deleteChunk: jest.fn(),
      getExpiredSessions: jest.fn(),
      updateUploadSession: jest.fn(),
      deleteUploadSession: jest.fn(),
      updateStorageNode: jest.fn(),
      getChunkReplicas: jest.fn(),
    } as unknown as jest.Mocked<MetadataStore>;

    mockReplication = {
      verifyReplicas: jest.fn(),
      reReplicate: jest.fn(),
    } as unknown as jest.Mocked<ReplicationService>;

    mockDedup = {
      getOrphanedChunks: jest.fn(),
    } as unknown as jest.Mocked<DeduplicationEngine>;

    mockNode = {
      deleteChunk: jest.fn(),
    } as unknown as jest.Mocked<StorageNode>;

    jobs = new BackgroundJobs(mockStore, mockReplication, mockDedup, [mockNode]);
  });

  // ─── garbageCollect ───────────────────────────────────────────────────────

  describe('garbageCollect', () => {
    it('deletes orphaned chunks from storage nodes and metadata', async () => {
      mockDedup.getOrphanedChunks.mockResolvedValue(['hash-1', 'hash-2']);
      mockNode.deleteChunk.mockResolvedValue(undefined);
      mockStore.deleteChunk.mockResolvedValue(undefined);

      const result = await jobs.garbageCollect();

      expect(result.deleted).toBe(2);
      expect(mockNode.deleteChunk).toHaveBeenCalledWith('hash-1');
      expect(mockNode.deleteChunk).toHaveBeenCalledWith('hash-2');
      expect(mockStore.deleteChunk).toHaveBeenCalledWith('hash-1');
      expect(mockStore.deleteChunk).toHaveBeenCalledWith('hash-2');
    });

    it('returns 0 when no orphaned chunks exist', async () => {
      mockDedup.getOrphanedChunks.mockResolvedValue([]);

      const result = await jobs.garbageCollect();

      expect(result.deleted).toBe(0);
    });

    it('continues when a node does not have the chunk', async () => {
      mockDedup.getOrphanedChunks.mockResolvedValue(['hash-1']);
      mockNode.deleteChunk.mockRejectedValue(new Error('chunk not found'));
      mockStore.deleteChunk.mockResolvedValue(undefined);

      const result = await jobs.garbageCollect();

      expect(result.deleted).toBe(1);
    });
  });

  // ─── cleanupExpiredSessions ───────────────────────────────────────────────

  describe('cleanupExpiredSessions', () => {
    it('marks and deletes expired sessions', async () => {
      mockStore.getExpiredSessions.mockResolvedValue([
        { sessionId: 'sess-1', fileId: 'f1', fileName: 'a.txt', totalChunks: 5, userId: 'u1', createdAt: new Date(), expiresAt: new Date(Date.now() - 1000), status: 'active' },
        { sessionId: 'sess-2', fileId: 'f2', fileName: 'b.txt', totalChunks: 3, userId: 'u1', createdAt: new Date(), expiresAt: new Date(Date.now() - 1000), status: 'active' },
      ]);
      mockStore.updateUploadSession.mockResolvedValue(undefined);
      mockStore.deleteUploadSession.mockResolvedValue(undefined);

      const result = await jobs.cleanupExpiredSessions();

      expect(result.cleaned).toBe(2);
      expect(mockStore.updateUploadSession).toHaveBeenCalledWith('sess-1', { status: 'expired' });
      expect(mockStore.deleteUploadSession).toHaveBeenCalledWith('sess-1');
    });

    it('returns 0 when no expired sessions', async () => {
      mockStore.getExpiredSessions.mockResolvedValue([]);

      const result = await jobs.cleanupExpiredSessions();

      expect(result.cleaned).toBe(0);
    });
  });

  // ─── checkMetadataConsistency ─────────────────────────────────────────────

  describe('checkMetadataConsistency', () => {
    it('marks stale nodes as offline', async () => {
      const staleNode = makeNode({
        lastHeartbeat: new Date(Date.now() - 120_000), // 2 minutes ago
      });
      mockStore.listStorageNodes.mockResolvedValue([staleNode]);
      mockStore.updateStorageNode.mockResolvedValue(undefined);

      const result = await jobs.checkMetadataConsistency();

      expect(result.inconsistencies).toBe(1);
      expect(result.repaired).toBe(1);
      expect(mockStore.updateStorageNode).toHaveBeenCalledWith('node-1', { status: 'offline' });
    });

    it('does not flag healthy nodes', async () => {
      const healthyNode = makeNode({ lastHeartbeat: new Date() });
      mockStore.listStorageNodes.mockResolvedValue([healthyNode]);

      const result = await jobs.checkMetadataConsistency();

      expect(result.inconsistencies).toBe(0);
      expect(mockStore.updateStorageNode).not.toHaveBeenCalled();
    });
  });
});
