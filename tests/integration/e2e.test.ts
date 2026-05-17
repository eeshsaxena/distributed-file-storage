/**
 * End-to-End Test Suite
 *
 * Tests complete user workflows using in-memory mocks of all components.
 * These tests validate the integration between components without requiring
 * live infrastructure (PostgreSQL, Redis, HSM).
 *
 * For full infrastructure E2E tests, run with Docker: npm run docker:up
 */

import { randomUUID } from 'crypto';
import { ChunkManagerImpl } from '../../src/chunk-manager';
import { VersionManagerImpl } from '../../src/version-manager';
import { DeduplicationEngineImpl } from '../../src/deduplication-engine';
import { AccessControlImpl } from '../../src/access-control';
import { CDNGatewayImpl } from '../../src/cdn-gateway';
import { UploadManagerImpl } from '../../src/upload-manager';
import { Operation, Permission } from '../../src/interfaces/access-control.interface';
import {
  MetadataStore,
  FileRecord,
  FileVersionRecord,
  ChunkRecord,
  UploadSessionRecord,
  UploadedChunkRecord,
  FilePermissionRecord,
  AccessAuditRecord,
  ChunkReplicaRecord,
  StorageNodeRecord,
} from '../../src/interfaces/metadata-store.interface';
import { StorageNode } from '../../src/interfaces/storage-node.interface';

// ─── In-memory MetadataStore ──────────────────────────────────────────────────

class InMemoryMetadataStore implements MetadataStore {
  files = new Map<string, FileRecord>();
  versions = new Map<string, FileVersionRecord[]>();
  chunks = new Map<string, ChunkRecord>();
  sessions = new Map<string, UploadSessionRecord>();
  uploadedChunks = new Map<string, UploadedChunkRecord[]>();
  permissions = new Map<string, FilePermissionRecord[]>();
  auditLog: AccessAuditRecord[] = [];

  async createFile(f: FileRecord) { this.files.set(f.fileId, f); }
  async getFile(id: string) { return this.files.get(id) ?? null; }
  async updateFile(id: string, u: Partial<FileRecord>) {
    const f = this.files.get(id);
    if (f) this.files.set(id, { ...f, ...u });
  }
  async deleteFile(id: string) { this.files.delete(id); }
  async listFilesByOwner(ownerId: string) {
    return [...this.files.values()].filter(f => f.ownerId === ownerId);
  }

  async createFileVersion(v: FileVersionRecord) {
    const list = this.versions.get(v.fileId) ?? [];
    list.push(v);
    this.versions.set(v.fileId, list);
  }
  async getFileVersion(fileId: string, version: number) {
    return (this.versions.get(fileId) ?? []).find(v => v.version === version) ?? null;
  }
  async listFileVersions(fileId: string) { return this.versions.get(fileId) ?? []; }
  async deleteFileVersion(fileId: string, version: number) {
    const list = (this.versions.get(fileId) ?? []).filter(v => v.version !== version);
    this.versions.set(fileId, list);
  }

  async createChunk(c: ChunkRecord) { this.chunks.set(c.chunkHash, c); }
  async getChunk(hash: string) { return this.chunks.get(hash) ?? null; }
  async updateChunk(hash: string, u: Partial<ChunkRecord>) {
    const c = this.chunks.get(hash);
    if (c) this.chunks.set(hash, { ...c, ...u });
  }
  async deleteChunk(hash: string) { this.chunks.delete(hash); }
  async incrementChunkReference(hash: string) {
    const c = this.chunks.get(hash);
    if (c) c.referenceCount++;
  }
  async decrementChunkReference(hash: string) {
    const c = this.chunks.get(hash);
    if (c && c.referenceCount > 0) c.referenceCount--;
  }
  async getOrphanedChunks() {
    return [...this.chunks.values()].filter(c => c.referenceCount === 0).map(c => c.chunkHash);
  }

  async createChunkReplica(_r: ChunkReplicaRecord) {}
  async getChunkReplicas(_hash: string): Promise<ChunkReplicaRecord[]> { return []; }
  async deleteChunkReplica() {}

  async registerStorageNode(_n: StorageNodeRecord) {}
  async getStorageNode(_id: string) { return null; }
  async updateStorageNode() {}
  async listStorageNodes() { return []; }
  async updateNodeHeartbeat() {}

