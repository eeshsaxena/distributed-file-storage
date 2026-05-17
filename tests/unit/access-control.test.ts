import { AccessControlImpl } from '../../src/access-control';
import { Operation, Permission } from '../../src/interfaces/access-control.interface';
import { MetadataStore, FileRecord } from '../../src/interfaces/metadata-store.interface';

describe('AccessControl', () => {
  let mockStore: jest.Mocked<MetadataStore>;
  let ac: AccessControlImpl;

  const makeFile = (overrides: Partial<FileRecord> = {}): FileRecord => ({
    fileId: 'file-1',
    fileName: 'test.txt',
    ownerId: 'owner-1',
    currentVersion: 1,
    totalSize: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
    retentionDays: 30,
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

    ac = new AccessControlImpl(mockStore);
  });

  // ─── checkPermission ──────────────────────────────────────────────────────

  describe('checkPermission', () => {
    it('grants all permissions to the file owner', async () => {
      mockStore.getFile.mockResolvedValue(makeFile({ ownerId: 'owner-1' }));

      for (const op of [Operation.READ, Operation.WRITE, Operation.DELETE, Operation.SHARE]) {
        const result = await ac.checkPermission('owner-1', 'file-1', op);
        expect(result).toBe(true);
      }
    });

    it('denies access when file does not exist', async () => {
      mockStore.getFile.mockResolvedValue(null);

      const result = await ac.checkPermission('user-1', 'missing-file', Operation.READ);

      expect(result).toBe(false);
    });

    it('denies access when user has no permission', async () => {
      mockStore.getFile.mockResolvedValue(makeFile({ ownerId: 'owner-1' }));
      mockStore.checkPermission.mockResolvedValue(false);

      const result = await ac.checkPermission('other-user', 'file-1', Operation.READ);

      expect(result).toBe(false);
    });

    it('grants access when user has explicit permission', async () => {
      mockStore.getFile.mockResolvedValue(makeFile({ ownerId: 'owner-1' }));
      mockStore.checkPermission.mockResolvedValue(true);

      const result = await ac.checkPermission('user-2', 'file-1', Operation.READ);

      expect(result).toBe(true);
    });

    it('caches permission check result', async () => {
      mockStore.getFile.mockResolvedValue(makeFile({ ownerId: 'owner-1' }));
      mockStore.checkPermission.mockResolvedValue(true);

      await ac.checkPermission('user-2', 'file-1', Operation.READ);
      await ac.checkPermission('user-2', 'file-1', Operation.READ);

      // getFile called twice (once per check before cache kicks in for non-owner)
      // but checkPermission on store should only be called once due to caching
      expect(mockStore.checkPermission).toHaveBeenCalledTimes(1);
    });
  });

  // ─── grantPermission ──────────────────────────────────────────────────────

  describe('grantPermission', () => {
    it('grants permission when called by owner', async () => {
      mockStore.getFile.mockResolvedValue(makeFile({ ownerId: 'owner-1' }));
      mockStore.grantPermission.mockResolvedValue(undefined);

      await ac.grantPermission('owner-1', 'file-1', 'user-2', Permission.READ);

      expect(mockStore.grantPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'file-1',
          userId: 'user-2',
          permission: 'read',
          grantedBy: 'owner-1',
        })
      );
    });

    it('throws when non-owner tries to grant permission', async () => {
      mockStore.getFile.mockResolvedValue(makeFile({ ownerId: 'owner-1' }));

      await expect(
        ac.grantPermission('not-owner', 'file-1', 'user-2', Permission.READ)
      ).rejects.toThrow(/not the owner/i);
    });

    it('throws when file does not exist', async () => {
      mockStore.getFile.mockResolvedValue(null);

      await expect(
        ac.grantPermission('owner-1', 'missing', 'user-2', Permission.READ)
      ).rejects.toThrow(/file not found/i);
    });
  });

  // ─── revokePermission ─────────────────────────────────────────────────────

  describe('revokePermission', () => {
    it('revokes permission when called by owner', async () => {
      mockStore.getFile.mockResolvedValue(makeFile({ ownerId: 'owner-1' }));
      mockStore.revokePermission.mockResolvedValue(undefined);

      await ac.revokePermission('owner-1', 'file-1', 'user-2');

      expect(mockStore.revokePermission).toHaveBeenCalledWith('file-1', 'user-2');
    });

    it('throws when non-owner tries to revoke permission', async () => {
      mockStore.getFile.mockResolvedValue(makeFile({ ownerId: 'owner-1' }));

      await expect(
        ac.revokePermission('not-owner', 'file-1', 'user-2')
      ).rejects.toThrow(/not the owner/i);
    });
  });

  // ─── auditAccess ──────────────────────────────────────────────────────────

  describe('auditAccess', () => {
    it('logs access attempt to metadata store', async () => {
      mockStore.logAccess.mockResolvedValue(undefined);

      await ac.auditAccess('user-1', 'file-1', Operation.READ, true);

      expect(mockStore.logAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          fileId: 'file-1',
          operation: Operation.READ,
          result: true,
        })
      );
    });

    it('logs failed access attempt', async () => {
      mockStore.logAccess.mockResolvedValue(undefined);

      await ac.auditAccess('user-1', 'file-1', Operation.DELETE, false);

      expect(mockStore.logAccess).toHaveBeenCalledWith(
        expect.objectContaining({ result: false })
      );
    });
  });
});
