-- Initialize database schema for Distributed File Storage System

-- Files table
CREATE TABLE IF NOT EXISTS files (
    file_id UUID PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    owner_id VARCHAR(255) NOT NULL,
    current_version INTEGER NOT NULL DEFAULT 1,
    total_size BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    retention_days INTEGER NOT NULL DEFAULT 30
);

CREATE INDEX idx_files_owner_id ON files(owner_id);
CREATE INDEX idx_files_created_at ON files(created_at);

-- File versions table
CREATE TABLE IF NOT EXISTS file_versions (
    file_id UUID NOT NULL,
    version INTEGER NOT NULL,
    chunk_hashes TEXT[] NOT NULL,
    size BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id VARCHAR(255) NOT NULL,
    content_type VARCHAR(100),
    checksum VARCHAR(64),
    PRIMARY KEY (file_id, version),
    FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE
);

CREATE INDEX idx_file_versions_created_at ON file_versions(created_at);

-- Chunks table
CREATE TABLE IF NOT EXISTS chunks (
    chunk_hash VARCHAR(64) PRIMARY KEY,
    size INTEGER NOT NULL,
    encrypted_size INTEGER NOT NULL,
    reference_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_verified TIMESTAMP
);

CREATE INDEX idx_chunks_reference_count ON chunks(reference_count);
CREATE INDEX idx_chunks_last_verified ON chunks(last_verified);

-- Storage nodes table
CREATE TABLE IF NOT EXISTS storage_nodes (
    node_id VARCHAR(255) PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    port INTEGER NOT NULL,
    availability_zone VARCHAR(100) NOT NULL,
    region VARCHAR(100) NOT NULL,
    capacity BIGINT NOT NULL,
    used_space BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    registered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    virtual_node_ids TEXT[]
);

CREATE INDEX idx_storage_nodes_status ON storage_nodes(status);
CREATE INDEX idx_storage_nodes_availability_zone ON storage_nodes(availability_zone);

-- Chunk replicas table
CREATE TABLE IF NOT EXISTS chunk_replicas (
    chunk_hash VARCHAR(64) NOT NULL,
    node_id VARCHAR(255) NOT NULL,
    availability_zone VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chunk_hash, node_id),
    FOREIGN KEY (chunk_hash) REFERENCES chunks(chunk_hash) ON DELETE CASCADE,
    FOREIGN KEY (node_id) REFERENCES storage_nodes(node_id) ON DELETE CASCADE
);

-- Upload sessions table
CREATE TABLE IF NOT EXISTS upload_sessions (
    session_id UUID PRIMARY KEY,
    file_id UUID NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    total_chunks INTEGER NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
);

CREATE INDEX idx_upload_sessions_file_id ON upload_sessions(file_id);
CREATE INDEX idx_upload_sessions_user_id ON upload_sessions(user_id);
CREATE INDEX idx_upload_sessions_expires_at ON upload_sessions(expires_at);
CREATE INDEX idx_upload_sessions_status ON upload_sessions(status);

-- Uploaded chunks tracking table
CREATE TABLE IF NOT EXISTS uploaded_chunks (
    session_id UUID NOT NULL,
    sequence_number INTEGER NOT NULL,
    chunk_hash VARCHAR(64) NOT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, sequence_number),
    FOREIGN KEY (session_id) REFERENCES upload_sessions(session_id) ON DELETE CASCADE
);

-- File permissions table
CREATE TABLE IF NOT EXISTS file_permissions (
    file_id UUID NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    permission VARCHAR(20) NOT NULL,
    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    granted_by VARCHAR(255) NOT NULL,
    PRIMARY KEY (file_id, user_id),
    FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE
);

-- Access audit log table
CREATE TABLE IF NOT EXISTS access_audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    file_id UUID NOT NULL,
    operation VARCHAR(20) NOT NULL,
    result BOOLEAN NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    user_agent TEXT
);

CREATE INDEX idx_access_audit_log_user_id ON access_audit_log(user_id);
CREATE INDEX idx_access_audit_log_file_id ON access_audit_log(file_id);
CREATE INDEX idx_access_audit_log_timestamp ON access_audit_log(timestamp);
