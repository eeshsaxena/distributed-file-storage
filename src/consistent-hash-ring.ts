import { createHash } from 'crypto';
import { ConsistentHashRing } from './interfaces/consistent-hash-ring.interface';

/**
 * Consistent Hash Ring Implementation
 *
 * Uses virtual nodes to distribute chunks across storage nodes with minimal
 * data movement when nodes are added or removed.
 */
export class ConsistentHashRingImpl implements ConsistentHashRing {
  private readonly virtualNodesPerPhysical: number;
  private ring: Map<string, string>; // hash -> physical node ID
  private sortedHashes: string[];
  private physicalNodes: Set<string>;

  constructor(virtualNodesPerPhysical: number = 150) {
    this.virtualNodesPerPhysical = virtualNodesPerPhysical;
    this.ring = new Map();
    this.sortedHashes = [];
    this.physicalNodes = new Set();
  }

  /**
   * Add storage node to ring with virtual nodes
   *
   * @param nodeId - Physical node identifier
   * @param virtualNodeCount - Number of virtual nodes (defaults to 150)
   */
  addNode(nodeId: string, virtualNodeCount?: number): void {
    const count = virtualNodeCount || this.virtualNodesPerPhysical;

    // Add physical node to tracking set
    this.physicalNodes.add(nodeId);

    // Create virtual nodes
    for (let i = 0; i < count; i++) {
      const virtualNodeId = `${nodeId}:vnode:${i}`;
      const hash = this.computeHash(virtualNodeId);

      this.ring.set(hash, nodeId);
    }

    // Re-sort hash keys
    this.sortedHashes = Array.from(this.ring.keys()).sort();
  }

  /**
   * Remove storage node from ring
   *
   * @param nodeId - Physical node identifier
   */
  removeNode(nodeId: string): void {
    // Remove physical node from tracking
    this.physicalNodes.delete(nodeId);

    // Remove all virtual nodes for this physical node
    const hashesToRemove: string[] = [];

    for (const [hash, physicalId] of this.ring.entries()) {
      if (physicalId === nodeId) {
        hashesToRemove.push(hash);
      }
    }

    for (const hash of hashesToRemove) {
      this.ring.delete(hash);
    }

    // Re-sort hash keys
    this.sortedHashes = Array.from(this.ring.keys()).sort();
  }

  /**
   * Find N distinct storage nodes for a chunk hash
   * Walks clockwise around the ring to find distinct physical nodes
   *
   * @param chunkHash - SHA-256 hash of the chunk
   * @param count - Number of distinct nodes to return
   * @returns Array of distinct physical node IDs
   */
  getNodes(chunkHash: string, count: number): string[] {
    if (this.physicalNodes.size === 0) {
      return [];
    }

    if (count > this.physicalNodes.size) {
      count = this.physicalNodes.size;
    }

    const selectedNodes: string[] = [];
    const selectedSet = new Set<string>();

    // Find starting position on ring
    const startIndex = this.findStartIndex(chunkHash);

    // Walk clockwise around ring to find distinct nodes
    let currentIndex = startIndex;
    let attempts = 0;
    const maxAttempts = this.sortedHashes.length;

    while (selectedNodes.length < count && attempts < maxAttempts) {
      const hash = this.sortedHashes[currentIndex];
      const nodeId = this.ring.get(hash);

      if (nodeId && !selectedSet.has(nodeId)) {
        selectedNodes.push(nodeId);
        selectedSet.add(nodeId);
      }

      currentIndex = (currentIndex + 1) % this.sortedHashes.length;
      attempts++;
    }

    return selectedNodes;
  }

  /**
   * Find starting index on ring for a given hash
   * Uses binary search for efficiency
   *
   * @param hash - Hash to locate
   * @returns Index in sorted hash array
   */
  private findStartIndex(hash: string): number {
    if (this.sortedHashes.length === 0) {
      return 0;
    }

    // Binary search to find first hash >= target hash
    let left = 0;
    let right = this.sortedHashes.length - 1;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);

      if (this.sortedHashes[mid] < hash) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    // If all hashes are less than target, wrap around to start
    if (this.sortedHashes[left] < hash) {
      return 0;
    }

    return left;
  }

  /**
   * Compute SHA-256 hash of a string
   *
   * @param data - Data to hash
   * @returns SHA-256 hash as hex string
   */
  private computeHash(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Get total number of physical nodes
   *
   * @returns Number of physical nodes
   */
  getPhysicalNodeCount(): number {
    return this.physicalNodes.size;
  }

  /**
   * Get total number of virtual nodes
   *
   * @returns Number of virtual nodes
   */
  getVirtualNodeCount(): number {
    return this.ring.size;
  }

  /**
   * Get all physical node IDs
   *
   * @returns Array of physical node IDs
   */
  getPhysicalNodes(): string[] {
    return Array.from(this.physicalNodes);
  }

  /**
   * Check if a node exists in the ring
   *
   * @param nodeId - Physical node identifier
   * @returns True if node exists, false otherwise
   */
  hasNode(nodeId: string): boolean {
    return this.physicalNodes.has(nodeId);
  }

  /**
   * Clear all nodes from the ring
   */
  clear(): void {
    this.ring.clear();
    this.sortedHashes = [];
    this.physicalNodes.clear();
  }
}
