const { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
const path = require('path');
const fsPromises = require('fs/promises');
const axios = require('axios');
const statusManager = require('./status');
const database = require('../database');
const syncHistory = require('../syncHistory');

const config         = require('../config');
const API_URL        = config.ENTERPRISE_URL;
const ENTERPRISE_URL = config.ENTERPRISE_URL;

// Match enterprise upload-provider thresholds
const PART_SIZE = 20 * 1024 * 1024;       // 20MB default
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB triggers multipart
const CONCURRENCY = 3;
const MAX_PARTS = 9900;                    // S3 hard limit is 10,000
const MAX_RETRIES = 3;

class UploadManager {
    constructor() {
        this.currentConfigId = null;
        this.currentSyncJobId = null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC ENTRY POINT — resolves bucket info + credentials then uploads
    // ─────────────────────────────────────────────────────────────────────────

    async uploadWithBucketId(bucketId, filePath, s3Key, mimeType, configId = null, syncJobId = null) {
        this.currentConfigId = configId;
        this.currentSyncJobId = syncJobId;

        const credentialManager = require('../aws-credentials');
        const authManager = require('../auth');

        const dbRes = await database.query(
            `SELECT b.region, b.name, b."accountId" FROM "Bucket" b WHERE b.id = $1`,
            [bucketId]
        );
        if (dbRes.rows.length === 0) throw new Error('Bucket not found in database');

        const { region, name: bucketName, accountId } = dbRes.rows[0];

        const stat = await fsPromises.stat(filePath);
        const contentType = mimeType || 'application/octet-stream';

        if (stat.size >= MULTIPART_THRESHOLD) {
            await this._uploadMultipart(bucketId, accountId, filePath, bucketName, s3Key, contentType, stat, region, credentialManager, authManager);
        } else {
            await this._uploadSimple(bucketId, accountId, filePath, bucketName, s3Key, contentType, stat, region, credentialManager);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SIMPLE UPLOAD — single PutObject for files < 100MB
    // ─────────────────────────────────────────────────────────────────────────

    async _uploadSimple(bucketId, accountId, filePath, bucketName, s3Key, contentType, stat, region, credentialManager) {
        const fileName = path.basename(filePath);
        const transferId = `ul-${Date.now()}-${fileName}`;
        statusManager.startTransfer(transferId, fileName, 'upload', stat.size);

        try {
            const credentials = await credentialManager.getCredentials(accountId);
            const s3 = this._buildS3Client(credentials, region);

            const { PutObjectCommand } = require('@aws-sdk/client-s3');

            // Pipe through a PassThrough to track upload progress
            const { PassThrough } = require('stream');
            const passThrough = new PassThrough();
            const fileStream = fs.createReadStream(filePath);
            let uploaded = 0;

            // Register abort controller so terminate() can cancel the stream
            const abortCtrl = new AbortController();
            statusManager.registerAbortController(transferId, abortCtrl);

            fileStream.on('data', (chunk) => {
                uploaded += chunk.length;
                if (stat.size > 0) {
                    statusManager.updateProgress(transferId, (uploaded / stat.size) * 100, uploaded);
                }
            });
            fileStream.pipe(passThrough);

            const cmd = new PutObjectCommand({
                Bucket: bucketName,
                Key: s3Key,
                Body: passThrough,
                ContentType: contentType,
                ContentLength: stat.size,
            });

            await s3.send(cmd, { abortSignal: abortCtrl.signal });

            statusManager.completeTransfer(transferId, 'done');
            await syncHistory.logActivity('UPLOAD', s3Key, 'SUCCESS', null, this.currentConfigId, this.currentSyncJobId);
        } catch (error) {
            console.error('[UploadManager] Simple upload error:', error.message);
            const finalStatus = error.message === 'Transfer terminated by user' ? 'terminated' : 'error';
            statusManager.completeTransfer(transferId, finalStatus);
            if (finalStatus !== 'terminated') {
                await syncHistory.logActivity('UPLOAD', s3Key, 'FAILED', error.message, this.currentConfigId, this.currentSyncJobId);
            }
            throw error;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MULTIPART UPLOAD — resumable, 20MB parts, per-part credential refresh
    // Mirrors the enterprise upload-provider.tsx multipart strategy.
    // ─────────────────────────────────────────────────────────────────────────

    async _uploadMultipart(bucketId, accountId, filePath, bucketName, s3Key, contentType, stat, region, credentialManager, authManager) {
        const fileName = path.basename(filePath);
        const transferId = `ul-${Date.now()}-${fileName}`;

        // Dynamic part sizing — prevent exceeding S3's 10,000 part limit
        let partSize = PART_SIZE;
        if (stat.size / partSize > MAX_PARTS) {
            partSize = Math.ceil(stat.size / MAX_PARTS);
        }
        const totalParts = Math.ceil(stat.size / partSize);

        statusManager.startTransfer(transferId, fileName, 'upload', stat.size, totalParts);

        // Deterministic file hash for resumption — matches enterprise pattern
        const fileHash = Buffer.from(
            `${bucketId}-root-${fileName}-${stat.size}-${stat.mtimeMs}`
        ).toString('base64');

        let uploadId = null;
        let completedParts = []; // [{ PartNumber, ETag }]

        try {
            // ── 1. Check for resumable upload ──────────────────────────────
            const token = authManager.getToken();
            try {
                const statusRes = await axios.post(
                    `${ENTERPRISE_URL}/api/files/multipart/status`,
                    { fileHash },
                    { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
                );
                if (statusRes.data?.active) {
                    uploadId = statusRes.data.uploadId;
                    completedParts = statusRes.data.parts || [];
                    console.log(`[UploadManager] Resuming multipart upload for ${fileName} — ${completedParts.length}/${totalParts} parts done`);
                }
            } catch (e) {
                // Status check failed — start fresh, non-fatal
                console.warn(`[UploadManager] Could not check multipart status for ${fileName}:`, e.message);
            }

            // ── 2. Initiate if no active upload found ──────────────────────
            if (!uploadId) {
                const credentials = await credentialManager.getCredentials(accountId);
                const s3 = this._buildS3Client(credentials, region);

                const initRes = await s3.send(new CreateMultipartUploadCommand({
                    Bucket: bucketName,
                    Key: s3Key,
                    ContentType: contentType,
                }));
                uploadId = initRes.UploadId;
                console.log(`[UploadManager] Initiated multipart upload for ${fileName} — uploadId: ${uploadId}`);
            }

            // ── 3. Upload remaining parts ──────────────────────────────────
            const completedPartNumbers = new Set(completedParts.map(p => p.PartNumber));
            const remainingParts = Array.from({ length: totalParts }, (_, i) => i + 1)
                .filter(n => !completedPartNumbers.has(n));

            // Restore progress for already-completed parts
            if (completedParts.length > 0) {
                const pct = Math.round((completedParts.length / totalParts) * 100);
                statusManager.updateProgress(transferId, pct, completedParts.length * partSize);
                // Mark resumed chunks as already done
                for (const p of completedParts) {
                    statusManager.updateChunk(transferId, p.PartNumber, 'done', 100);
                }
            }

            const uploadPart = async (partNumber) => {
                const start = (partNumber - 1) * partSize;
                const end = Math.min(start + partSize, stat.size);
                const chunkSize = end - start;

                statusManager.updateChunk(transferId, partNumber, 'active', 0);

                for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        // Per-part credential refresh — prevents expiry on long uploads
                        const credentials = await credentialManager.getCredentials(accountId);
                        const s3 = this._buildS3Client(credentials, region);

                        // Read chunk from file
                        const buffer = Buffer.allocUnsafe(chunkSize);
                        const fd = await fsPromises.open(filePath, 'r');
                        await fd.read(buffer, 0, chunkSize, start);
                        await fd.close();

                        const result = await s3.send(new UploadPartCommand({
                            Bucket: bucketName,
                            Key: s3Key,
                            UploadId: uploadId,
                            PartNumber: partNumber,
                            Body: buffer,
                            ContentLength: chunkSize,
                        }));

                        const etag = result.ETag?.replace(/"/g, '');
                        if (!etag) throw new Error(`No ETag returned for part ${partNumber}`);

                        completedParts.push({ PartNumber: partNumber, ETag: etag });

                        const pct = Math.round((completedParts.length / totalParts) * 100);
                        statusManager.updateProgress(transferId, pct, completedParts.length * partSize);
                        statusManager.updateChunk(transferId, partNumber, 'done', 100);
                        return;

                    } catch (err) {
                        console.warn(`[UploadManager] Part ${partNumber} attempt ${attempt}/${MAX_RETRIES} failed:`, err.message);
                        if (attempt >= MAX_RETRIES) {
                            statusManager.updateChunk(transferId, partNumber, 'error', 0);
                            throw err;
                        }
                        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
                    }
                }
            };

            // Upload parts sequentially — one at a time for predictable progress
            for (const partNum of remainingParts) {
                // Honour pause / terminate between parts
                const terminated = await statusManager.checkPauseSignal(transferId);
                if (terminated) throw new Error('Transfer terminated by user');
                await uploadPart(partNum);
            }

            // ── 4. Complete multipart upload ───────────────────────────────
            completedParts.sort((a, b) => a.PartNumber - b.PartNumber);

            const credentials = await credentialManager.getCredentials(accountId);
            const s3 = this._buildS3Client(credentials, region);

            await s3.send(new CompleteMultipartUploadCommand({
                Bucket: bucketName,
                Key: s3Key,
                UploadId: uploadId,
                MultipartUpload: { Parts: completedParts },
            }));

            statusManager.completeTransfer(transferId, 'done');
            await syncHistory.logActivity('UPLOAD', s3Key, 'SUCCESS', null, this.currentConfigId, this.currentSyncJobId);
            console.log(`[UploadManager] Multipart upload complete: ${fileName} (${totalParts} parts)`);

        } catch (error) {
            console.error('[UploadManager] Multipart upload error:', error.message);
            const finalStatus = error.message === 'Transfer terminated by user' ? 'terminated' : 'error';
            statusManager.completeTransfer(transferId, finalStatus);
            if (finalStatus !== 'terminated') {
                await syncHistory.logActivity('UPLOAD', s3Key, 'FAILED', error.message, this.currentConfigId, this.currentSyncJobId);
            }

            // Abort the multipart upload to avoid orphaned parts incurring S3 storage costs
            if (uploadId) {
                try {
                    const credentials = await credentialManager.getCredentials(accountId).catch(() => null);
                    if (credentials) {
                        const s3 = this._buildS3Client(credentials, region);
                        await s3.send(new AbortMultipartUploadCommand({
                            Bucket: bucketName,
                            Key: s3Key,
                            UploadId: uploadId,
                        }));
                        console.log(`[UploadManager] Aborted orphaned multipart upload: ${uploadId}`);
                    }
                } catch (abortErr) {
                    console.warn('[UploadManager] Failed to abort multipart upload:', abortErr.message);
                }
            }

            throw error;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    _buildS3Client(credentials, region) {
        return new S3Client({
            region: credentials.region || region || 'us-east-1',
            credentials: {
                accessKeyId: credentials.accessKeyId,
                secretAccessKey: credentials.secretAccessKey,
                sessionToken: credentials.sessionToken,
            },
        });
    }
}

module.exports = new UploadManager();
