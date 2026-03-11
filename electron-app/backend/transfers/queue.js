const uploadManager = require('./upload');
const transferState = require('./transferState');

class UploadQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        // Tracks what's currently in-flight or queued to prevent duplicates
        this.pendingKeys = new Set();
    }

    /**
     * Add an upload task. Persists to DB so it survives app restarts.
     */
    addUploadTask(bucketId, filePath, s3Key, mimeType = null, configId = null, syncJobId = null) {
        const uniqueKey = `${bucketId}-${s3Key}`;
        if (this.pendingKeys.has(uniqueKey)) {
            console.log(`[UploadQueue] Skipped duplicate upload task for: ${s3Key}`);
            return;
        }

        this.pendingKeys.add(uniqueKey);
        this.queue.push({ bucketId, filePath, s3Key, mimeType, configId, syncJobId, uniqueKey });
        this.processQueue();
    }

    /**
     * On app startup: load any pending/failed transfers from TransferState and re-queue them.
     * Called once from backend init after the DB is ready AND after auth (syncHistory.init).
     * Logs each incomplete transfer to LocalSyncActivity so they appear in Recent Activities.
     */
    async loadIncompleteTransfers() {
        const fs = require('fs');
        const database = require('../database');
        const { v4: uuidv4 } = require('uuid');

        // Prevent multiple concurrent calls
        if (this._loadingIncomplete) return;
        this._loadingIncomplete = true;

        try {
            // Scope to current user — don't resume another user's transfers
            let currentUserId = null;
            try {
                const authManager = require('../auth');
                currentUserId = authManager.getCurrentUserId();
            } catch {}

            if (!currentUserId) {
                console.log('[UploadQueue] No current user — skipping incomplete transfer resume');
                return;
            }

            const incomplete = transferState.getIncompleteTransfers(currentUserId);
            if (incomplete.length === 0) return;

            console.log(`[UploadQueue] Found ${incomplete.length} incomplete transfer(s) for user: ${currentUserId}`);

            for (const t of incomplete) {
                const fileName = t.s3Key.split('/').pop() || t.s3Key;

                // Log to LocalSyncActivity so it shows in Recent Activities
                try {
                    database.query(
                        `INSERT INTO "LocalSyncActivity"
                            (id, action, "fileName", status, error, synced, "configId", "syncJobId")
                         VALUES ($1, $2, $3, 'IN_PROGRESS', $4, 0, $5, $6)
                         ON CONFLICT (id) DO NOTHING`,
                        [
                            `resume-${t.id}`,
                            t.type === 'upload' ? 'UPLOAD' : 'DOWNLOAD',
                            fileName,
                            `Interrupted — resuming from ${t.bytesTransferred > 0 ? Math.round((t.bytesTransferred / (t.totalSize || 1)) * 100) + '%' : 'start'}`,
                            t.configId || null,
                            t.syncJobId || null,
                        ]
                    );
                } catch (logErr) {
                    console.warn('[UploadQueue] Could not log resume activity:', logErr.message);
                }

                if (t.type === 'upload') {
                    const uniqueKey = `${t.bucketId}-${t.s3Key}`;
                    if (this.pendingKeys.has(uniqueKey)) continue;

                    if (!fs.existsSync(t.localPath)) {
                        console.warn(`[UploadQueue] Skipping resume — local file gone: ${t.localPath}`);
                        transferState.deleteTransferState(t.id);
                        continue;
                    }

                    console.log(`[UploadQueue] Re-queuing upload: ${t.s3Key}`);
                    this.pendingKeys.add(uniqueKey);
                    this.queue.push({
                        bucketId: t.bucketId,
                        filePath: t.localPath,
                        s3Key: t.s3Key,
                        mimeType: t.mimeType,
                        configId: t.configId,
                        syncJobId: t.syncJobId,
                        uniqueKey,
                    });

                } else if (t.type === 'download') {
                    // Re-trigger download — downloadWithBucketId handles resume via .part file
                    const partPath = t.localPath + '.part';
                    const partExists = fs.existsSync(partPath) || fs.existsSync(t.localPath);
                    console.log(`[UploadQueue] Re-queuing download: ${t.s3Key} (partial: ${partExists})`);

                    // Fire-and-forget — don't block startup
                    const downloadManager = require('./download');
                    downloadManager.downloadWithBucketId(
                        t.bucketId, t.s3Key, t.localPath, t.totalSize
                    ).catch(err => {
                        console.error(`[UploadQueue] Resume download failed for ${t.s3Key}:`, err.message);
                    });
                }
            }

            if (this.queue.length > 0) this.processQueue();
        } catch (err) {
            console.error('[UploadQueue] Failed to load incomplete transfers:', err.message);
        } finally {
            this._loadingIncomplete = false;
        }
    }

    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            try {
                console.log(`[UploadQueue] Processing: ${task.s3Key} (${this.queue.length} left in queue)`);
                await uploadManager.uploadWithBucketId(
                    task.bucketId, task.filePath, task.s3Key, task.mimeType, task.configId, task.syncJobId
                );
            } catch (error) {
                console.error(`[UploadQueue] Upload failed for ${task.s3Key}:`, error.message);
                // State is already persisted by uploadManager — queue moves on
            } finally {
                this.pendingKeys.delete(task.uniqueKey);
            }
        }

        this.isProcessing = false;
    }
}

module.exports = new UploadQueue();
