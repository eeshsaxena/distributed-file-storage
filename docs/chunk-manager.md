# ChunkManager Component

## Overview

The ChunkManager is responsible for splitting files into fixed-size 8MB chunks and reassembling them. It uses streaming APIs for memory-efficient processing of large files and computes SHA-256 content hashes for each chunk to enable deduplication and integrity verification.

## Features

- **Fixed-Size Chunking**: Splits files into 8MB (8,388,608 bytes) chunks
- **SHA-256 Hashing**: Computes content hash for each chunk for deduplication and verification
- **Streaming Support**: Handles files larger than available memory using Node.js streams
- **Chunk Verification**: Validates chunk integrity by comparing content hashes
- **Metadata Tracking**: Maintains chunk metadata including file ID, sequence number, size, and hash

## Interface

### ChunkManager

```typescript
interface ChunkManager {
  chunkFile(fileId: string, fileData: Buffer): Promise<ChunkMetadata[]>;
  assembleFile(fileId: string, version: number): Promise<Buffer>;
  verifyChunk(chunkHash: string, chunkData: Buffer): boolean;
}
```

### ChunkMetadata

```typescript
interface ChunkMetadata {
  fileId: string;           // Unique file identifier
  sequenceNumber: number;   // Chunk position (0-indexed)
  contentHash: string;      // SHA-256 hash (64 hex characters)
  size: number;             // Chunk size in bytes
  encryptedSize: number;    // Size after encryption (set by encryption service)
}
```

## Implementation

### ChunkManagerImpl

The `ChunkManagerImpl` class provides a complete implementation of the ChunkManager interface.

#### Methods

##### `chunkFile(fileId: string, fileData: Buffer): Promise<ChunkMetadata[]>`

Splits a file into 8MB chunks and computes SHA-256 hash for each chunk.

**Parameters:**
- `fileId`: Unique identifier for the file
- `fileData`: File content as Buffer

**Returns:** Array of chunk metadata

**Example:**
```typescript
const chunkManager = new ChunkManagerImpl();
const fileData = Buffer.from('Hello, World!');
const chunks = await chunkManager.chunkFile('file-123', fileData);

console.log(chunks[0]);
// {
//   fileId: 'file-123',
//   sequenceNumber: 0,
//   contentHash: 'dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f',
//   size: 13,
//   encryptedSize: 0
// }
```

##### `verifyChunk(chunkHash: string, chunkData: Buffer): boolean`

Verifies chunk integrity by comparing the computed hash with the expected hash.

**Parameters:**
- `chunkHash`: Expected SHA-256 hash (64 hex characters)
- `chunkData`: Chunk data to verify

**Returns:** `true` if hash matches, `false` otherwise

**Example:**
```typescript
const chunkData = Buffer.from('Test data');
const chunks = await chunkManager.chunkFile('file-456', chunkData);
const isValid = chunkManager.verifyChunk(chunks[0].contentHash, chunkData);
console.log(isValid); // true
```

##### `chunkFileStream(fileId: string, fileStream: Readable): Promise<ChunkMetadata[]>`

Stream-based chunking for very large files. Processes file as a stream to minimize memory usage.

**Parameters:**
- `fileId`: Unique identifier for the file
- `fileStream`: Readable stream of file data

**Returns:** Array of chunk metadata

**Example:**
```typescript
import { createReadStream } from 'fs';

const fileStream = createReadStream('large-file.bin');
const chunks = await chunkManager.chunkFileStream('file-789', fileStream);
```

##### `createAssemblyStream(chunks: Buffer[]): Readable`

Creates a readable stream from chunk buffers for memory-efficient reassembly.

**Parameters:**
- `chunks`: Array of chunk data buffers in sequence order

**Returns:** Readable stream of reassembled file

**Example:**
```typescript
const chunkBuffers = [Buffer.from('chunk1'), Buffer.from('chunk2')];
const stream = chunkManager.createAssemblyStream(chunkBuffers);

stream.on('data', (chunk) => {
  console.log('Received chunk:', chunk);
});
```

## Chunking Behavior

### Chunk Size

- All chunks except the last are exactly **8MB (8,388,608 bytes)**
- The last chunk is **at most 8MB** (may be smaller)
- Empty files produce **zero chunks**

