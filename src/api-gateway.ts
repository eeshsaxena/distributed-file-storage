import http from 'http';
import { URL } from 'url';
import { UploadManager } from './interfaces/upload-manager.interface';
import { VersionManager } from './interfaces/version-manager.interface';
import { AccessControl, Operation } from './interfaces/access-control.interface';
import { MetadataStore } from './interfaces/metadata-store.interface';
import { MonitoringService } from './monitoring';

/**
 * API Gateway
 *
 * Lightweight HTTP server exposing REST endpoints for the distributed file
 * storage system. Uses Node.js built-in http module — no external framework.
 *
 * Endpoints:
 *   POST   /files/upload                                  – create upload session
 *   PUT    /files/upload/:sessionId/chunks/:seq           – upload chunk
 *   POST   /files/upload/:sessionId/finalize              – finalize upload
 *   GET    /files/:fileId                                 – download file metadata
 *   GET    /files/:fileId/versions                        – list versions
 *   GET    /files/:fileId/versions/:version               – get specific version
 *   DELETE /files/:fileId                                 – delete file
 *   POST   /files/:fileId/permissions                     – grant permission
 *   DELETE /files/:fileId/permissions/:userId             – revoke permission
 *   GET    /health                                        – health check (<500ms)
 *   GET    /metrics                                       – metrics (<1s)
 */
export class APIGateway {
  private server: http.Server;

  constructor(
    private readonly uploadManager: UploadManager,
    private readonly versionManager: VersionManager,
    private readonly accessControl: AccessControl,
    private readonly metadataStore: MetadataStore,
    private readonly monitoring: MonitoringService
  ) {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) => this.server.listen(port, resolve));
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve()))
    );
  }

  // ─── Request dispatcher ───────────────────────────────────────────────────

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    try {
      // Health check
      if (method === 'GET' && path === '/health') {
        return this.sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
      }

      // Metrics
      if (method === 'GET' && path === '/metrics') {
        const metrics = await this.monitoring.getMetrics();
        return this.sendJson(res, 200, metrics);
      }

      // POST /files/upload
      if (method === 'POST' && path === '/files/upload') {
        const body = await this.readBody(req);
        const { fileId, fileName, totalChunks, userId } = JSON.parse(body);
        const session = await this.uploadManager.createSession(fileId, fileName, totalChunks, userId);
        return this.sendJson(res, 201, session);
      }

      // PUT /files/upload/:sessionId/chunks/:seq
      const chunkUploadMatch = path.match(/^\/files\/upload\/([^/]+)\/chunks\/(\d+)$/);
      if (method === 'PUT' && chunkUploadMatch) {
        const [, sessionId, seqStr] = chunkUploadMatch;
        const body = await this.readBody(req);
        const { chunkHash } = JSON.parse(body);
        await this.uploadManager.markChunkUploaded(sessionId, parseInt(seqStr, 10), chunkHash);
        return this.sendJson(res, 200, { ok: true });
      }

      // POST /files/upload/:sessionId/finalize
      const finalizeMatch = path.match(/^\/files\/upload\/([^/]+)\/finalize$/);
      if (method === 'POST' && finalizeMatch) {
        const [, sessionId] = finalizeMatch;
        const metadata = await this.uploadManager.finalizeUpload(sessionId);
        return this.sendJson(res, 200, metadata);
      }

      // GET /files/:fileId/versions/:version
      const versionMatch = path.match(/^\/files\/([^/]+)\/versions\/(\d+)$/);
      if (method === 'GET' && versionMatch) {
        const [, fileId, versionStr] = versionMatch;
        const userId = this.extractUserId(req);
        const allowed = await this.accessControl.checkPermission(userId, fileId, Operation.READ);
        if (!allowed) return this.sendJson(res, 403, { error: 'Forbidden' });
        const version = await this.versionManager.getVersion(fileId, parseInt(versionStr, 10));
        return this.sendJson(res, 200, version);
      }

      // GET /files/:fileId/versions
      const versionsMatch = path.match(/^\/files\/([^/]+)\/versions$/);
      if (method === 'GET' && versionsMatch) {
        const [, fileId] = versionsMatch;
        const userId = this.extractUserId(req);
        const allowed = await this.accessControl.checkPermission(userId, fileId, Operation.READ);
        if (!allowed) return this.sendJson(res, 403, { error: 'Forbidden' });
        const versions = await this.versionManager.listVersions(fileId);
        return this.sendJson(res, 200, versions);
      }

      // GET /files/:fileId
      const fileMatch = path.match(/^\/files\/([^/]+)$/);
      if (method === 'GET' && fileMatch) {
        const [, fileId] = fileMatch;
        const userId = this.extractUserId(req);
        const allowed = await this.accessControl.checkPermission(userId, fileId, Operation.READ);
        if (!allowed) return this.sendJson(res, 403, { error: 'Forbidden' });
        const file = await this.metadataStore.getFile(fileId);
        if (!file) return this.sendJson(res, 404, { error: 'Not found' });
        return this.sendJson(res, 200, file);
      }

      // DELETE /files/:fileId/permissions/:userId
      const revokeMatch = path.match(/^\/files\/([^/]+)\/permissions\/([^/]+)$/);
      if (method === 'DELETE' && revokeMatch) {
        const [, fileId, targetUserId] = revokeMatch;
        const ownerId = this.extractUserId(req);
        await this.accessControl.revokePermission(ownerId, fileId, targetUserId);
        return this.sendJson(res, 200, { ok: true });
      }

      // POST /files/:fileId/permissions
      const grantMatch = path.match(/^\/files\/([^/]+)\/permissions$/);
      if (method === 'POST' && grantMatch) {
        const [, fileId] = grantMatch;
        const ownerId = this.extractUserId(req);
        const body = await this.readBody(req);
        const { targetUserId, permission } = JSON.parse(body);
        await this.accessControl.grantPermission(ownerId, fileId, targetUserId, permission);
        return this.sendJson(res, 200, { ok: true });
      }

      // DELETE /files/:fileId
      const deleteMatch = path.match(/^\/files\/([^/]+)$/);
      if (method === 'DELETE' && deleteMatch) {
        const [, fileId] = deleteMatch;
        const userId = this.extractUserId(req);
        const allowed = await this.accessControl.checkPermission(userId, fileId, Operation.DELETE);
        if (!allowed) return this.sendJson(res, 403, { error: 'Forbidden' });
        await this.metadataStore.deleteFile(fileId);
        return this.sendJson(res, 200, { ok: true });
      }

      this.sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      this.sendJson(res, 500, { error: message });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
    res.end(json);
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
      req.on('error', reject);
    });
  }

  private extractUserId(req: http.IncomingMessage): string {
    // In production this would validate a JWT token from Authorization header
    return (req.headers['x-user-id'] as string) ?? 'anonymous';
  }
}
