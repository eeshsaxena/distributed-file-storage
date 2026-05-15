/**
 * Upload Manager Interface
 *
 * Manages file upload sessions with resumable upload support.
 */

export interface UploadManager {
  /**
   * Create new upload session
   * @param fileId - Unique identifier for the file
   * @param fileName - Name of the file
   * @param totalChunks - Total number of chunks in the file
   * @param userId - User identifier
   * @returns Upload session
   */
  createSession(
    fileId: string,
    fileName: string,
    totalChunks: number,
    userId: string
  ): Promise<UploadSession>;

  /**
   * Resume existing upload session
   * @param sessionId - Session identifier
   * @returns Upload session
   */
  resumeSession(sessionId: string): Promise<UploadSession>;

  /**
   * Mark chunk as uploaded
   * @param sessionId - Session identifier
   * @param sequenceNumber - Chunk sequence number
   * @param chunkHash - SHA-256 hash of the chunk
   */
  markChunkUploaded(sessionId: string, sequenceNumber: number, chunkHash: string): Promise<void>;

  /**
   * Check if upload is complete
   * @param sessionId - Session identifier
   * @returns True if all chunks uploaded, false otherwise
   */
  isUploadComplete(sessionId: string): Promise<boolean>;

  /**
   * Finalize upload and create file metadata
   * @param sessionId - Session identifier
   * @returns File metadata
   */
  finalizeUpload(sessionId: string): Promise<FileMetadata>;

  /**
   * Clean up expired sessions (older than 7 days)
   */
  cleanupExpiredSessions(): Promise<void>;
}

export interface UploadSession {
  sessionId: string;
  fileId: string;
  fileName: string;
  totalChunks: number;
  uploadedChunks: Set<number>; // Sequence numbers
  createdAt: Date;
  expiresAt: Date;
  userId: string;
}

export interface FileMetadata {
  fileId: string;
  fileName: string;
  ownerId: string;
  currentVersion: number;
  totalSize: number;
  createdAt: Date;
  updatedAt: Date;
}
