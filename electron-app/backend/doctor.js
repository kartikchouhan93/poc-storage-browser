/**
 * backend/doctor.js
 * Enterprise-grade diagnostics with step-by-step progress reporting.
 * Each diagnostic emits granular sub-step events to the renderer.
 */

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const axios = require('axios');
const tls = require('tls');
const { v4: uuidv4 } = require('uuid');
const { S3Client, CreateMultipartUploadCommand, AbortMultipartUploadCommand } = require('@aws-sdk/client-s3');
const database = require('./database');
const authManager = require('./auth');
const credentialManager = require('./aws-credentials');
const { ENTERPRISE_URL } = require('./config');

const API_URL = ENTERPRISE_URL + '/api';

class DoctorManager {
  constructor() {
    this._mainWindow = null;
  }

  initUI(mainWindow) {
    this._mainWindow = mainWindow;
  }

  _emit(event) {
    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send('doctor:progress', event);
    }
  }

  /**
   * Run all diagnostics sequentially so the UI can show step-by-step progress.
   */
  async runAll(rootPath, userId = null) {
    const diagnostics = [];

    const checks = [
      () => this.checkDiskIO(rootPath),
      () => this.checkServiceHealth(),
      () => this.checkClockSkew(),
      () => this.checkProxyDetection(),
      async () => {
        const bucket = await this._getFirstBucket(userId);
        return bucket ? this.checkMultipartHandshake(bucket.id) : this._skipMultipart();
      },
      () => this.checkRouteTrace(),
    ];

    for (const check of checks) {
      try {
        const result = await check();
        diagnostics.push(result);
      } catch (err) {
        diagnostics.push({
          name: 'Unknown',
          status: 'fail',
          detail: err.message,
          durationMs: 0,
          steps: [],
        });
      }
    }

    await this._persistDiagnostics(diagnostics, userId);
    this._emit({ type: 'all-complete', diagnostics });

    // Persist each diagnostic result to LocalSyncActivity so it appears in Recent Activities
    try {
      const syncHistory = require('./syncHistory');
      for (const d of diagnostics) {
        await syncHistory.logActivity(
          'DIAGNOSTIC',
          d.name,
          d.status === 'pass' ? 'SUCCESS' : 'FAILED',
          d.status !== 'pass' ? (d.detail || null) : null
        );
      }
    } catch (e) {
      console.warn('[Doctor] Failed to log diagnostics to activity log:', e.message);
    }

    return diagnostics;
  }

  // ── 1. Disk I/O ───────────────────────────────────────────────────────────
  async checkDiskIO(rootPath) {
    const name = 'Disk I/O';
    const start = Date.now();
    const steps = [];
    const testFile = path.join(rootPath, `.cloudvault-io-test-${Date.now()}.tmp`);
    const renamedFile = path.join(rootPath, `.cloudvault-io-renamed-${Date.now()}.tmp`);
    const testData = Buffer.alloc(1024, 'x');

    const step = (label, status, ms) => {
      const s = { label, status, ms };
      steps.push(s);
      this._emit({ type: 'step', diagnostic: name, step: s, steps: [...steps] });
      console.log(`[Doctor] ${name} → ${label}: ${status} (${ms}ms)`);
    };

    try {
      // Ensure dir
      this._emit({ type: 'start', diagnostic: name });
      await fs.mkdir(rootPath, { recursive: true });
      step('Ensure directory', 'pass', 0);

      // Write
      const w0 = Date.now();
      await fs.writeFile(testFile, testData);
      step('Write 1KB file', 'pass', Date.now() - w0);

      // Read
      const r0 = Date.now();
      await fs.readFile(testFile);
      step('Read file back', 'pass', Date.now() - r0);

      // Rename
      const rn0 = Date.now();
      await fs.rename(testFile, renamedFile);
      step('Rename file', 'pass', Date.now() - rn0);

      // Delete
      const d0 = Date.now();
      await fs.unlink(renamedFile);
      step('Delete file', 'pass', Date.now() - d0);

      const totalMs = Date.now() - start;
      return { name, status: 'pass', detail: steps.map(s => `${s.label}: ${s.ms}ms`).join(' → '), durationMs: totalMs, steps, data: { writeMs: steps[1].ms, readMs: steps[2].ms, renameMs: steps[3].ms, deleteMs: steps[4].ms } };
    } catch (err) {
      step(err.message, 'fail', 0);
      try { await fs.unlink(testFile).catch(() => {}); } catch {}
      try { await fs.unlink(renamedFile).catch(() => {}); } catch {}
      return { name, status: 'fail', detail: err.message, durationMs: Date.now() - start, steps };
    }
  }

  // ── 2. Service Health ─────────────────────────────────────────────────────
  async checkServiceHealth() {
    const name = 'Service Health';
    const start = Date.now();
    const steps = [];

    const step = (label, status, ms) => {
      const s = { label, status, ms };
      steps.push(s);
      this._emit({ type: 'step', diagnostic: name, step: s, steps: [...steps] });
      console.log(`[Doctor] ${name} → ${label}: ${status} (${ms}ms)`);
    };

    this._emit({ type: 'start', diagnostic: name });

    // Check auth
    const session = authManager.getSession();
    if (!session?.idToken) {
      step('Check authentication', 'fail', 0);
      return { name, status: 'fail', detail: 'Not authenticated', durationMs: 0, steps };
    }
    step('Check authentication', 'pass', 0);

    // Hit heartbeat
    try {
      const h0 = Date.now();
      const response = await axios.get(`${API_URL}/api/heartbeat`, {
        headers: { Authorization: `Bearer ${session.idToken}` },
        timeout: 10000,
      });
      step('Ping /api/heartbeat', 'pass', Date.now() - h0);

      // Parse response
      const data = response.data || {};
      step('Parse server response', data.ok ? 'pass' : 'warn', 0);

      // Check server time
      const serverTime = response.headers['date'] || data.serverTime;
      step(`Server time: ${serverTime}`, 'pass', 0);

      return {
        name, status: data.ok ? 'pass' : 'warn',
        detail: data.ok ? 'All services operational' : 'Service degraded',
        durationMs: Date.now() - start, steps,
        data: { serverTime: data.serverTime, type: data.type, ok: data.ok },
      };
    } catch (err) {
      step(`Ping failed: ${err.message}`, 'fail', Date.now() - start);
      return { name, status: 'fail', detail: err.message, durationMs: Date.now() - start, steps };
    }
  }

  // ── 3. Clock Skew ─────────────────────────────────────────────────────────
  async checkClockSkew() {
    const name = 'Clock Skew';
    const start = Date.now();
    const steps = [];

    const step = (label, status, ms) => {
      const s = { label, status, ms };
      steps.push(s);
      this._emit({ type: 'step', diagnostic: name, step: s, steps: [...steps] });
      console.log(`[Doctor] ${name} → ${label}: ${status} (${ms}ms)`);
    };

    this._emit({ type: 'start', diagnostic: name });

    const session = authManager.getSession();
    if (!session?.idToken) {
      step('Check authentication', 'fail', 0);
      return { name, status: 'fail', detail: 'Not authenticated', durationMs: 0, steps };
    }
    step('Check authentication', 'pass', 0);

    try {
      const h0 = Date.now();
      const response = await axios.get(`${API_URL}/api/heartbeat`, {
        headers: { Authorization: `Bearer ${session.idToken}` },
        timeout: 10000,
      });
      step('Fetch server time', 'pass', Date.now() - h0);

      const localTime = Date.now();
      const serverTimeStr = response.headers['date'] || response.data?.serverTime;
      const serverTime = new Date(serverTimeStr).getTime();
      step(`Local: ${new Date(localTime).toISOString()}`, 'pass', 0);
      step(`Server: ${serverTimeStr}`, 'pass', 0);

      const driftMs = Math.abs(localTime - serverTime);
      const driftSec = Math.round(driftMs / 1000);
      const status = driftMs < 5 * 60 * 1000 ? 'pass' : 'fail';
      step(`Drift: ${driftSec}s ${status === 'pass' ? '✓' : '✗ exceeds 5min'}`, status, 0);

      return { name, status, detail: `Drift: ${driftSec}s`, durationMs: Date.now() - start, steps, data: { driftMs, driftSec } };
    } catch (err) {
      step(`Error: ${err.message}`, 'fail', 0);
      return { name, status: 'fail', detail: err.message, durationMs: Date.now() - start, steps };
    }
  }

  // ── 4. Proxy Detection ────────────────────────────────────────────────────
  async checkProxyDetection() {
    const name = 'Proxy Detection';
    const start = Date.now();
    const steps = [];

    const step = (label, status, ms) => {
      const s = { label, status, ms };
      steps.push(s);
      this._emit({ type: 'step', diagnostic: name, step: s, steps: [...steps] });
      console.log(`[Doctor] ${name} → ${label}: ${status} (${ms}ms)`);
    };

    this._emit({ type: 'start', diagnostic: name });
    step('Connecting to s3.amazonaws.com:443', 'pass', 0);

    return new Promise((resolve) => {
      const c0 = Date.now();
      const socket = tls.connect({
        host: 's3.amazonaws.com', port: 443, servername: 's3.amazonaws.com',
        rejectUnauthorized: false,
      }, () => {
        step('TLS handshake complete', 'pass', Date.now() - c0);

        const cert = socket.getPeerCertificate();
        socket.end();

        const issuer = cert.issuer?.O || cert.issuer?.CN || 'Unknown';
        step(`Certificate issuer: ${issuer}`, 'pass', 0);

        const subject = cert.subject?.CN || 'Unknown';
        step(`Certificate subject: ${subject}`, 'pass', 0);

        const isAmazon = issuer.toLowerCase().includes('amazon') ||
                         issuer.toLowerCase().includes('aws') ||
                         subject.includes('amazonaws.com');

        const status = isAmazon ? 'pass' : 'warn';
        step(isAmazon ? 'Direct connection confirmed' : `Proxy detected: ${issuer}`, status, 0);

        resolve({ name, status, detail: isAmazon ? 'Direct connection to AWS S3' : `Proxy: ${issuer}`, durationMs: Date.now() - start, steps, data: { issuer, subject, directConnection: isAmazon } });
      });

      socket.on('error', (err) => {
        step(`Connection error: ${err.message}`, 'fail', Date.now() - c0);
        resolve({ name, status: 'fail', detail: err.message, durationMs: Date.now() - start, steps });
      });

      socket.setTimeout(10000, () => {
        socket.destroy();
        step('Connection timeout (10s)', 'fail', 10000);
        resolve({ name, status: 'fail', detail: 'Timeout', durationMs: Date.now() - start, steps });
      });
    });
  }

  // ── 5. Multipart Handshake ────────────────────────────────────────────────
  async checkMultipartHandshake(bucketId) {
    const name = 'Multipart Handshake';
    const start = Date.now();
    const steps = [];

    const step = (label, status, ms) => {
      const s = { label, status, ms };
      steps.push(s);
      this._emit({ type: 'step', diagnostic: name, step: s, steps: [...steps] });
      console.log(`[Doctor] ${name} → ${label}: ${status} (${ms}ms)`);
    };

    this._emit({ type: 'start', diagnostic: name });

    try {
      // Lookup bucket
      const b0 = Date.now();
      const bucketRes = await database.query('SELECT name, region FROM "Bucket" WHERE id = $1', [bucketId]);
      if (bucketRes.rows.length === 0) {
        step('Lookup bucket', 'fail', Date.now() - b0);
        return { name, status: 'fail', detail: 'Bucket not found', durationMs: Date.now() - start, steps };
      }
      const { name: bucketName, region } = bucketRes.rows[0];
      step(`Lookup bucket: ${bucketName}`, 'pass', Date.now() - b0);

      // Get credentials
      const cr0 = Date.now();
      const credentials = await credentialManager.getCredentialsForBucket(bucketId);
      step('Fetch STS credentials', 'pass', Date.now() - cr0);

      // Build S3 client
      const s3 = new S3Client({
        region: credentials.region || region,
        credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey, sessionToken: credentials.sessionToken },
      });
      step('Initialize S3 client', 'pass', 0);

      // Create multipart upload
      const testKey = `.cloudvault-multipart-test-${Date.now()}.tmp`;
      const cm0 = Date.now();
      const createRes = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucketName, Key: testKey }));
      step(`CreateMultipartUpload (UploadId: ${createRes.UploadId?.substring(0, 12)}...)`, 'pass', Date.now() - cm0);

      // Abort multipart upload
      const ab0 = Date.now();
      await s3.send(new AbortMultipartUploadCommand({ Bucket: bucketName, Key: testKey, UploadId: createRes.UploadId }));
      step('AbortMultipartUpload', 'pass', Date.now() - ab0);

      return { name, status: 'pass', detail: `Multipart permissions validated on ${bucketName}`, durationMs: Date.now() - start, steps };
    } catch (err) {
      step(`Error: ${err.message}`, 'fail', 0);
      return { name, status: 'fail', detail: err.message, durationMs: Date.now() - start, steps };
    }
  }

  // ── 6. Route Traceroute ─────────────────────────────────────────────────
  async checkRouteTrace() {
    const name = 'Route Trace';
    const start = Date.now();
    const steps = [];

    const step = (label, status, ms) => {
      const s = { label, status, ms };
      steps.push(s);
      this._emit({ type: 'step', diagnostic: name, step: s, steps: [...steps] });
      console.log(`[Doctor] ${name} → ${label}: ${status} (${ms}ms)`);
    };

    this._emit({ type: 'start', diagnostic: name });

    // Extract hostname from ENTERPRISE_URL
    let targetHost;
    try {
      targetHost = new URL(ENTERPRISE_URL).hostname;
      step(`Target: ${targetHost}`, 'pass', 0);
    } catch (err) {
      step(`Invalid target URL: ${ENTERPRISE_URL}`, 'fail', 0);
      return { name, status: 'fail', detail: 'Invalid enterprise URL', durationMs: Date.now() - start, steps };
    }

    // Pick the right command per platform
    const platform = os.platform();
    let cmd, args;
    if (platform === 'win32') {
      cmd = 'tracert';
      args = ['-d', '-w', '3000', '-h', '30', targetHost];
    } else {
      // macOS and Linux
      cmd = 'traceroute';
      args = ['-n', '-w', '3', '-m', '30', targetHost];
    }

    step(`Running ${cmd} (${platform})`, 'pass', 0);

    return new Promise((resolve) => {
      const t0 = Date.now();
      const child = execFile(cmd, args, { timeout: 60000 }, (err, stdout, stderr) => {
        const output = (stdout || '') + (stderr || '');

        if (err && !stdout) {
          step(`${cmd} failed: ${err.message}`, 'fail', Date.now() - t0);
          return resolve({ name, status: 'fail', detail: err.message, durationMs: Date.now() - start, steps });
        }

        // Parse hops from output
        const hops = [];
        const lines = output.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Match hop lines: starts with a number (hop count)
          // Windows: "  1    <1 ms    <1 ms    <1 ms  192.168.1.1"
          // Linux/Mac: " 1  192.168.1.1  0.456 ms  0.389 ms  0.352 ms"
          const hopMatch = trimmed.match(/^\s*(\d+)\s+(.+)/);
          if (!hopMatch) continue;

          const hopNum = parseInt(hopMatch[1], 10);
          const rest = hopMatch[2].trim();

          // Check for timeout (* * *)
          const isTimeout = /^\*\s+\*\s+\*/.test(rest) || rest === '* * *';

          // Extract IP addresses from the line
          const ipMatch = rest.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
          const ip = ipMatch ? ipMatch[1] : null;

          // Extract latency values
          const latencies = [];
          const latencyPattern = /(\d+(?:\.\d+)?)\s*ms/g;
          let m;
          while ((m = latencyPattern.exec(rest)) !== null) {
            latencies.push(parseFloat(m[1]));
          }
          // Handle Windows "<1 ms" as 0.5ms
          const subMsCount = (rest.match(/<1\s*ms/g) || []).length;
          for (let i = 0; i < subMsCount; i++) latencies.push(0.5);

          const avgMs = latencies.length > 0
            ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length * 100) / 100
            : null;

          if (isTimeout) {
            step(`Hop ${hopNum}: * * * (timeout)`, 'warn', 0);
            hops.push({ hop: hopNum, ip: null, avgMs: null, timeout: true });
          } else if (ip) {
            const label = avgMs !== null
              ? `Hop ${hopNum}: ${ip} (${avgMs}ms)`
              : `Hop ${hopNum}: ${ip}`;
            step(label, 'pass', avgMs || 0);
            hops.push({ hop: hopNum, ip, avgMs, timeout: false });
          }
        }

        if (hops.length === 0) {
          step('No hops detected — command may not be available', 'warn', 0);
          return resolve({ name, status: 'warn', detail: `${cmd} returned no parseable hops`, durationMs: Date.now() - start, steps });
        }

        const totalHops = hops.length;
        const reachedTarget = hops.some(h => h.ip === targetHost);
        const timeouts = hops.filter(h => h.timeout).length;

        const summaryStatus = reachedTarget ? 'pass' : (timeouts > totalHops / 2 ? 'fail' : 'warn');
        const detail = `${totalHops} hops, ${timeouts} timeouts${reachedTarget ? ', target reached' : ', target not confirmed'}`;
        step(detail, summaryStatus, 0);

        resolve({
          name,
          status: summaryStatus,
          detail,
          durationMs: Date.now() - start,
          steps,
          data: { targetHost, platform, totalHops, timeouts, reachedTarget, hops },
        });
      });
    });
  }


  // ── Persistence ───────────────────────────────────────────────────────────
  async _persistDiagnostics(diagnostics, userId = null) {
    try {
      // Delete only this user's previous diagnostics (or unscoped ones if no userId)
      if (userId) {
        await database.query(`DELETE FROM "DiagnosticsLog" WHERE "userId" = $1`, [userId]);
      } else {
        await database.query(`DELETE FROM "DiagnosticsLog" WHERE "userId" IS NULL`, []);
      }
      for (const d of diagnostics) {
        await database.query(
          `INSERT INTO "DiagnosticsLog" (id, name, status, detail, "durationMs", data, "userId")
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [uuidv4(), d.name, d.status, d.detail, d.durationMs || 0,
           JSON.stringify({ data: d.data || null, steps: d.steps || [] }), userId]
        );
      }
      console.log(`[Doctor] Persisted ${diagnostics.length} diagnostics to SQLite`);
    } catch (err) {
      console.error('[Doctor] Failed to persist:', err.message);
    }
  }

  async getLastDiagnostics(userId = null) {
    try {
      const result = userId
        ? await database.query(
            `SELECT * FROM "DiagnosticsLog" WHERE "userId" = $1 ORDER BY "ranAt" DESC`,
            [userId]
          )
        : await database.query(`SELECT * FROM "DiagnosticsLog" ORDER BY "ranAt" DESC`);
      return result.rows.map(r => {
        let parsed = {};
        try { parsed = JSON.parse(r.data); } catch {}
        return { ...r, data: parsed?.data || null, steps: parsed?.steps || [] };
      });
    } catch (err) {
      console.error('[Doctor] Failed to fetch:', err.message);
      return [];
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  async _getFirstBucket(userId = null) {
    try {
      const result = userId
        ? await database.query('SELECT id FROM "Bucket" WHERE "userId" = $1 LIMIT 1', [userId])
        : await database.query('SELECT id FROM "Bucket" LIMIT 1');
      return result.rows[0] || null;
    } catch { return null; }
  }

  _skipMultipart() {
    return { name: 'Multipart Handshake', status: 'warn', detail: 'Skipped: No buckets available', durationMs: 0, steps: [{ label: 'No buckets in local DB', status: 'warn', ms: 0 }] };
  }
}

module.exports = new DoctorManager();
