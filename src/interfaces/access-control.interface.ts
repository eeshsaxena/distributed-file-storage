/**
 * Access Control Interface
 *
 * Manages authentication, authorization, and permissions.
 */

export interface AccessControl {
  /**
   * Verify user has permission for operation
   * @param userId - User identifier
   * @param fileId - File identifier
   * @param operation - Operation type
   * @returns True if user has permission, false otherwise
   */
  checkPermission(userId: string, fileId: string, operation: Operation): Promise<boolean>;

  /**
   * Grant permission to another user
   * @param ownerId - Owner user identifier
   * @param fileId - File identifier
   * @param targetUserId - Target user identifier
   * @param permission - Permission to grant
   */
  grantPermission(
    ownerId: string,
    fileId: string,
    targetUserId: string,
    permission: Permission
  ): Promise<void>;

  /**
   * Revoke permission
   * @param ownerId - Owner user identifier
   * @param fileId - File identifier
   * @param targetUserId - Target user identifier
   */
  revokePermission(ownerId: string, fileId: string, targetUserId: string): Promise<void>;

  /**
   * Audit access attempt
   * @param userId - User identifier
   * @param fileId - File identifier
   * @param operation - Operation type
   * @param result - Whether access was granted
   */
  auditAccess(userId: string, fileId: string, operation: Operation, result: boolean): Promise<void>;
}

export enum Operation {
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
  SHARE = 'share',
}

export enum Permission {
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
}
