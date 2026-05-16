import {
  ReplicationService,
  ReplicaLocation,
  ReplicaHealth,
  StorageNodeInfo,
} from './interfaces/replication-service.interface';
import { ConsistentHashRing } from './interfaces/consistent-hash-ring.interface';
import { StorageNode } from './interfaces/storage-node.interface';
import { MetadataStore } from './interfaces/metadata-store.interface';

/**
 * Replication Service Implementation
 *
 * Maintains 3 replicas of each chunk across distinct storage nodes
 * with availability zone preference and quorum writes.
 */
export class ReplicationServiceImpl implements ReplicationService {
  private readonly replicationFactor: number = 3;
  private readonly quorumWrite: number = 2; // W=2

  constructor(
    private readonly hashRing: ConsistentHashRing,
    private readonly storageNodes: Map<string, StorageNode>,
    private readonly metadataStore: MetadataStore
  ) {}

  /**
   * Replicate chunk to 3 storage nodes with quorum write (W=2)
   *
   * @param chunkHash - SHA-256 hash of the chunk
   * @param chunkData - Encrypted chunk data
   * @returns Array of replica locations
   */
  async replicateChunk(chunkHash: string, chunkData: Buffer): Promise<ReplicaLocation[]> {
    // Select storage nodes using consistent hashing
    const selectedNodes = await this.selectStorageNodes(chunkHash, this.replicationFactor);

    if (selectedNodes.length < this.replicationFactor) {
      throw new Error(
        `Insufficient storage nodes: need ${this.replicationFactor}, found ${selectedNodes.length}`
      );
    }

    const replicaLocations: ReplicaLocation[] = [];
    const writePromises: Promise<void>[] = [];
    let successCount = 0;

    // Write to all nodes in parallel
    for (const nodeInfo of selectedNodes) {
      const node = this.storageNodes.get(nodeInfo.nodeId);
      if (!node) {
        continue;
      }

      const writePromise = node
        .writeChunk(chunkHash, chunkData)
        .then(async () => {
          const location: ReplicaLocation = {
            nodeId: nodeInfo.nodeId,
            availabilityZone: nodeInfo.availabilityZone,
            timestamp: new Date(),
          };

          replicaLocations.push(location);

          // Record replica in metadata store
          await this.metadataStore.createChunkReplica({
            chunkHash,
            nodeId: nodeInfo.nodeId,
            availabilityZone: nodeInfo.availabilityZone,
            createdAt: new Date(),
          });

          successCount++;
        })
        .catch((error) => {
          console.error(`Failed to write chunk ${chunkHash} to node ${nodeInfo.nodeId}:`, error);
        });

      writePromises.push(writePromise);
    }

    // Wait for all writes to complete
    await Promise.all(writePromises);

    // Check quorum
    if (successCount < this.quorumWrite) {
      throw new Error(
        `Quorum write failed: need ${this.quorumWrite} successful writes, got ${successCount}`
      );
    }

    return replicaLocations;
  }

  /**
   * Select optimal storage nodes for chunk replication
   * Prefers nodes in different availability zones
   *
   * @param chunkHash - SHA-256 hash of the chunk
   * @param count - Number of nodes to select
   * @returns Array of selected storage node info
   */
  async selectStorageNodes(chunkHash: string, count: number): Promise<StorageNodeInfo[]> {
    // Get candidate nodes from consistent hash ring
    const candidateNodes = this.hashRing.getNodes(chunkHash, count * 2);

    if (candidateNodes.length === 0) {
      return [];
    }

    // Get node details from metadata store
    const nodeDetails = await Promise.all(
      candidateNodes.map((nodeId) => this.metadataStore.getStorageNode(nodeId))
    );

    // Filter out null results and nodes that are not active
    const activeNodes = nodeDetails
      .filter((node) => node !== null && node.status === 'active')
      .map((node) => node!);

    // Prefer nodes in different availability zones
    const selectedNodes: StorageNodeInfo[] = [];
    const usedZones = new Set<string>();

    // First pass: select nodes from different zones
    for (const node of activeNodes) {
      if (selectedNodes.length >= count) {
        break;
      }

      if (!usedZones.has(node.availabilityZone)) {
        selectedNodes.push({
          nodeId: node.nodeId,
          ipAddress: node.ipAddress,
          port: node.port,
          availabilityZone: node.availabilityZone,
          region: node.region,
          capacity: node.capacity,
          usedSpace: node.usedSpace,
          status: node.status,
        });
        usedZones.add(node.availabilityZone);
      }
    }

    // Second pass: fill remaining slots if needed
    for (const node of activeNodes) {
      if (selectedNodes.length >= count) {
        break;
      }

      if (!selectedNodes.find((n) => n.nodeId === node.nodeId)) {
        selectedNodes.push({
          nodeId: node.nodeId,
          ipAddress: node.ipAddress,
          port: node.port,
          availabilityZone: node.availabilityZone,
          region: node.region,
          capacity: node.capacity,
          usedSpace: node.usedSpace,
          status: node.status,
        });
      }
    }

    return selectedNodes;
  }

