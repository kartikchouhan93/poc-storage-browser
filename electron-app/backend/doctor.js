/**
 * backend/doctor.js
 * Enterprise-grade diagnostics for the CloudVault agent.
 * 
 * Provides 5 health checks:
 *   1. Clock Skew Detection — compares local time with server time
 *   2. Disk I/O Performance — tests read/write/rename/delete operations
 *   3. Multipart Handshake — validates S3 multipart upload permissions
 *   4. Proxy Detection — checks if TLS is being intercepted
 *   5. Service Health — fetches backend service status
 */

const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const tls = require('tls');
const { v4: uuidv4 } = require('uuid');
const { S3Client, CreateMultipartUploadCommand, AbortMultipartUploadCommand } = require('@aws-sdk/client-s3');
const database = require('./database');
const authManager = require('./auth');
const credentialManager = require('./aws-credentials');

const API_URL = process.env.ENTERPRISE_URL || 'http://localhost:3000';

class DoctorManager {
  /**
   * Run all diagnostics in parallel and persist results to SQLite
   */
  async runAll(rootPath) {
    const results = await Promise.allSettled([
      this.checkClockSkew(),
      this.checkDiskIO(rootPath),
      this.checkServiceHealth(),
      this.checkProxyDetection(),
      this._getFirstBucket().then(bucket =>
        bucket ? this.checkMultipartHandshake(bucket.id) : this._skipMultipart()
      ),
    ]);

    const diagnostics = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        name: ['Clock Skew', 'Disk I/O', 'Service Health', 'Proxy Detection', 'Multipart Handshake'][i],
        status: 'fail',
        detail: `Error: ${r.reason?.message || 'Unknown error'}`,
        durationMs: 0,
      };
    });

    // Persist to SQLite — replace all previous results
    await this._persistDiagnostics(diagnostics);
    return diagnostics;
  }

  async _persistDiagnostics(diagnostics) {
    try {
      await database.query(`DELETE FROM "DiagnosticsLog"`, []);
      for (const d of diagnostics) {
        await database.query(
          `INSERT INTO "DiagnosticsLog" (id, name, status, detail, "durationMs", data)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [uuidv4(), d.name, d.status, d.detail, d.durationMs || 0, d.data ? JSON.stringify(d.data) : null]
        );
      }
    } catch (err) {
      console.error('[Doctor] Failed to persist diagnostics:', err.message);
    }
  }

  async getLastDiagnostics() {
    try {
      const result = await database.query(
        `SELECT * FROM "DiagnosticsLog" ORDER BY "ranAt" DESC`
      );
      return result.rows.map(r => ({
        ...r,
        data: r.data ? JSON.parse(r.data) : null,
      }));
    } catch (err) {
      console.error('[Doctor] Failed to fetch diagnostics:', err.message);
      return [];
    }
  }

  /**
   * 1. Clock Skew Detection
   * Compares local time with server time from heartbeat response.
   * Fails if drift > 5 minutes (AWS S3 will reject presigned URLs).
   */
  async checkClockSkew() {
    const start = Date.now();
    try {
      const session = authManager.getSession();
      if (!session?.idToken) {
        return {
          name: 'Clock Skew',
          status: 'fail',
          detail: 'Not authenticated',
          durationMs: Date.now() - start,
        };
      }

      const response = await axios.get(`${API_URL}/api/heartbeat`, {
        headers: { Authorization: `Bearer ${session.idToken}` },
        timeout: 10000,
      });

      const localTime = Date.now();
      const serverTimeStr = response.headers['date'] || response.data?.serverTime;
      const serverTime = new Date(serverTimeStr).getTime();
      const driftMs = Math.abs(localTime - serverTime);
      const driftSec = Math.round(driftMs / 1000);

      const status = driftMs < 5 * 60 * 1000 ? 'pass' : 'fail';
      const detail = `Drift: ${driftSec}s (${status === 'pass' ? 'within tolerance' : 'exceeds 5 min limit'})`;

      return {
        name: 'Clock Skew',
        status,
        detail,
        durationMs: Date.now() - start,
        data: { localTime, serverTime, driftMs, driftSec },
      };
    } catch (err) {
      return {
        name: 'Clock Skew',
        status: 'fail',
        detail: `Error: ${err.message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * 2. Disk I/O Performance
   * Creates/reads/renames/deletes a 1KB test file in the sync root.
   * Fails if any operation takes > 5 seconds or throws an error.
   */
  async checkDiskIO(rootPath) {
    const start = Date.now();
    const testFile = path.join(rootPath, `.cloudvault-io-test-${Date.now()}.tmp`);
    const renamedFile = path.join(rootPath, `.cloudvault-io-test-renamed-${Date.now()}.tmp`);
    const testData = Buffer.alloc(1024, 'x'); // 1KB

    try {
      // Ensure root path exists
      await fs.mkdir(rootPath, { recursive: true });

      // Write test
      const writeStart = Date.now();
      await fs.writeFile(testFile, testData);
      const writeMs = Date.now() - writeStart;

      // Read test
      const readStart = Date.now();
      await fs.readFile(testFile);
      const readMs = Date.now() - readStart;

      // Rename test
      const renameStart = Date.now();
      await fs.rename(testFile, renamedFile);
      const renameMs = Date.now() - renameStart;

      // Delete test
      const deleteStart = Date.now();
      await fs.unlink(renamedFile);
      const deleteMs = Date.now() - deleteStart;

      const maxMs = Math.max(writeMs, readMs, renameMs, deleteMs);
      const status = maxMs < 5000 ? 'pass' : 'warn';
      const detail = `Write: ${writeMs}ms | Read: ${readMs}ms | Rename: ${renameMs}ms | Delete: ${deleteMs}ms`;

      return {
        name: 'Disk I/O',
        status,
        detail,
        durationMs: Date.now() - start,
        data: { writeMs, readMs, renameMs, deleteMs },
      };
    } catch (err) {
      // Cleanup on error
      try { await fs.unlink(testFile).catch(() => {}); } catch {}
      try { await fs.unlink(renamedFile).catch(() => {}); } catch {}

      return {
        name: 'Disk I/O',
        status: 'fail',
        detail: `Error: ${err.message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * 3. Multipart Handshake Test
   * Initiates a multipart upload and immediately aborts it.
   * Validates s3:PutObject + s3:AbortMultipartUpload permissions.
   */
  async checkMultipartHandshake(bucketId) {
    const start = Date.now();
    try {
      // Get bucket info
      const bucketRes = await database.query(
        'SELECT name, region FROM "Bucket" WHERE id = $1',
        [bucketId]
      );
      if (bucketRes.rows.length === 0) {
        return {
          name: 'Multipart Handshake',
          status: 'fail',
          detail: 'Bucket not found',
          durationMs: Date.now() - start,
        };
      }

      const { name: bucketName, region } = bucketRes.rows[0];

      // Get credentials
      const credentials = await credentialManager.getCredentialsForBucket(bucketId);

      const s3 = new S3Client({
        region: credentials.region || region,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      });

      // Initiate multipart upload
      const testKey = `.cloudvault-multipart-test-${Date.now()}.tmp`;
      const createCmd = new CreateMultipartUploadCommand({
        Bucket: bucketName,
        Key: testKey,
      });
      const createRes = await s3.send(createCmd);

      // Immediately abort
      const abortCmd = new AbortMultipartUploadCommand({
        Bucket: bucketName,
        Key: testKey,
        UploadId: createRes.UploadId,
      });
      await s3.send(abortCmd);

      return {
        name: 'Multipart Handshake',
        status: 'pass',
        detail: `Successfully validated multipart permissions on ${bucketName}`,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        name: 'Multipart Handshake',
        status: 'fail',
        detail: `Error: ${err.message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * 4. Proxy Detection
   * Checks if TLS is being intercepted by a corporate proxy.
   * Connects to S3 endpoint and inspects the certificate chain.
   */
  async checkProxyDetection() {
    const start = Date.now();
    return new Promise((resolve) => {
      const socket = tls.connect({
        host: 's3.amazonaws.com',
        port: 443,
        servername: 's3.amazonaws.com',
        rejectUnauthorized: false, // We want to see the cert even if invalid
      }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();

        const issuer = cert.issuer?.O || cert.issuer?.CN || 'Unknown';
        const isAmazon = issuer.toLowerCase().includes('amazon') || 
                        issuer.toLowerCase().includes('aws') ||
                        cert.subject?.CN?.includes('amazonaws.com');

        const status = isAmazon ? 'pass' : 'warn';
        const detail = isAmazon 
          ? 'Direct connection to AWS S3'
          : `Proxy detected: Certificate issued by "${issuer}"`;

        resolve({
          name: 'Proxy Detection',
          status,
          detail,
          durationMs: Date.now() - start,
          data: { issuer, directConnection: isAmazon },
        });
      });

      socket.on('error', (err) => {
        resolve({
          name: 'Proxy Detection',
          status: 'fail',
          detail: `Error: ${err.message}`,
          durationMs: Date.now() - start,
        });
      });

      socket.setTimeout(10000, () => {
        socket.destroy();
        resolve({
          name: 'Proxy Detection',
          status: 'fail',
          detail: 'Connection timeout',
          durationMs: Date.now() - start,
        });
      });
    });
  }

  /**
   * 5. Service Health
   * Fetches backend service status from heartbeat endpoint.
   */
  async checkServiceHealth() {
    const start = Date.now();
    try {
      const session = authManager.getSession();
      if (!session?.idToken) {
        return {
          name: 'Service Health',
          status: 'fail',
          detail: 'Not authenticated',
          durationMs: Date.now() - start,
        };
      }

      const response = await axios.get(`${API_URL}/api/heartbeat`, {
        headers: { Authorization: `Bearer ${session.idToken}` },
        timeout: 10000,
      });

      const data = response.data || {};
      const detail = data.ok ? 'All services operational' : 'Service degraded';

      return {
        name: 'Service Health',
        status: data.ok ? 'pass' : 'warn',
        detail,
        durationMs: Date.now() - start,
        data: {
          serverTime: data.serverTime,
          type: data.type,
        },
      };
    } catch (err) {
      return {
        name: 'Service Health',
        status: 'fail',
        detail: `Error: ${err.message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  async _getFirstBucket() {
    try {
      const result = await database.query('SELECT id FROM "Bucket" LIMIT 1');
      return result.rows[0] || null;
    } catch {
      return null;
    }
  }

  _skipMultipart() {
    return {
      name: 'Multipart Handshake',
      status: 'warn',
      detail: 'Skipped: No buckets available',
      durationMs: 0,
    };
  }
}

module.exports = new DoctorManager();
