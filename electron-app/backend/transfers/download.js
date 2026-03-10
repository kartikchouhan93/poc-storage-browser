const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { pipeline } = require('stream/promises');
const statusManager = require('./status');

class DownloadManager {
    /**
     * Download from S3 using short-lived credentials
     */
    async downloadFromS3(s3Client, bucketName, s3Key, localPath, totalSize = 0) {
        const fileName = path.basename(s3Key);
        const transferId = `dl-${Date.now()}-${fileName}`;

        // Synthesize virtual chunks for progress display (1 chunk per ~20MB, min 1)
        const CHUNK_SIZE = 20 * 1024 * 1024;
        const totalChunks = totalSize > 0 ? Math.max(1, Math.ceil(totalSize / CHUNK_SIZE)) : 0;
        
        statusManager.startTransfer(transferId, fileName, 'download', totalSize, totalChunks);

        const abortCtrl = new AbortController();
        statusManager.registerAbortController(transferId, abortCtrl);

        try {
            const data = await s3Client.send(
                new GetObjectCommand({ Bucket: bucketName, Key: s3Key }),
                { abortSignal: abortCtrl.signal }
            );
            let downloaded = 0;

            const progressPassThrough = new (require('stream').PassThrough)();
            progressPassThrough.on('data', async (chunk) => {
                downloaded += chunk.length;
                if (totalSize > 0) {
                    const progress = (downloaded / totalSize) * 100;
                    statusManager.updateProgress(transferId, progress, downloaded);

                    if (totalChunks > 0) {
                        const currentChunkIndex = Math.min(totalChunks, Math.floor(downloaded / CHUNK_SIZE) + 1);
                        for (let i = 1; i < currentChunkIndex; i++) {
                            statusManager.updateChunk(transferId, i, 'done', 100);
                        }
                        const chunkStart = (currentChunkIndex - 1) * CHUNK_SIZE;
                        const chunkProgress = Math.min(100, ((downloaded - chunkStart) / CHUNK_SIZE) * 100);
                        statusManager.updateChunk(transferId, currentChunkIndex, 'active', chunkProgress);
                    }
                }
                // Pause support — cork the stream while paused
                if (statusManager.isPaused(transferId)) {
                    progressPassThrough.pause();
                    await statusManager.checkPauseSignal(transferId);
                    progressPassThrough.resume();
                }
            });

            await pipeline(
                data.Body,
                progressPassThrough,
                fs.createWriteStream(localPath),
                { signal: abortCtrl.signal }
            );

            statusManager.completeTransfer(transferId, 'done');
            return true;
        } catch (error) {
            const isTerminated = statusManager.isTerminated(transferId);
            console.error('[DownloadManager] S3 Error:', isTerminated ? 'terminated by user' : error.message);
            statusManager.completeTransfer(transferId, isTerminated ? 'terminated' : 'error');
            if (!isTerminated) throw error;
            return false;
        }
    }

    /**
     * Download from HTTP URL
     */
    async downloadFromUrl(url, targetDir) {
        const fileName = path.basename(url);
        const destination = path.join(targetDir, fileName);
        const transferId = `dl-${Date.now()}-${fileName}`;

        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destination);
            https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    file.close();
                    fs.unlink(destination, () => {}); 
                    reject(`Server responded with ${response.statusCode}`);
                    return;
                }

                const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
                statusManager.startTransfer(transferId, fileName, 'download', totalBytes);
                let receivedBytes = 0;

                response.on('data', (chunk) => {
                    receivedBytes += chunk.length;
                    if (totalBytes > 0) {
                        const progress = (receivedBytes / totalBytes) * 100;
                        statusManager.updateProgress(transferId, progress, receivedBytes);
                    }
                });

                response.pipe(file);

                file.on('finish', () => {
                    file.close(() => {
                        statusManager.completeTransfer(transferId, 'done');
                        resolve({ success: true, path: destination });
                    });
                });

                file.on('error', (err) => {
                    fs.unlink(destination, () => {}); 
                    statusManager.completeTransfer(transferId, 'error');
                    reject(err.message);
                });
            }).on('error', (err) => {
                fs.unlink(destination, () => {}); 
                statusManager.completeTransfer(transferId, 'error');
                reject(err.message);
            });
        });
    }

    /**
     * Download from S3 by bucket ID (fetches credentials automatically)
     */
    async downloadWithBucketId(bucketId, s3Key, localPath, totalSize = 0) {
        const credentialManager = require('../aws-credentials');
        const database = require('../database');
        
        const dbRes = await database.query(`
            SELECT b.region, b.name FROM "Bucket" b WHERE b.id = $1
        `, [bucketId]);

        if (dbRes.rows.length === 0) throw new Error("Bucket not found");
        
        const { region, name } = dbRes.rows[0];
        const credentials = await credentialManager.getCredentialsForBucket(bucketId);

        const s3 = new S3Client({
            region: credentials.region || region,
            credentials: {
                accessKeyId: credentials.accessKeyId,
                secretAccessKey: credentials.secretAccessKey,
                sessionToken: credentials.sessionToken,
            },
        });

        return await this.downloadFromS3(s3, name, s3Key, localPath, totalSize);
    }
}

module.exports = new DownloadManager();
