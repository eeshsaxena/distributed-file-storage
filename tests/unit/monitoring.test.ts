import { MonitoringService } from '../../src/monitoring';
import { MetadataStore, StorageNodeRecord } from '../../src/interfaces/metadata-store.interface';

describe('MonitoringService', () => {
  let mockStore: jest.Mocked<Pick<MetadataStore, 'listStorageNodes'>>;
  let monitoring: MonitoringService;

  const makeNode = (capacity: number, usedSpace: number, status: 'active' | 'offline' = 'active'): StorageNodeRecord => ({
    nodeId: 'node-1',
    ipAddress: '127.0.0.1',
    port: 8080,
    availabilityZone: 'us-east-1a',
    region: 'us-east-1',
    capacity,
    usedSpace,
    status,
    registeredAt: new Date(),
    lastHeartbeat: new Date(),
  });

  beforeEach(() => {
    mockStore = { listStorageNodes: jest.fn() };
    monitoring = new MonitoringService(mockStore as unknown as MetadataStore);
  });

  describe('getStorageCapacity', () => {
    it('sums capacity and used space across nodes', async () => {
      mockStore.listStorageNodes.mockResolvedValue([
        makeNode(1000, 400),
        makeNode(2000, 600),
      ]);

      const cap = await monitoring.getStorageCapacity();

      expect(cap.totalCapacity).toBe(3000);
      expect(cap.usedCapacity).toBe(1000);
      expect(cap.availableCapacity).toBe(2000);
    });

    it('returns zeros when no nodes exist', async () => {
      mockStore.listStorageNodes.mockResolvedValue([]);

      const cap = await monitoring.getStorageCapacity();

      expect(cap.totalCapacity).toBe(0);
      expect(cap.usedCapacity).toBe(0);
      expect(cap.availableCapacity).toBe(0);
    });
  });

  describe('getDeduplicationRatio', () => {
    it('returns 1.0 for empty chunk list', async () => {
      const ratio = await monitoring.getDeduplicationRatio([]);
      expect(ratio).toBe(1.0);
    });

    it('returns 1.0 when all chunks have refCount 1', async () => {
      const ratio = await monitoring.getDeduplicationRatio([
        { size: 1000, referenceCount: 1 },
        { size: 2000, referenceCount: 1 },
      ]);
      expect(ratio).toBe(1.0);
    });

    it('calculates correct ratio with deduplication', async () => {
      // Physical: 1000, Logical: 1000*3 = 3000, Ratio: 3.0
      const ratio = await monitoring.getDeduplicationRatio([
        { size: 1000, referenceCount: 3 },
      ]);
      expect(ratio).toBe(3.0);
    });
  });

  describe('getReplicationOverhead', () => {
    it('returns overhead equal to replication factor', async () => {
      const result = await monitoring.getReplicationOverhead(
        [{ size: 1000 }, { size: 2000 }],
        3
      );
      expect(result.uniqueStorage).toBe(3000);
      expect(result.replicatedStorage).toBe(9000);
      expect(result.overhead).toBe(3);
    });

    it('handles empty chunk list', async () => {
      const result = await monitoring.getReplicationOverhead([], 3);
      expect(result.uniqueStorage).toBe(0);
      expect(result.replicatedStorage).toBe(0);
    });
  });
});
