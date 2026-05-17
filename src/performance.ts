import { StorageNode } from './interfaces/storage-node.interface';
import { StorageNodeRecord } from './interfaces/metadata-store.interface';

/**
 * Performance Optimizations
 *
 * Task 22: Parallel chunk operations and storage node selection optimization.
 * - Parallel upload/download of up to 10 concurrent chunks
 * - Lowest-latency node selection for retrieval (Property 27)
 * - High-capacity node avoidance >80% (Property 24)
 */

export const MAX_PARALLEL_CHUNKS = 10;
export const HIGH_CAPACITY_THRESHOLD = 0.8; // 80%

/**
 * Execute up to MAX_PARALLEL_CHUNKS operations concurrently.
 * Processes all items in waves of MAX_PARALLEL_CHUNKS.
 */
export async function parallelChunkOps<T>(
  items: T[],
  operation: (item: T, index: number) => Promise<void>,
  concurrency: number = MAX_PARALLEL_CHUNKS
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    await Promise.all(batch.map((item, j) => operation(item, i + j)));
  }
}

/**
 * Select the storage node with the lowest network latency.
 * Property 27: Lowest-latency node selected for retrieval.
 * Validates: Requirements 10.3
 */
export function selectLowestLatencyNode(nodes: StorageNodeRecord[]): StorageNodeRecord {
  if (nodes.length === 0) throw new Error('No storage nodes available');
  return nodes.reduce((best, node) =>
    node.networkLatency !== undefined && best.networkLatency !== undefined
      ? node.networkLatency < best.networkLatency ? node : best
      : best
  );
}

/**
 * Filter out nodes that exceed the high-capacity threshold (>80% used).
 * Falls back to all nodes if all exceed the threshold.
 * Property 24: High-capacity nodes selected less frequently.
 * Validates: Requirements 8.5
 */
export function filterHighCapacityNodes(nodes: StorageNodeRecord[]): StorageNodeRecord[] {
  const healthy = nodes.filter(
    (n) => n.capacity > 0 && n.usedSpace / n.capacity < HIGH_CAPACITY_THRESHOLD
  );
  return healthy.length > 0 ? healthy : nodes; // fallback to all if all are high-capacity
}

/**
 * Select the best node for chunk retrieval:
 * 1. Exclude high-capacity nodes (>80%)
 * 2. Among remaining, pick lowest latency
 */
export function selectBestNode(nodes: StorageNodeRecord[]): StorageNodeRecord {
  const filtered = filterHighCapacityNodes(nodes);
  return selectLowestLatencyNode(filtered);
}
