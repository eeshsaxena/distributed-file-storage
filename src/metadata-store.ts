import { Pool, PoolClient } from 'pg';
import {
  MetadataStore,
  FileRecord,
  FileVersionRecord,
  ChunkRecord,
  ChunkReplicaRecord,
  StorageNodeRecord,
  UploadSessionRecord,
  UploadedChunkRecord,
  FilePermissionRecord,
  AccessAuditRecord,
} from './interfaces/metadata-store.interface';

/**
 * PostgreSQL-based Metadata Store Implementation
 *
 * Provides CRUD operations for all metadata with transaction support.
 */
export class MetadataStoreImpl implements MetadataStore {
  private pool: Pool;
  private client: PoolClient | null = null;

  constructor(connectionConfig: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  }) {
    this.pool = new Pool(connectionConfig);
  }

  async connect(): Promise<void> {
    // Test connection
    const client = await this.pool.connect();
    client.release();
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  async beginTransaction(): Promise<void> {
    this.client = await this.pool.connect();
    await this.client.query('BEGIN');
  }

  async commitTransaction(): Promise<void> {
    if (!this.client) {
      throw new Error('No active transaction');
    }
    await this.client.query('COMMIT');
    this.client.release();
    this.client = null;
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.client) {
      throw new Error('No active transaction');
    }
    await this.client.query('ROLLBACK');
    this.client.release();
    this.client = null;
  }

  private getClient(): Pool | PoolClient {
    return this.client || this.pool;
  }

  // File operations
  async createFile(file: FileRecord): Promise<void> {
    const query = `
      INSERT INTO files (file_id, file_name, owner_id, current_version, total_size, created_at, updated_at, retention_days)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    await this.getClient().query(query, [
      file.fileId,
      file.fileName,
      file.ownerId,
      file.currentVersion,
      file.totalSize,
      file.createdAt,
      file.updatedAt,
      file.retentionDays,
    ]);
  }

  async getFile(fileId: string): Promise<FileRecord | null> {
    const query = 'SELECT * FROM files WHERE file_id = $1';
    const result = await this.getClient().query(query, [fileId]);
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapToFileRecord(result.rows[0]);
  }

  async updateFile(fileId: string, updates: Partial<FileRecord>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.fileName !== undefined) {
      fields.push(`file_name = $${paramIndex++}`);
      values.push(updates.fileName);
    }
    if (updates.currentVersion !== undefined) {
      fields.push(`current_version = $${paramIndex++}`);
      values.push(updates.currentVersion);
    }
    if (updates.totalSize !== undefined) {
      fields.push(`total_size = $${paramIndex++}`);
      values.push(updates.totalSize);
    }
    if (updates.updatedAt !== undefined) {
      fields.push(`updated_at = $${paramIndex++}`);
      values.push(updates.updatedAt);
    }
    if (updates.retentionDays !== undefined) {
      fields.push(`retention_days = $${paramIndex++}`);
      values.push(updates.retentionDays);
    }

    if (fields.length === 0) {
      return;
    }

    values.push(fileId);
    const query = `UPDATE files SET ${fields.join(', ')} WHERE file_id = $${paramIndex}`;
    await this.getClient().query(query, values);
  }

  async deleteFile(fileId: string): Promise<void> {
    const query = 'DELETE FROM files WHERE file_id = $1';
    await this.getClient().query(query, [fileId]);
  }

  async listFilesByOwner(ownerId: string): Promise<FileRecord[]> {
    const query = 'SELECT * FROM files WHERE owner_id = $1 ORDER BY created_at DESC';
    const result = await this.getClient().query(query, [ownerId]);
    return result.rows.map((row: any) => this.mapToFileRecord(row));
  }

  // File version operations
  async createFileVersion(version: FileVersionRecord): Promise<void> {
    const query = `
      INSERT INTO file_versions (file_id, version, chunk_hashes, size, created_at, user_id, content_type, checksum)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    await this.getClient().query(query, [
      version.fileId,
      version.version,
      version.chunkHashes,
      version.size,
      version.createdAt,
      version.userId,
      version.contentType || null,
      version.checksum || null,
    ]);
  }

  async getFileVersion(fileId: string, version: number): Promise<FileVersionRecord | null> {
    const query = 'SELECT * FROM file_versions WHERE file_id = $1 AND version = $2';
    const result = await this.getClient().query(query, [fileId, version]);
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapToFileVersionRecord(result.rows[0]);
  }

  async listFileVersions(fileId: string): Promise<FileVersionRecord[]> {
    const query = 'SELECT * FROM file_versions WHERE file_id = $1 ORDER BY version DESC';
    const result = await this.getClient().query(query, [fileId]);
    return result.rows.map((row: any) => this.mapToFileVersionRecord(row));
  }

  async deleteFileVersion(fileId: string, version: number): Promise<void> {
    const query = 'DELETE FROM file_versions WHERE file_id = $1 AND version = $2';
    await this.getClient().query(query, [fileId, version]);
  }

  // Chunk operations
  async createChunk(chunk: ChunkRecord): Promise<void> {
    const query = `
      INSERT INTO chunks (chunk_hash, size, encrypted_size, reference_count, created_at, last_verified)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (chunk_hash) DO NOTHING
    `;
    await this.getClient().query(query, [
      chunk.chunkHash,
      chunk.size,
      chunk.encryptedSize,
      chunk.referenceCount,
      chunk.createdAt,
      chunk.lastVerified || null,
    ]);
  }

  async getChunk(chunkHash: string): Promise<ChunkRecord | null> {
    const query = 'SELECT * FROM chunks WHERE chunk_hash = $1';
    const result = await this.getClient().query(query, [chunkHash]);
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapToChunkRecord(result.rows[0]);
  }

  async updateChunk(chunkHash: string, updates: Partial<ChunkRecord>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.referenceCount !== undefined) {
      fields.push(`reference_count = $${paramIndex++}`);
      values.push(updates.referenceCount);
    }
    if (updates.lastVerified !== undefined) {
      fields.push(`last_verified = $${paramIndex++}`);
      values.push(updates.lastVerified);
    }

    if (fields.length === 0) {
      return;
    }

    values.push(chunkHash);
    const query = `UPDATE chunks SET ${fields.join(', ')} WHERE chunk_hash = $${paramIndex}`;
    await this.getClient().query(query, values);
  }

  async deleteChunk(chunkHash: string): Promise<void> {
    const query = 'DELETE FROM chunks WHERE chunk_hash = $1';
    await this.getClient().query(query, [chunkHash]);
  }

  async incrementChunkReference(chunkHash: string, fileId: string): Promise<void> {
    const query = 'UPDATE chunks SET reference_count = reference_count + 1 WHERE chunk_hash = $1';
    await this.getClient().query(query, [chunkHash]);
  }

  async decrementChunkReference(chunkHash: string, fileId: string): Promise<void> {
    const query = 'UPDATE chunks SET reference_count = reference_count - 1 WHERE chunk_hash = $1';
    await this.getClient().query(query, [chunkHash]);
  }

  async getOrphanedChunks(): Promise<string[]> {
    const query = 'SELECT chunk_hash FROM chunks WHERE reference_count = 0';
    const result = await this.getClient().query(query);
    return result.rows.map((row: any) => row.chunk_hash);
  }

  // Chunk replica operations
  async createChunkReplica(replica: ChunkReplicaRecord): Promise<void> {
    const query = `
      INSERT INTO chunk_replicas (chunk_hash, node_id, availability_zone, created_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (chunk_hash, node_id) DO NOTHING
    `;
    await this.getClient().query(query, [
      replica.chunkHash,
      replica.nodeId,
      replica.availabilityZone,
      replica.createdAt,
    ]);
  }

  async getChunkReplicas(chunkHash: string): Promise<ChunkReplicaRecord[]> {
    const query = 'SELECT * FROM chunk_replicas WHERE chunk_hash = $1';
    const result = await this.getClient().query(query, [chunkHash]);
    return result.rows.map((row: any) => this.mapToChunkReplicaRecord(row));
  }

  async deleteChunkReplica(chunkHash: string, nodeId: string): Promise<void> {
    const query = 'DELETE FROM chunk_replicas WHERE chunk_hash = $1 AND node_id = $2';
    await this.getClient().query(query, [chunkHash, nodeId]);
  }

  // Storage node operations
  async registerStorageNode(node: StorageNodeRecord): Promise<void> {
    const query = `
      INSERT INTO storage_nodes (node_id, ip_address, port, availability_zone, region, capacity, used_space, status, registered_at, last_heartbeat, virtual_node_ids)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (node_id) DO UPDATE SET
        ip_address = EXCLUDED.ip_address,
        port = EXCLUDED.port,
        availability_zone = EXCLUDED.availability_zone,
        region = EXCLUDED.region,
        capacity = EXCLUDED.capacity,
        status = EXCLUDED.status,
        last_heartbeat = EXCLUDED.last_heartbeat
    `;
    await this.getClient().query(query, [
      node.nodeId,
      node.ipAddress,
      node.port,
      node.availabilityZone,
      node.region,
      node.capacity,
      node.usedSpace,
      node.status,
      node.registeredAt,
      node.lastHeartbeat,
      node.virtualNodeIds || null,
    ]);
  }

  async getStorageNode(nodeId: string): Promise<StorageNodeRecord | null> {
    const query = 'SELECT * FROM storage_nodes WHERE node_id = $1';
    const result = await this.getClient().query(query, [nodeId]);
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapToStorageNodeRecord(result.rows[0]);
  }

  async updateStorageNode(nodeId: string, updates: Partial<StorageNodeRecord>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.usedSpace !== undefined) {
      fields.push(`used_space = $${paramIndex++}`);
      values.push(updates.usedSpace);
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.lastHeartbeat !== undefined) {
      fields.push(`last_heartbeat = $${paramIndex++}`);
      values.push(updates.lastHeartbeat);
    }

    if (fields.length === 0) {
      return;
    }

    values.push(nodeId);
    const query = `UPDATE storage_nodes SET ${fields.join(', ')} WHERE node_id = $${paramIndex}`;
    await this.getClient().query(query, values);
  }

  async listStorageNodes(status?: string): Promise<StorageNodeRecord[]> {
    let query = 'SELECT * FROM storage_nodes';
    const values: any[] = [];

    if (status) {
      query += ' WHERE status = $1';
      values.push(status);
    }

    query += ' ORDER BY node_id';
    const result = await this.getClient().query(query, values);
    return result.rows.map((row: any) => this.mapToStorageNodeRecord(row));
  }

  async updateNodeHeartbeat(nodeId: string): Promise<void> {
    const query = 'UPDATE storage_nodes SET last_heartbeat = $1 WHERE node_id = $2';
    await this.getClient().query(query, [new Date(), nodeId]);
  }

  // Upload session operations
  async createUploadSession(session: UploadSessionRecord): Promise<void> {
    const query = `
      INSERT INTO upload_sessions (session_id, file_id, file_name, total_chunks, user_id, created_at, expires_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    await this.getClient().query(query, [
      session.sessionId,
      session.fileId,
      session.fileName,
      session.totalChunks,
      session.userId,
      session.createdAt,
      session.expiresAt,
      session.status,
    ]);
  }

  async getUploadSession(sessionId: string): Promise<UploadSessionRecord | null> {
    const query = 'SELECT * FROM upload_sessions WHERE session_id = $1';
    const result = await this.getClient().query(query, [sessionId]);
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapToUploadSessionRecord(result.rows[0]);
  }

  async updateUploadSession(
    sessionId: string,
    updates: Partial<UploadSessionRecord>
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.status !== undefined) {
      fields.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }

    if (fields.length === 0) {
      return;
    }

    values.push(sessionId);
    const query = `UPDATE upload_sessions SET ${fields.join(', ')} WHERE session_id = $${paramIndex}`;
    await this.getClient().query(query, values);
  }

  async markChunkUploaded(
    sessionId: string,
    sequenceNumber: number,
    chunkHash: string
  ): Promise<void> {
    const query = `
      INSERT INTO uploaded_chunks (session_id, sequence_number, chunk_hash, uploaded_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (session_id, sequence_number) DO NOTHING
    `;
    await this.getClient().query(query, [sessionId, sequenceNumber, chunkHash, new Date()]);
  }

  async getUploadedChunks(sessionId: string): Promise<UploadedChunkRecord[]> {
    const query =
      'SELECT * FROM uploaded_chunks WHERE session_id = $1 ORDER BY sequence_number';
    const result = await this.getClient().query(query, [sessionId]);
    return result.rows.map((row: any) => this.mapToUploadedChunkRecord(row));
  }

  async deleteUploadSession(sessionId: string): Promise<void> {
    const query = 'DELETE FROM upload_sessions WHERE session_id = $1';
    await this.getClient().query(query, [sessionId]);
  }

  async getExpiredSessions(expiryDate: Date): Promise<UploadSessionRecord[]> {
    const query = 'SELECT * FROM upload_sessions WHERE expires_at < $1 AND status = $2';
    const result = await this.getClient().query(query, [expiryDate, 'active']);
    return result.rows.map((row: any) => this.mapToUploadSessionRecord(row));
  }

  // Permission operations
  async grantPermission(permission: FilePermissionRecord): Promise<void> {
    const query = `
      INSERT INTO file_permissions (file_id, user_id, permission, granted_at, granted_by)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (file_id, user_id) DO UPDATE SET
        permission = EXCLUDED.permission,
        granted_at = EXCLUDED.granted_at,
        granted_by = EXCLUDED.granted_by
    `;
    await this.getClient().query(query, [
      permission.fileId,
      permission.userId,
      permission.permission,
      permission.grantedAt,
      permission.grantedBy,
    ]);
  }

  async revokePermission(fileId: string, userId: string): Promise<void> {
    const query = 'DELETE FROM file_permissions WHERE file_id = $1 AND user_id = $2';
    await this.getClient().query(query, [fileId, userId]);
  }

  async getFilePermissions(fileId: string): Promise<FilePermissionRecord[]> {
    const query = 'SELECT * FROM file_permissions WHERE file_id = $1';
    const result = await this.getClient().query(query, [fileId]);
    return result.rows.map((row: any) => this.mapToFilePermissionRecord(row));
  }

  async checkPermission(
    fileId: string,
    userId: string,
    permission: string
  ): Promise<boolean> {
    const query =
      'SELECT COUNT(*) as count FROM file_permissions WHERE file_id = $1 AND user_id = $2 AND permission = $3';
    const result = await this.getClient().query(query, [fileId, userId, permission]);
    return parseInt(result.rows[0].count) > 0;
  }

  // Audit operations
  async logAccess(audit: AccessAuditRecord): Promise<void> {
    const query = `
      INSERT INTO access_audit_log (user_id, file_id, operation, result, timestamp, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    await this.getClient().query(query, [
      audit.userId,
      audit.fileId,
      audit.operation,
      audit.result,
      audit.timestamp,
      audit.ipAddress || null,
      audit.userAgent || null,
    ]);
  }

  async getAccessLogs(fileId: string, limit: number = 100): Promise<AccessAuditRecord[]> {
    const query =
      'SELECT * FROM access_audit_log WHERE file_id = $1 ORDER BY timestamp DESC LIMIT $2';
    const result = await this.getClient().query(query, [fileId, limit]);
    return result.rows.map((row: any) => this.mapToAccessAuditRecord(row));
  }

  // Mapping functions
  private mapToFileRecord(row: any): FileRecord {
    return {
      fileId: row.file_id,
      fileName: row.file_name,
      ownerId: row.owner_id,
      currentVersion: row.current_version,
      totalSize: parseInt(row.total_size),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      retentionDays: row.retention_days,
    };
  }

  private mapToFileVersionRecord(row: any): FileVersionRecord {
    return {
      fileId: row.file_id,
      version: row.version,
      chunkHashes: row.chunk_hashes,
      size: parseInt(row.size),
      createdAt: row.created_at,
      userId: row.user_id,
      contentType: row.content_type,
      checksum: row.checksum,
    };
  }

  private mapToChunkRecord(row: any): ChunkRecord {
    return {
      chunkHash: row.chunk_hash,
      size: row.size,
      encryptedSize: row.encrypted_size,
      referenceCount: row.reference_count,
      createdAt: row.created_at,
      lastVerified: row.last_verified,
    };
  }

  private mapToChunkReplicaRecord(row: any): ChunkReplicaRecord {
    return {
      chunkHash: row.chunk_hash,
      nodeId: row.node_id,
      availabilityZone: row.availability_zone,
      createdAt: row.created_at,
    };
  }

  private mapToStorageNodeRecord(row: any): StorageNodeRecord {
    return {
      nodeId: row.node_id,
      ipAddress: row.ip_address,
      port: row.port,
      availabilityZone: row.availability_zone,
      region: row.region,
      capacity: parseInt(row.capacity),
      usedSpace: parseInt(row.used_space),
      status: row.status,
      registeredAt: row.registered_at,
      lastHeartbeat: row.last_heartbeat,
      virtualNodeIds: row.virtual_node_ids,
    };
  }

  private mapToUploadSessionRecord(row: any): UploadSessionRecord {
    return {
      sessionId: row.session_id,
      fileId: row.file_id,
      fileName: row.file_name,
      totalChunks: row.total_chunks,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      status: row.status,
    };
  }

  private mapToUploadedChunkRecord(row: any): UploadedChunkRecord {
    return {
      sessionId: row.session_id,
      sequenceNumber: row.sequence_number,
      chunkHash: row.chunk_hash,
      uploadedAt: row.uploaded_at,
    };
  }

  private mapToFilePermissionRecord(row: any): FilePermissionRecord {
    return {
      fileId: row.file_id,
      userId: row.user_id,
      permission: row.permission,
      grantedAt: row.granted_at,
      grantedBy: row.granted_by,
    };
  }

  private mapToAccessAuditRecord(row: any): AccessAuditRecord {
    return {
      auditId: row.audit_id,
      userId: row.user_id,
      fileId: row.file_id,
      operation: row.operation,
      result: row.result,
      timestamp: row.timestamp,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
    };
  }
}
