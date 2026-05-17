import { randomUUID } from 'crypto';
import {
  UploadManager,
  UploadSession,
  FileMetadata,
} from './interfaces/upload-manager.interface';
import { MetadataStore, UploadSessionRecord } from './interfaces/metadata-store.interface';

/**
 * Upload Manager Implementation
 *
 * Manages file upload sessions with resumable upload support.
 * - Creates and manages upload sessions
 * - Tracks uploaded chunks
 * - Supports out-of-order chunk uploads
 * - Handles session expiration (7 days)
 * - Supports parallel upload of up to 10 chunks
 */
export class UploadManagerImpl implements UploadManager {
  private metadataStore: MetadataStore;
  private readonly SESSION_EXPIRY_DAYS = 7;

  constructor(metadataStore: MetadataStore) {
    this.metadataStore = metadataStore;
  }

  /**
   * Create new upload session
   * @param fileId - Unique identifier for the file
   * @param fileName - Name of the file
   * @param totalChunks - Total number of chunks in the file
   * @param userId - User identifier
   * @returns Upload session
   */
  async createSession(
    fileId: string,
    fileName: string,
    totalChunks: number,
    userId: string
  ): Promise<UploadSession> {
    // Generate unique session ID
    const sessionId = randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + this.SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    );

    // Create session record in metadata store
    const sessionRecord: UploadSessionRecord = {
      sessionId,
      fileId,
      fileName,
      totalChunks,
      userId,
      createdAt,
      expiresAt,
      status: 'active',
    };

    await this.metadataStore.createUploadSession(sessionRecord);

    // Return upload session
    return {
      sessionId,
      fileId,
      fileName,
      totalChunks,
      uploadedChunks: new Set<number>(),
      createdAt,
      expiresAt,
      userId,
    };
  }

  /**
   * Resume existing upload session
   * @param sessionId - Session identifier
   * @returns Upload session
   */
  async resumeSession(sessionId: string): Promise<UploadSession> {
    // Get session from metadata store
    const sessionRecord = await this.metadataStore.getUploadSession(sessionId);

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Check if session is expired
    if (sessionRecord.status === 'expired' || new Date() > sessionRecord.expiresAt) {
      throw new Error(`Session expired: ${sessionId}`);
    }

    // Check if session is already completed
    if (sessionRecord.status === 'completed') {
      throw new Error(`Session already completed: ${sessionId}`);
    }

    // Get uploaded chunks
    const uploadedChunkRecords = await this.metadataStore.getUploadedChunks(sessionId);
    const uploadedChunks = new Set<number>(
      uploadedChunkRecords.map((record) => record.sequenceNumber)
    );

    // Return upload session
    return {
      sessionId: sessionRecord.sessionId,
      fileId: sessionRecord.fileId,
      fileName: sessionRecord.fileName,
      totalChunks: sessionRecord.totalChunks,
      uploadedChunks,
      createdAt: sessionRecord.createdAt,
      expiresAt: sessionRecord.expiresAt,
      userId: sessionRecord.userId,
    };
  }

  /**
   * Mark chunk as uploaded
   * @param sessionId - Session identifier
   * @param sequenceNumber - Chunk sequence number
   * @param chunkHash - SHA-256 hash of the chunk
   */
  async markChunkUploaded(
    sessionId: string,
    sequenceNumber: number,
    chunkHash: string
  ): Promise<void> {
    // Verify session exists and is active
    const sessionRecord = await this.metadataStore.getUploadSession(sessionId);

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (sessionRecord.status !== 'active') {
      throw new Error(`Session is not active: ${sessionId}`);
    }

    // Check if session is expired
    if (new Date() > sessionRecord.expiresAt) {
      throw new Error(`Session expired: ${sessionId}`);
    }

    // Validate sequence number
    if (sequenceNumber < 0 || sequenceNumber >= sessionRecord.totalChunks) {
      throw new Error(
        `Invalid sequence number: ${sequenceNumber}. Must be between 0 and ${sessionRecord.totalChunks - 1}`
      );
    }

    // Mark chunk as uploaded in metadata store
    await this.metadataStore.markChunkUploaded(sessionId, sequenceNumber, chunkHash);
  }

  /**
   * Check if upload is complete
   * @param sessionId - Session identifier
   * @returns True if all chunks uploaded, false otherwise
   */
  async isUploadComplete(sessionId: string): Promise<boolean> {
    // Get session from metadata store
    const sessionRecord = await this.metadataStore.getUploadSession(sessionId);

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Get uploaded chunks
    const uploadedChunkRecords = await this.metadataStore.getUploadedChunks(sessionId);

    // Check if all chunks are uploaded
    return uploadedChunkRecords.length === sessionRecord.totalChunks;
  }

  /**
   * Finalize upload and create file metadata
   * @param sessionId - Session identifier
   * @returns File metadata
   */
  async finalizeUpload(sessionId: string): Promise<FileMetadata> {
    // Get session from metadata store
    const sessionRecord = await this.metadataStore.getUploadSession(sessionId);

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Verify upload is complete
    const isComplete = await this.isUploadComplete(sessionId);
    if (!isComplete) {
      throw new Error(`Upload not complete: ${sessionId}`);
    }

    // Get uploaded chunks to calculate total size
    const uploadedChunkRecords = await this.metadataStore.getUploadedChunks(sessionId);

    // Calculate total file size from chunks
    let totalSize = 0;
    for (const chunkRecord of uploadedChunkRecords) {
      const chunk = await this.metadataStore.getChunk(chunkRecord.chunkHash);
      if (chunk) {
        totalSize += chunk.size;
      }
    }

    // Create file metadata
    const now = new Date();
    const fileMetadata: FileMetadata = {
      fileId: sessionRecord.fileId,
      fileName: sessionRecord.fileName,
      ownerId: sessionRecord.userId,
      currentVersion: 1,
      totalSize,
      createdAt: now,
      updatedAt: now,
    };

    // Create file record in metadata store
    await this.metadataStore.createFile({
      fileId: fileMetadata.fileId,
      fileName: fileMetadata.fileName,
      ownerId: fileMetadata.ownerId,
      currentVersion: fileMetadata.currentVersion,
      totalSize: fileMetadata.totalSize,
      createdAt: fileMetadata.createdAt,
      updatedAt: fileMetadata.updatedAt,
      retentionDays: 30, // Default retention
    });

    // Create file version record
    const chunkHashes = uploadedChunkRecords
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .map((record) => record.chunkHash);

    await this.metadataStore.createFileVersion({
      fileId: sessionRecord.fileId,
      version: 1,
      chunkHashes,
      size: totalSize,
      createdAt: now,
      userId: sessionRecord.userId,
    });

    // Mark session as completed
    await this.metadataStore.updateUploadSession(sessionId, { status: 'completed' });

    return fileMetadata;
  }

  /**
   * Clean up expired sessions (older than 7 days)
   */
  async cleanupExpiredSessions(): Promise<void> {
    const now = new Date();

    // Get expired sessions
    const expiredSessions = await this.metadataStore.getExpiredSessions(now);

    // Delete each expired session
    for (const session of expiredSessions) {
      try {
        // Mark as expired first
        await this.metadataStore.updateUploadSession(session.sessionId, {
          status: 'expired',
        });

        // Delete the session (this will cascade delete uploaded chunks)
        await this.metadataStore.deleteUploadSession(session.sessionId);
      } catch (error) {
        // Log error but continue with other sessions
        console.error(`Failed to cleanup session ${session.sessionId}:`, error);
      }
    }
  }
}