  /**
   * Verify replica health and trigger re-replication if needed
   *
   * @param chunkHash - SHA-256 hash of the chunk
   * @returns Replica health status
   */
  async verifyReplicas(chunkHash: string): Promise<ReplicaHealth> {
    const replicas = await this.metadataStore.getChunkReplicas(chunkHash);

    const healthyReplicas: string[] = [];
    const corruptedReplicas: string[] = [];

    // Verify each replica
    for (const replica of replicas) {
      const node = this.storageNodes.get(replica.nodeId);
      if (!node) {
        corruptedReplicas.push(replica.nodeId);
        continue;
      }

      try {
        const isValid = await node.verifyChunkIntegrity(chunkHash);
        if (isValid) {
          healthyReplicas.push(replica.nodeId);
        } else {
          corruptedReplicas.push(replica.nodeId);
        }
      } catch (error) {
        corruptedReplicas.push(replica.nodeId);
      }
    }

    return {
      chunkHash,
      replicaCount: replicas.length,
      healthyReplicas: healthyReplicas.length,
      corruptedReplicas,
    };
  }

  /**
   * Re-replicate chunk when replica count drops below threshold
   *
   * @param chunkHash - SHA-256 hash of the chunk
   */
  async reReplicate(chunkHash: string): Promise<void> {
    const health = await this.verifyReplicas(chunkHash);

    // Remove corrupted replicas
    for (const nodeId of health.corruptedReplicas) {
      try {
        const node = this.storageNodes.get(nodeId);
        if (node) {
          await node.deleteChunk(chunkHash);
        }
        await this.metadataStore.deleteChunkReplica(chunkHash, nodeId);
      } catch (error) {
        console.error(`Failed to delete corrupted replica on node ${nodeId}:`, error);
      }
    }

    // Check if we need more replicas
    const currentReplicas = health.replicaCount - health.corruptedReplicas.length;
    if (currentReplicas >= this.replicationFactor) {
      return;
    }

    // Get chunk data from a healthy replica
    let chunkData: Buffer | null = null;
    const replicas = await this.metadataStore.getChunkReplicas(chunkHash);

    for (const replica of replicas) {
      if (health.corruptedReplicas.includes(replica.nodeId)) {
        continue;
      }

      const node = this.storageNodes.get(replica.nodeId);
      if (!node) {
        continue;
      }

      try {
        chunkData = await node.readChunk(chunkHash);
        break;
      } catch (error) {
        console.error(`Failed to read chunk from node ${replica.nodeId}:`, error);
      }
    }

    if (!chunkData) {
      throw new Error(`Cannot re-replicate chunk ${chunkHash}: no healthy replicas found`);
    }

    // Get existing replica node IDs
    const existingNodeIds = replicas.map((r) => r.nodeId);

    // Select new nodes (excluding existing ones)
    const neededReplicas = this.replicationFactor - currentReplicas;
    const allCandidates = this.hashRing.getNodes(chunkHash, this.replicationFactor * 3);
    const newNodeIds = allCandidates
      .filter((nodeId) => !existingNodeIds.includes(nodeId))
      .slice(0, neededReplicas);

    // Write to new nodes
    for (const nodeId of newNodeIds) {
      const node = this.storageNodes.get(nodeId);
      if (!node) {
        continue;
      }

      try {
        await node.writeChunk(chunkHash, chunkData);

        const nodeRecord = await this.metadataStore.getStorageNode(nodeId);
        await this.metadataStore.createChunkReplica({
          chunkHash,
          nodeId,
          availabilityZone: nodeRecord?.availabilityZone || 'unknown',
          createdAt: new Date(),
        });
      } catch (error) {
        console.error(`Failed to re-replicate chunk to node ${nodeId}:`, error);
      }
    }
  }

  /**
   * Get replication factor
   *
   * @returns Replication factor (default: 3)
   */
  getReplicationFactor(): number {
    return this.replicationFactor;
  }

  /**
   * Get quorum write count
   *
   * @returns Quorum write count (default: 2)
   */
  getQuorumWrite(): number {
    return this.quorumWrite;
  }
}
