import * as fc from 'fast-check';
import { MonitoringService } from '../../src/monitoring';
import { MetadataStore, StorageNodeRecord } from '../../src/interfaces/metadata-store.interface';

/**
 * Property-Based Tests for Monitoring
 *
 * Feature: distributed-file-storage
 * Tests Properties 31, 32, 33 from the design document
 */
describe('Monitoring Properties', () => {
  let mockStore: jest.Mocked<Pick<MetadataStore, 'listStorageNodes'>>;
  let monitoring: MonitoringService;

  beforeEach(() => {
    mockStore = { listStorageNodes: jest.fn() };
    monitoring = new MonitoringService(mockStore as unknown as MetadataStore);
  });

  const makeNode = (capacity: number, usedSpace: number): StorageNodeRecord => ({
    nodeId: Math.random().toString(36).slice(2),
    ipAddress: '127.0.0.1',
    port: 8080,
    availabilityZone: 'us-east-1a',
    region: 'us-east-1',
    capacity,
    usedSpace,
    status: 'active',
    registeredAt: new Date(),
    lastHeartbeat: new Date(),
  });

  /**
   * Property 31: Capacity calculation is correct
   * total = sum of node capacities, available = total - used
   * Validates: Requirements 14.1
   */
  test('Property 31: Capacity calculation is correct', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            capacity: fc.integer({ min: 1_000_000, max: 1_000_000_000 }),
            used: fc.integer({ min: 0, max: 999_999 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (nodeData) => {
          const nodes = nodeData.map((n) => makeNode(n.capacity, n.used));
          mockStore.listStorageNodes.mockResolvedValue(nodes);

          const capacity = await monitoring.getStorageCapacity();

          const expectedTotal = nodeData.reduce((s, n) => s + n.capacity, 0);
          const expectedUsed = nodeData.reduce((s, n) => s + n.used, 0);

          expect(capacity.totalCapacity).toBe(expectedTotal);
          expect(capacity.usedCapacity).toBe(expectedUsed);
          expect(capacity.availableCapacity).toBe(expectedTotal - expectedUsed);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 32: Deduplication ratio formula is correct
   * ratio = logical size / physical size
   * Validates: Requirements 14.2
   */
  test('Property 32: Deduplication ratio formula is correct', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            size: fc.integer({ min: 1, max: 10_000 }),
            referenceCount: fc.integer({ min: 1, max: 20 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        async (chunks) => {
          const ratio = await monitoring.getDeduplicationRatio(chunks);

          const physical = chunks.reduce((s, c) => s + c.size, 0);
          const logical = chunks.reduce((s, c) => s + c.size * c.referenceCount, 0);
          const expected = logical / physical;

          expect(Math.abs(ratio - expected)).toBeLessThan(0.0001);
          // Ratio is always >= 1.0 (logical >= physical when refCount >= 1)
          expect(ratio).toBeGreaterThanOrEqual(1.0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 33: Replication overhead formula is correct
   * overhead = replicatedStorage / uniqueStorage = R
   * Validates: Requirements 14.3
   */
  test('Property 33: Replication overhead formula is correct', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ size: fc.integer({ min: 1, max: 10_000 }) }),
          { minLength: 1, maxLength: 20 }
        ),
        fc.integer({ min: 1, max: 5 }), // replication factor
        async (chunks, R) => {
          const result = await monitoring.getReplicationOverhead(chunks, R);

          const uniqueStorage = chunks.reduce((s, c) => s + c.size, 0);
          expect(result.uniqueStorage).toBe(uniqueStorage);
          expect(result.replicatedStorage).toBe(uniqueStorage * R);
          expect(result.overhead).toBe(R);
        }
      ),
      { numRuns: 100 }
    );
  });
});
