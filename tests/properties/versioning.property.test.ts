import * as fc from 'fast-check';
import { VersionManagerImpl } from '../../src/version-manager';
import { FileVersionRecord, MetadataStore } from '../../src/interfaces/metadata-store.interface';
import { DeduplicationEngine } from '../../src/interfaces/deduplication-engine.interface';

/**
 * Property-Based Tests for Version Manager
 *
 * Feature: distributed-file-storage
 * Tests Properties 18-22 from the design document
 */
describe('Version Manager Properties', () => {
  // ─── In-memory mock store ─────────────────────────────────────────────────

  class MockMetadataStore {
    private versions: Map<string, FileVersionRecord[]> = new Map();
    private files: Map<string, { currentVersion: number; updatedAt: Date }> = new Map();
    private chunks: Map<string, { size: number }> = new Map();

    async listFileVersions(fileId: string): Promise<FileVersionRecord[]> {
      return this.versions.get(fileId) ?? [];
    }

    async createFileVersion(v: FileVersionRecord): Promise<void> {
      const list = this.versions.get(v.fileId) ?? [];
      list.push({ ...v });
      this.versions.set(v.fileId, list);
    }

    async getFileVersion(fileId: string, version: number): Promise<FileVersionRecord | null> {
      const list = this.versions.get(fileId) ?? [];
      return list.find((v) => v.version === version) ?? null;
    }

    async deleteFileVersion(fileId: string, version: number): Promise<void> {
      const list = this.versions.get(fileId) ?? [];
      this.versions.set(fileId, list.filter((v) => v.version !== version));
    }

    async updateFile(fileId: string, updates: { currentVersion?: number; updatedAt?: Date }): Promise<void> {
      const existing = this.files.get(fileId) ?? { currentVersion: 0, updatedAt: new Date() };
      this.files.set(fileId, { ...existing, ...updates });
    }

    async getChunk(hash: string) {
      const c = this.chunks.get(hash);
      return c ? { chunkHash: hash, size: c.size, encryptedSize: c.size + 16, referenceCount: 1, createdAt: new Date() } : null;
    }

    setChunkSize(hash: string, size: number) {
      this.chunks.set(hash, { size });
    }

    reset() {
      this.versions.clear();
      this.files.clear();
      this.chunks.clear();
    }
  }

  class MockDeduplicationEngine {
    private refs: Map<string, number> = new Map();

    async incrementReference(hash: string, _fileId: string): Promise<void> {
      this.refs.set(hash, (this.refs.get(hash) ?? 0) + 1);
    }

    async decrementReference(hash: string, _fileId: string): Promise<void> {
      const current = this.refs.get(hash) ?? 0;
      if (current <= 0) throw new Error('Cannot decrement below zero');
      this.refs.set(hash, current - 1);
    }

    getRefCount(hash: string): number {
      return this.refs.get(hash) ?? 0;
    }

    reset() {
      this.refs.clear();
    }
  }

  let mockStore: MockMetadataStore;
  let mockDedup: MockDeduplicationEngine;
  let versionManager: VersionManagerImpl;

  beforeEach(() => {
    mockStore = new MockMetadataStore();
    mockDedup = new MockDeduplicationEngine();
    versionManager = new VersionManagerImpl(mockStore as unknown as MetadataStore, mockDedup as unknown as DeduplicationEngine);
  });

  /**
   * Property 18: Modify creates new version
   * Validates: Requirements 7.1
   */
  test('Property 18: Modify creates new version', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 1, max: 5 }),
        async (fileId, modifications) => {
          mockStore.reset();
          mockDedup.reset();

          let previousVersionCount = 0;

          for (let i = 0; i < modifications; i++) {
            const versionsBefore = await mockStore.listFileVersions(fileId);
            previousVersionCount = versionsBefore.length;

            await versionManager.createVersion(fileId, [`hash-${i}`], 'user-1');

            const versionsAfter = await mockStore.listFileVersions(fileId);
            expect(versionsAfter.length).toBe(previousVersionCount + 1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 19: Versions are sequential
   * Validates: Requirements 7.2
   */
  test('Property 19: Versions are sequential', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 1, max: 10 }),
        async (fileId, n) => {
          mockStore.reset();
          mockDedup.reset();

          for (let i = 0; i < n; i++) {
            await versionManager.createVersion(fileId, [`hash-${i}`], 'user-1');
          }

          const versions = await versionManager.listVersions(fileId);
          const numbers = versions.map((v) => v.version);

          expect(numbers).toEqual(Array.from({ length: n }, (_, i) => i + 1));
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 20: Version metadata contains required fields
   * Validates: Requirements 7.3
   */
  test('Property 20: Version metadata contains required fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (fileId, userId) => {
          mockStore.reset();
          mockDedup.reset();

          const version = await versionManager.createVersion(fileId, ['hash-a'], userId);

          expect(typeof version.version).toBe('number');
          expect(version.createdAt).toBeInstanceOf(Date);
          expect(typeof version.size).toBe('number');
          expect(version.userId).toBe(userId);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 21: Version retrieval returns correct chunks
   * Validates: Requirements 7.4
   */
  test('Property 21: Version retrieval returns correct chunks', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.array(fc.hexaString({ minLength: 64, maxLength: 64 }), { minLength: 1, maxLength: 5 }),
        async (fileId, chunkHashes) => {
          mockStore.reset();
          mockDedup.reset();

          const created = await versionManager.createVersion(fileId, chunkHashes, 'user-1');
          const retrieved = await versionManager.getVersion(fileId, created.version);

          expect(retrieved.chunkHashes).toEqual(chunkHashes);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 22: Shared chunks have correct reference counts
   * Validates: Requirements 7.7
   */
  test('Property 22: Shared chunks have correct reference counts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 2, max: 5 }),
        fc.hexaString({ minLength: 64, maxLength: 64 }),
        async (fileId, versionCount, sharedHash) => {
          mockStore.reset();
          mockDedup.reset();

          // Create N versions all containing the same shared chunk
          for (let i = 0; i < versionCount; i++) {
            await versionManager.createVersion(fileId, [sharedHash], 'user-1');
          }

          // Reference count should equal number of versions
          const refCount = mockDedup.getRefCount(sharedHash);
          expect(refCount).toBe(versionCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});
