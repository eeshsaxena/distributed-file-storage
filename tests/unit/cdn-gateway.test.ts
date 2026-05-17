import { CDNGatewayImpl } from '../../src/cdn-gateway';
import { StorageNode } from '../../src/interfaces/storage-node.interface';

describe('CDNGateway', () => {
  let mockNode: jest.Mocked<StorageNode>;
  let cdn: CDNGatewayImpl;

  beforeEach(() => {
    mockNode = {
      writeChunk: jest.fn(),
      readChunk: jest.fn(),
      deleteChunk: jest.fn(),
      verifyChunkIntegrity: jest.fn(),
      getHealthMetrics: jest.fn(),
    } as jest.Mocked<StorageNode>;

    cdn = new CDNGatewayImpl([mockNode]);
  });

  // ─── getChunk ─────────────────────────────────────────────────────────────

  describe('getChunk', () => {
    it('fetches chunk from storage node on cache miss', async () => {
      const data = Buffer.from('chunk data');
      mockNode.readChunk.mockResolvedValue(data);

      const result = await cdn.getChunk('hash-1', { latitude: 0, longitude: 0 });

      expect(result).toEqual(data);
      expect(mockNode.readChunk).toHaveBeenCalledWith('hash-1');
    });

    it('serves from cache on second request (no storage node call)', async () => {
      const data = Buffer.from('cached chunk');
      mockNode.readChunk.mockResolvedValue(data);

      await cdn.getChunk('hash-2', { latitude: 0, longitude: 0 });
      await cdn.getChunk('hash-2', { latitude: 0, longitude: 0 });

      expect(mockNode.readChunk).toHaveBeenCalledTimes(1);
    });

    it('throws when no storage nodes are available', async () => {
      const emptyCdn = new CDNGatewayImpl([]);

      await expect(
        emptyCdn.getChunk('hash-1', { latitude: 0, longitude: 0 })
      ).rejects.toThrow(/no storage nodes/i);
    });
  });

  // ─── invalidateCache ──────────────────────────────────────────────────────

  describe('invalidateCache', () => {
    it('removes cached chunks for the specified file version', async () => {
      const data = Buffer.from('data');
      mockNode.readChunk.mockResolvedValue(data);

      // Prime the cache
      await cdn.getChunk('hash-a', { latitude: 0, longitude: 0 });

      // Register the file version → chunk mapping
      cdn.registerFileVersion('file-1', 1, ['hash-a']);

      // Invalidate
      await cdn.invalidateCache('file-1', 1);

      // Next request should hit storage node again
      await cdn.getChunk('hash-a', { latitude: 0, longitude: 0 });

      expect(mockNode.readChunk).toHaveBeenCalledTimes(2);
    });

    it('does nothing when file version has no registered chunks', async () => {
      await expect(cdn.invalidateCache('unknown-file', 99)).resolves.not.toThrow();
    });
  });

  // ─── getChunkRange ────────────────────────────────────────────────────────

  describe('getChunkRange', () => {
    it('returns the correct byte range', async () => {
      const data = Buffer.from('Hello, World!'); // 13 bytes
      mockNode.readChunk.mockResolvedValue(data);

      const range = await cdn.getChunkRange('hash-r', 7, 11);

      expect(range.toString()).toBe('World');
    });

    it('returns single byte when startByte === endByte', async () => {
      const data = Buffer.from('ABCDE');
      mockNode.readChunk.mockResolvedValue(data);

      const range = await cdn.getChunkRange('hash-r2', 2, 2);

      expect(range.length).toBe(1);
      expect(range[0]).toBe('C'.charCodeAt(0));
    });

    it('throws when startByte is negative', async () => {
      const data = Buffer.from('data');
      mockNode.readChunk.mockResolvedValue(data);

      await expect(cdn.getChunkRange('hash-r3', -1, 2)).rejects.toThrow(/startByte/i);
    });

    it('throws when endByte < startByte', async () => {
      const data = Buffer.from('data');
      mockNode.readChunk.mockResolvedValue(data);

      await expect(cdn.getChunkRange('hash-r4', 5, 3)).rejects.toThrow(/endByte/i);
    });

    it('throws when endByte exceeds chunk length', async () => {
      const data = Buffer.from('short'); // 5 bytes
      mockNode.readChunk.mockResolvedValue(data);

      await expect(cdn.getChunkRange('hash-r5', 0, 10)).rejects.toThrow(/endByte/i);
    });
  });

  // ─── getCacheStats ────────────────────────────────────────────────────────

  describe('getCacheStats', () => {
    it('returns cache statistics object with required fields', async () => {
      const stats = await cdn.getCacheStats('us-east-1');

      expect(stats).toHaveProperty('hitRate');
      expect(stats).toHaveProperty('missRate');
      expect(stats).toHaveProperty('evictionRate');
      expect(stats).toHaveProperty('averageLatency');
    });

    it('hitRate is between 0 and 1', async () => {
      const stats = await cdn.getCacheStats('us-east-1');

      expect(stats.hitRate).toBeGreaterThanOrEqual(0);
      expect(stats.hitRate).toBeLessThanOrEqual(1);
    });
  });
});
