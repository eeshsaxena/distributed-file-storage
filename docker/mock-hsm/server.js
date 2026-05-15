const http = require('http');
const crypto = require('crypto');

// Mock HSM service for development
// Simulates a Hardware Security Module for key management

const masterKeys = new Map();
let currentKeyVersion = 1;

// Initialize with a master key
masterKeys.set(currentKeyVersion, crypto.randomBytes(32));

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  // Health check endpoint
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'healthy', service: 'mock-hsm' }));
    return;
  }

  // Get current master key
  if (req.method === 'GET' && req.url === '/master-key') {
    res.writeHead(200);
    res.end(JSON.stringify({
      keyVersion: currentKeyVersion,
      key: masterKeys.get(currentKeyVersion).toString('base64'),
    }));
    return;
  }

  // Get specific key version
  if (req.method === 'GET' && req.url.startsWith('/master-key/')) {
    const version = parseInt(req.url.split('/')[2]);
    const key = masterKeys.get(version);
    
    if (key) {
      res.writeHead(200);
      res.end(JSON.stringify({
        keyVersion: version,
        key: key.toString('base64'),
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Key version not found' }));
    }
    return;
  }

  // Rotate master key
  if (req.method === 'POST' && req.url === '/master-key/rotate') {
    currentKeyVersion++;
    masterKeys.set(currentKeyVersion, crypto.randomBytes(32));
    
    res.writeHead(200);
    res.end(JSON.stringify({
      message: 'Master key rotated',
      newKeyVersion: currentKeyVersion,
    }));
    return;
  }

  // Encrypt data (for testing)
  if (req.method === 'POST' && req.url === '/encrypt') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { data, keyVersion } = JSON.parse(body);
        const key = masterKeys.get(keyVersion || currentKeyVersion);
        
        if (!key) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Key version not found' }));
          return;
        }

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        
        const encrypted = Buffer.concat([
          cipher.update(Buffer.from(data, 'base64')),
          cipher.final(),
        ]);
        
        const authTag = cipher.getAuthTag();
        
        res.writeHead(200);
        res.end(JSON.stringify({
          encrypted: encrypted.toString('base64'),
          iv: iv.toString('base64'),
          authTag: authTag.toString('base64'),
          keyVersion: keyVersion || currentKeyVersion,
        }));
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // Decrypt data (for testing)
  if (req.method === 'POST' && req.url === '/decrypt') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { encrypted, iv, authTag, keyVersion } = JSON.parse(body);
        const key = masterKeys.get(keyVersion);
        
        if (!key) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Key version not found' }));
          return;
        }

        const decipher = crypto.createDecipheriv(
          'aes-256-gcm',
          key,
          Buffer.from(iv, 'base64')
        );
        
        decipher.setAuthTag(Buffer.from(authTag, 'base64'));
        
        const decrypted = Buffer.concat([
          decipher.update(Buffer.from(encrypted, 'base64')),
          decipher.final(),
        ]);
        
        res.writeHead(200);
        res.end(JSON.stringify({
          data: decrypted.toString('base64'),
        }));
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // Not found
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Mock HSM service running on port ${PORT}`);
});
