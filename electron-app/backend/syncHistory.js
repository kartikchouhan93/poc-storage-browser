/**
 * SyncHistory Logger
 * ------------------
 * Two-phase sync history:
 *   Phase 1: Every upload/download activity is written immediately to the LOCAL Postgres DB
 *            (LocalSyncActivity table) — this is instant and works offline.
 *   Phase 2: When runSync() completes, it calls flush() which reads all unsynced rows from
 *            local DB, POSTs them as a single SyncHistory record to the Global DB (Next.js),
 *            then marks them as synced=true locally.
 *
 * Usage:
 *   syncHistory.logActivity('UPLOAD', 'myfile.txt', 'SUCCESS');
 *   syncHistory.logActivity('DOWNLOAD', 'photo.png', 'FAILED', 'HTTP 404');
 *   await syncHistory.flush();  // called at end of runSync()
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const database = require('./database');
const { ENTERPRISE_URL } = require('./config');

const API_URL = ENTERPRISE_URL + '/api';

class SyncHistoryLogger {
    constructor() {
        this.authToken = null;
        this.mainWindow = null;
        this.userId = null;
        this.botId = null;
    }

    initUI(mainWindow) {
        this.mainWindow = mainWindow;
    }

    init(token, userId = null, botId = null) {
        this.authToken = token;
        this.userId = userId;
        this.botId = botId;
        console.log('[SyncHistory] Logger initialized for userId:', userId, 'botId:', botId);
    }

    stop() {
        this.authToken = null;
        this.userId = null;
        this.botId = null;
    }

    /**
     * Phase 1: Write activity to LOCAL DB immediately.
     * Deduplicates: if the same action+fileName+status was logged in the last 30 min, skip it.
     * @param {'UPLOAD'|'DOWNLOAD'|'DELETE'} action
     * @param {string} fileName
     * @param {'SUCCESS'|'FAILED'} status
     * @param {string} [error]
     */
    async logActivity(action, fileName, status, error = null, configId = null, syncJobId = null) {
        // Never log SKIPs — they are noise (file already exists locally)
        if (action === 'SKIP') return;

        const id = uuidv4();
        try {
            // ZIP and DIAGNOSTIC activities always log — they are meaningful per-run events
            if (action !== 'ZIP' && action !== 'DIAGNOSTIC') {
                // Dedup: don't insert if same file+action+status was logged in the last 30 minutes
                let dedupQuery = `SELECT id FROM "LocalSyncActivity"
                     WHERE action = $1 AND "fileName" = $2 AND status = $3
                       AND "createdAt" > datetime('now', '-30 minutes')`;
                let params = [action, fileName, status];
                if (configId) {
                    dedupQuery += ` AND "configId" = $4`;
                    params.push(configId);
                }
                if (this.userId) {
                    dedupQuery += ` AND "userId" = $${params.length + 1}`;
                    params.push(this.userId);
                }
                dedupQuery += ` LIMIT 1`;

                const recent = await database.query(dedupQuery, params);
                if (recent.rows.length > 0) {
                    console.log(`[SyncHistory] Dedup skipped: ${action} ${fileName} → ${status}`);
                    return;
                }
            }

            await database.query(
                `INSERT INTO "LocalSyncActivity" (id, action, "fileName", status, error, synced, "configId", "syncJobId", "userId", "botId")
                 VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)`,
                [id, action, fileName, status, error, configId, syncJobId, this.userId, this.botId]
            );
            console.log(`[SyncHistory] Local log: ${action} ${fileName} → ${status}`);
            
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('sync-activity-logged', {
                    id, action, fileName, status, error, configId, syncJobId,
                    userId: this.userId, botId: this.botId, createdAt: new Date()
                });
            }
        } catch (err) {
            console.error('[SyncHistory] Failed to write local activity:', err.message);
        }
    }


    /**
     * Phase 2: Read all unsynced local activities → POST to Global DB → mark as synced.
     * Called at the end of SyncManager.runSync().
     */
    async flush() {
        if (!this.authToken) {
            console.warn('[SyncHistory] No token — skipping flush to Global DB');
            return;
        }

        let rows = [];
        try {
            let flushQuery = `SELECT * FROM "LocalSyncActivity" WHERE synced = 0`;
            const flushParams = [];
            if (this.userId) {
                flushQuery += ` AND "userId" = $1`;
                flushParams.push(this.userId);
            }
            flushQuery += ` ORDER BY "createdAt" ASC`;
            const result = await database.query(flushQuery, flushParams);
            rows = result.rows;
        } catch (err) {
            console.error('[SyncHistory] Failed to read local activities:', err.message);
            return;
        }

        if (rows.length === 0) {
            console.log('[SyncHistory] No unsynced activities to flush');
            return;
        }

        // Build the payload for Global DB
        const activities = rows.map(r => ({
            action: r.action,
            fileName: r.fileName,
            status: r.status,
            error: r.error,
        }));

        const successCount = activities.filter(a => a.status === 'SUCCESS' && a.action !== 'SKIP').length;
        const failedCount = activities.filter(a => a.status === 'FAILED').length;
        const totalCount = activities.filter(a => a.action !== 'SKIP').length;
        const overallStatus = failedCount > 0 ? 'FAILED' : totalCount > 0 ? 'SUCCESS' : 'SUCCESS';

        const payload = {
            status: overallStatus,
            startedAt: rows[0].createdAt,
            completedAt: rows[rows.length - 1].createdAt,
            totalFiles: totalCount,
            syncedFiles: successCount,
            failedFiles: failedCount,
            activities,
        };

        try {
            const res = await axios.post(`${API_URL}/agent/sync-history`, payload, {
                headers: { Authorization: `Bearer ${this.authToken}` },
                timeout: 15000,
            });

        if (res.status === 200 || res.status === 201) {
                // Mark all flushed rows as synced in local DB
                const ids = rows.map(r => r.id);
                
                // Build SQLite-compatible IN clause instead of PostgreSQL ANY()
                const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
                const updateQuery = `UPDATE "LocalSyncActivity" SET synced = 1 WHERE id IN (${placeholders})`;
                
                await database.query(updateQuery, ids);
                console.log(`[SyncHistory] Flushed ${rows.length} activities to Global DB ✓`);
            }
        } catch (err) {
            console.error('[SyncHistory] Failed to flush to Global DB:', err.response?.data || err.message);
            // Activities remain unsynced in local DB and will be retried next cycle
        }
    }
}

module.exports = new SyncHistoryLogger();
