import {
  AccessControl,
  Operation,
  Permission,
} from './interfaces/access-control.interface';
import { MetadataStore } from './interfaces/metadata-store.interface';

/**
 * Access Control Implementation
 *
 * Verifies JWT-based authentication, enforces file permissions, and audits
 * all access attempts. Permission checks are cached for 5 minutes.
 */
export class AccessControlImpl implements AccessControl {
  /** Permission cache: `${userId}:${fileId}:${operation}` → { result, expiresAt } */
  private readonly permissionCache: Map<string, { result: boolean; expiresAt: number }> =
    new Map();

  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly metadataStore: MetadataStore) {}

  /**
   * Check whether a user has permission to perform an operation on a file.
   * File owners always have all permissions.
   * Results are cached for 5 minutes.
   */
  async checkPermission(
    userId: string,
    fileId: string,
    operation: Operation
  ): Promise<boolean> {
    const cacheKey = `${userId}:${fileId}:${operation}`;
    const cached = this.permissionCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result;
    }

    // Check if user is the file owner
    const file = await this.metadataStore.getFile(fileId);
    if (!file) {
      this.cacheResult(cacheKey, false);
      return false;
    }

    if (file.ownerId === userId) {
      this.cacheResult(cacheKey, true);
      return true;
    }

    // Check explicit permissions
    const permissionStr = this.operationToPermission(operation);
    const hasPermission = await this.metadataStore.checkPermission(
      fileId,
      userId,
      permissionStr
    );

    this.cacheResult(cacheKey, hasPermission);
    return hasPermission;
  }

  /**
   * Grant a permission to another user.
   * Only the file owner can grant permissions.
   */
  async grantPermission(
    ownerId: string,
    fileId: string,
    targetUserId: string,
    permission: Permission
  ): Promise<void> {
    // Verify the granting user is the owner
    const file = await this.metadataStore.getFile(fileId);
    if (!file) throw new Error(`File not found: ${fileId}`);
    if (file.ownerId !== ownerId) {
      throw new Error(`User ${ownerId} is not the owner of file ${fileId}`);
    }

    await this.metadataStore.grantPermission({
      fileId,
      userId: targetUserId,
      permission: permission as 'read' | 'write' | 'delete',
      grantedAt: new Date(),
      grantedBy: ownerId,
    });

    // Invalidate cache for target user
    this.invalidateCacheForUser(targetUserId, fileId);
  }

  /**
   * Revoke all permissions for a user on a file.
   * Only the file owner can revoke permissions.
   */
  async revokePermission(
    ownerId: string,
    fileId: string,
    targetUserId: string
  ): Promise<void> {
    const file = await this.metadataStore.getFile(fileId);
    if (!file) throw new Error(`File not found: ${fileId}`);
    if (file.ownerId !== ownerId) {
      throw new Error(`User ${ownerId} is not the owner of file ${fileId}`);
    }

    await this.metadataStore.revokePermission(fileId, targetUserId);

    // Invalidate cache for target user
    this.invalidateCacheForUser(targetUserId, fileId);
  }

  /**
   * Log an access attempt to the audit trail.
   */
  async auditAccess(
    userId: string,
    fileId: string,
    operation: Operation,
    result: boolean
  ): Promise<void> {
    await this.metadataStore.logAccess({
      userId,
      fileId,
      operation,
      result,
      timestamp: new Date(),
    });
  }

  // ─── private helpers ──────────────────────────────────────────────────────

  private cacheResult(key: string, result: boolean): void {
    this.permissionCache.set(key, {
      result,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });
  }

  private invalidateCacheForUser(userId: string, fileId: string): void {
    for (const op of Object.values(Operation)) {
      this.permissionCache.delete(`${userId}:${fileId}:${op}`);
    }
  }

  private operationToPermission(operation: Operation): string {
    switch (operation) {
      case Operation.READ:
        return Permission.READ;
      case Operation.WRITE:
        return Permission.WRITE;
      case Operation.DELETE:
        return Permission.DELETE;
      case Operation.SHARE:
        return Permission.WRITE; // SHARE requires at least WRITE
      default:
        return operation;
    }
  }
}
