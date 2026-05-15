# Distributed File Storage System

A cloud-native distributed file storage platform with chunking, replication, deduplication, encryption, versioning, and CDN delivery.

## Features

- **File Chunking**: Files are divided into 8MB fixed-size chunks for efficient distribution
- **Data Replication**: 3-way replication across different availability zones for high availability
- **Content Deduplication**: SHA-256 content-based deduplication to minimize storage costs
- **Resumable Uploads**: Support for interrupted upload resumption with 7-day session persistence
- **CDN Delivery**: Geographic content delivery with edge caching for low-latency access
- **Encryption**: AES-256-GCM encryption at rest with per-file keys and master key rotation
- **File Versioning**: Immutable version history with configurable retention policies
- **Access Control**: JWT-based authentication with granular file permissions

## Architecture

The system consists of the following components:

- **API Gateway**: REST API for client interactions
- **Chunk Manager**: File chunking and reassembly
- **Replication Service**: Multi-node chunk replication with consistent hashing
- **Deduplication Engine**: Content-based deduplication with reference counting
- **Upload Manager**: Resumable upload session management
- **CDN Gateway**: Edge caching and content delivery
- **Encryption Service**: Data encryption and key management
- **Version Manager**: File version tracking and retention
- **Storage Nodes**: Distributed chunk storage
- **Metadata Store**: PostgreSQL database for system metadata
- **Key Management**: HSM-backed master key storage

## Prerequisites

- Node.js 20.x or higher
- Docker and Docker Compose
- npm or yarn

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd distributed-file-storage
```

2. Install dependencies:
```bash
npm install
```

3. Start the Docker infrastructure:
```bash
npm run docker:up
```

This will start:
- PostgreSQL database (port 5432)
- Redis cache (port 6379)
- Mock HSM service (port 3001)
- 3 Storage nodes (ports 4001-4003)

4. Build the TypeScript code:
```bash
npm run build
```

## Development

### Project Structure

```
distributed-file-storage/
├── src/                    # Source code
├── tests/
│   ├── properties/         # Property-based tests (fast-check)
│   ├── unit/              # Unit tests
│   └── integration/       # Integration tests
├── docker/                # Docker configuration
│   ├── init-db.sql       # Database schema
│   └── mock-hsm/         # Mock HSM service
├── dist/                  # Compiled output
└── coverage/             # Test coverage reports
```

### Available Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm test` - Run all tests
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests only
- `npm run test:properties` - Run property-based tests only
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Lint code with ESLint
- `npm run lint:fix` - Fix linting issues automatically
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting
- `npm run docker:up` - Start Docker services
- `npm run docker:down` - Stop Docker services
- `npm run docker:logs` - View Docker logs

### Running Tests

Run all tests:
```bash
npm test
```

Run specific test suites:
```bash
npm run test:unit
npm run test:integration
npm run test:properties
```

Run tests with coverage:
```bash
npm run test:coverage
```

### Code Quality

The project uses ESLint and Prettier for code quality:

```bash
# Check linting
npm run lint

# Fix linting issues
npm run lint:fix

# Check formatting
npm run format:check

# Format code
npm run format
```

## Testing Strategy

The project uses three types of tests:

1. **Property-Based Tests** (`tests/properties/`): Using fast-check to validate universal correctness properties across random inputs
2. **Unit Tests** (`tests/unit/`): Testing individual components and functions
3. **Integration Tests** (`tests/integration/`): Testing component interactions and infrastructure

Target code coverage: 80% for core components

## Docker Services

### PostgreSQL
- Port: 5432
- Database: `distributed_file_storage`
- User: `dfs_user`
- Password: `dfs_password`

### Redis
- Port: 6379
- Persistence: AOF enabled

### Mock HSM
- Port: 3001
- Endpoints:
  - `GET /health` - Health check
  - `GET /master-key` - Get current master key
  - `POST /master-key/rotate` - Rotate master key
  - `POST /encrypt` - Encrypt data
  - `POST /decrypt` - Decrypt data

### Storage Nodes
- Node 1: Port 4001 (us-east-1a)
- Node 2: Port 4002 (us-east-1b)
- Node 3: Port 4003 (us-east-1c)

## Configuration

Environment variables can be set in `.env` file:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=distributed_file_storage
DB_USER=dfs_user
DB_PASSWORD=dfs_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# HSM
HSM_URL=http://localhost:3001

# Storage
CHUNK_SIZE=8388608  # 8MB
REPLICATION_FACTOR=3
```

## License

MIT
