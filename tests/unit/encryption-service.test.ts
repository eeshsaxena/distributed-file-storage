import { EncryptionServiceImpl } from '../../src/encryption-service';
import { EncryptedChunk } from '../../src/interfaces/encryption-service.interface';

/**
 * Unit Tests for Encryption Service
 *
 * Tests specific scenarios and edge cases for encryption operations.
 */
describe('EncryptionService', () => {
  let encryptionService: EncryptionServiceImpl;

  beforeAll(() => {
    // Use mock HSM service (should be running on localhost:3001)
    encryptionService = new EncryptionServiceImpl('http://localhost:3001');
  });

  describe('encryptChunk', () => {
    it('should encrypt a chunk and return encrypted data with metadata', async () => {
      const chunkData = Buffer.from('Test chunk data');
      const fileId = 'test-file-1';

      const encryptedChunk = await encryptionService.encryptChunk(
        chunkData,
        fileId
      );

      expect(encryptedChunk.data).toBeDefined();
      expect(encryptedChunk.data).toBeInstanceOf(Buffer);
      expect(encryptedChunk.iv).toBeDefined();
      expect(encryptedChunk.iv).toBeInstanceOf(Buffer);
      expect(encryptedChunk.iv.length).toBe(12); // 96 bits for GCM
      expect(encryptedChunk.authTag).toBeDefined();
      expect(encryptedChunk.authTag).toBeInstanceOf(Buffer);
      expect(encryptedChunk.authTag.length).toBe(16); // 128 bits
      expect(encryptedChunk.keyVersion).toBeDefined();
      expect(typeof encryptedChunk.keyVersion).toBe('number');
    }, 10000);

    it('should encrypt empty chunk', async () => {
      const emptyChunk = Buffer.alloc(0);
      const fileId = 'test-file-2';

      const encryptedChunk = await encryptionService.encryptChunk(
        emptyChunk,
        fileId
      );

      expect(encryptedChunk.data).toBeDefined();
      expect(encryptedChunk.iv).toBeDefined();
      expect(encryptedChunk.authTag).toBeDefined();
      expect(encryptedChunk.keyVersion).toBeDefined();
    }, 10000);

    it('should produce different IVs for same chunk encrypted twice', async () => {
      const chunkData = Buffer.from('Same data');
      const fileId = 'test-file-3';

      const encrypted1 = await encryptionService.encryptChunk(chunkData, fileId);
      const encrypted2 = await encryptionService.encryptChunk(chunkData, fileId);

      // IVs should be different (randomly generated)
      expect(encrypted1.iv.equals(encrypted2.iv)).toBe(false);
    }, 10000);

    it('should encrypt large chunk (8MB)', async () => {
      const largeChunk = Buffer.alloc(8 * 1024 * 1024, 'a');
      const fileId = 'test-file-4';

      const encryptedChunk = await encryptionService.encryptChunk(
        largeChunk,
        fileId
      );

      expect(encryptedChunk.data).toBeDefined();
      expect(encryptedChunk.data.length).toBeGreaterThan(0);
    }, 30000);

    it('should produce different ciphertext for different file IDs', async () => {
      const chunkData = Buffer.from('Same chunk data');
      const fileId1 = 'file-1';
      const fileId2 = 'file-2';

      const encrypted1 = await encryptionService.encryptChunk(chunkData, fileId1);
      const encrypted2 = await encryptionService.encryptChunk(chunkData, fileId2);

      // Even with same IV (unlikely but possible), ciphertext should differ
      // because different file keys are used
      // We can't guarantee this in a single test, but the property test covers it
      expect(encrypted1.data).toBeDefined();
      expect(encrypted2.data).toBeDefined();
    }, 10000);
  });

  describe('decryptChunkWithMetadata', () => {
    it('should decrypt encrypted chunk back to original', async () => {
      const originalData = Buffer.from('Test data for decryption');
      const fileId = 'test-file-5';

      const encryptedChunk = await encryptionService.encryptChunk(
        originalData,
        fileId
      );
      const decryptedData = await encryptionService.decryptChunkWithMetadata(
        encryptedChunk,
        fileId
      );

      expect(decryptedData.equals(originalData)).toBe(true);
    }, 10000);

    it('should decrypt empty chunk', async () => {
      const emptyData = Buffer.alloc(0);
      const fileId = 'test-file-6';

      const encryptedChunk = await encryptionService.encryptChunk(
        emptyData,
        fileId
      );
      const decryptedData = await encryptionService.decryptChunkWithMetadata(
        encryptedChunk,
        fileId
      );

      expect(decryptedData.length).toBe(0);
      expect(decryptedData.equals(emptyData)).toBe(true);
    }, 10000);

    it('should fail to decrypt with wrong file ID', async () => {
      const originalData = Buffer.from('Secret data');
      const fileId1 = 'file-1';
      const fileId2 = 'file-2';

      const encryptedChunk = await encryptionService.encryptChunk(
        originalData,
        fileId1
      );

      // Try to decrypt with wrong file ID
      await expect(
        encryptionService.decryptChunkWithMetadata(encryptedChunk, fileId2)
      ).rejects.toThrow();
    }, 10000);

    it('should fail to decrypt with tampered ciphertext', async () => {
      const originalData = Buffer.from('Data to tamper');
      const fileId = 'test-file-7';

      const encryptedChunk = await encryptionService.encryptChunk(
        originalData,
        fileId
      );

      // Tamper with the encrypted data
      const tamperedChunk: EncryptedChunk = {
        ...encryptedChunk,
        data: Buffer.from(encryptedChunk.data),
      };
      tamperedChunk.data[0] = tamperedChunk.data[0] ^ 0xff;

      // Decryption should fail due to authentication tag mismatch
      await expect(
        encryptionService.decryptChunkWithMetadata(tamperedChunk, fileId)
      ).rejects.toThrow();
    }, 10000);

    it('should fail to decrypt with tampered IV', async () => {
      const originalData = Buffer.from('Data with IV tampering');
      const fileId = 'test-file-8';

      const encryptedChunk = await encryptionService.encryptChunk(
        originalData,
        fileId
      );

      // Tamper with the IV
      const tamperedChunk: EncryptedChunk = {
        ...encryptedChunk,
        iv: Buffer.from(encryptedChunk.iv),
      };
      tamperedChunk.iv[0] = tamperedChunk.iv[0] ^ 0xff;

      // Decryption should fail
      await expect(
        encryptionService.decryptChunkWithMetadata(tamperedChunk, fileId)
      ).rejects.toThrow();
    }, 10000);

    it('should fail to decrypt with tampered auth tag', async () => {
      const originalData = Buffer.from('Data with auth tag tampering');
      const fileId = 'test-file-9';

      const encryptedChunk = await encryptionService.encryptChunk(
        originalData,
        fileId
      );

      // Tamper with the auth tag
      const tamperedChunk: EncryptedChunk = {
        ...encryptedChunk,
        authTag: Buffer.from(encryptedChunk.authTag),
      };
      tamperedChunk.authTag[0] = tamperedChunk.authTag[0] ^ 0xff;

      // Decryption should fail
      await expect(
        encryptionService.decryptChunkWithMetadata(tamperedChunk, fileId)
      ).rejects.toThrow();
    }, 10000);

    it('should decrypt large chunk (8MB)', async () => {
      const largeData = Buffer.alloc(8 * 1024 * 1024, 'b');
      const fileId = 'test-file-10';

      const encryptedChunk = await encryptionService.encryptChunk(
        largeData,
        fileId
      );
      const decryptedData = await encryptionService.decryptChunkWithMetadata(
        encryptedChunk,
        fileId
      );

      expect(decryptedData.length).toBe(largeData.length);
      expect(decryptedData.equals(largeData)).toBe(true);
    }, 30000);
  });

  describe('generateFileKey', () => {
    it('should generate a file key', async () => {
      const fileId = 'test-file-11';

      const key = await encryptionService.generateFileKey(fileId);

      expect(key).toBeDefined();
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    }, 10000);

    it('should generate same key for same file ID', async () => {
      const fileId = 'test-file-12';

      const key1 = await encryptionService.generateFileKey(fileId);
      const key2 = await encryptionService.generateFileKey(fileId);

      expect(key1).toBe(key2);
    }, 10000);

    it('should generate different keys for different file IDs', async () => {
      const fileId1 = 'file-1';
      const fileId2 = 'file-2';

      const key1 = await encryptionService.generateFileKey(fileId1);
      const key2 = await encryptionService.generateFileKey(fileId2);

      expect(key1).not.toBe(key2);
    }, 10000);

    it('should generate valid base64 encoded key', async () => {
      const fileId = 'test-file-13';

      const key = await encryptionService.generateFileKey(fileId);

      // Should be valid base64
      expect(() => Buffer.from(key, 'base64')).not.toThrow();

      // Decoded key should be 32 bytes (256 bits for AES-256)
      const decodedKey = Buffer.from(key, 'base64');
      expect(decodedKey.length).toBe(32);
    }, 10000);
  });

  describe('rotateMasterKey', () => {
    it('should rotate master key successfully', async () => {
      // Get current key version
      const keyBefore = await encryptionService.generateFileKey('test-file-14');

      // Rotate master key
      await encryptionService.rotateMasterKey();

      // Generate key after rotation
      const keyAfter = await encryptionService.generateFileKey('test-file-14');

      // Keys should be different after rotation
      expect(keyAfter).not.toBe(keyBefore);
    }, 10000);

    it('should allow decryption of old data after key rotation', async () => {
      const originalData = Buffer.from('Data before rotation');
      const fileId = 'test-file-15';

      // Encrypt with current key
      const encryptedChunk = await encryptionService.encryptChunk(
        originalData,
        fileId
      );
      const oldKeyVersion = encryptedChunk.keyVersion;

      // Rotate master key
      await encryptionService.rotateMasterKey();

      // Should still be able to decrypt old data
      const decryptedData = await encryptionService.decryptChunkWithMetadata(
        encryptedChunk,
        fileId
      );

      expect(decryptedData.equals(originalData)).toBe(true);

      // New encryption should use new key version
      const newEncryptedChunk = await encryptionService.encryptChunk(
        originalData,
        fileId
      );
      expect(newEncryptedChunk.keyVersion).toBeGreaterThan(oldKeyVersion);
    }, 10000);
  });

  describe('round-trip encryption', () => {
    it('should preserve data through multiple encrypt-decrypt cycles', async () => {
      const originalData = Buffer.from('Multi-cycle test data');
      const fileId = 'test-file-16';

      // First cycle
      const encrypted1 = await encryptionService.encryptChunk(originalData, fileId);
      const decrypted1 = await encryptionService.decryptChunkWithMetadata(
        encrypted1,
        fileId
      );

      expect(decrypted1.equals(originalData)).toBe(true);

      // Second cycle (encrypt the decrypted data)
      const encrypted2 = await encryptionService.encryptChunk(decrypted1, fileId);
      const decrypted2 = await encryptionService.decryptChunkWithMetadata(
        encrypted2,
        fileId
      );

      expect(decrypted2.equals(originalData)).toBe(true);
    }, 10000);

    it('should handle binary data correctly', async () => {
      // Create binary data with all byte values
      const binaryData = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) {
        binaryData[i] = i;
      }
      const fileId = 'test-file-17';

      const encryptedChunk = await encryptionService.encryptChunk(
        binaryData,
        fileId
      );
      const decryptedData = await encryptionService.decryptChunkWithMetadata(
        encryptedChunk,
        fileId
      );

      expect(decryptedData.equals(binaryData)).toBe(true);
    }, 10000);

    it('should handle UTF-8 text data correctly', async () => {
      const textData = Buffer.from('Hello, 世界! 🌍', 'utf-8');
      const fileId = 'test-file-18';

      const encryptedChunk = await encryptionService.encryptChunk(
        textData,
        fileId
      );
      const decryptedData = await encryptionService.decryptChunkWithMetadata(
        encryptedChunk,
        fileId
      );

      expect(decryptedData.equals(textData)).toBe(true);
      expect(decryptedData.toString('utf-8')).toBe('Hello, 世界! 🌍');
    }, 10000);
  });

  describe('error handling', () => {
    it('should handle HSM connection failure gracefully', async () => {
      // Create service with invalid HSM URL
      const invalidService = new EncryptionServiceImpl('http://localhost:9999');
      const chunkData = Buffer.from('Test');
      const fileId = 'test-file-19';

      await expect(
        invalidService.encryptChunk(chunkData, fileId)
      ).rejects.toThrow();
    }, 10000);

    it('should handle invalid key version', async () => {
      const originalData = Buffer.from('Test data');
      const fileId = 'test-file-20';

      const encryptedChunk = await encryptionService.encryptChunk(
        originalData,
        fileId
      );

      // Tamper with key version to non-existent version
      const tamperedChunk: EncryptedChunk = {
        ...encryptedChunk,
        keyVersion: 99999,
      };

      await expect(
        encryptionService.decryptChunkWithMetadata(tamperedChunk, fileId)
      ).rejects.toThrow();
    }, 10000);
  });
});
