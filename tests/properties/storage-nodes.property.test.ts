import * as fc from 'fast-check';
import {
  selectLowestLatencyNode,
  filterHighCapacityNodes,
  selectBestNode,
  HIGH_CAPACITY_THRESHOLD,
} from '../../src/performance';
import { StorageNodeRecord } from '../../src/interfaces/metadata-store.interface';

/**
 * Property-Based Tests for Storage Node Selection
 *
 * Feature: distributed-file-storage
 * Tests Properties 23, 24, 27 from the design document
 */
describe('Storage Node Selection Properties', () => {
  const makeNode = (
    nodeId: string,
    networkLatency: number,
    capacity: number,
    usedSpace: number,
    availabilityZone = 'us-east-1a'
  ): StorageNodeRecord => ({
    nodeId,
    ipAddress: '127.0.0.1',
    port: 8080,
    availabilityZone,
    region: 'us-east-1',
    capacity,
    usedSpace,
    networkLatency,
    status: 'active',
    registeredAt: new Date(),
    lastHeartbeat: new Date(),
  });

  /**
   * Property 27: Lowest-latency node selected for retrieval
   *
   * For any set of storage nodes with different latencies, when selecting a node
   * for chunk retrieval, the selected node SHALL have the minimum latency.
   *
   * Validates: Requirements 10.3
   */
  test('Property 27: Lowest-latency node selected for retrieval', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            latency: fc.integer({ min: 1, max: 1000 }),
            capacity: fc.integer({ min: 1_000_000, max: 1_000_000_000 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (nodeData) => {
          const nodes = nodeData.map((n, i) =>
            makeNode(`node-${i}`, n.latency, n.capacity, 0)
          );

          const selected = selectLowestLatencyNode(nodes);
          const minLatency = Math.min(...nodes.map((n) => n.networkLatency!));

          expect(selected.networkLatency).toBe(minLatency);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 24: High-capacity nodes selected less frequently
   *
   * For any node selection where some nodes exceed 80% capacity, those
   * high-capacity nodes SHALL be excluded when lower-capacity nodes exist.
   *
   * Validates: Requirements 8.5
   */
  test('Property 24: High-capacity nodes are filtered out when alternatives exist', () => {
    fc.assert(
      fc.property(
        // At least one healthy node (used < 80%)
        fc.array(
          fc.record({
            capacity: fc.integer({ min: 1_000_000, max: 1_000_000_000 }),
            usedBasisPoints: fc.integer({ min: 0, max: 7900 }), // 0–79% in basis points
          }),
          { minLength: 1, maxLength: 5 }
        ),
        // Some high-capacity nodes (used > 80%)
        fc.array(
          fc.record({
            capacity: fc.integer({ min: 1_000_000, max: 1_000_000_000 }),
            usedBasisPoints: fc.integer({ min: 8100, max: 10000 }), // 81–100%
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (healthyData, highCapData) => {
          const healthyNodes = healthyData.map((n, i) =>
            makeNode(`healthy-${i}`, 10, n.capacity, Math.floor(n.capacity * n.usedBasisPoints / 10000))
          );
          const highCapNodes = highCapData.map((n, i) =>
            makeNode(`highcap-${i}`, 5, n.capacity, Math.floor(n.capacity * n.usedBasisPoints / 10000))
          );

          const allNodes = [...healthyNodes, ...highCapNodes];
          const filtered = filterHighCapacityNodes(allNodes);

          // All filtered nodes should be below threshold
          for (const node of filtered) {
            const utilization = node.usedSpace / node.capacity;
            expect(utilization).toBeLessThan(HIGH_CAPACITY_THRESHOLD);
          }

          // No high-capacity nodes should be in the filtered list
          const highCapIds = new Set(highCapNodes.map((n) => n.nodeId));
          for (const node of filtered) {
            expect(highCapIds.has(node.nodeId)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: selectBestNode always returns a node
   */
  test('Property: selectBestNode always returns a valid node', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            latency: fc.integer({ min: 1, max: 500 }),
            capacity: fc.integer({ min: 1_000_000, max: 1_000_000_000 }),
            usedBasisPoints: fc.integer({ min: 0, max: 10000 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (nodeData) => {
          const nodes = nodeData.map((n, i) =>
            makeNode(`node-${i}`, n.latency, n.capacity, Math.floor(n.capacity * n.usedBasisPoints / 10000))
          );

          // Should always return a node without throwing
          const selected = selectBestNode(nodes);
          expect(selected).toBeDefined();
          expect(selected.nodeId).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Falls back to all nodes when all exceed capacity
   */
  test('Property: Falls back to all nodes when all exceed 80% capacity', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            capacity: fc.integer({ min: 1_000_000, max: 1_000_000_000 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (nodeData) => {
          // All nodes at 90% capacity (9000 basis points)
          const nodes = nodeData.map((n, i) =>
            makeNode(`node-${i}`, 10, n.capacity, Math.floor(n.capacity * 0.9))
          );

          const filtered = filterHighCapacityNodes(nodes);

          // Should fall back to all nodes
          expect(filtered.length).toBe(nodes.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
