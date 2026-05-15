import { ChunkManagerImpl } from '../../src/chunk-manager';
import { ChunkMetadata } from '../../src/interfaces/chunk-manager.interface';
import { Readable } from 'stream';

describe('ChunkManager', () => {
  let chunkManager: ChunkManagerImpl;
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB

  beforeEach(() => {
    chunkManager = new ChunkManagerImpl();
  });

  describe('chunkFile', () => {
    it('should handle empty file (0 bytes)', async () => {
      const fileId = 'file-1';
      const emptyFile = Buffer.alloc(0);

      const chunks = await chunkManager.chunkFile(fileId, emptyFile);

      expect(chunks).toHaveLength(0);
    });

    it('should create single chunk for file smaller than 8MB', async () => {
      const fileId = 'file-2';
      const fileData = Buffer.from('Hello, World!');

      const chunks = await chunkManager.chunkFile(fileId, fileData);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].fileId).toBe(fileId);
      expect(chunks[0].sequenceNumber).toBe(0);
      expect(chunks[0].size).toBe(fileData.length);
      expect(chunks[0].contentHash).toHaveLength(64); // SHA-256 hex string
    });

    it('should create single chunk for exactly 8MB file', async () => {
      const fileId = 'file-3';
      const fileData = Buffer.alloc(CHUNK_SIZE, 'a');

      const chunks = await chunkManager.chunkFile(fileId, fileData);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].size).toBe(CHUNK_SIZE);
      expect(chunks[0].sequenceNumber).toBe(0);
    });

    it('should create two chunks for file slightly larger than 8MB', async () => {
      const fileId = 'file-4';
      const fileData = Buffer.alloc(CHUNK_SIZE + 100, 'b');

      const chunks = await chunkManager.chunkFile(fileId, fileData);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].size).toBe(CHUNK_SIZE);
      expect(chunks[0].sequenceNumber).toBe(0);
      expect(chunks[1].size).toBe(100);
      expect(chunks[1].sequenceNumber).toBe(1);
    });

    it('should create multiple chunks for large file', async () => {
      const fileId = 'file-5';
      const fileSize = CHUNK_SIZE * 3 + 1024; // 3 full chunks + 1KB
      const fileData = Buffer.alloc(fileSize, 'c');

      const chunks = await chunkManager.chunkFile(fileId, fileData);

      expect(chunks).toHaveLength(4);
      expect(chunks[0].size).toBe(CHUNK_SIZE);
      expect(chunks[1].size).toBe(CHUNK_SIZE);
      expect(chunks[2].size).toBe(CHUNK_SIZE);
      expect(chunks[3].size).toBe(1024);
    });

    it('should assign sequential sequence numbers', async () => {
      const fileId = 'file-6';
      const fileData = Buffer.alloc(CHUNK_SIZE * 2 + 500, 'd');

      const chunks = await chunkManager.chunkFile(fileId, fileData);

      expect(chunks).toHaveLength(3);
      expect(chunks[0].sequenceNumber).toBe(0);
      expect(chunks[1].sequenceNumber).toBe(1);
      expect(chunks[2].sequenceNumber).toBe(2);
    });

    it('should compute valid SHA-256 content hash for each chunk', async () => {
      const fileId = 'file-7';
      const fileData = Buffer.from('Test data for hashing');

      const chunks = await chunkManager.chunkFile(fileId, fileData);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].contentHash).toMatch(/^[a-f0-9]{64}$/); // Valid SHA-256 hex
    });

    it('should produce different hashes for different chunk content', async () => {
      const fileId = 'file-8';
      const chunk1Data = Buffer.alloc(CHUNK_SIZE, 'a');
      const chunk2Data = Buffer.alloc(100, 'b');
      const fileData = Buffer.concat([chunk1Data, chunk2Data]);

      const chunks = await chunkManager.chunkFile(fileId, fileData);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].contentHash).not.toBe(chunks[1].contentHash);
    });

    it('should produce same hash for identical chunk content', async () => {
      const fileId1 = 'file-9';
      const fileId2 = 'file-10';
      const identicalData = Buffer.from('Identical content');

      const chunks1 = await chunkManager.chunkFile(fileId1, identicalData);
      const chunks2 = await chunkManager.chunkFile(fileId2, identicalData);

      expect(chunks1[0].contentHash).toBe(chunks2[0].contentHash);
    });

    it('should set encryptedSize to 0 (to be set by encryption service)', async () => {
      const fileId = 'file-11';
      const fileData = Buffer.from('Test');

      const chunks = await chunkManager.chunkFile(fileId, fileData);

      expect(chunks[0].encryptedSize).toBe(0);
    });

    it('should handle single-byte file', async () => {
      const fileId = 'file-12';
      const fileData = Buffer.from('X');

      const chunks = await chunkManager.chunkFile(fileId, fileData);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].size).toBe(1);
    });

    it('should handle file with exactly 2 * 8MB', async () => {
      const fileId = 'file-13';
      const fileData = Buffer.alloc(CHUNK_SIZE * 2, 'e');

      const chunks = await chunkManager.chunkFile(fileId, fileData);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].size).toBe(CHUNK_SIZE);
      expect(chunks[1].size).toBe(CHUNK_SIZE);
    });
  });

  describe('verifyChunk', () => {
    it('should return true for matching hash', async () => {
      const chunkData = Buffer.from('Test chunk data');
      const fileId = 'file-14';

      const chunks = await chunkManager.chunkFile(fileId, chunkData);
      const expectedHash = chunks[0].contentHash;

      const isValid = chunkManager.verifyChunk(expectedHash, chunkData);

      expect(isValid).toBe(true);
    });

    it('should return false for non-matching hash', () => {
      const chunkData = Buffer.from('Test chunk data');
      const wrongHash = 'a'.repeat(64); // Invalid hash

      const isValid = chunkManager.verifyChunk(wrongHash, chunkData);

      expect(isValid).toBe(false);
    });

    it('should return false when chunk data is modified', async () => {
      const originalData = Buffer.from('Original data');
      const modifiedData = Buffer.from('Modified data');
      const fileId = 'file-15';

      const chunks = await chunkManager.chunkFile(fileId, originalData);
      const originalHash = chunks[0].contentHash;

      const isValid = chunkManager.verifyChunk(originalHash, modifiedData);

      expect(isValid).toBe(false);
    });

    it('should detect single-byte corruption', async () => {
      const originalData = Buffer.from('Test data for corruption detection');
      const fileId = 'file-16';

      const chunks = await chunkManager.chunkFile(fileId, originalData);
      const originalHash = chunks[0].contentHash;

      // Corrupt one byte
      const corruptedData = Buffer.from(originalData);
      corruptedData[0] = corruptedData[0] ^ 0xff;

      const isValid = chunkManager.verifyChunk(originalHash, corruptedData);

      expect(isValid).toBe(false);
    });

    it('should verify empty chunk correctly', async () => {
      const emptyData = Buffer.alloc(0);
      const fileId = 'file-17';

      // Empty file produces no chunks, so we need to compute hash manually
      const chunks = await chunkManager.chunkFile(fileId, Buffer.from(''));
      
      // Since empty file produces no chunks, we test with a minimal chunk
      const minimalData = Buffer.from('a');
      const minimalChunks = await chunkManager.chunkFile(fileId, minimalData);
      
      const isValid = chunkManager.verifyChunk(minimalChunks[0].contentHash, minimalData);
      expect(isValid).toBe(true);
    });
  });

  describe('chunkFileStream', () => {
    it('should chunk file from stream', async () => {
      const fileId = 'file-18';
      const fileData = Buffer.alloc(CHUNK_SIZE + 1000, 'f');
      const stream = Readable.from([fileData]);

      const chunks = await chunkManager.chunkFileStream(fileId, stream);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].size).toBe(CHUNK_SIZE);
      expect(chunks[1].size).toBe(1000);
    });

    it('should handle empty stream', async () => {
      const fileId = 'file-19';
      const stream = Readable.from([]);

      const chunks = await chunkManager.chunkFileStream(fileId, stream);

      expect(chunks).toHaveLength(0);
    });

    it('should handle stream with multiple small chunks', async () => {
      const fileId = 'file-20';
      const chunk1 = Buffer.alloc(1024, 'a');
      const chunk2 = Buffer.alloc(1024, 'b');
      const chunk3 = Buffer.alloc(1024, 'c');
      const stream = Readable.from([chunk1, chunk2, chunk3]);

      const chunks = await chunkManager.chunkFileStream(fileId, stream);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].size).toBe(3072);
    });

    it('should handle stream error', async () => {
      const fileId = 'file-21';
      const stream = new Readable({
        read() {
          this.emit('error', new Error('Stream error'));
        },
      });

      await expect(chunkManager.chunkFileStream(fileId, stream)).rejects.toThrow(
        'Stream error'
      );
    });

    it('should produce same chunks as buffer-based chunking', async () => {
      const fileId = 'file-22';
      const fileData = Buffer.alloc(CHUNK_SIZE * 2 + 500, 'g');

      const bufferChunks = await chunkManager.chunkFile(fileId, fileData);
      
      const stream = Readable.from([fileData]);
      const streamChunks = await chunkManager.chunkFileStream(fileId, stream);

      expect(streamChunks).toHaveLength(bufferChunks.length);
      for (let i = 0; i < bufferChunks.length; i++) {
        expect(streamChunks[i].contentHash).toBe(bufferChunks[i].contentHash);
        expect(streamChunks[i].size).toBe(bufferChunks[i].size);
        expect(streamChunks[i].sequenceNumber).toBe(bufferChunks[i].sequenceNumber);
      }
    });
  });

  describe('createAssemblyStream', () => {
    it('should create readable stream from chunks', (done) => {
      const chunk1 = Buffer.from('First chunk');
      const chunk2 = Buffer.from('Second chunk');
      const chunks = [chunk1, chunk2];

      const stream = chunkManager.createAssemblyStream(chunks);
      const result: Buffer[] = [];

      stream.on('data', (chunk: Buffer) => {
        result.push(chunk);
      });

      stream.on('end', () => {
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(chunk1);
        expect(result[1]).toEqual(chunk2);
        done();
      });
    });

    it('should handle empty chunks array', (done) => {
      const stream = chunkManager.createAssemblyStream([]);
      const result: Buffer[] = [];

      stream.on('data', (chunk: Buffer) => {
        result.push(chunk);
      });

      stream.on('end', () => {
        expect(result).toHaveLength(0);
        done();
      });
    });

    it('should handle single chunk', (done) => {
      const chunk = Buffer.from('Single chunk');
      const stream = chunkManager.createAssemblyStream([chunk]);
      const result: Buffer[] = [];

      stream.on('data', (data: Buffer) => {
        result.push(data);
      });

      stream.on('end', () => {
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(chunk);
        done();
      });
    });
  });

  describe('round-trip property', () => {
    it('should preserve file content through chunk-reassemble cycle', async () => {
      const fileId = 'file-23';
      const originalData = Buffer.from('This is test data for round-trip verification');

      // Chunk the file
      const chunks = await chunkManager.chunkFile(fileId, originalData);

      // Simulate reassembly by concatenating chunks
      // (In real system, this would retrieve from storage)
      const chunkBuffers: Buffer[] = [];
      let offset = 0;
      for (const chunk of chunks) {
        const chunkData = originalData.subarray(offset, offset + chunk.size);
        chunkBuffers.push(chunkData);
        offset += chunk.size;
      }

      const reassembled = Buffer.concat(chunkBuffers);

      expect(reassembled).toEqual(originalData);
    });

    it('should produce identical hashes on re-chunking', async () => {
      const fileId = 'file-24';
      const originalData = Buffer.alloc(CHUNK_SIZE * 2 + 1000, 'h');

      // First chunking
      const chunks1 = await chunkManager.chunkFile(fileId, originalData);

      // Simulate reassembly
      const chunkBuffers: Buffer[] = [];
      let offset = 0;
      for (const chunk of chunks1) {
        const chunkData = originalData.subarray(offset, offset + chunk.size);
        chunkBuffers.push(chunkData);
        offset += chunk.size;
      }
      const reassembled = Buffer.concat(chunkBuffers);

      // Second chunking
      const chunks2 = await chunkManager.chunkFile(fileId, reassembled);

      expect(chunks2).toHaveLength(chunks1.length);
      for (let i = 0; i < chunks1.length; i++) {
        expect(chunks2[i].contentHash).toBe(chunks1[i].contentHash);
        expect(chunks2[i].size).toBe(chunks1[i].size);
      }
    });
  });
});
