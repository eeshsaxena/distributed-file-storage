/**
 * Mock Storage Node Service
 * 
 * Simulates a storage node that stores and retrieves file chunks.
 * In production, this would be a more sophisticated service with
 * disk management, replication, and integrity verification.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 9000;
const NODE_ID = process.env.NODE_ID || 'node-1';
const AVAILABILITY_ZONE = process.env.AVAILABILITY_ZONE || 'us-east-1a';
const REGION = process.env.REGION || 'us-east-1';
const DATA_DIR = process.env.DATA_DIR || '/data';
const CAPACITY = parseInt(process.env.CAPACITY || '107374182400'); // 100GB default

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Create subdirectories for hash-based organization (00-ff)
for (let i = 0; i < 256; i++) {
  const subdir = path.join(DATA_DIR, i.toString(16).padStart(2, '0'));
  if (!fs.existsSync(subdir)) {
    fs.mkdirSync(subdir, { recursive: true });
  }
}

// Track node metrics
const metrics = {
  chunkCount: 0,
  usedSpace: 0,
  readCount: 0,
  writeCount: 0,
  deleteCount: 0,
  errorCount: 0,
  lastHeartbeat: new Date()
};

// Get chunk file path based on hash
function getChunkPath(chunkHash) {
  const prefix = chunkHash.substring(0, 2);
  return path.join(DATA_DIR, prefix, chunkHash);
}

// Calculate used disk space
function calculateUsedSpace() {
  let totalSize = 0;
  let count = 0;
  
  for (let i = 0; i < 256; i++) {
    const subdir = path.join(DATA_DIR, i.toString(16).padStart(2, '0'));
    if (fs.existsSync(subdir)) {
      const files = fs.readdirSync(subdir);
      for (const file of files) {
        const filePath = path.join(subdir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
        count++;
      }
    }
  }
  
  metrics.usedSpace = totalSize;
  metrics.chunkCount = count;
}

// Initial calculation
calculateUsedSpace();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Health check endpoint
  if (url.pathname === '/health' && req.method === 'GET') {
    metrics.lastHeartbeat = new Date();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'storage-node',
      nodeId: NODE_ID,
      availabilityZone: AVAILABILITY_ZONE,
      region: REGION
    }));
    return;
  }
  
  // Get node metrics
  if (url.pathname === '/metrics' && req.method === 'GET') {
    const diskUsagePercent = (metrics.usedSpace / CAPACITY) * 100;
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      nodeId: NODE_ID,
      availabilityZone: AVAILABILITY_ZONE,
      region: REGION,
      capacity: CAPACITY,
      usedSpace: metrics.usedSpace,
      diskUsagePercent: diskUsagePercent.toFixed(2),
      chunkCount: metrics.chunkCount,
      readCount: metrics.readCount,
      writeCount: metrics.writeCount,
      deleteCount: metrics.deleteCount,
      errorCount: metrics.errorCount,
      lastHeartbeat: metrics.lastHeartbeat
    }));
    return;
  }
  
  // Write chunk
  if (url.pathname.startsWith('/chunks/') && req.method === 'PUT') {
    const chunkHash = url.pathname.split('/').pop();
    
    if (!chunkHash || chunkHash.length !== 64) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid chunk hash' }));
      metrics.errorCount++;
      return;
    }
    
    let body = Buffer.alloc(0);
    req.on('data', chunk => {
      body = Buffer.concat([body, chunk]);
    });
    
    req.on('end', () => {
      try {
        // Verify hash
        const computedHash = crypto.createHash('sha256').update(body).digest('hex');
        if (computedHash !== chunkHash) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Hash mismatch',
            expected: chunkHash,
            computed: computedHash
          }));
          metrics.errorCount++;
          return;
        }
        
        const chunkPath = getChunkPath(chunkHash);
        
        // Check if chunk already exists
        if (fs.existsSync(chunkPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            message: 'Chunk already exists',
            chunkHash: chunkHash,
            nodeId: NODE_ID
          }));
          return;
        }
        
        // Write chunk to disk
        fs.writeFileSync(chunkPath, body);
        
        // Update metrics
        metrics.writeCount++;
        calculateUsedSpace();
        
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Chunk written successfully',
          chunkHash: chunkHash,
          size: body.length,
          nodeId: NODE_ID
        }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
        metrics.errorCount++;
      }
    });
    return;
  }
  
  // Read chunk
  if (url.pathname.startsWith('/chunks/') && req.method === 'GET') {
    const chunkHash = url.pathname.split('/').pop();
    
    if (!chunkHash || chunkHash.length !== 64) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid chunk hash' }));
      metrics.errorCount++;
      return;
    }
    
    try {
      const chunkPath = getChunkPath(chunkHash);
      
      if (!fs.existsSync(chunkPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Chunk not found' }));
        return;
      }
      
      const data = fs.readFileSync(chunkPath);
      
      // Verify integrity
      const computedHash = crypto.createHash('sha256').update(data).digest('hex');
      if (computedHash !== chunkHash) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Chunk corrupted',
          expected: chunkHash,
          computed: computedHash
        }));
        metrics.errorCount++;
        return;
      }
      
      metrics.readCount++;
      
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.length,
        'X-Chunk-Hash': chunkHash,
        'X-Node-Id': NODE_ID
      });
      res.end(data);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
      metrics.errorCount++;
    }
    return;
  }
  
  // Delete chunk
  if (url.pathname.startsWith('/chunks/') && req.method === 'DELETE') {
    const chunkHash = url.pathname.split('/').pop();
    
    if (!chunkHash || chunkHash.length !== 64) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid chunk hash' }));
      metrics.errorCount++;
      return;
    }
    
    try {
      const chunkPath = getChunkPath(chunkHash);
      
      if (!fs.existsSync(chunkPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Chunk not found' }));
        return;
      }
      
      fs.unlinkSync(chunkPath);
      
      metrics.deleteCount++;
      calculateUsedSpace();
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        message: 'Chunk deleted successfully',
        chunkHash: chunkHash,
        nodeId: NODE_ID
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
      metrics.errorCount++;
    }
    return;
  }
  
  // Verify chunk integrity
  if (url.pathname.startsWith('/chunks/') && url.pathname.endsWith('/verify') && req.method === 'POST') {
    const parts = url.pathname.split('/');
    const chunkHash = parts[parts.length - 2];
    
    if (!chunkHash || chunkHash.length !== 64) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid chunk hash' }));
      metrics.errorCount++;
      return;
    }
    
    try {
      const chunkPath = getChunkPath(chunkHash);
      
      if (!fs.existsSync(chunkPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Chunk not found' }));
        return;
      }
      
      const data = fs.readFileSync(chunkPath);
      const computedHash = crypto.createHash('sha256').update(data).digest('hex');
      const isValid = computedHash === chunkHash;
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        chunkHash: chunkHash,
        isValid: isValid,
        computedHash: computedHash,
        nodeId: NODE_ID
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
      metrics.errorCount++;
    }
    return;
  }
  
  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Storage Node ${NODE_ID} listening on port ${PORT}`);
  console.log(`Availability Zone: ${AVAILABILITY_ZONE}`);
  console.log(`Region: ${REGION}`);
  console.log(`Data Directory: ${DATA_DIR}`);
  console.log(`Capacity: ${CAPACITY} bytes`);
});
