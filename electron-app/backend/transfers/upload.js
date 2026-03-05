const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require('fs');
const path = require('path');
const fsPromises = require('fs/promises');
const { createDecipheriv } = require("crypto");
const statusManager = require('./status');
const database = require('../database');
const syncHistory = require('../syncHistory');

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY || "", "hex");
const ALGORITHM = "aes-256-gcm";

function decrypt(text) {
    if (!text) return text;
    // If it doesn't look like our encrypted format (iv:hex:tag), return as is
    const parts = text.split(":");
    if (parts.length !== 3) return text;
    
    try {
        const [ivHex, encryptedHex, authTagHex] = parts;
        const iv = Buffer.from(ivHex, "hex");
        const authTag = Buffer.from(authTagHex, "hex");
        const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedHex, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    } catch (e) {
        console.warn('[UploadManager] Decryption failed, using raw value');
        return text;
    }
}

class UploadManager {
    constructor() {
        this.currentConfigId = null;
        this.currentSyncJobId = null;
    }
    /**
     * Handles both normal and large files.
     * Uses @aws-sdk/lib-storage Upload for automatic multipart handling.
     */
    async uploadFileToS3(s3Client, filePath, bucketName, s3Key, mimeType = 'application/octet-stream') {
        const fileName = path.basename(filePath);
        const stat = await fsPromises.stat(filePath);
        const transferId = `ul-${Date.now()}-${fileName}`;
        
        statusManager.startTransfer(transferId, fileName, 'upload', stat.size);

        try {
            const fileStream = fs.createReadStream(filePath);
            
            const upload = new Upload({
                client: s3Client,
                params: {
                    Bucket: bucketName,
                    Key: s3Key,
                    Body: fileStream,
                    ContentType: mimeType,
                },
                partSize: 5 * 1024 * 1024,
                queueSize: 4
            });

            upload.on('httpUploadProgress', (progress) => {
                const total = progress.total || stat.size;
                if (total > 0) {
                    const percentage = Math.round((progress.loaded * 100) / total);
                    statusManager.updateProgress(transferId, percentage, progress.loaded);
                }
            });

            await upload.done();
            statusManager.completeTransfer(transferId, 'done');
            await syncHistory.logActivity('UPLOAD', s3Key || fileName, 'SUCCESS', null, this.currentConfigId, this.currentSyncJobId);
            return true;
        } catch (error) {
            console.error('[UploadManager] S3 Upload Error:', error.message);
            statusManager.completeTransfer(transferId, 'error');
            await syncHistory.logActivity('UPLOAD', s3Key || fileName, 'FAILED', error.message, this.currentConfigId, this.currentSyncJobId);
            throw error;
        }
    }

    /**
     * Resolves credentials and bucket info then uploads.
     * Now uses short-lived STS credentials from /api/agent/credentials
     */
    async uploadWithBucketId(bucketId, filePath, s3Key, mimeType, configId = null, syncJobId = null) {
        this.currentConfigId = configId;
        this.currentSyncJobId = syncJobId;
        
        const credentialManager = require('../aws-credentials');
        
        // Get bucket info
        const dbRes = await database.query(`
            SELECT b.region, b.name, b."accountId"
            FROM "Bucket" b 
            WHERE b.id = $1
        `, [bucketId]);

        if (dbRes.rows.length === 0) throw new Error("Bucket not found in database");
        
        const data = dbRes.rows[0];
        
        // Get short-lived credentials from backend
        let credentials;
        try {
            credentials = await credentialManager.getCredentialsForBucket(bucketId);
        } catch (error) {
            console.error(`[UploadManager] Failed to get credentials for ${data.name}:`, error.message);
            throw new Error(`Failed to get AWS credentials: ${error.message}`);
        }

        const s3 = new S3Client({
            region: credentials.region || data.region || 'us-east-1',
            credentials: {
                accessKeyId: credentials.accessKeyId,
                secretAccessKey: credentials.secretAccessKey,
                sessionToken: credentials.sessionToken,
            },
        });

        return await this.uploadFileToS3(s3, filePath, data.name, s3Key, mimeType);
    }
}

module.exports = new UploadManager();
