/**
 * Replication Service Interface
 *
 * Maintains multiple replicas of chunks across storage nodes.
 */

export interface ReplicationService {
  /**
   * Replicate chunk to 3 storage nodes
   * @param chunkHash - SHA-256 hash of the chunk
   * @param chunkData - Chunk data to replicate
   * @returns Array of replica locations
   */
  replicateChunk(chunkHash: string, chunkData: Buffer): Promise<ReplicaLocation[]>;

  /**
   * Check replica health and trigger re-replication if needed
   * @param chunkHash - SHA-256 hash of the chunk
   * @returns Replica health information
   */
  verifyReplicas(chunkHash: string): Promise<ReplicaHealth>;

  /**
   * Select optimal storage nodes for new chunk
   * @param chunkHash - SHA-256 hash of the chunk
   * @param count - Number of nodes to select
   * @returns Array of selected storage nodes
   */
  selectStorageNodes(chunkHash: string, count: number): Promise<StorageNodeInfo[]>;

  /**
   * Re-replicate chunk when replica count drops below threshold
   * @param chunkHash - SHA-256 hash of the chunk
   */
  reReplicate(chunkHash: string): Promise<void>;
}

export interface ReplicaLocation {
  nodeId: string;
  availabilityZone: string;
  timestamp: Date;
}

export interface ReplicaHealth {
  chunkHash: string;
  replicaCount: number;
  healthyReplicas: number;
  corruptedReplicas: string[]; // Node IDs
}

export interface StorageNodeInfo {
  nodeId: string;
  ipAddress: string;
  port: number;
  availabilityZone: string;
  region: string;
  capacity: number;
  usedSpace: number;
  status: 'active' | 'draining' | 'offline';
}
