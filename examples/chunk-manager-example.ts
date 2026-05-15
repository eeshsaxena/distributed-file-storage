/**
 * ChunkManager Usage Examples
 *
 * This file demonstrates how to use the ChunkManager component
 * for file chunking, verification, and streaming operations.
 */

import { ChunkManagerImpl } from '../src/chunk-manager';
import { createReadStream } from 'fs';
import { Readable } from 'stream';

async function basicChunkingExample() {
  console.log('=== Basic Chunking Example ===\n');

  const chunkManager = new ChunkManagerImpl();

  // Create a sample file (1MB of data)
  const fileData = Buffer.alloc(1024 * 1024, 'a');
  const fileId = 'example-file-1';

  // Chunk the file
  const chunks = await chunkManager.chunkFile(fileId, fileData);

  console.log(`File size: ${fileData.length} bytes`);
  console.log(`Number of chunks: ${chunks.length}`);
  console.log('\nChunk details:');

  chunks.forEach((chunk, index) => {
    console.log(`  Chunk ${index}:`);
    console.log(`    Sequence: ${chunk.sequenceNumber}`);
    console.log(`    Size: ${chunk.size} bytes`);
    console.log(`    Hash: ${chunk.contentHash.substring(0, 16)}...`);
  });
}

async function largeFileChunkingExample() {
  console.log('\n=== Large File Chunking Example ===\n');

  const chunkManager = new ChunkManagerImpl();

  // Create a large file (25MB = 3 full chunks + 1MB)
  const fileSize = 25 * 1024 * 1024;
  const fileData = Buffer.alloc(fileSize, 'b');
  const fileId = 'large-file-1';

  console.log(`Chunking ${fileSize} bytes...`);

  const chunks = await chunkManager.chunkFile(fileId, fileData);

  console.log(`Created ${chunks.length} chunks:`);
  chunks.forEach((chunk) => {
    const sizeMB = (chunk.size / (1024 * 1024)).toFixed(2);
    console.log(`  Chunk ${chunk.sequenceNumber}: ${sizeMB} MB`);
  });
}

async function chunkVerificationExample() {
  console.log('\n=== Chunk Verification Example ===\n');

  const chunkManager = new ChunkManagerImpl();

  const originalData = Buffer.from('Important data that must not be corrupted');
  const fileId = 'verified-file-1';

  // Chunk the file
  const chunks = await chunkManager.chunkFile(fileId, originalData);
  const expectedHash = chunks[0].contentHash;

  // Verify original data
  const isValid = chunkManager.verifyChunk(expectedHash, originalData);
  console.log(`Original data verification: ${isValid ? 'PASS' : 'FAIL'}`);

  // Simulate corruption
  const corruptedData = Buffer.from(originalData);
  corruptedData[0] = corruptedData[0] ^ 0xff; // Flip bits

  const isCorrupted = chunkManager.verifyChunk(expectedHash, corruptedData);
  console.log(`Corrupted data verification: ${isCorrupted ? 'PASS' : 'FAIL'}`);
  console.log(`Corruption detected: ${!isCorrupted ? 'YES' : 'NO'}`);
}

async function streamChunkingExample() {
  console.log('\n=== Stream-Based Chunking Example ===\n');

  const chunkManager = new ChunkManagerImpl();

  // Create a stream from buffer (in real use, this would be a file stream)
  const fileData = Buffer.alloc(20 * 1024 * 1024, 'c'); // 20MB
  const stream = Readable.from([fileData]);
  const fileId = 'stream-file-1';

  console.log('Processing file stream...');

  const chunks = await chunkManager.chunkFileStream(fileId, stream);

  console.log(`Stream processing complete: ${chunks.length} chunks created`);
  console.log(`Total size: ${chunks.reduce((sum, c) => sum + c.size, 0)} bytes`);
}

async function assemblyStreamExample() {
  console.log('\n=== Assembly Stream Example ===\n');

  const chunkManager = new ChunkManagerImpl();

  // Create some chunk buffers
  const chunk1 = Buffer.from('First chunk of data. ');
  const chunk2 = Buffer.from('Second chunk of data. ');
  const chunk3 = Buffer.from('Third chunk of data.');

  const chunks = [chunk1, chunk2, chunk3];

  console.log('Creating assembly stream from chunks...');

  const stream = chunkManager.createAssemblyStream(chunks);
  const assembled: Buffer[] = [];

  stream.on('data', (chunk: Buffer) => {
    assembled.push(chunk);
    console.log(`  Received chunk: ${chunk.length} bytes`);
  });

  await new Promise<void>((resolve) => {
    stream.on('end', () => {
      const result = Buffer.concat(assembled);
      console.log(`\nAssembled file: "${result.toString()}"`);
      console.log(`Total size: ${result.length} bytes`);
      resolve();
    });
  });
}

async function roundTripExample() {
  console.log('\n=== Round-Trip Example ===\n');

  const chunkManager = new ChunkManagerImpl();

  const originalData = Buffer.from('This data should survive chunking and reassembly!');
  const fileId = 'roundtrip-file-1';

  console.log(`Original: "${originalData.toString()}"`);

  // Chunk the file
  const chunks = await chunkManager.chunkFile(fileId, originalData);
  console.log(`Created ${chunks.length} chunk(s)`);

  // Simulate reassembly
  const chunkBuffers: Buffer[] = [];
  let offset = 0;

  for (const chunk of chunks) {
    const chunkData = originalData.subarray(offset, offset + chunk.size);
    chunkBuffers.push(chunkData);
    offset += chunk.size;
  }

  const reassembled = Buffer.concat(chunkBuffers);
  console.log(`Reassembled: "${reassembled.toString()}"`);

  // Verify
  const isIdentical = originalData.equals(reassembled);
  console.log(`\nRound-trip successful: ${isIdentical ? 'YES' : 'NO'}`);
}

async function deduplicationExample() {
  console.log('\n=== Deduplication Example ===\n');

  const chunkManager = new ChunkManagerImpl();

  // Create two files with identical content
  const content = Buffer.from('Duplicate content that appears in multiple files');
  const file1Id = 'file-1';
  const file2Id = 'file-2';

  const chunks1 = await chunkManager.chunkFile(file1Id, content);
  const chunks2 = await chunkManager.chunkFile(file2Id, content);

  console.log('File 1 hash:', chunks1[0].contentHash);
  console.log('File 2 hash:', chunks2[0].contentHash);
  console.log(`Hashes match: ${chunks1[0].contentHash === chunks2[0].contentHash ? 'YES' : 'NO'}`);
  console.log('\nThis enables deduplication: only one physical copy needs to be stored!');
}

// Run all examples
async function main() {
  try {
    await basicChunkingExample();
    await largeFileChunkingExample();
    await chunkVerificationExample();
    await streamChunkingExample();
    await assemblyStreamExample();
    await roundTripExample();
    await deduplicationExample();

    console.log('\n=== All examples completed successfully! ===\n');
  } catch (error) {
    console.error('Error running examples:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export {
  basicChunkingExample,
  largeFileChunkingExample,
  chunkVerificationExample,
  streamChunkingExample,
  assemblyStreamExample,
  roundTripExample,
  deduplicationExample,
};
