import * as fc from 'fast-check';
import { EncryptionServiceImpl } from '../../src/encryption-service';
import { EncryptedChunk } from '../../src/interfaces/encryption-service.interface';

/**
 * Property-Based Tests for Encryption Service
 *
 * Feature: distributed-file-storage
 * Tests Properties 16-17 from the design document
 */
describe('Encryption Service Properties', () => {
  let encryptionService: EncryptionServiceImpl;

  beforeAll(() => {
    // Use mock HSM service (should be running on localhost:3001)
    encryptionService = new EncryptionServiceImpl('http://localhost:3001');
  });

  /**
   * Property 16: Different files get different encryption keys
   *
   * For any two distinct file identifiers, the derived encryption keys SHALL be different.
   *
   * **Validates: Requirements 6.2**
   */
  test('Property 16: Different files get different encryption keys', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // First file ID
        fc.uuid(), // Second file ID
        async (fileId1, fileId2) => {
          // Skip if file IDs are the same
          fc.pre(fileId1 !== fileId2);

          // Generate keys for both files
          const key1 = await encryptionService.generateFileKey(fileId1);
          const key2 = await encryptionService.generateFileKey(fileId2);

          // Keys must be different for different file IDs
          expect(key1).not.toBe(key2);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000); // Increase timeout for network calls

  /**
   * Property 17: Encrypt-decrypt round-trip preserves chunk
   *
   * For any chunk, encrypting the chunk and then decrypting it SHALL produce
   * data that is byte-for-byte identical to the original chunk.
   *
   * **Validates: Requirements 6.4**
   */
  test('Property 17: Encrypt-decrypt round-trip preserves chunk', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 10 * 1024 * 1024 }), // Random chunk up to 10MB
        fc.uuid(), // File ID
        async (chunkData, fileId) => {
          const originalChunk = Buffer.from(chunkData);

          // Encrypt the chunk
          const encryptedChunk = await encryptionService.encryptChunk(
            originalChunk,
            fileId
          );

          // Verify encrypted chunk has required fields
          expect(encryptedChunk.data).toBeDefined();
          expect(encryptedChunk.iv).toBeDefined();
          expect(encryptedChunk.authTag).toBeDefined();
          expect(encryptedChunk.keyVersion).toBeDefined();

          // Decrypt the chunk
          const decryptedChunk =
            await encryptionService.decryptChunkWithMetadata(
              encryptedChunk,
              fileId
            );

          // Verify byte-for-byte equality
          expect(decryptedChunk.length).toBe(originalChunk.length);
          expect(decryptedChunk.equals(originalChunk)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000); // Increase timeout for network calls

  /**
   * Additional property: Same file ID produces same key
   */
  test('Property: Same file ID produces same key', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (fileId) => {
        // Generate key twice for the same file ID
        const key1 = await encryptionService.generateFileKey(fileId);
        const key2 = await encryptionService.generateFileKey(fileId);

        // Keys must be identical for the same file ID
        expect(key1).toBe(key2);
      }),
      { numRuns: 100 }
    );
  }, 60000);

  /**
   * Additional property: Encrypted data is different from original
   */
  test('Property: Encrypted data is different from original (for non-empty chunks)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 1024 * 1024 }), // Non-empty chunks
        fc.uuid(),
        async (chunkData, fileId) => {
          const originalChunk = Buffer.from(chunkData);

          // Encrypt the chunk
          const encryptedChunk = await encryptionService.encryptChunk(
            originalChunk,
            fileId
          );

          // Encrypted data should be different from original
          // (unless by extreme coincidence, which is cryptographically negligible)
          expect(encryptedChunk.data.equals(originalChunk)).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  }, 60000);

  /**
   * Additional property: Different IVs produce different ciphertexts
   */
  test('Property: Same chunk encrypted twice produces different ciphertexts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 1024 * 1024 }),
        fc.uuid(),
        async (chunkData, fileId) => {
          const originalChunk = Buffer.from(chunkData);

          // Encrypt the same chunk twice
          const encrypted1 = await encryptionService.encryptChunk(
            originalChunk,
            fileId
          );
          const encrypted2 = await encryptionService.encryptChunk(
            originalChunk,
            fileId
          );

          // IVs should be different (randomly generated)
          expect(encrypted1.iv.equals(encrypted2.iv)).toBe(false);

          // Ciphertexts should be different due to different IVs
          expect(encrypted1.data.equals(encrypted2.data)).toBe(false);

          // But both should decrypt to the same original data
          const decrypted1 = await encryptionService.decryptChunkWithMetadata(
            encrypted1,
            fileId
          );
          const decrypted2 = await encryptionService.decryptChunkWithMetadata(
            encrypted2,
            fileId
          );

          expect(decrypted1.equals(originalChunk)).toBe(true);
          expect(decrypted2.equals(originalChunk)).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  }, 60000);

  /**
   * Additional property: Encryption with wrong file ID fails decryption
   */
  test('Property: Decryption with wrong file ID fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 1024 * 1024 }),
        fc.uuid(),
        fc.uuid(),
        async (chunkData, fileId1, fileId2) => {
          // Skip if file IDs are the same
          fc.pre(fileId1 !== fileId2);

          const originalChunk = Buffer.from(chunkData);

          // Encrypt with fileId1
          const encryptedChunk = await encryptionService.encryptChunk(
            originalChunk,
            fileId1
          );

          // Try to decrypt with fileId2 (wrong file ID)
          // This should fail because the derived key will be different
          await expect(
            encryptionService.decryptChunkWithMetadata(encryptedChunk, fileId2)
          ).rejects.toThrow();
        }
      ),
      { numRuns: 50 }
    );
  }, 60000);

  /**
   * Additional property: Tampering with ciphertext fails authentication
   */
  test('Property: Tampering with encrypted data fails authentication', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 10, maxLength: 1024 * 1024 }),
        fc.uuid(),
        fc.integer({ min: 0, max: 255 }),
        async (chunkData, fileId, tamperByte) => {
          const originalChunk = Buffer.from(chunkData);

          // Encrypt the chunk
          const encryptedChunk = await encryptionService.encryptChunk(
            originalChunk,
            fileId
          );

          // Tamper with the encrypted data
          const tamperedChunk: EncryptedChunk = {
            ...encryptedChunk,
            data: Buffer.from(encryptedChunk.data),
          };

          // Modify first byte if possible
          if (tamperedChunk.data.length > 0) {
            tamperedChunk.data[0] = tamperByte;

            // Only expect failure if we actually changed the byte
            if (tamperedChunk.data[0] !== encryptedChunk.data[0]) {
              // Decryption should fail due to authentication tag mismatch
              await expect(
                encryptionService.decryptChunkWithMetadata(tamperedChunk, fileId)
              ).rejects.toThrow();
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  }, 60000);

  /**
   * Additional property: Empty chunk encryption works
   */
  test('Property: Empty chunk can be encrypted and decrypted', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (fileId) => {
        const emptyChunk = Buffer.alloc(0);

        // Encrypt empty chunk
        const encryptedChunk = await encryptionService.encryptChunk(
          emptyChunk,
          fileId
        );

        // Decrypt empty chunk
        const decryptedChunk = await encryptionService.decryptChunkWithMetadata(
          encryptedChunk,
          fileId
        );

        // Should get back empty chunk
        expect(decryptedChunk.length).toBe(0);
        expect(decryptedChunk.equals(emptyChunk)).toBe(true);
      }),
      { numRuns: 50 }
    );
  }, 60000);
});