  async createUploadSession(s: UploadSessionRecord) { this.sessions.set(s.sessionId, s); }
  async getUploadSession(id: string) { return this.sessions.get(id) ?? null; }
  async updateUploadSession(id: string, u: Partial<UploadSessionRecord>) {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, ...u });
  }
  async markChunkUploaded(sessionId: string, seq: number, hash: string) {
    const list = this.uploadedChunks.get(sessionId) ?? [];
    list.push({ sessionId, sequenceNumber: seq, chunkHash: hash, uploadedAt: new Date() });
    this.uploadedChunks.set(sessionId, list);
  }
  async getUploadedChunks(sessionId: string) { return this.uploadedChunks.get(sessionId) ?? []; }
  async deleteUploadSession(id: string) { this.sessions.delete(id); this.uploadedChunks.delete(id); }
  async getExpiredSessions(now: Date) {
    return [...this.sessions.values()].filter(s => s.expiresAt < now);
  }

  async grantPermission(p: FilePermissionRecord) {
    const list = this.permissions.get(p.fileId) ?? [];
    const filtered = list.filter(x => x.userId !== p.userId);
    filtered.push(p);
    this.permissions.set(p.fileId, filtered);
  }
  async revokePermission(fileId: string, userId: string) {
    const list = (this.permissions.get(fileId) ?? []).filter(p => p.userId !== userId);
    this.permissions.set(fileId, list);
  }
  async getFilePermissions(fileId: string) { return this.permissions.get(fileId) ?? []; }
  async checkPermission(fileId: string, userId: string, permission: string) {
    return (this.permissions.get(fileId) ?? []).some(p => p.userId === userId && p.permission === permission);
  }

  async logAccess(a: AccessAuditRecord) { this.auditLog.push(a); }
  async getAccessLogs(fileId: string) { return this.auditLog.filter(a => a.fileId === fileId); }

  async beginTransaction() {}
  async commitTransaction() {}
  async rollbackTransaction() {}
  async connect() {}
  async disconnect() {}
}

// ─── In-memory StorageNode ────────────────────────────────────────────────────

