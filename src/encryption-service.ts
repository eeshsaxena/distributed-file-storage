import crypto from 'crypto';
import http from 'http';
import {
  EncryptionService,
  EncryptedChunk,
} from './interfaces/encryption-service.interface';

/**
 * Encryption Service Implementation
 *
 * Handles data encryption and decryption using AES-256-GCM.
 * Integrates with Hardware Security Module (HSM) for master key management.
 */
export class EncryptionServiceImpl implements EncryptionService {
  private readonly hsmUrl: string;
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32; // 256 bits
  private readonly ivLength = 12; // 96 bits for GCM
  private masterKeyCache: Map<number, Buffer> = new Map();

  constructor(hsmUrl: string = 'http://localhost:3001') {
    this.hsmUrl = hsmUrl;
  }

  /**
   * Encrypt chunk data using AES-256-GCM
   * @param chunkData - Chunk data to encrypt
   * @param fileId - File identifier for key derivation
   * @returns Encrypted chunk with metadata
   */
  async encryptChunk(
    chunkData: Buffer,
    fileId: string
  ): Promise<EncryptedChunk> {
    // Get current master key from HSM
    const { keyVersion, masterKey } = await this.getMasterKey();

    // Derive file-specific encryption key
    const fileKey = await this.deriveFileKey(masterKey, fileId);

    // Generate random initialization vector
    const iv = crypto.randomBytes(this.ivLength);

    // Create cipher
    const cipher = crypto.createCipheriv(this.algorithm, fileKey, iv);

    // Encrypt data
    const encrypted = Buffer.concat([cipher.update(chunkData), cipher.final()]);

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    return {
      data: encrypted,
      iv,
      authTag,
      keyVersion,
    };
  }

  /**
   * Decrypt chunk data
   * @param encryptedData - Encrypted chunk data
   * @param fileId - File identifier for key derivation
   * @returns Decrypted chunk data
   */
  async decryptChunk(encryptedData: Buffer, fileId: string): Promise<Buffer> {
    // Parse encrypted chunk structure
    // In a real implementation, this would be passed as EncryptedChunk object
    // For now, we'll assume the caller provides the full EncryptedChunk structure
    throw new Error(
      'decryptChunk requires EncryptedChunk object, not raw buffer'
    );
  }

  /**
   * Decrypt chunk using EncryptedChunk structure
   * @param encryptedChunk - Encrypted chunk with metadata
   * @param fileId - File identifier for key derivation
   * @returns Decrypted chunk data
   */
  async decryptChunkWithMetadata(
    encryptedChunk: EncryptedChunk,
    fileId: string
  ): Promise<Buffer> {
    const { data, iv, authTag, keyVersion } = encryptedChunk;

    // Get master key for the specific version
    const masterKey = await this.getMasterKeyVersion(keyVersion);

    // Derive file-specific encryption key
    const fileKey = await this.deriveFileKey(masterKey, fileId);

    // Create decipher
    const decipher = crypto.createDecipheriv(this.algorithm, fileKey, iv);

    // Set authentication tag
    decipher.setAuthTag(authTag);

    // Decrypt data
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

    return decrypted;
  }

  /**
   * Generate file encryption key using HKDF
   * @param fileId - File identifier
   * @returns Derived encryption key (base64 encoded)
   */
  async generateFileKey(fileId: string): Promise<string> {
    // Get current master key from HSM
    const { masterKey } = await this.getMasterKey();

    // Derive file-specific key
    const fileKey = await this.deriveFileKey(masterKey, fileId);

    return fileKey.toString('base64');
  }

  /**
   * Rotate master key in HSM
   */
  async rotateMasterKey(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        `${this.hsmUrl}/master-key/rotate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode === 200) {
              // Clear cache to force fetching new key
              this.masterKeyCache.clear();
              resolve();
            } else {
              reject(
                new Error(`Failed to rotate master key: ${res.statusCode}`)
              );
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(error);
      });

      req.end();
    });
  }

  /**
   * Get current master key from HSM
   * @returns Master key and version
   */
  private async getMasterKey(): Promise<{
    keyVersion: number;
    masterKey: Buffer;
  }> {
    return new Promise((resolve, reject) => {
      http.get(`${this.hsmUrl}/master-key`, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            const response = JSON.parse(data);
            const masterKey = Buffer.from(response.key, 'base64');
            const keyVersion = response.keyVersion;

            // Cache the key
            this.masterKeyCache.set(keyVersion, masterKey);

            resolve({ keyVersion, masterKey });
          } else {
            reject(new Error(`Failed to get master key: ${res.statusCode}`));
          }
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get specific master key version from HSM
   * @param version - Key version to retrieve
   * @returns Master key
   */
  private async getMasterKeyVersion(version: number): Promise<Buffer> {
    // Check cache first
    if (this.masterKeyCache.has(version)) {
      return this.masterKeyCache.get(version)!;
    }

    return new Promise((resolve, reject) => {
      http.get(`${this.hsmUrl}/master-key/${version}`, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            const response = JSON.parse(data);
            const masterKey = Buffer.from(response.key, 'base64');

            // Cache the key
            this.masterKeyCache.set(version, masterKey);

            resolve(masterKey);
          } else {
            reject(
              new Error(
                `Failed to get master key version ${version}: ${res.statusCode}`
              )
            );
          }
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Derive file-specific encryption key using HKDF
   * @param masterKey - Master key from HSM
   * @param fileId - File identifier
   * @returns Derived file key
   */
  private async deriveFileKey(
    masterKey: Buffer,
    fileId: string
  ): Promise<Buffer> {
    // Use HKDF (HMAC-based Key Derivation Function) to derive file-specific key
    // HKDF = HKDF-Extract + HKDF-Expand
    // We use the fileId as the "info" parameter to derive unique keys per file

    const salt = Buffer.from('distributed-file-storage-salt'); // Fixed salt for consistency
    const info = Buffer.from(`file:${fileId}`);

    // HKDF-Extract: PRK = HMAC-Hash(salt, IKM)
    const prk = crypto.createHmac('sha256', salt).update(masterKey).digest();

    // HKDF-Expand: OKM = HMAC-Hash(PRK, info || 0x01)
    const okm = crypto
      .createHmac('sha256', prk)
      .update(Buffer.concat([info, Buffer.from([0x01])]))
      .digest();

    // Return first 32 bytes for AES-256
    return okm.subarray(0, this.keyLength);
  }
}
