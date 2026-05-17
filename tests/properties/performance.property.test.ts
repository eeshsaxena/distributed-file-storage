import * as fc from 'fast-check';
import { validateHash } from '../../src/error-handling';
import crypto from 'crypto';

/**
 * Property-Based Tests for Performance / Hash Validation
 *
 * Feature: distributed-file-storage
 * Tests Property 26 from the design document
 */
describe('Performance and Hash Validation Properties', () => {
  /**
   * Property 26: Hash validation detects mismatches
   *
   * For any chunk with a computed content hash, if the data produces a different
   * hash, the validation SHALL fail and report the mismatch.
   *
   * Validates: Requirements 9.5, 10.5, 15.2
   */
  test('Property 26: Hash validation detects mismatches', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 64 * 1024 }),
        fc.integer({ min: 0, max: 255 }),
        async (chunkData, tamperByte) => {
          const data = Buffer.from(chunkData);
          const correctHash = crypto.createHash('sha256').update(data).digest('hex');

          // Correct hash should validate
          expect(validateHash(data, correctHash)).toBe(true);

          // Tamper with data
          const tampered = Buffer.from(data);
          tampered[0] = tamperByte;

          if (tampered[0] !== data[0]) {
            // Modified data should fail validation
            expect(validateHash(tampered, correctHash)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Correct hash always validates
   */
  test('Property: Correct hash always validates', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 64 * 1024 }),
        async (chunkData) => {
          const data = Buffer.from(chunkData);
          const hash = crypto.createHash('sha256').update(data).digest('hex');

          expect(validateHash(data, hash)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Wrong hash always fails
   */
  test('Property: Wrong hash always fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 1024 }),
        fc.hexaString({ minLength: 64, maxLength: 64 }),
        async (chunkData, randomHash) => {
          const data = Buffer.from(chunkData);
          const correctHash = crypto.createHash('sha256').update(data).digest('hex');

          fc.pre(randomHash !== correctHash);

          expect(validateHash(data, randomHash)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
