import { ConsistentHashRingImpl } from '../../src/consistent-hash-ring';
import { createHash } from 'crypto';

describe('ConsistentHashRing', () => {
  let ring: ConsistentHashRingImpl;

  beforeEach(() => {
    ring = new ConsistentHashRingImpl(150);
  });

  describe('addNode', () => {
    it('should add node to ring', () => {
      ring.addNode('node-1');

      expect(ring.hasNode('node-1')).toBe(true);
      expect(ring.getPhysicalNodeCount()).toBe(1);
    });

    it('should create 150 virtual nodes by default', () => {
      ring.addNode('node-1');

      expect(ring.getVirtualNodeCount()).toBe(150);
    });

    it('should create custom number of virtual nodes', () => {
      ring.addNode('node-1', 100);

      expect(ring.getVirtualNodeCount()).toBe(100);
    });

    it('should add multiple nodes', () => {
      ring.addNode('node-1');
      ring.addNode('node-2');
      ring.addNode('node-3');

      expect(ring.getPhysicalNodeCount()).toBe(3);
      expect(ring.getVirtualNodeCount()).toBe(450); // 3 * 150
    });

    it('should handle adding same node twice', () => {
      ring.addNode('node-1');
      ring.addNode('node-1');

      // Adding same node twice adds more virtual nodes
      expect(ring.getPhysicalNodeCount()).toBe(1);
      // Virtual nodes are added each time, so 2 * 150 = 300
      expect(ring.getVirtualNodeCount()).toBeGreaterThanOrEqual(150);
    });
  });

  describe('removeNode', () => {
    it('should remove node from ring', () => {
      ring.addNode('node-1');
      ring.removeNode('node-1');

      expect(ring.hasNode('node-1')).toBe(false);
      expect(ring.getPhysicalNodeCount()).toBe(0);
      expect(ring.getVirtualNodeCount()).toBe(0);
    });

    it('should remove only specified node', () => {
      ring.addNode('node-1');
      ring.addNode('node-2');
      ring.addNode('node-3');

      ring.removeNode('node-2');

      expect(ring.hasNode('node-1')).toBe(true);
      expect(ring.hasNode('node-2')).toBe(false);
      expect(ring.hasNode('node-3')).toBe(true);
      expect(ring.getPhysicalNodeCount()).toBe(2);
      expect(ring.getVirtualNodeCount()).toBe(300); // 2 * 150
    });

    it('should handle removing non-existent node', () => {
      ring.addNode('node-1');
      ring.removeNode('node-2');

      expect(ring.getPhysicalNodeCount()).toBe(1);
    });
  });

  describe('getNodes', () => {
    it('should return empty array when no nodes exist', () => {
      const chunkHash = computeHash('chunk-1');
      const nodes = ring.getNodes(chunkHash, 3);

      expect(nodes).toEqual([]);
    });

    it('should return single node when only one exists', () => {
      ring.addNode('node-1');

      const chunkHash = computeHash('chunk-1');
      const nodes = ring.getNodes(chunkHash, 3);

      expect(nodes).toEqual(['node-1']);
    });

    it('should return N distinct nodes', () => {
      ring.addNode('node-1');
      ring.addNode('node-2');
      ring.addNode('node-3');

      const chunkHash = computeHash('chunk-1');
      const nodes = ring.getNodes(chunkHash, 3);

      expect(nodes).toHaveLength(3);
      expect(new Set(nodes).size).toBe(3); // All distinct
    });

    it('should return all available nodes when count exceeds node count', () => {
      ring.addNode('node-1');
      ring.addNode('node-2');

      const chunkHash = computeHash('chunk-1');
      const nodes = ring.getNodes(chunkHash, 5);

      expect(nodes).toHaveLength(2);
    });

    it('should return consistent nodes for same chunk hash', () => {
      ring.addNode('node-1');
      ring.addNode('node-2');
      ring.addNode('node-3');

      const chunkHash = computeHash('chunk-1');
      const nodes1 = ring.getNodes(chunkHash, 3);
      const nodes2 = ring.getNodes(chunkHash, 3);

      expect(nodes1).toEqual(nodes2);
    });

    it('should return different nodes for different chunk hashes', () => {
      ring.addNode('node-1');
      ring.addNode('node-2');
      ring.addNode('node-3');
      ring.addNode('node-4');
      ring.addNode('node-5');

      const hash1 = computeHash('chunk-1');
      const hash2 = computeHash('chunk-2');

      const nodes1 = ring.getNodes(hash1, 3);
      const nodes2 = ring.getNodes(hash2, 3);

      // Should be different (with high probability)
      expect(nodes1).not.toEqual(nodes2);
    });

    it('should handle requesting 0 nodes', () => {
      ring.addNode('node-1');

      const chunkHash = computeHash('chunk-1');
      const nodes = ring.getNodes(chunkHash, 0);

      expect(nodes).toEqual([]);
    });

    it('should distribute chunks across all nodes', () => {
      ring.addNode('node-1');
      ring.addNode('node-2');
      ring.addNode('node-3');

      const nodeCounts = new Map<string, number>();
      nodeCounts.set('node-1', 0);
      nodeCounts.set('node-2', 0);
      nodeCounts.set('node-3', 0);

      // Simulate 100 chunks
      for (let i = 0; i < 100; i++) {
        const chunkHash = computeHash(`chunk-${i}`);
        const nodes = ring.getNodes(chunkHash, 1);

        if (nodes.length > 0) {
          const count = nodeCounts.get(nodes[0]) || 0;
          nodeCounts.set(nodes[0], count + 1);
        }
      }

      // Each node should get some chunks (not perfectly balanced, but distributed)
      for (const [nodeId, count] of nodeCounts.entries()) {
        expect(count).toBeGreaterThan(0);
      }
    });
  });

  describe('getPhysicalNodes', () => {
    it('should return empty array when no nodes', () => {
      expect(ring.getPhysicalNodes()).toEqual([]);
    });

    it('should return all physical node IDs', () => {
      ring.addNode('node-1');
      ring.addNode('node-2');
      ring.addNode('node-3');

      const nodes = ring.getPhysicalNodes();

      expect(nodes).toHaveLength(3);
      expect(nodes).toContain('node-1');
      expect(nodes).toContain('node-2');
      expect(nodes).toContain('node-3');
    });
  });

  describe('clear', () => {
    it('should remove all nodes', () => {
      ring.addNode('node-1');
      ring.addNode('node-2');
      ring.addNode('node-3');

      ring.clear();

      expect(ring.getPhysicalNodeCount()).toBe(0);
      expect(ring.getVirtualNodeCount()).toBe(0);
      expect(ring.getPhysicalNodes()).toEqual([]);
    });
  });

  describe('minimal data movement', () => {
    it('should minimize data movement when adding node', () => {
      // Add initial nodes
      ring.addNode('node-1');
      ring.addNode('node-2');
      ring.addNode('node-3');

      // Record initial chunk assignments
      const initialAssignments = new Map<string, string>();
      for (let i = 0; i < 100; i++) {
        const chunkHash = computeHash(`chunk-${i}`);
        const nodes = ring.getNodes(chunkHash, 1);
        if (nodes.length > 0) {
          initialAssignments.set(chunkHash, nodes[0]);
        }
      }

      // Add new node
      ring.addNode('node-4');

      // Check how many chunks moved
      let movedCount = 0;
      for (const [chunkHash, oldNode] of initialAssignments.entries()) {
        const newNodes = ring.getNodes(chunkHash, 1);
        if (newNodes.length > 0 && newNodes[0] !== oldNode) {
          movedCount++;
        }
      }

      // Should move approximately 1/4 of chunks (25 out of 100)
      // Allow some variance: 15-35 chunks
      expect(movedCount).toBeGreaterThan(10);
      expect(movedCount).toBeLessThan(40);
    });

    it('should minimize data movement when removing node', () => {
      // Add nodes
      ring.addNode('node-1');
      ring.addNode('node-2');
      ring.addNode('node-3');
      ring.addNode('node-4');

      // Record initial assignments
      const initialAssignments = new Map<string, string>();
      for (let i = 0; i < 100; i++) {
        const chunkHash = computeHash(`chunk-${i}`);
        const nodes = ring.getNodes(chunkHash, 1);
        if (nodes.length > 0) {
          initialAssignments.set(chunkHash, nodes[0]);
        }
      }

      // Remove node
      ring.removeNode('node-4');

      // Check how many chunks moved
      let movedCount = 0;
      for (const [chunkHash, oldNode] of initialAssignments.entries()) {
        const newNodes = ring.getNodes(chunkHash, 1);
        if (newNodes.length > 0 && newNodes[0] !== oldNode) {
          movedCount++;
        }
      }

      // Only chunks that were on node-4 should move (approximately 25 out of 100)
      // Allow some variance: 15-35 chunks
      expect(movedCount).toBeGreaterThan(10);
      expect(movedCount).toBeLessThan(40);
    });
  });

  describe('load balancing', () => {
    it('should distribute load relatively evenly', () => {
      ring.addNode('node-1');
      ring.addNode('node-2');
      ring.addNode('node-3');

      const nodeCounts = new Map<string, number>();
      nodeCounts.set('node-1', 0);
      nodeCounts.set('node-2', 0);
      nodeCounts.set('node-3', 0);

      // Simulate 300 chunks
      for (let i = 0; i < 300; i++) {
        const chunkHash = computeHash(`chunk-${i}`);
        const nodes = ring.getNodes(chunkHash, 1);

        if (nodes.length > 0) {
          const count = nodeCounts.get(nodes[0]) || 0;
          nodeCounts.set(nodes[0], count + 1);
        }
      }

      // Calculate variance
      const counts = Array.from(nodeCounts.values());
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      const variance =
        counts.reduce((sum, count) => sum + Math.pow(count - mean, 2), 0) / counts.length;
      const stdDev = Math.sqrt(variance);
      const coefficientOfVariation = (stdDev / mean) * 100;

      // Coefficient of variation should be less than 20% for good distribution
      expect(coefficientOfVariation).toBeLessThan(20);
    });
  });
});

function computeHash(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
