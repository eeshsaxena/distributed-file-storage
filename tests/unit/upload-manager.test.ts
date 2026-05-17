import { UploadManagerImpl } from '../../src/upload-manager';
import { MetadataStore, UploadSessionRecord, UploadedChunkRecord } from '../../src/interfaces/metadata-store.interface';

/**
 * Unit Tests for Upload Manager
 *
 * Tests specific scenarios and edge cases for upload session management.
 */
describe('UploadManager', () => {
  let mockStore: jest.Mocked<MetadataStore>;
  let uploadManager: UploadManagerImpl;

  const makeSession = (overrides: Partial<UploadSessionRecord> = {}): UploadSessionRecord => ({
    sessionId: 'session-1',
    fileId: 'file-1',
    fileName: 'test.txt',
    totalChunks: 5,
    userId: 'user-1',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    status: 'active',
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

    uploadManager = new UploadManagerImpl(mockStore);
  });

  // ─── createSession ────────────────────────────────────────────────────────

  describe('createSession', () => {
    it('creates a session with a unique UUID session ID', async () => {
      mockStore.createUploadSession.mockResolvedValue(undefined);

      const session = await uploadManager.createSession('file-1', 'test.txt', 10, 'user-1');

      expect(session.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('creates two sessions with different IDs', async () => {
      mockStore.createUploadSession.mockResolvedValue(undefined);

      const s1 = await uploadManager.createSession('file-1', 'a.txt', 5, 'user-1');
      const s2 = await uploadManager.createSession('file-2', 'b.txt', 5, 'user-1');

      expect(s1.sessionId).not.toBe(s2.sessionId);
    });

    it('sets expiry to 7 days from creation', async () => {
      mockStore.createUploadSession.mockResolvedValue(undefined);
      const before = Date.now();

      const session = await uploadManager.createSession('file-1', 'test.txt', 5, 'user-1');

      const after = Date.now();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs);
      expect(session.expiresAt.getTime()).toBeLessThanOrEqual(after + sevenDaysMs);
    });

    it('starts with empty uploadedChunks set', async () => {
      mockStore.createUploadSession.mockResolvedValue(undefined);

      const session = await uploadManager.createSession('file-1', 'test.txt', 5, 'user-1');

      expect(session.uploadedChunks.size).toBe(0);
    });

    it('persists session to metadata store', async () => {
      mockStore.createUploadSession.mockResolvedValue(undefined);

      await uploadManager.createSession('file-1', 'test.txt', 5, 'user-1');

      expect(mockStore.createUploadSession).toHaveBeenCalledTimes(1);
      const arg = mockStore.createUploadSession.mock.calls[0][0];
      expect(arg.fileId).toBe('file-1');
      expect(arg.fileName).toBe('test.txt');
      expect(arg.totalChunks).toBe(5);
      expect(arg.userId).toBe('user-1');
      expect(arg.status).toBe('active');
    });
  });

  // ─── resumeSession ────────────────────────────────────────────────────────

  describe('resumeSession', () => {
    it('returns session with previously uploaded chunks', async () => {
      mockStore.getUploadSession.mockResolvedValue(makeSession());
      const uploaded: UploadedChunkRecord[] = [
        { sessionId: 'session-1', sequenceNumber: 0, chunkHash: 'hash-0', uploadedAt: new Date() },
        { sessionId: 'session-1', sequenceNumber: 2, chunkHash: 'hash-2', uploadedAt: new Date() },
      ];
      mockStore.getUploadedChunks.mockResolvedValue(uploaded);

      const session = await uploadManager.resumeSession('session-1');

      expect(session.uploadedChunks.has(0)).toBe(true);
      expect(session.uploadedChunks.has(2)).toBe(true);
      expect(session.uploadedChunks.size).toBe(2);
    });

    it('throws when session does not exist', async () => {
      mockStore.getUploadSession.mockResolvedValue(null);

      await expect(uploadManager.resumeSession('missing')).rejects.toThrow('Session not found');
    });

    it('throws when session is expired by status', async () => {
      mockStore.getUploadSession.mockResolvedValue(makeSession({ status: 'expired' }));

      await expect(uploadManager.resumeSession('session-1')).rejects.toThrow(/expired/i);
    });

    it('throws when session is expired by date', async () => {
      mockStore.getUploadSession.mockResolvedValue(
        makeSession({ expiresAt: new Date(Date.now() - 1000) })
      );

      await expect(uploadManager.resumeSession('session-1')).rejects.toThrow(/expired/i);
    });

    it('throws when session is already completed', async () => {
      mockStore.getUploadSession.mockResolvedValue(makeSession({ status: 'completed' }));

      await expect(uploadManager.resumeSession('session-1')).rejects.toThrow(/completed/i);
    });
  });

  // ─── markChunkUploaded ────────────────────────────────────────────────────

  describe('markChunkUploaded', () => {
    it('marks a valid chunk as uploaded', async () => {
      mockStore.getUploadSession.mockResolvedValue(makeSession());
      mockStore.markChunkUploaded.mockResolvedValue(undefined);

      await uploadManager.markChunkUploaded('session-1', 0, 'hash-0');

      expect(mockStore.markChunkUploaded).toHaveBeenCalledWith('session-1', 0, 'hash-0');
    });

    it('throws when session does not exist', async () => {
      mockStore.getUploadSession.mockResolvedValue(null);

      await expect(
        uploadManager.markChunkUploaded('missing', 0, 'hash-0')
      ).rejects.toThrow('Session not found');
    });

    it('throws when session is not active', async () => {
      mockStore.getUploadSession.mockResolvedValue(makeSession({ status: 'completed' }));

      await expect(
        uploadManager.markChunkUploaded('session-1', 0, 'hash-0')
      ).rejects.toThrow(/not active/i);
    });

    it('throws when sequence number is negative', async () => {
      mockStore.getUploadSession.mockResolvedValue(makeSession());

      await expect(
        uploadManager.markChunkUploaded('session-1', -1, 'hash-0')
      ).rejects.toThrow(/invalid sequence number/i);
    });

    it('throws when sequence number equals totalChunks', async () => {
      mockStore.getUploadSession.mockResolvedValue(makeSession({ totalChunks: 5 }));

      await expect(
        uploadManager.markChunkUploaded('session-1', 5, 'hash-5')
      ).rejects.toThrow(/invalid sequence number/i);
    });

    it('throws when sequence number exceeds totalChunks', async () => {
      mockStore.getUploadSession.mockResolvedValue(makeSession({ totalChunks: 5 }));

      await expect(
        uploadManager.markChunkUploaded('session-1', 99, 'hash-99')
      ).rejects.toThrow(/invalid sequence number/i);
    });

    it('throws when session is expired', async () => {
      mockStore.getUploadSession.mockResolvedValue(
        makeSession({ expiresAt: new Date(Date.now() - 1000) })
      );

      await expect(
        uploadManager.markChunkUploaded('session-1', 0, 'hash-0')
      ).rejects.toThrow(/expired/i);
    });
  });

  // ─── isUploadComplete ─────────────────────────────────────────────────────

  describe('isUploadComplete', () => {
    it('returns false when not all chunks are uploaded', async () => {
      mockStore.getUploadSession.mockResolvedValue(makeSession({ totalChunks: 5 }));
      mockStore.getUploadedChunks.mockResolvedValue([
        { sessionId: 'session-1', sequenceNumber: 0, chunkHash: 'h0', uploadedAt: new Date() },
        { sessionId: 'session-1', sequenceNumber: 1, chunkHash: 'h1', uploadedAt: new Date() },
      ]);

      const result = await uploadManager.isUploadComplete('session-1');

      expect(result).toBe(false);
    });

    it('returns true when all chunks are uploaded', async () => {
      mockStore.getUploadSession.mockResolvedValue(makeSession({ totalChunks: 3 }));
      mockStore.getUploadedChunks.mockResolvedValue([
        { sessionId: 'session-1', sequenceNumber: 0, chunkHash: 'h0', uploadedAt: new Date() },
        { sessionId: 'session-1', sequenceNumber: 1, chunkHash: 'h1', uploadedAt: new Date() },
        { sessionId: 'session-1', sequenceNumber: 2, chunkHash: 'h2', uploadedAt: new Date() },
      ]);

      const result = await uploadManager.isUploadComplete('session-1');

      expect(result).toBe(true);
    });

    it('throws when session does not exist', async () => {
      mockStore.getUploadSession.mockResolvedValue(null);

      await expect(uploadManager.isUploadComplete('missing')).rejects.toThrow('Session not found');
    });
  });

  // ─── finalizeUpload ───────────────────────────────────────────────────────

  describe('finalizeUpload', () => {
    it('throws when upload is not complete', async () => {
      mockStore.getUploadSession.mockResolvedValue(makeSession({ totalChunks: 5 }));
      mockStore.getUploadedChunks.mockResolvedValue([
        { sessionId: 'session-1', sequenceNumber: 0, chunkHash: 'h0', uploadedAt: new Date() },
      ]);

      await expect(uploadManager.finalizeUpload('session-1')).rejects.toThrow(
        /upload not complete/i
      );
    });

    it('creates file and version records when upload is complete', async () => {
      mockStore.getUploadSession.mockResolvedValue(makeSession({ totalChunks: 2 }));
      const uploaded: UploadedChunkRecord[] = [
        { sessionId: 'session-1', sequenceNumber: 0, chunkHash: 'h0', uploadedAt: new Date() },
        { sessionId: 'session-1', sequenceNumber: 1, chunkHash: 'h1', uploadedAt: new Date() },
      ];
      mockStore.getUploadedChunks.mockResolvedValue(uploaded);
      mockStore.getChunk
        .mockResolvedValueOnce({ chunkHash: 'h0', size: 1000, encryptedSize: 1016, referenceCount: 1, createdAt: new Date() })
        .mockResolvedValueOnce({ chunkHash: 'h1', size: 500, encryptedSize: 516, referenceCount: 1, createdAt: new Date() });
      mockStore.createFile.mockResolvedValue(undefined);
      mockStore.createFileVersion.mockResolvedValue(undefined);
      mockStore.updateUploadSession.mockResolvedValue(undefined);

      const result = await uploadManager.finalizeUpload('session-1');

      expect(mockStore.createFile).toHaveBeenCalledTimes(1);
      expect(mockStore.createFileVersion).toHaveBeenCalledTimes(1);
      expect(mockStore.updateUploadSession).toHaveBeenCalledWith('session-1', { status: 'completed' });
      expect(result.totalSize).toBe(1500);
      expect(result.currentVersion).toBe(1);
    });

    it('throws when session does not exist', async () => {
      mockStore.getUploadSession.mockResolvedValue(null);

      await expect(uploadManager.finalizeUpload('missing')).rejects.toThrow('Session not found');
    });
  });

  // ─── cleanupExpiredSessions ───────────────────────────────────────────────

  describe('cleanupExpiredSessions', () => {
    it('marks and deletes expired sessions', async () => {
      const expiredSessions: UploadSessionRecord[] = [
        makeSession({ sessionId: 'exp-1', status: 'active' }),
        makeSession({ sessionId: 'exp-2', status: 'active' }),
      ];
      mockStore.getExpiredSessions.mockResolvedValue(expiredSessions);
      mockStore.updateUploadSession.mockResolvedValue(undefined);
      mockStore.deleteUploadSession.mockResolvedValue(undefined);

      await uploadManager.cleanupExpiredSessions();

      expect(mockStore.updateUploadSession).toHaveBeenCalledWith('exp-1', { status: 'expired' });
      expect(mockStore.updateUploadSession).toHaveBeenCalledWith('exp-2', { status: 'expired' });
      expect(mockStore.deleteUploadSession).toHaveBeenCalledWith('exp-1');
      expect(mockStore.deleteUploadSession).toHaveBeenCalledWith('exp-2');
    });

    it('does nothing when no expired sessions exist', async () => {
      mockStore.getExpiredSessions.mockResolvedValue([]);

      await uploadManager.cleanupExpiredSessions();

      expect(mockStore.updateUploadSession).not.toHaveBeenCalled();
      expect(mockStore.deleteUploadSession).not.toHaveBeenCalled();
    });

    it('continues cleanup even if one session fails', async () => {
      const expiredSessions: UploadSessionRecord[] = [
        makeSession({ sessionId: 'exp-1' }),
        makeSession({ sessionId: 'exp-2' }),
      ];
      mockStore.getExpiredSessions.mockResolvedValue(expiredSessions);
      mockStore.updateUploadSession
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce(undefined);
      mockStore.deleteUploadSession.mockResolvedValue(undefined);

      // Should not throw even if one session fails
      await expect(uploadManager.cleanupExpiredSessions()).resolves.not.toThrow();
      // Second session should still be processed
      expect(mockStore.updateUploadSession).toHaveBeenCalledTimes(2);
    });
  });
});
