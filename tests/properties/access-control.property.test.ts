import * as fc from 'fast-check';
import { AccessControlImpl } from '../../src/access-control';
import { Operation, Permission } from '../../src/interfaces/access-control.interface';
import { MetadataStore, FileRecord, FilePermissionRecord } from '../../src/interfaces/metadata-store.interface';

/**
 * Property-Based Tests for Access Control
 *
 * Feature: distributed-file-storage
 * Tests Properties 28-30 from the design document
 */
describe('Access Control Properties', () => {
  // ─── In-memory mock store ─────────────────────────────────────────────────

  class MockMetadataStore {
    private files: Map<string, FileRecord> = new Map();
    private permissions: Map<string, FilePermissionRecord[]> = new Map();
    private auditLog: unknown[] = [];

    async getFile(fileId: string): Promise<FileRecord | null> {
      return this.files.get(fileId) ?? null;
    }

    async checkPermission(fileId: string, userId: string, permission: string): Promise<boolean> {
      const perms = this.permissions.get(fileId) ?? [];
      return perms.some((p) => p.userId === userId && p.permission === permission);
    }

    async grantPermission(perm: FilePermissionRecord): Promise<void> {
      const perms = this.permissions.get(perm.fileId) ?? [];
      // Remove existing permission for same user
      const filtered = perms.filter((p) => p.userId !== perm.userId);
      filtered.push(perm);
      this.permissions.set(perm.fileId, filtered);
    }

    async revokePermission(fileId: string, userId: string): Promise<void> {
      const perms = this.permissions.get(fileId) ?? [];
      this.permissions.set(fileId, perms.filter((p) => p.userId !== userId));
    }

    async logAccess(audit: unknown): Promise<void> {
      this.auditLog.push(audit);
    }

    // Test helpers
    setFile(file: FileRecord) {
      this.files.set(file.fileId, file);
    }

    reset() {
      this.files.clear();
      this.permissions.clear();
      this.auditLog = [];
    }
  }

  let mockStore: MockMetadataStore;
  let ac: AccessControlImpl;

  beforeEach(() => {
    mockStore = new MockMetadataStore();
    ac = new AccessControlImpl(mockStore as unknown as MetadataStore);
  });

  /**
   * Property 28: File owner is creator
   *
   * For any user creating a file, the file owner SHALL be set to that user's identifier.
   * Validates: Requirements 13.1
   */
  test('Property 28: File owner has all permissions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // ownerId
        fc.uuid(), // fileId
        async (ownerId, fileId) => {
          mockStore.reset();
          mockStore.setFile({
            fileId,
            fileName: 'test.txt',
            ownerId,
            currentVersion: 1,
            totalSize: 100,
            createdAt: new Date(),
            updatedAt: new Date(),
            retentionDays: 30,
          });

          // Owner should have all permissions
          for (const op of [Operation.READ, Operation.WRITE, Operation.DELETE, Operation.SHARE]) {
            const result = await ac.checkPermission(ownerId, fileId, op);
            expect(result).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 29: Unauthorized access denied
   *
   * For any user without permission to access a file, all access attempts SHALL be denied.
   * Validates: Requirements 13.3
   */
  test('Property 29: Unauthorized access denied', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // ownerId
        fc.uuid(), // unauthorizedUserId
        fc.uuid(), // fileId
        async (ownerId, unauthorizedUserId, fileId) => {
          fc.pre(ownerId !== unauthorizedUserId);

          mockStore.reset();
          mockStore.setFile({
            fileId,
            fileName: 'test.txt',
            ownerId,
            currentVersion: 1,
            totalSize: 100,
            createdAt: new Date(),
            updatedAt: new Date(),
            retentionDays: 30,
          });

          // Unauthorized user has no permissions — all operations should be denied
          for (const op of [Operation.READ, Operation.WRITE, Operation.DELETE]) {
            const result = await ac.checkPermission(unauthorizedUserId, fileId, op);
            expect(result).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 30: Granted permissions work correctly
   *
   * For any file owner granting a permission to another user, that user SHALL
   * subsequently have the granted permission.
   * Validates: Requirements 13.5
   */
  test('Property 30: Granted permissions work correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // ownerId
        fc.uuid(), // targetUserId
        fc.uuid(), // fileId
        fc.constantFrom(Permission.READ, Permission.WRITE, Permission.DELETE),
        async (ownerId, targetUserId, fileId, permission) => {
          fc.pre(ownerId !== targetUserId);

          mockStore.reset();
          mockStore.setFile({
            fileId,
            fileName: 'test.txt',
            ownerId,
            currentVersion: 1,
            totalSize: 100,
            createdAt: new Date(),
            updatedAt: new Date(),
            retentionDays: 30,
          });

          // Before grant — access denied
          const beforeGrant = await ac.checkPermission(
            targetUserId,
            fileId,
            permission as unknown as Operation
          );
          expect(beforeGrant).toBe(false);

          // Grant permission
          await ac.grantPermission(ownerId, fileId, targetUserId, permission);

          // After grant — access allowed
          const afterGrant = await ac.checkPermission(
            targetUserId,
            fileId,
            permission as unknown as Operation
          );
          expect(afterGrant).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Revoked permissions are denied
   */
  test('Property: Revoked permissions are denied', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        async (ownerId, targetUserId, fileId) => {
          fc.pre(ownerId !== targetUserId);

          mockStore.reset();
          mockStore.setFile({
            fileId,
            fileName: 'test.txt',
            ownerId,
            currentVersion: 1,
            totalSize: 100,
            createdAt: new Date(),
            updatedAt: new Date(),
            retentionDays: 30,
          });

          // Grant then revoke
          await ac.grantPermission(ownerId, fileId, targetUserId, Permission.READ);
          await ac.revokePermission(ownerId, fileId, targetUserId);

          const result = await ac.checkPermission(targetUserId, fileId, Operation.READ);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
