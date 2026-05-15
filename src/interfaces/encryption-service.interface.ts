/**
 * Encryption Service Interface
 *
 * Handles data encryption and decryption using AES-256-GCM.
 */

export interface EncryptionService {
  /**
   * Encrypt chunk data
   * @param chunkData - Chunk data to encrypt
   * @param fileId - File identifier for key derivation
   * @returns Encrypted chunk with metadata
   */
  encryptChunk(chunkData: Buffer, fileId: string): Promise<EncryptedChunk>;

  /**
   * Decrypt chunk data
   * @param encryptedData - Encrypted chunk data
   * @param fileId - File identifier for key derivation
   * @returns Decrypted chunk data
   */
  decryptChunk(encryptedData: Buffer, fileId: string): Promise<Buffer>;

  /**
   * Generate file encryption key
   * @param fileId - File identifier
   * @returns Derived encryption key
   */
  generateFileKey(fileId: string): Promise<string>;

  /**
   * Rotate master key
   */
  rotateMasterKey(): Promise<void>;
}

export interface EncryptedChunk {
  data: Buffer;
  iv: Buffer; // Initialization vector
  authTag: Buffer; // GCM authentication tag
  keyVersion: number; // Master key version used
}
