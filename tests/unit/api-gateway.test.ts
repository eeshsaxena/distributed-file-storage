import http from 'http';
import { APIGateway } from '../../src/api-gateway';
import { UploadManager, UploadSession } from '../../src/interfaces/upload-manager.interface';
import { VersionManager } from '../../src/interfaces/version-manager.interface';
import { AccessControl, Operation, Permission } from '../../src/interfaces/access-control.interface';
import { MetadataStore, FileRecord } from '../../src/interfaces/metadata-store.interface';
import { MonitoringService } from '../../src/monitoring';

// ─── Minimal HTTP helper ──────────────────────────────────────────────────────

function request(
  method: string,
  path: string,
  port: number,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const json = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { hostname: 'localhost', port, path, method,
        headers: { 'Content-Type': 'application/json', 'x-user-id': 'user-1', ...headers,
          ...(json ? { 'Content-Length': Buffer.byteLength(json) } : {}) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: {} }); }
        });
      }
    );
    req.on('error', reject);
    if (json) req.write(json);
    req.end();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('APIGateway', () => {
  let gateway: APIGateway;
  let mockUpload: jest.Mocked<UploadManager>;
  let mockVersion: jest.Mocked<VersionManager>;
  let mockAC: jest.Mocked<AccessControl>;
  let mockStore: jest.Mocked<MetadataStore>;
  let mockMonitoring: jest.Mocked<MonitoringService>;
  const PORT = 19876;

  beforeAll(async () => {
    mockUpload = {
      createSession: jest.fn(),
      resumeSession: jest.fn(),
      markChunkUploaded: jest.fn(),
      isUploadComplete: jest.fn(),
      finalizeUpload: jest.fn(),
      cleanupExpiredSessions: jest.fn(),
    } as jest.Mocked<UploadManager>;

    mockVersion = {
      createVersion: jest.fn(),
      getVersion: jest.fn(),
      listVersions: jest.fn(),
      pruneVersions: jest.fn(),
    } as jest.Mocked<VersionManager>;

    mockAC = {
      checkPermission: jest.fn(),
      grantPermission: jest.fn(),
      revokePermission: jest.fn(),
      auditAccess: jest.fn(),
    } as jest.Mocked<AccessControl>;

    mockStore = {
      getFile: jest.fn(),
      deleteFile: jest.fn(),
    } as unknown as jest.Mocked<MetadataStore>;

    mockMonitoring = {
      getMetrics: jest.fn(),
      getStorageCapacity: jest.fn(),
      getDeduplicationRatio: jest.fn(),
      getReplicationOverhead: jest.fn(),
    } as unknown as jest.Mocked<MonitoringService>;

    gateway = new APIGateway(mockUpload, mockVersion, mockAC, mockStore, mockMonitoring);
    await gateway.listen(PORT);
  });

  afterAll(async () => {
    await gateway.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // ─── Health check ─────────────────────────────────────────────────────────

  it('GET /health returns 200 with status ok', async () => {
    const res = await request('GET', '/health', PORT);
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('ok');
  });

  // ─── Metrics ──────────────────────────────────────────────────────────────

  it('GET /metrics returns 200 with metrics', async () => {
    mockMonitoring.getMetrics.mockResolvedValue({
      capacity: { totalCapacity: 1000, usedCapacity: 200, availableCapacity: 800 },
      deduplicationRatio: 1.5,
      replicationOverhead: { uniqueStorage: 100, replicatedStorage: 300, overhead: 3 },
      chunkCount: 10,
      nodeCount: 3,
    });

    const res = await request('GET', '/metrics', PORT);
    expect(res.status).toBe(200);
    expect((res.body as { nodeCount: number }).nodeCount).toBe(3);
  });

  // ─── Upload session ───────────────────────────────────────────────────────

  it('POST /files/upload creates a session', async () => {
    const session: UploadSession = {
      sessionId: 'sess-1', fileId: 'file-1', fileName: 'test.txt',
      totalChunks: 5, uploadedChunks: new Set(), createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 86400000), userId: 'user-1',
    };
    mockUpload.createSession.mockResolvedValue(session);

    const res = await request('POST', '/files/upload', PORT, {
      fileId: 'file-1', fileName: 'test.txt', totalChunks: 5, userId: 'user-1',
    });

    expect(res.status).toBe(201);
    expect((res.body as { sessionId: string }).sessionId).toBe('sess-1');
  });

  // ─── Chunk upload ─────────────────────────────────────────────────────────

  it('PUT /files/upload/:sessionId/chunks/:seq marks chunk uploaded', async () => {
    mockUpload.markChunkUploaded.mockResolvedValue(undefined);

    const res = await request('PUT', '/files/upload/sess-1/chunks/0', PORT, { chunkHash: 'hash-0' });

    expect(res.status).toBe(200);
    expect(mockUpload.markChunkUploaded).toHaveBeenCalledWith('sess-1', 0, 'hash-0');
  });

  // ─── Finalize upload ──────────────────────────────────────────────────────

  it('POST /files/upload/:sessionId/finalize finalizes upload', async () => {
    mockUpload.finalizeUpload.mockResolvedValue({
      fileId: 'file-1', fileName: 'test.txt', ownerId: 'user-1',
      currentVersion: 1, totalSize: 1000, createdAt: new Date(), updatedAt: new Date(),
    });

    const res = await request('POST', '/files/upload/sess-1/finalize', PORT);

    expect(res.status).toBe(200);
    expect((res.body as { fileId: string }).fileId).toBe('file-1');
  });

  // ─── File access ──────────────────────────────────────────────────────────

  it('GET /files/:fileId returns file when user has permission', async () => {
    mockAC.checkPermission.mockResolvedValue(true);
    mockStore.getFile.mockResolvedValue({
      fileId: 'file-1', fileName: 'test.txt', ownerId: 'user-1',
      currentVersion: 1, totalSize: 1000, createdAt: new Date(),
      updatedAt: new Date(), retentionDays: 30,
    });

    const res = await request('GET', '/files/file-1', PORT);

    expect(res.status).toBe(200);
    expect((res.body as { fileId: string }).fileId).toBe('file-1');
  });

  it('GET /files/:fileId returns 403 when user lacks permission', async () => {
    mockAC.checkPermission.mockResolvedValue(false);

    const res = await request('GET', '/files/file-1', PORT);

    expect(res.status).toBe(403);
  });

  it('GET /files/:fileId returns 404 when file does not exist', async () => {
    mockAC.checkPermission.mockResolvedValue(true);
    mockStore.getFile.mockResolvedValue(null);

    const res = await request('GET', '/files/missing', PORT);

    expect(res.status).toBe(404);
  });

  // ─── Versions ─────────────────────────────────────────────────────────────

  it('GET /files/:fileId/versions lists versions', async () => {
    mockAC.checkPermission.mockResolvedValue(true);
    mockVersion.listVersions.mockResolvedValue([
      { fileId: 'file-1', version: 1, chunkHashes: [], size: 100, createdAt: new Date(), userId: 'user-1', metadata: {} },
    ]);

    const res = await request('GET', '/files/file-1/versions', PORT);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // ─── Permissions ──────────────────────────────────────────────────────────

  it('POST /files/:fileId/permissions grants permission', async () => {
    mockAC.grantPermission.mockResolvedValue(undefined);

    const res = await request('POST', '/files/file-1/permissions', PORT, {
      targetUserId: 'user-2', permission: Permission.READ,
    });

    expect(res.status).toBe(200);
    expect(mockAC.grantPermission).toHaveBeenCalled();
  });

  it('DELETE /files/:fileId/permissions/:userId revokes permission', async () => {
    mockAC.revokePermission.mockResolvedValue(undefined);

    const res = await request('DELETE', '/files/file-1/permissions/user-2', PORT);

    expect(res.status).toBe(200);
    expect(mockAC.revokePermission).toHaveBeenCalledWith('user-1', 'file-1', 'user-2');
  });

  // ─── Delete file ──────────────────────────────────────────────────────────

  it('DELETE /files/:fileId deletes file when user has permission', async () => {
    mockAC.checkPermission.mockResolvedValue(true);
    mockStore.deleteFile.mockResolvedValue(undefined);

    const res = await request('DELETE', '/files/file-1', PORT);

    expect(res.status).toBe(200);
    expect(mockStore.deleteFile).toHaveBeenCalledWith('file-1');
  });

  it('DELETE /files/:fileId returns 403 when user lacks permission', async () => {
    mockAC.checkPermission.mockResolvedValue(false);

    const res = await request('DELETE', '/files/file-1', PORT);

    expect(res.status).toBe(403);
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  it('returns 500 on unexpected errors', async () => {
    mockMonitoring.getMetrics.mockRejectedValue(new Error('DB down'));

    const res = await request('GET', '/metrics', PORT);

    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBe('DB down');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request('GET', '/unknown/route', PORT);
    expect(res.status).toBe(404);
  });
});