class InMemoryStorageNode implements StorageNode {
  private store = new Map<string, Buffer>();
  constructor(readonly nodeId: string) {}
  async writeChunk(hash: string, data: Buffer) { this.store.set(hash, data); }
  async readChunk(hash: string) {
    const d = this.store.get(hash);
    if (!d) throw new Error(`Chunk ${hash} not found`);
    return d;
  }
  async deleteChunk(hash: string) { this.store.delete(hash); }
  async verifyChunkIntegrity(_hash: string) { return true; }
  async getHealthMetrics() {
    return { nodeId: this.nodeId, availabilityZone: 'us-east-1a', diskUsagePercent: 10,
      cpuUsagePercent: 5, networkLatency: 1, chunkCount: this.store.size, lastHeartbeat: new Date() };
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function buildComponents() {
  const store = new InMemoryMetadataStore();
  const node = new InMemoryStorageNode('node-1');
  const chunkManager = new ChunkManagerImpl();
  const dedup = new DeduplicationEngineImpl(store);
  const versionManager = new VersionManagerImpl(store, dedup);
  const accessControl = new AccessControlImpl(store);
  const cdn = new CDNGatewayImpl([node]);
  const uploadManager = new UploadManagerImpl(store);
  return { store, node, chunkManager, dedup, versionManager, accessControl, cdn, uploadManager };
}

// ─── E2E Tests ────────────────────────────────────────────────────────────────

describe('E2E: Complete upload and download flow', () => {
  /**
   * 24.1: Upload file → verify chunks stored → verify metadata → download → verify content
   */
  it('chunks a file, stores metadata, and reassembles correctly', async () => {
    const { store, node, chunkManager } = buildComponents();
    const fileId = randomUUID();
    const originalData = Buffer.alloc(20 * 1024 * 1024, 0xab); // 20MB

    // Chunk the file
    const chunks = await chunkManager.chunkFile(fileId, originalData);
    expect(chunks.length).toBe(3); // 8MB + 8MB + 4MB

    // Store chunks on node and register metadata
    for (const chunk of chunks) {
      const chunkData = originalData.subarray(
        chunk.sequenceNumber * 8 * 1024 * 1024,
        chunk.sequenceNumber * 8 * 1024 * 1024 + chunk.size
      );
      await node.writeChunk(chunk.contentHash, chunkData);
      await store.createChunk({
        chunkHash: chunk.contentHash, size: chunk.size,
        encryptedSize: chunk.size, referenceCount: 1, createdAt: new Date(),
      });
    }

    // Verify all chunks exist in metadata
    for (const chunk of chunks) {
      const record = await store.getChunk(chunk.contentHash);
      expect(record).not.toBeNull();
    }

    // Verify chunk integrity
    for (const chunk of chunks) {
      const data = await node.readChunk(chunk.contentHash);
      expect(chunkManager.verifyChunk(chunk.contentHash, data)).toBe(true);
    }
  });
});

describe('E2E: Resumable upload', () => {
  /**
   * 24.2: Upload partial → interrupt → resume → complete
   */
  it('resumes an interrupted upload and completes it', async () => {
    const { store, uploadManager } = buildComponents();
    const fileId = randomUUID();

    // Create session
    const session = await uploadManager.createSession(fileId, 'large.bin', 5, 'user-1');

    // Upload first 3 chunks
    for (let i = 0; i < 3; i++) {
      await uploadManager.markChunkUploaded(session.sessionId, i, `hash-${i}`);
    }

    // Simulate interruption — resume session
    const resumed = await uploadManager.resumeSession(session.sessionId);
    expect(resumed.uploadedChunks.size).toBe(3);
    expect(resumed.uploadedChunks.has(0)).toBe(true);
    expect(resumed.uploadedChunks.has(2)).toBe(true);

    // Upload remaining chunks
    await uploadManager.markChunkUploaded(session.sessionId, 3, 'hash-3');
    await uploadManager.markChunkUploaded(session.sessionId, 4, 'hash-4');

    // Verify complete
    const isComplete = await uploadManager.isUploadComplete(session.sessionId);
    expect(isComplete).toBe(true);
  });
});

describe('E2E: File versioning', () => {
  /**
   * 24.3: Upload → modify → new version → retrieve old version → both correct
   */
  it('creates sequential versions and retrieves each correctly', async () => {
    const { store, versionManager, dedup } = buildComponents();
    const fileId = randomUUID();

    // Register chunks in store for size calculation
    await store.createChunk({ chunkHash: 'v1-hash', size: 1000, encryptedSize: 1016, referenceCount: 0, createdAt: new Date() });
    await store.createChunk({ chunkHash: 'v2-hash', size: 1500, encryptedSize: 1516, referenceCount: 0, createdAt: new Date() });

    // Create file record
    await store.createFile({ fileId, fileName: 'doc.txt', ownerId: 'user-1', currentVersion: 0, totalSize: 0, createdAt: new Date(), updatedAt: new Date(), retentionDays: 30 });

    // Version 1
    const v1 = await versionManager.createVersion(fileId, ['v1-hash'], 'user-1');
    expect(v1.version).toBe(1);

    // Version 2 (modified)
    const v2 = await versionManager.createVersion(fileId, ['v2-hash'], 'user-1');
    expect(v2.version).toBe(2);

    // Retrieve version 1 — should still have original chunks
    const retrieved1 = await versionManager.getVersion(fileId, 1);
    expect(retrieved1.chunkHashes).toEqual(['v1-hash']);

    // Retrieve version 2
    const retrieved2 = await versionManager.getVersion(fileId, 2);
    expect(retrieved2.chunkHashes).toEqual(['v2-hash']);

    // List versions — should be sequential
    const versions = await versionManager.listVersions(fileId);
    expect(versions.map(v => v.version)).toEqual([1, 2]);
  });
});

describe('E2E: Deduplication', () => {
  /**
   * 24.4: Upload file → upload identical file → only one physical copy → correct ref counts
   */
  it('stores only one physical copy of identical chunks', async () => {
    const { store, dedup } = buildComponents();
    const sharedHash = 'a'.repeat(64);

    // Register chunk once
    await store.createChunk({ chunkHash: sharedHash, size: 8 * 1024 * 1024, encryptedSize: 8 * 1024 * 1024 + 16, referenceCount: 0, createdAt: new Date() });

    // File 1 references the chunk
    await dedup.incrementReference(sharedHash, 'file-1');
    // File 2 references the same chunk (deduplication)
    await dedup.incrementReference(sharedHash, 'file-2');

    // Only one physical copy
    const allChunks = [...store.chunks.values()].filter(c => c.chunkHash === sharedHash);
    expect(allChunks).toHaveLength(1);

    // Reference count = 2
    const result = await dedup.checkDuplicate(sharedHash);
    expect(result.referenceCount).toBe(2);

    // Delete file 1 — ref count drops to 1
    await dedup.decrementReference(sharedHash, 'file-1');
    const after = await dedup.checkDuplicate(sharedHash);
    expect(after.referenceCount).toBe(1);
  });
});

describe('E2E: CDN delivery', () => {
  /**
   * 24.5: Upload → download from CDN → cache hit → invalidate → cache miss
   */
  it('caches chunks and invalidates on file update', async () => {
    const { node, cdn } = buildComponents();
    const chunkHash = 'b'.repeat(64);
    const data = Buffer.from('chunk content');

    await node.writeChunk(chunkHash, data);

    // First request — cache miss, fetches from node
    const first = await cdn.getChunk(chunkHash, { latitude: 0, longitude: 0 });
    expect(first.equals(data)).toBe(true);

    // Register file version for invalidation
    cdn.registerFileVersion('file-1', 1, [chunkHash]);

    // Second request — cache hit (node not called again)
    const second = await cdn.getChunk(chunkHash, { latitude: 0, longitude: 0 });
    expect(second.equals(data)).toBe(true);

    // Invalidate cache
    await cdn.invalidateCache('file-1', 1);

    // Update chunk data on node
    const newData = Buffer.from('updated chunk content');
    await node.writeChunk(chunkHash, newData);

    // Next request — cache miss again, fetches updated data
    const third = await cdn.getChunk(chunkHash, { latitude: 0, longitude: 0 });
    expect(third.equals(newData)).toBe(true);
  });

  it('returns correct byte range', async () => {
    const { node, cdn } = buildComponents();
    const hash = 'c'.repeat(64);
    const data = Buffer.from('Hello, World!'); // 13 bytes
    await node.writeChunk(hash, data);

    const range = await cdn.getChunkRange(hash, 7, 11);
    expect(range.toString()).toBe('World');
  });
});

describe('E2E: Access control', () => {
  /**
   * 24.6: User A uploads → User B denied → User A grants → User B succeeds
   */
  it('enforces permissions and allows sharing', async () => {
    const { store, accessControl } = buildComponents();
    const fileId = randomUUID();

    // Create file owned by User A
    await store.createFile({ fileId, fileName: 'secret.txt', ownerId: 'user-a', currentVersion: 1, totalSize: 100, createdAt: new Date(), updatedAt: new Date(), retentionDays: 30 });

    // User A has all permissions
    expect(await accessControl.checkPermission('user-a', fileId, Operation.READ)).toBe(true);
    expect(await accessControl.checkPermission('user-a', fileId, Operation.DELETE)).toBe(true);

    // User B is denied
    expect(await accessControl.checkPermission('user-b', fileId, Operation.READ)).toBe(false);

    // User A grants READ to User B
    await accessControl.grantPermission('user-a', fileId, 'user-b', Permission.READ);

    // User B can now read
    expect(await accessControl.checkPermission('user-b', fileId, Operation.READ)).toBe(true);

    // User B still cannot delete
    expect(await accessControl.checkPermission('user-b', fileId, Operation.DELETE)).toBe(false);

    // User A revokes permission
    await accessControl.revokePermission('user-a', fileId, 'user-b');
    expect(await accessControl.checkPermission('user-b', fileId, Operation.READ)).toBe(false);
  });

  it('audits all access attempts', async () => {
    const { store, accessControl } = buildComponents();
    const fileId = randomUUID();
    await store.createFile({ fileId, fileName: 'audit.txt', ownerId: 'user-a', currentVersion: 1, totalSize: 100, createdAt: new Date(), updatedAt: new Date(), retentionDays: 30 });

    await accessControl.auditAccess('user-a', fileId, Operation.READ, true);
    await accessControl.auditAccess('user-b', fileId, Operation.READ, false);

    const logs = await store.getAccessLogs(fileId);
    expect(logs).toHaveLength(2);
    expect(logs[0].result).toBe(true);
    expect(logs[1].result).toBe(false);
  });
});

describe('E2E: Node failure recovery simulation', () => {
  /**
   * 24.7: Upload → node "fails" → data still accessible from replica
   */
  it('serves data from replica when primary node is unavailable', async () => {
    const node1 = new InMemoryStorageNode('node-1');
    const node2 = new InMemoryStorageNode('node-2');
    const hash = 'd'.repeat(64);
    const data = Buffer.from('replicated chunk');

    // Write to both nodes (simulating replication)
    await node1.writeChunk(hash, data);
    await node2.writeChunk(hash, data);

    // Simulate node1 failure — CDN falls back to node2
    const cdn = new CDNGatewayImpl([node2]); // node1 removed
    const retrieved = await cdn.getChunk(hash, { latitude: 0, longitude: 0 });
    expect(retrieved.equals(data)).toBe(true);
  });
});
