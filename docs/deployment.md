# Deployment Documentation

## System Architecture

The Distributed File Storage System is composed of the following services:

```
┌─────────────┐     ┌──────────────────────────────────────────────┐
│   Client    │────▶│              API Gateway (:3000)             │
└─────────────┘     └──────────────────────────────────────────────┘
                          │          │          │          │
                    ┌─────▼──┐ ┌────▼───┐ ┌───▼────┐ ┌──▼──────┐
                    │Upload  │ │Version │ │Access  │ │Monitoring│
                    │Manager │ │Manager │ │Control │ │Service  │
                    └────────┘ └────────┘ └────────┘ └─────────┘
                          │          │          │
                    ┌─────▼──────────▼──────────▼──────┐
                    │         Metadata Store            │
                    │         (PostgreSQL :5432)        │
                    └───────────────────────────────────┘
                          │
              ┌───────────┼───────────┐
        ┌─────▼──┐  ┌─────▼──┐  ┌────▼───┐
        │Storage │  │Storage │  │Storage │
        │Node 1  │  │Node 2  │  │Node 3  │
        │(:4001) │  │(:4002) │  │(:4003) │
        └────────┘  └────────┘  └────────┘
              │
        ┌─────▼──────────────────────────┐
        │  Mock HSM (:3001)  Redis(:6379)│
        └────────────────────────────────┘
```

### Components

| Component | Description | Port |
|-----------|-------------|------|
| API Gateway | REST API entry point | 3000 |
| PostgreSQL | Metadata store | 5432 |
| Redis | CDN edge cache | 6379 |
| Mock HSM | Master key management | 3001 |
| Storage Node 1 | Chunk storage (AZ: us-east-1a) | 4001 |
| Storage Node 2 | Chunk storage (AZ: us-east-1b) | 4002 |
| Storage Node 3 | Chunk storage (AZ: us-east-1c) | 4003 |

---

## API Endpoints

### Upload

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/files/upload` | Create upload session |
| `PUT` | `/files/upload/:sessionId/chunks/:seq` | Upload a chunk |
| `POST` | `/files/upload/:sessionId/finalize` | Finalize upload |

**Create session request body:**
```json
{ "fileId": "uuid", "fileName": "file.bin", "totalChunks": 10, "userId": "user-1" }
```

**Upload chunk request body:**
```json
{ "chunkHash": "sha256-hex-string" }
```

### Files

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/files/:fileId` | Get file metadata |
| `DELETE` | `/files/:fileId` | Delete file |
| `GET` | `/files/:fileId/versions` | List all versions |
| `GET` | `/files/:fileId/versions/:version` | Get specific version |

### Permissions

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/files/:fileId/permissions` | Grant permission |
| `DELETE` | `/files/:fileId/permissions/:userId` | Revoke permission |

**Grant permission request body:**
```json
{ "targetUserId": "user-2", "permission": "read" }
```

### System

| Method | Path | Description | SLA |
|--------|------|-------------|-----|
| `GET` | `/health` | Health check | < 500ms |
| `GET` | `/metrics` | Storage metrics | < 1s |

### Authentication

All requests must include the user identifier in the `x-user-id` header. In production, replace with JWT validation via `Authorization: Bearer <token>`.

---

## Configuration Options

All configuration is provided via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API Gateway listen port |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `distributed_file_storage` | Database name |
| `DB_USER` | `dfs_user` | Database user |
| `DB_PASSWORD` | `dfs_password` | Database password |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `HSM_URL` | `http://localhost:3001` | Mock HSM URL |
| `STORAGE_PATH` | `/data/chunks` | Storage node data directory |
| `NODE_ID` | — | Storage node identifier |
| `AVAILABILITY_ZONE` | — | Storage node availability zone |

Copy `.env.example` to `.env` and adjust values for your environment.

---

## Local Development

### Prerequisites

- Node.js 20+
- Docker Desktop
- npm

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start infrastructure (PostgreSQL, Redis, Mock HSM, Storage Nodes)
npm run docker:up

# 3. Build TypeScript
npm run build

# 4. Run tests
npm test

# 5. Stop infrastructure
npm run docker:down
```

### Running Tests

```bash
# All tests
npm test

# Unit tests only (no infrastructure required)
npm run test:unit

# Property-based tests only (no infrastructure required for most)
npm run test:properties

# With coverage report
npm run test:coverage
```

Tests requiring live infrastructure (PostgreSQL + Mock HSM):
- `tests/unit/encryption-service.test.ts`
- `tests/properties/encryption.property.test.ts`
- `tests/properties/upload.property.test.ts`

Run `npm run docker:up` before executing these tests.

---

## Monitoring and Alerting

### Metrics Endpoint

`GET /metrics` returns:

```json
{
  "capacity": {
    "totalCapacity": 3000000000,
    "usedCapacity": 450000000,
    "availableCapacity": 2550000000
  },
  "deduplicationRatio": 2.4,
  "replicationOverhead": {
    "uniqueStorage": 150000000,
    "replicatedStorage": 450000000,
    "overhead": 3
  },
  "chunkCount": 18750,
  "nodeCount": 3
}
```

### Key Metrics to Monitor

| Metric | Alert Threshold | Description |
|--------|----------------|-------------|
| Node disk usage | > 80% | Reduce new chunk assignments |
| Replica count | < 3 | Trigger re-replication within 5 min |
| Node heartbeat age | > 60s | Mark node offline |
| Metadata inconsistencies | > 0 | Trigger reconciliation |

### Background Jobs Schedule

| Job | Frequency | Description |
|-----|-----------|-------------|
| Replica integrity verification | Every 24h | Detect and repair corrupted replicas |
| Garbage collection | Daily | Delete zero-reference chunks |
| Session cleanup | On-demand | Remove expired upload sessions (> 7 days) |
| Metadata consistency check | Every 6h | Verify node heartbeats and metadata |

---

## Backup and Recovery

### Database Backup

```bash
# Backup PostgreSQL
docker exec dfs-postgres pg_dump -U dfs_user distributed_file_storage > backup.sql

# Restore
docker exec -i dfs-postgres psql -U dfs_user distributed_file_storage < backup.sql
```

### Storage Node Recovery

When a storage node fails:

1. The system detects the failure within **60 seconds** via missed heartbeats.
2. All chunks with replicas on the failed node are identified.
3. Re-replication is triggered for chunks with fewer than 3 healthy replicas.
4. New replicas are created on healthy nodes within **5 minutes**.
5. Metadata is updated with new replica locations.

### Master Key Rotation

The encryption master key should be rotated every 90 days:

```bash
curl -X POST http://localhost:3001/master-key/rotate
```

Old key versions are retained for decryption of existing data. New chunks are encrypted with the new key version automatically.

---

## Performance Characteristics

| Operation | Target | Notes |
|-----------|--------|-------|
| Upload speed | ≥ 100 Mbps | Up to 10 parallel chunks |
| Download speed | ≥ 100 Mbps | Up to 10 parallel chunks |
| CDN response time | < 100ms (p95) | Cached chunks at edge |
| Metadata API | < 1s | All metadata queries |
| Health check | < 500ms | `/health` endpoint |
| Node failure detection | < 60s | Via heartbeat monitoring |
| Re-replication | < 5 min | After replica count drops below 3 |
