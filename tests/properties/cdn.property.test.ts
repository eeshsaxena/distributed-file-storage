import * as fc from 'fast-check';
import { CDNGatewayImpl } from '../../src/cdn-gateway';
import { StorageNode } from '../../src/interfaces/storage-node.interface';

/**
 * Property-Based Tests for CDN Gateway
 *
 * Feature: distributed-file-storage
 * Tests Property 15 from the design document
 */
describe('CDN Gateway Properties', () => {
  /**
   * Property 15: Byte-range returns correct data
   *
   * For any file and any valid byte range [start, end], requesting that byte range
   * SHALL return data that is byte-for-byte identical to bytes [start, end] of the
   * original file.
   *
   * Validates: Requirements 5.6
   */
  test('Property 15: Byte-range returns correct data', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Random chunk data (1 byte to 1MB)
        fc.uint8Array({ minLength: 1, maxLength: 1024 * 1024 }),
        // Valid byte range within the chunk
        fc.nat(),
        fc.nat(),
        async (chunkData, rawStart, rawEnd) => {
          const data = Buffer.from(chunkData);
          if (data.length === 0) return;

          // Clamp to valid range
          const startByte = rawStart % data.length;
          const endByte = startByte + (rawEnd % (data.length - startByte));

          // Build mock storage node that returns the chunk
          const mockNode: jest.Mocked<StorageNode> = {
            writeChunk: jest.fn(),
            readChunk: jest.fn().mockResolvedValue(data),
            deleteChunk: jest.fn(),
            verifyChunkIntegrity: jest.fn(),
            getHealthMetrics: jest.fn(),
          };

          const cdn = new CDNGatewayImpl([mockNode]);
          const range = await cdn.getChunkRange('test-hash', startByte, endByte);

          // Verify byte-for-byte equality with original slice
          const expected = data.subarray(startByte, endByte + 1);
          expect(range.length).toBe(expected.length);
          expect(range.equals(expected)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Cache hit returns identical data to origin
   */
  test('Property: Cache hit returns identical data to origin', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 64 * 1024 }),
        fc.hexaString({ minLength: 64, maxLength: 64 }),
        async (chunkData, chunkHash) => {
          const data = Buffer.from(chunkData);

          const mockNode: jest.Mocked<StorageNode> = {
            writeChunk: jest.fn(),
            readChunk: jest.fn().mockResolvedValue(data),
            deleteChunk: jest.fn(),
            verifyChunkIntegrity: jest.fn(),
            getHealthMetrics: jest.fn(),
          };

          const cdn = new CDNGatewayImpl([mockNode]);

          // First request — cache miss
          const first = await cdn.getChunk(chunkHash, { latitude: 0, longitude: 0 });
          // Second request — cache hit
          const second = await cdn.getChunk(chunkHash, { latitude: 0, longitude: 0 });

          expect(first.equals(second)).toBe(true);
          // Storage node should only be called once
          expect(mockNode.readChunk).toHaveBeenCalledTimes(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Byte-range length equals endByte - startByte + 1
   */
  test('Property: Byte-range length is correct', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 10, maxLength: 1024 }),
        fc.nat(),
        fc.nat(),
        async (chunkData, rawStart, rawEnd) => {
          const data = Buffer.from(chunkData);
          const startByte = rawStart % data.length;
          const endByte = startByte + (rawEnd % (data.length - startByte));

          const mockNode: jest.Mocked<StorageNode> = {
            writeChunk: jest.fn(),
            readChunk: jest.fn().mockResolvedValue(data),
            deleteChunk: jest.fn(),
            verifyChunkIntegrity: jest.fn(),
            getHealthMetrics: jest.fn(),
          };

          const cdn = new CDNGatewayImpl([mockNode]);
          const range = await cdn.getChunkRange('hash', startByte, endByte);

          expect(range.length).toBe(endByte - startByte + 1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
