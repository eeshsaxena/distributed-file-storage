/**
 * Consistent Hash Ring Interface
 *
 * Distributes chunks across storage nodes using consistent hashing.
 */

export interface ConsistentHashRing {
  /**
   * Add storage node to ring with virtual nodes
   * @param nodeId - Node identifier
   * @param virtualNodeCount - Number of virtual nodes (default: 150)
   */
  addNode(nodeId: string, virtualNodeCount: number): void;

  /**
   * Remove storage node from ring
   * @param nodeId - Node identifier
   */
  removeNode(nodeId: string): void;

  /**
   * Find N storage nodes for a chunk hash
   * @param chunkHash - SHA-256 hash of the chunk
   * @param count - Number of nodes to return
   * @returns Array of node identifiers
   */
  getNodes(chunkHash: string, count: number): string[];
}
