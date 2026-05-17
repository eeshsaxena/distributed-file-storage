import { VersionManagerImpl } from '../../src/version-manager';
import { MetadataStore, FileVersionRecord, FileRecord } from '../../src/interfaces/metadata-store.interface';
import { DeduplicationEngine } from '../../src/interfaces/deduplication-engine.interface';

describe('VersionManager', () => {
  let mockStore: jest.Mocked<MetadataStore>;
  let mockDedup: jest.Mocked<DeduplicationEngine>;
  let versionManager: VersionManagerImpl;

  const makeFileRecord = (overrides: Partial<FileRecord> = {}): FileRecord => ({
    fileId: 'file-1',
    fileName: 'test.txt',
    ownerId: 'user-1',
    currentVersion: 1,
    totalSize: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
    retentionDays: 30,
    ...overrides,
  });

  const makeVersionRecord = (overrides: Partial<FileVersionRecord> = {}): FileVersionRecord => ({
    fileId: 'file-1',
    version: 1,
    chunkHashes: ['hash-1', 'hash-2'],
    size: 1000,
    createdAt: new Date(),
    userId: 'user-1',
    ...overrides,
  });

  beforeEach(() => {
    mockStore = {
      createFile: jest.fn(),
      getFile: jest.fn(),
      updateFile: jest.fn(),
      deleteFile: jest.fn(),
      listFilesByOwner: jest.fn(),
      createFileVersion: jest.fn(),
      getFileVersion: jest.fn(),
      listFileVersions: jest.fn(),
      deleteFileVersion: jest.fn(),
      createChunk: jest.fn(),
      getChunk: jest.fn(),
      updateChunk: jest.fn(),
      deleteChunk: jest.fn(),
      incrementChunkReference: jest.fn(),
      decrementChunkReference: jest.fn(),
      getOrphanedChunks: jest.fn(),
      createChunkReplica: jest.fn(),
      getChunkReplicas: jest.fn(),
      deleteChunkReplica: jest.fn(),
      registerStorageNode: jest.fn(),
      getStorageNode: jest.fn(),
      updateStorageNode: jest.fn(),
      listStorageNodes: jest.fn(),
      updateNodeHeartbeat: jest.fn(),
      createUploadSession: jest.fn(),
      getUploadSession: jest.fn(),
      updateUploadSession: jest.fn(),
      markChunkUploaded: jest.fn(),
      getUploadedChunks: jest.fn(),
      deleteUploadSession: jest.fn(),
      getExpiredSessions: jest.fn(),
      grantPermission: jest.fn(),
      revokePermission: jest.fn(),
      getFilePermissions: jest.fn(),
      checkPermission: jest.fn(),
      logAccess: jest.fn(),
      getAccessLogs: jest.fn(),
      beginTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
    } as jest.Mocked<MetadataStore>;

    mockDedup = {
      checkDuplicate: jest.fn(),
      incrementReference: jest.fn(),
      decrementReference: jest.fn(),
      getOrphanedChunks: jest.fn(),
      getDeduplicationRatio: jest.fn(),
    } as jest.Mocked<DeduplicationEngine>;

    versionManager = new VersionManagerImpl(mockStore, mockDedup);
  });

  // ─── createVersion ────────────────────────────────────────────────────────

  describe('createVersion', () => {
    it('assigns version number 1 for first version', async () => {
      mockStore.listFileVersions.mockResolvedValue([]);
      mockStore.getChunk.mockResolvedValue({ chunkHash: 'h1', size: 500, encryptedSize: 516, referenceCount: 1, createdAt: new Date() });
      mockStore.createFileVersion.mockResolvedValue(undefined);
      mockStore.updateFile.mockResolvedValue(undefined);
      mockDedup.incrementReference.mockResolvedValue(undefined);

      const version = await versionManager.createVersion('file-1', ['h1'], 'user-1');

      expect(version.version).toBe(1);
    });

    it('assigns sequential version numbers', async () => {
      mockStore.listFileVersions.mockResolvedValue([makeVersionRecord({ version: 1 })]);
      mockStore.getChunk.mockResolvedValue({ chunkHash: 'h2', size: 500, encryptedSize: 516, referenceCount: 1, createdAt: new Date() });
      mockStore.createFileVersion.mockResolvedValue(undefined);
      mockStore.updateFile.mockResolvedValue(undefined);
      mockDedup.incrementReference.mockResolvedValue(undefined);

      const version = await versionManager.createVersion('file-1', ['h2'], 'user-1');

      expect(version.version).toBe(2);
    });

    it('increments reference count for each chunk', async () => {
      mockStore.listFileVersions.mockResolvedValue([]);
      mockStore.getChunk.mockResolvedValue({ chunkHash: 'h1', size: 500, encryptedSize: 516, referenceCount: 1, createdAt: new Date() });
      mockStore.createFileVersion.mockResolvedValue(undefined);
      mockStore.updateFile.mockResolvedValue(undefined);
      mockDedup.incrementReference.mockResolvedValue(undefined);

      await versionManager.createVersion('file-1', ['h1', 'h2'], 'user-1');

      expect(mockDedup.incrementReference).toHaveBeenCalledTimes(2);
      expect(mockDedup.incrementReference).toHaveBeenCalledWith('h1', 'file-1');
      expect(mockDedup.incrementReference).toHaveBeenCalledWith('h2', 'file-1');
    });

    it('persists version to metadata store', async () => {
      mockStore.listFileVersions.mockResolvedValue([]);
      mockStore.getChunk.mockResolvedValue({ chunkHash: 'h1', size: 500, encryptedSize: 516, referenceCount: 1, createdAt: new Date() });
      mockStore.createFileVersion.mockResolvedValue(undefined);
      mockStore.updateFile.mockResolvedValue(undefined);
      mockDedup.incrementReference.mockResolvedValue(undefined);

      await versionManager.createVersion('file-1', ['h1'], 'user-1');

      expect(mockStore.createFileVersion).toHaveBeenCalledTimes(1);
      const arg = mockStore.createFileVersion.mock.calls[0][0];
      expect(arg.fileId).toBe('file-1');
      expect(arg.version).toBe(1);
      expect(arg.chunkHashes).toEqual(['h1']);
      expect(arg.userId).toBe('user-1');
    });

    it('returns version with required metadata fields', async () => {
      mockStore.listFileVersions.mockResolvedValue([]);
      mockStore.getChunk.mockResolvedValue({ chunkHash: 'h1', size: 800, encryptedSize: 816, referenceCount: 1, createdAt: new Date() });
      mockStore.createFileVersion.mockResolvedValue(undefined);
      mockStore.updateFile.mockResolvedValue(undefined);
      mockDedup.incrementReference.mockResolvedValue(undefined);

      const version = await versionManager.createVersion('file-1', ['h1'], 'user-1');

      expect(version.fileId).toBe('file-1');
      expect(version.version).toBeDefined();
      expect(version.createdAt).toBeInstanceOf(Date);
      expect(version.size).toBe(800);
      expect(version.userId).toBe('user-1');
    });
  });

  // ─── getVersion ───────────────────────────────────────────────────────────

  describe('getVersion', () => {
    it('returns the correct version', async () => {
      const record = makeVersionRecord({ version: 2, chunkHashes: ['h1', 'h2'] });
      mockStore.getFileVersion.mockResolvedValue(record);

      const version = await versionManager.getVersion('file-1', 2);

      expect(version.version).toBe(2);
      expect(version.chunkHashes).toEqual(['h1', 'h2']);
    });

    it('throws when version does not exist', async () => {
      mockStore.getFileVersion.mockResolvedValue(null);

      await expect(versionManager.getVersion('file-1', 99)).rejects.toThrow(
        /version 99 not found/i
      );
    });
  });

  // ─── listVersions ─────────────────────────────────────────────────────────

  describe('listVersions', () => {
    it('returns versions sorted by version number', async () => {
      mockStore.listFileVersions.mockResolvedValue([
        makeVersionRecord({ version: 3 }),
        makeVersionRecord({ version: 1 }),
        makeVersionRecord({ version: 2 }),
      ]);

      const versions = await versionManager.listVersions('file-1');

      expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    });

    it('returns empty array when no versions exist', async () => {
      mockStore.listFileVersions.mockResolvedValue([]);

      const versions = await versionManager.listVersions('file-1');

      expect(versions).toEqual([]);
    });
  });

  // ─── pruneVersions ────────────────────────────────────────────────────────

  describe('pruneVersions', () => {
    it('deletes versions older than retention period', async () => {
      const old = makeVersionRecord({
        version: 1,
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days ago
      });
      const recent = makeVersionRecord({
        version: 2,
        createdAt: new Date(), // today
      });
      mockStore.listFileVersions.mockResolvedValue([old, recent]);
      mockStore.deleteFileVersion.mockResolvedValue(undefined);
      mockDedup.decrementReference.mockResolvedValue(undefined);

      const deleted = await versionManager.pruneVersions('file-1', 30);

      expect(deleted).toBe(1);
      expect(mockStore.deleteFileVersion).toHaveBeenCalledWith('file-1', 1);
      expect(mockStore.deleteFileVersion).not.toHaveBeenCalledWith('file-1', 2);
    });

    it('never deletes the latest version', async () => {
      const old = makeVersionRecord({
        version: 1,
        createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      });
      mockStore.listFileVersions.mockResolvedValue([old]);
      mockStore.deleteFileVersion.mockResolvedValue(undefined);
      mockDedup.decrementReference.mockResolvedValue(undefined);

      const deleted = await versionManager.pruneVersions('file-1', 30);

      // Even though it's old, it's the only (latest) version — must not be deleted
      expect(deleted).toBe(0);
      expect(mockStore.deleteFileVersion).not.toHaveBeenCalled();
    });

    it('decrements reference counts for pruned chunks', async () => {
      const old = makeVersionRecord({
        version: 1,
        chunkHashes: ['h1', 'h2'],
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      });
      const recent = makeVersionRecord({ version: 2, chunkHashes: ['h3'] });
      mockStore.listFileVersions.mockResolvedValue([old, recent]);
      mockStore.deleteFileVersion.mockResolvedValue(undefined);
      mockDedup.decrementReference.mockResolvedValue(undefined);

      await versionManager.pruneVersions('file-1', 30);

      expect(mockDedup.decrementReference).toHaveBeenCalledWith('h1', 'file-1');
      expect(mockDedup.decrementReference).toHaveBeenCalledWith('h2', 'file-1');
      expect(mockDedup.decrementReference).not.toHaveBeenCalledWith('h3', 'file-1');
    });

    it('returns 0 when no versions are old enough to prune', async () => {
      const recent = makeVersionRecord({ version: 1, createdAt: new Date() });
      mockStore.listFileVersions.mockResolvedValue([recent]);

      const deleted = await versionManager.pruneVersions('file-1', 30);

      expect(deleted).toBe(0);
    });
  });
});