### Sequence Numbers

- Chunks are numbered sequentially starting from **0**
- Sequence numbers indicate the chunk's position in the original file

### Content Hashing

- Each chunk has a **SHA-256 content hash** (64 hexadecimal characters)
- Identical content produces identical hashes (enables deduplication)
- Hash is computed from the raw chunk data before encryption

## Correctness Properties

The ChunkManager implementation satisfies the following properties (verified by property-based tests):

1. **Property 1**: All chunks except the last are exactly 8MB; the last chunk is at most 8MB
2. **Property 2**: Every chunk has a valid SHA-256 content hash (64 hex characters)
3. **Property 3**: Chunk metadata contains file ID, sequence number, size, and content hash
4. **Property 4**: Chunking and reassembling preserves file content (byte-for-byte identical)
5. **Property 5**: Chunking, reassembling, and re-chunking produces identical hashes

## Testing

### Unit Tests

Located in `tests/unit/chunk-manager.test.ts`:
- Empty file handling
- Single chunk files
- Multiple chunk files
- Exact 8MB boundaries
- Hash verification
- Stream-based chunking
- Round-trip preservation

### Property-Based Tests

Located in `tests/properties/chunking.property.test.ts`:
- Tests all 5 correctness properties with 100 random inputs each
- Uses `fast-check` library for property-based testing
- Generates random files from 0 to 50MB

### Running Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm test -- tests/unit/chunk-manager.test.ts

# Run property tests only
npm test -- tests/properties/chunking.property.test.ts

# Run with coverage
npm run test:coverage
```

## Integration with Other Components

### Deduplication Engine

The Deduplication Engine uses chunk content hashes to detect duplicate chunks:

```typescript
const chunks = await chunkManager.chunkFile(fileId, fileData);
for (const chunk of chunks) {
  const duplicate = await deduplicationEngine.checkDuplicate(chunk.contentHash);
  if (!duplicate.exists) {
    // Store new chunk
  } else {
    // Increment reference count
    await deduplicationEngine.incrementReference(chunk.contentHash, fileId);
  }
}
```

### Encryption Service

The Encryption Service encrypts chunks before storage:

```typescript
const chunks = await chunkManager.chunkFile(fileId, fileData);
for (const chunk of chunks) {
  const chunkData = fileData.subarray(offset, offset + chunk.size);
  const encrypted = await encryptionService.encryptChunk(chunkData, fileId);
  chunk.encryptedSize = encrypted.data.length;
  // Store encrypted chunk
}
```

### Replication Service

The Replication Service replicates chunks to multiple storage nodes:

```typescript
const chunks = await chunkManager.chunkFile(fileId, fileData);
for (const chunk of chunks) {
  const chunkData = fileData.subarray(offset, offset + chunk.size);
  const replicas = await replicationService.replicateChunk(chunk.contentHash, chunkData);
  // Store replica locations in metadata
}
```

## Performance Considerations

### Memory Usage

- **Buffer-based chunking**: Loads entire file into memory (suitable for files < 100MB)
- **Stream-based chunking**: Processes file incrementally (suitable for files > 100MB)
- **Chunk size**: 8MB balances memory usage with network transfer efficiency

### Hashing Performance

- SHA-256 hashing is CPU-intensive
- For large files, consider parallel chunk processing
- Node.js crypto module uses native implementations for performance

### Streaming Best Practices

- Use `chunkFileStream()` for files larger than available memory
- Use `createAssemblyStream()` for memory-efficient reassembly
- Consider backpressure handling for production systems

## Future Enhancements

1. **Parallel Processing**: Process multiple chunks concurrently for faster hashing
2. **Progress Callbacks**: Report chunking progress for large files
3. **Configurable Chunk Size**: Support different chunk sizes for different use cases
4. **Content-Defined Chunking**: Implement CDC for better deduplication of modified files
5. **Compression**: Add optional compression before encryption

## References

- [Design Document](../.kiro/specs/distributed-file-storage/design.md)
- [Requirements Document](../.kiro/specs/distributed-file-storage/requirements.md)
- [Node.js Crypto Module](https://nodejs.org/api/crypto.html)
- [Node.js Streams](https://nodejs.org/api/stream.html)
