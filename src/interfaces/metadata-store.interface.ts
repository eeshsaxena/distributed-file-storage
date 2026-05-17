/**
 * Metadata Store Interface
 *
 * Responsible for storing and retrieving metadata about files, chunks, versions, and storage nodes.
 */

export interface MetadataStore {
  // File operations
  createFile(file: FileRecord): Promise<void>;
  getFile(fileId: string): Promise<FileRecord | null>;
  updateFile(fileId: string, updates: Partial<FileRecord>): Promise<void>;
  deleteFile(fileId: string): Promise<void>;
  listFilesByOwner(ownerId: string): Promise<FileRecord[]>;

  // File version operations
  createFileVersion(version: FileVersionRecord): Promise<void>;
  getFileVersion(fileId: string, version: number): Promise<FileVersionRecord | null>;
  listFileVersions(fileId: string): Promise<FileVersionRecord[]>;
  deleteFileVersion(fileId: string, version: number): Promise<void>;

  // Chunk operations
  createChunk(chunk: ChunkRecord): Promise<void>;
  getChunk(chunkHash: string): Promise<ChunkRecord | null>;
  updateChunk(chunkHash: string, updates: Partial<ChunkRecord>): Promise<void>;
  deleteChunk(chunkHash: string): Promise<void>;
  incrementChunkReference(chunkHash: string, fileId: string): Promise<void>;
  decrementChunkReference(chunkHash: string, fileId: string): Promise<void>;
  getOrphanedChunks(): Promise<string[]>;

  // Chunk replica operations
  createChunkReplica(replica: ChunkReplicaRecord): Promise<void>;
  getChunkReplicas(chunkHash: string): Promise<ChunkReplicaRecord[]>;
  deleteChunkReplica(chunkHash: string, nodeId: string): Promise<void>;

  // Storage node operations
  registerStorageNode(node: StorageNodeRecord): Promise<void>;
  getStorageNode(nodeId: string): Promise<StorageNodeRecord | null>;
  updateStorageNode(nodeId: string, updates: Partial<StorageNodeRecord>): Promise<void>;
  listStorageNodes(status?: string): Promise<StorageNodeRecord[]>;
  updateNodeHeartbeat(nodeId: string): Promise<void>;

  // Upload session operations
  createUploadSession(session: UploadSessionRecord): Promise<void>;
  getUploadSession(sessionId: string): Promise<UploadSessionRecord | null>;
  updateUploadSession(sessionId: string, updates: Partial<UploadSessionRecord>): Promise<void>;
  markChunkUploaded(sessionId: string, sequenceNumber: number, chunkHash: string): Promise<void>;
  getUploadedChunks(sessionId: string): Promise<UploadedChunkRecord[]>;
  deleteUploadSession(sessionId: string): Promise<void>;
  getExpiredSessions(expiryDate: Date): Promise<UploadSessionRecord[]>;

  // Permission operations
  grantPermission(permission: FilePermissionRecord): Promise<void>;
  revokePermission(fileId: string, userId: string): Promise<void>;
  getFilePermissions(fileId: string): Promise<FilePermissionRecord[]>;
  checkPermission(fileId: string, userId: string, permission: string): Promise<boolean>;

  // Audit operations
  logAccess(audit: AccessAuditRecord): Promise<void>;
  getAccessLogs(fileId: string, limit?: number): Promise<AccessAuditRecord[]>;

  // Transaction support
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;

  // Connection management
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface FileRecord {
  fileId: string;
  fileName: string;
  ownerId: string;
  currentVersion: number;
  totalSize: number;
  createdAt: Date;
  updatedAt: Date;
  retentionDays: number;
}

export interface FileVersionRecord {
  fileId: string;
  version: number;
  chunkHashes: string[];
  size: number;
  createdAt: Date;
  userId: string;
  contentType?: string;
  checksum?: string;
}

export interface ChunkRecord {
  chunkHash: string;
  size: number;
  encryptedSize: number;
  referenceCount: number;
  createdAt: Date;
  lastVerified?: Date;
}

export interface ChunkReplicaRecord {
  chunkHash: string;
  nodeId: string;
  availabilityZone: string;
  createdAt: Date;
}

export interface StorageNodeRecord {
  nodeId: string;
  ipAddress: string;
  port: number;
  availabilityZone: string;
  region: string;
  capacity: number;
  usedSpace: number;
  status: 'active' | 'draining' | 'offline';
  registeredAt: Date;
  lastHeartbeat: Date;
  virtualNodeIds?: string[];
  networkLatency?: number;     // Milliseconds — reported by health metrics
}

export interface UploadSessionRecord {
  sessionId: string;
  fileId: string;
  fileName: string;
  totalChunks: number;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  status: 'active' | 'completed' | 'expired';
}

export interface UploadedChunkRecord {
  sessionId: string;
  sequenceNumber: number;
  chunkHash: string;
  uploadedAt: Date;
}

export interface FilePermissionRecord {
  fileId: string;
  userId: string;
  permission: 'read' | 'write' | 'delete';
  grantedAt: Date;
  grantedBy: string;
}

export interface AccessAuditRecord {
  auditId?: number;
  userId: string;
  fileId: string;
  operation: string;
  result: boolean;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
}
