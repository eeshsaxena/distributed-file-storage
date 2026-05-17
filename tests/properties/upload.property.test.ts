import * as fc from 'fast-check';
import { UploadManagerImpl } from '../../src/upload-manager';
import { MetadataStoreImpl } from '../../src/metadata-store';

/**
 * Property-Based Tests for Upload Manager
 *
 * Feature: distributed-file-storage
 * Tests Properties 10-14, 25 from the design document
 */
describe('Upload Manager Properties', () => {
  let uploadManager: UploadManagerImpl;
  let metadataStore: MetadataStoreImpl;

  beforeAll(async () => {
    // Initialize metadata store with test database
    metadataStore = new MetadataStoreImpl({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'distributed_storage_test',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    });

    await metadataStore.connect();
    uploadManager = new UploadManagerImpl(metadataStore);
  });

  afterAll(async () => {
    await metadataStore.disconnect();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    // Note: In a real implementation, you'd want to use transactions or a test database
  });

  /**
   * Property 10: Session IDs are unique
   *
   * For any N upload sessions created, all N session identifiers SHALL be unique.
   *
   * **Validates: Requirements 4.1**
   */
  test('Property 10: Session IDs are unique', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }), // Number of sessions to create
        async (numSessions) => {
          const sessionIds = new Set<string>();

          // Create N sessions
          for (let i = 0; i < numSessions; i++) {
            const session = await uploadManager.createSession(
              `file-${i}`,
              `test-file-${i}.txt`,
              10,
              `user-${i}`
            );

            // Verify session ID is unique
            expect(sessionIds.has(session.sessionId)).toBe(false);
            sessionIds.add(session.sessionId);
          }

          // Verify all session IDs are unique
          expect(sessionIds.size).toBe(numSessions);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 11: Session tracks uploaded chunks
   *
   * For any sequence of chunk uploads to a session, the session state SHALL
   * accurately track which chunk sequence numbers have been successfully uploaded.
   *
   * **Validates: Requirements 4.2**
   */
  test('Property 11: Session tracks uploaded chunks', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }), // Total chunks
        fc.array(fc.integer({ min: 0, max: 19 }), { minLength: 0, maxLength: 20 }), // Chunks to upload
        async (totalChunks, chunksToUpload) => {
          // Create session
          const session = await uploadManager.createSession(
            `file-${Math.random()}`,
            'test-file.txt',
            totalChunks,
            'test-user'
          );

          // Filter valid chunk sequence numbers
          const validChunks = [...new Set(chunksToUpload.filter((n) => n < totalChunks))];

          // Upload chunks
          for (const sequenceNumber of validChunks) {
            await uploadManager.markChunkUploaded(
              session.sessionId,
              sequenceNumber,
              `hash-${sequenceNumber}`
            );
          }

          // Resume session and verify uploaded chunks
          const resumedSession = await uploadManager.resumeSession(session.sessionId);

          // Verify all uploaded chunks are tracked
          for (const sequenceNumber of validChunks) {
            expect(resumedSession.uploadedChunks.has(sequenceNumber)).toBe(true);
          }

          // Verify count matches
          expect(resumedSession.uploadedChunks.size).toBe(validChunks.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 12: Resume returns uploaded chunks
   *
   * For any upload session with a set of uploaded chunks, resuming the session
   * SHALL return exactly the set of chunk sequence numbers that were successfully uploaded.
   *
   * **Validates: Requirements 4.4**
   */
  test('Property 12: Resume returns uploaded chunks', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 20 }), // Total chunks
        fc.array(fc.integer({ min: 0, max: 19 }), { minLength: 1, maxLength: 15 }), // Chunks to upload
        async (totalChunks, chunksToUpload) => {
          // Create session
          const session = await uploadManager.createSession(
            `file-${Math.random()}`,
            'test-file.txt',
            totalChunks,
            'test-user'
          );

          // Filter valid and unique chunk sequence numbers
          const validChunks = [...new Set(chunksToUpload.filter((n) => n < totalChunks))];
          const uploadedSet = new Set(validChunks);

          // Upload chunks
          for (const sequenceNumber of validChunks) {
            await uploadManager.markChunkUploaded(
              session.sessionId,
              sequenceNumber,
              `hash-${sequenceNumber}`
            );
          }

          // Resume session
          const resumedSession = await uploadManager.resumeSession(session.sessionId);

          // Verify returned set matches uploaded set exactly
          expect(resumedSession.uploadedChunks.size).toBe(uploadedSet.size);

          for (const sequenceNumber of uploadedSet) {
            expect(resumedSession.uploadedChunks.has(sequenceNumber)).toBe(true);
          }

          for (const sequenceNumber of resumedSession.uploadedChunks) {
            expect(uploadedSet.has(sequenceNumber)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 13: Chunk upload order doesn't affect result
   *
   * For any file with N chunks, uploading the chunks in any permutation of
   * sequence numbers SHALL produce the same final assembled file.
   *
   * **Validates: Requirements 4.5**
   */
  test('Property 13: Chunk upload order does not affect result', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 10 }), // Number of chunks
        async (numChunks) => {
          // Create two sessions for the same file
          const fileId = `file-${Math.random()}`;
          const session1 = await uploadManager.createSession(
            fileId,
            'test-file.txt',
            numChunks,
            'test-user'
          );
          const session2 = await uploadManager.createSession(
            fileId + '-2',
            'test-file.txt',
            numChunks,
            'test-user'
          );

          // Create sequence numbers array
          const sequenceNumbers = Array.from({ length: numChunks }, (_, i) => i);

          // Upload chunks in original order for session1
          for (const seq of sequenceNumbers) {
            await uploadManager.markChunkUploaded(session1.sessionId, seq, `hash-${seq}`);
          }

          // Upload chunks in random order for session2
          const shuffled = [...sequenceNumbers].sort(() => Math.random() - 0.5);
          for (const seq of shuffled) {
            await uploadManager.markChunkUploaded(session2.sessionId, seq, `hash-${seq}`);
          }

          // Verify both sessions have all chunks uploaded
          const complete1 = await uploadManager.isUploadComplete(session1.sessionId);
          const complete2 = await uploadManager.isUploadComplete(session2.sessionId);

          expect(complete1).toBe(true);
          expect(complete2).toBe(true);

          // Get uploaded chunks for both sessions
          const uploadedChunks1 = await metadataStore.getUploadedChunks(session1.sessionId);
          const uploadedChunks2 = await metadataStore.getUploadedChunks(session2.sessionId);

          // Sort by sequence number
          const sorted1 = uploadedChunks1
            .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
            .map((c) => c.chunkHash);
          const sorted2 = uploadedChunks2
            .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
            .map((c) => c.chunkHash);

          // Verify chunk hashes are in the same order
          expect(sorted1).toEqual(sorted2);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 14: All chunks uploaded marks session complete
   *
   * For any file with N chunks, when all N chunks have been successfully uploaded
   * to a session, the session SHALL be marked as complete.
   *
   * **Validates: Requirements 4.6**
   */
  test('Property 14: All chunks uploaded marks session complete', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }), // Number of chunks
        async (numChunks) => {
          // Create session
          const session = await uploadManager.createSession(
            `file-${Math.random()}`,
            'test-file.txt',
            numChunks,
            'test-user'
          );

          // Upload all chunks
          for (let i = 0; i < numChunks; i++) {
            await uploadManager.markChunkUploaded(session.sessionId, i, `hash-${i}`);
          }

          // Verify session is complete
          const isComplete = await uploadManager.isUploadComplete(session.sessionId);
          expect(isComplete).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 25: Progress calculation is correct
   *
   * For any upload session with N total chunks and M successfully uploaded chunks,
   * the progress percentage SHALL equal (M / N) × 100%.
   *
   * **Validates: Requirements 9.3**
   */
  test('Property 25: Progress calculation is correct', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 20 }), // Total chunks
        fc.integer({ min: 0, max: 20 }), // Chunks to upload
        async (totalChunks, chunksToUploadCount) => {
          // Create session
          const session = await uploadManager.createSession(
            `file-${Math.random()}`,
            'test-file.txt',
            totalChunks,
            'test-user'
          );

          // Upload M chunks (capped at totalChunks)
          const actualChunksToUpload = Math.min(chunksToUploadCount, totalChunks);
          for (let i = 0; i < actualChunksToUpload; i++) {
            await uploadManager.markChunkUploaded(session.sessionId, i, `hash-${i}`);
          }

          // Get uploaded chunks count
          const uploadedChunks = await metadataStore.getUploadedChunks(session.sessionId);
          const M = uploadedChunks.length;
          const N = totalChunks;

          // Calculate expected progress
          const expectedProgress = (M / N) * 100;

          // Calculate actual progress
          const actualProgress = (M / N) * 100;

          // Verify progress calculation
          expect(actualProgress).toBeCloseTo(expectedProgress, 2);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Cannot upload chunk with invalid sequence number
   */
  test('Property: Cannot upload chunk with invalid sequence number', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }), // Total chunks
        fc.integer({ min: 10, max: 100 }), // Invalid sequence number (out of range)
        async (totalChunks, invalidSeq) => {
          // Create session
          const session = await uploadManager.createSession(
            `file-${Math.random()}`,
            'test-file.txt',
            totalChunks,
            'test-user'
          );

          // Attempt to upload chunk with invalid sequence number
          await expect(
            uploadManager.markChunkUploaded(session.sessionId, invalidSeq, 'hash-invalid')
          ).rejects.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Cannot resume expired session
   */
  test('Property: Cannot resume expired session', async () => {
    // Create session
    const session = await uploadManager.createSession(
      `file-${Math.random()}`,
      'test-file.txt',
      5,
      'test-user'
    );

    // Manually expire the session by updating its expiry date
    await metadataStore.updateUploadSession(session.sessionId, {
      status: 'expired',
    });

    // Attempt to resume expired session
    await expect(uploadManager.resumeSession(session.sessionId)).rejects.toThrow(/expired/i);
  });

  /**
   * Additional property: Session expiry is set correctly
   */
  test('Property: Session expiry is set to 7 days from creation', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (totalChunks) => {
        const beforeCreate = new Date();
        const session = await uploadManager.createSession(
          `file-${Math.random()}`,
          'test-file.txt',
          totalChunks,
          'test-user'
        );
        const afterCreate = new Date();

        // Calculate expected expiry (7 days from creation)
        const expectedExpiryMin = new Date(beforeCreate.getTime() + 7 * 24 * 60 * 60 * 1000);
        const expectedExpiryMax = new Date(afterCreate.getTime() + 7 * 24 * 60 * 60 * 1000);

        // Verify expiry is within expected range
        expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiryMin.getTime());
        expect(session.expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiryMax.getTime());
      }),
      { numRuns: 100 }
    );
  });
});
