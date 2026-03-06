/**
 * backend/health-reporter.js
 * Pushes heartbeat logs + last diagnostics to the enterprise backend every 5 minutes.
 */

const axios = require('axios');
const authManager = require('./auth');
const heartbeat = require('./heartbeat');
const doctor = require('./doctor');

const API_URL = process.env.ENTERPRISE_URL || 'http://localhost:3000';
const REPORT_INTERVAL = 5 * 60 * 1000; // 5 minutes

class HealthReporter {
  constructor() {
    this._timer = null;
    this._rootPath = null;
  }

  start(rootPath) {
    this.stop();
    this._rootPath = rootPath;
    this._timer = setInterval(() => this._report(), REPORT_INTERVAL);
    if (this._timer.unref) this._timer.unref();
    console.log('[HealthReporter] Started (interval=5min)');
    // First report after 10s to let heartbeat fire first
    setTimeout(() => this._report(), 10000);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _report() {
    const session = authManager.getSession();
    if (!session?.idToken) return;

    try {
      const [heartbeatLogs, diagnostics] = await Promise.all([
        heartbeat.getHeartbeatHistory(60),
        doctor.getLastDiagnostics(),
      ]);

      let currentStatus = 'UNKNOWN';
      if (heartbeatLogs.length > 0) {
        const latest = heartbeatLogs[heartbeatLogs.length - 1];
        const isRecent = Date.now() - new Date(latest.timestamp).getTime() < 2 * 60 * 1000;
        currentStatus = isRecent && latest.status === 'SUCCESS' ? 'ACTIVE' : 'OFFLINE';
      }

      await axios.post(
        `${API_URL}/api/agent/health`,
        { heartbeatLogs, diagnostics, currentStatus },
        { headers: { Authorization: `Bearer ${session.idToken}` }, timeout: 15000 }
      );

      console.log(`[HealthReporter] Pushed health data (status=${currentStatus}, beats=${heartbeatLogs.length}, diags=${diagnostics.length})`);
    } catch (err) {
      console.error('[HealthReporter] Failed:', err.message);
    }
  }
}

module.exports = new HealthReporter();
