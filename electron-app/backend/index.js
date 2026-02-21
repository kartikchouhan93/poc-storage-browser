const { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { Upload } = require('@aws-sdk/lib-storage');
const fs = require('fs');
const path = require('path');
const fsPromises = require('fs/promises');
const os = require('os');
const { createDecipheriv } = require("crypto");
const { Pool } = require("pg");
require('dotenv').config();

const ENCRYPTION_KEY = Buffer.from("dfa35e10f81315ea9e69e3dff3f7a4ac6096a0828052aaf09f38bc11600d4a53", "hex");
const ALGORITHM = "aes-256-gcm";

function decrypt(text) {
    if (!text) return text;
    const parts = text.split(":");
    if (parts.length !== 3) return text;
    const [ivHex, encryptedHex, authTagHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

const globalDbPool = new Pool({
  connectionString: "postgresql://myuser:mypassword@localhost:5435/filemanagement?schema=public"
});

class BackendManager {
    constructor() {
        this.s3Client = null;
        this.bucketName = process.env.AWS_BUCKET_NAME || 'my-bucket';
        this.region = process.env.AWS_REGION || 'us-east-1';
        this.isSyncing = false; // Guard against sync loops

        this.initS3();
    }

    initS3() {
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            const credentials = {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            };
            if (process.env.AWS_SESSION_TOKEN) {
                credentials.sessionToken = process.env.AWS_SESSION_TOKEN;
            }
            this.s3Client = new S3Client({ region: this.region, credentials });
            console.log('S3 Client Initialized with region:', this.region);
        } else {
            console.warn('AWS Credentials not found. S3 Sync will be skipped.');
        }
    }

    async uploadFileToS3(filePath, s3Key, overrideBucket = null) {
        if (!this.s3Client) return;
        const targetBucket = overrideBucket || this.bucketName;
        try {
            const fileStream = fs.createReadStream(filePath);
            const upload = new Upload({
                client: this.s3Client,
                params: { Bucket: targetBucket, Key: s3Key, Body: fileStream }
            });
            await upload.done();
            console.log(`[S3] Uploaded: s3://${targetBucket}/${s3Key}`);
            return true;
        } catch (error) {
            console.error('S3 Upload Error:', error);
            throw error;
        }
    }

    async uploadWithPresigned(filePath, s3Key, bucketId, bucketName, mimeType) {
        const axios = require('axios');
        
        try {
            // 1. Fetch AWS Credentials from Global Database
            const dbRes = await globalDbPool.query(`
                SELECT a."awsAccessKeyId", a."awsSecretAccessKey", b.region, b.name 
                FROM "Bucket" b 
                JOIN "Account" a ON b."accountId" = a.id 
                WHERE b.id = $1
            `, [bucketId]);

            if (dbRes.rows.length === 0) {
                throw new Error("Bucket/Account not found in Global Database");
            }

            const accountData = dbRes.rows[0];
            if (!accountData.awsAccessKeyId || !accountData.awsSecretAccessKey) {
                throw new Error("AWS credentials missing for this account");
            }

            // 2. Initialize localized S3Client using Decrypted Tokens
            const s3 = new S3Client({
                region: accountData.region,
                credentials: {
                    accessKeyId: decrypt(accountData.awsAccessKeyId),
                    secretAccessKey: decrypt(accountData.awsSecretAccessKey),
                },
            });

            // 3. Generate Presigned URL natively
            const command = new PutObjectCommand({
                Bucket: accountData.name,
                Key: s3Key,
                ContentType: mimeType,
            });

            const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
            if (!url) throw new Error('Failed to generate local presigned URL');

            // 4. Upload File natively
            const stat = await fsPromises.stat(filePath);
            const fileStream = fs.createReadStream(filePath);

            await axios.put(url, fileStream, {
                headers: {
                    'Content-Type': mimeType,
                    'Content-Length': stat.size
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity
            });
            console.log(`[S3] Uploaded via Localized Presign logic: s3://${bucketName}/${s3Key}`);
            return true;
        } catch (error) {
            console.error('Localized Data Upload Error:', error?.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Called by chokidar watcher when a file is added locally.
     * Skipped during sync to prevent loops.
     */
    async onLocalFileAdded(filePath, localRootPath) {
        if (this.isSyncing) {
            console.log(`[Watcher] Skipping auto-upload during sync: ${filePath}`);
            return;
        }

        let stat;
        try {
            stat = await fsPromises.stat(filePath);
            if (stat.isDirectory()) return; // skip folders
        } catch(e) { return; }

        const relativePath = path.relative(localRootPath, filePath).split(path.sep).join('/');
        const parts = relativePath.split('/');
        if (parts.length < 2) return; // ignores files not inside a bucket folder

        const bucketName = parts[0];
        const s3Key = parts.slice(1).join('/');

        console.log(`[Watcher] Auto-uploading new file via Presigned URL: ${s3Key} to bucket ${bucketName}`);
        try {
            // Fetch bucket lookup first to use Presigned URL logic
            const { query } = require('../src/lib/db');
            const bucketRes = await query('SELECT id FROM "Bucket" WHERE name = $1', [bucketName]);
            if (bucketRes.rows.length === 0) {
                 console.log(`[Watcher] Bucket ${bucketName} not in DB, upload skipped.`);
                 return;
            }
            const bucketId = bucketRes.rows[0].id;

            const mimeType = 'application/octet-stream'; 

            // Upload via Central API (Presigned URL)
            await this.uploadWithPresigned(filePath, s3Key, bucketId, bucketName, mimeType);

            let parentId = null;
            if (parts.length > 2) {
                 const parentKey = parts.slice(1, -1).join('/');
                 const parentRes = await query('SELECT id FROM "FileObject" WHERE key = $1 AND "bucketId" = $2', [parentKey, bucketId]);
                 if (parentRes.rows.length > 0) parentId = parentRes.rows[0].id;
            }

            const crypto = require('crypto');
            const fileId = crypto.randomUUID();
            const fileName = path.basename(filePath);

            await query(`
                INSERT INTO "FileObject" (id, name, key, "isFolder", size, "mimeType", "bucketId", "parentId", "createdAt", "updatedAt", "isSynced")
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), true)
                ON CONFLICT (id) DO UPDATE SET size = EXCLUDED.size, "updatedAt" = EXCLUDED."updatedAt"
            `, [fileId, fileName, s3Key, false, stat.size, mimeType, bucketId, parentId]);
            console.log(`[Watcher] Local DB updated for ${s3Key}`);
        } catch (err) {
            console.error(`[Watcher] Auto-upload failed for ${relativePath}:`, err.message);
        }
    }

    /**
     * Builds a fresh S3Client using credentials from the Global DB for a given bucketId.
     */
    async getS3ClientForBucket(bucketId) {
        const dbRes = await globalDbPool.query(`
            SELECT a."awsAccessKeyId", a."awsSecretAccessKey", b.region, b.name
            FROM "Bucket" b
            JOIN "Account" a ON b."accountId" = a.id
            WHERE b.id = $1
        `, [bucketId]);

        if (dbRes.rows.length === 0) throw new Error(`Bucket/Account not found in Global DB for id: ${bucketId}`);

        const accountData = dbRes.rows[0];
        if (!accountData.awsAccessKeyId || !accountData.awsSecretAccessKey) {
            throw new Error('AWS credentials missing for this account');
        }

        const s3 = new S3Client({
            region: accountData.region,
            credentials: {
                accessKeyId: decrypt(accountData.awsAccessKeyId),
                secretAccessKey: decrypt(accountData.awsSecretAccessKey),
            },
        });

        return { s3, bucketName: accountData.name };
    }

    /**
     * Called by chokidar when a FILE is deleted locally.
     * Removes from S3 and local DB.
     */
    async onLocalFileRemoved(filePath, localRootPath) {
        if (this.isSyncing) {
            console.log(`[Watcher] Skipping auto-delete during sync: ${filePath}`);
            return;
        }

        const relativePath = path.relative(localRootPath, filePath).split(path.sep).join('/');
        const parts = relativePath.split('/');
        if (parts.length < 2) return;

        const bucketName = parts[0];
        const s3Key = parts.slice(1).join('/');

        console.log(`[Watcher] Auto-deleting file: ${s3Key} from bucket ${bucketName}`);
        try {
            const { query } = require('../src/lib/db');

            // 1. Find bucket in local DB
            const bucketRes = await query('SELECT id FROM "Bucket" WHERE name = $1', [bucketName]);
            if (bucketRes.rows.length === 0) {
                console.log(`[Watcher] Bucket ${bucketName} not in local DB, delete skipped.`);
                return;
            }
            const bucketId = bucketRes.rows[0].id;

            // 2. Get fresh S3 client using decrypted credentials from Global DB
            const { s3, bucketName: s3BucketName } = await this.getS3ClientForBucket(bucketId);

            // 3. Delete from S3
            await s3.send(new DeleteObjectCommand({ Bucket: s3BucketName, Key: s3Key }));
            console.log(`[S3] Deleted: s3://${s3BucketName}/${s3Key}`);

            // 4. Delete from local DB
            await query('DELETE FROM "FileObject" WHERE key = $1 AND "bucketId" = $2', [s3Key, bucketId]);
            console.log(`[Watcher] Local DB: removed ${s3Key}`);
        } catch (err) {
            console.error(`[Watcher] Auto-delete failed for ${relativePath}:`, err.message);
        }
    }

    /**
     * Called by chokidar when a DIRECTORY is deleted locally.
     * Removes all objects under that prefix from S3 and local DB.
     */
    async onLocalDirRemoved(dirPath, localRootPath) {
        if (this.isSyncing) {
            console.log(`[Watcher] Skipping auto-delete (dir) during sync: ${dirPath}`);
            return;
        }

        const relativePath = path.relative(localRootPath, dirPath).split(path.sep).join('/');
        const parts = relativePath.split('/');
        if (parts.length < 2) return; // top-level bucket folder — don't delete the whole bucket

        const bucketName = parts[0];
        const s3Prefix = parts.slice(1).join('/') + '/';

        console.log(`[Watcher] Auto-deleting dir prefix: ${s3Prefix} from bucket ${bucketName}`);
        try {
            const { query } = require('../src/lib/db');

            // 1. Find bucket in local DB
            const bucketRes = await query('SELECT id FROM "Bucket" WHERE name = $1', [bucketName]);
            if (bucketRes.rows.length === 0) {
                console.log(`[Watcher] Bucket ${bucketName} not in local DB, dir delete skipped.`);
                return;
            }
            const bucketId = bucketRes.rows[0].id;

            // 2. Get fresh S3 client
            const { s3, bucketName: s3BucketName } = await this.getS3ClientForBucket(bucketId);

            // 3. List all S3 objects under the prefix then delete them
            const listRes = await s3.send(new ListObjectsV2Command({
                Bucket: s3BucketName,
                Prefix: s3Prefix,
            }));

            for (const obj of (listRes.Contents || [])) {
                await s3.send(new DeleteObjectCommand({ Bucket: s3BucketName, Key: obj.Key }));
                console.log(`[S3] Deleted (dir): s3://${s3BucketName}/${obj.Key}`);
            }

            // 4. Also attempt deleting the folder placeholder key itself (some setups store it)
            await s3.send(new DeleteObjectCommand({ Bucket: s3BucketName, Key: s3Prefix })).catch(() => {});

            // 5. Remove all matching entries from local DB
            await query(
                'DELETE FROM "FileObject" WHERE ("key" LIKE $1 OR "key" = $2) AND "bucketId" = $3',
                [s3Prefix + '%', s3Prefix.slice(0, -1), bucketId]
            );
            console.log(`[Watcher] Local DB: removed all entries under prefix ${s3Prefix}`);
        } catch (err) {
            console.error(`[Watcher] Auto-delete (dir) failed for ${relativePath}:`, err.message);
        }
    }

    async getRecursiveFiles(dir, rootDir = dir, excludeDirs = []) {
        let results = [];
        try {
            const list = await fsPromises.readdir(dir, { withFileTypes: true });
            for (const entry of list) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/');

                if (entry.isDirectory()) {
                    // Skip excluded directories (prevents self-copy loops)
                    if (excludeDirs.some(ex => fullPath.startsWith(ex))) continue;
                    const subRes = await this.getRecursiveFiles(fullPath, rootDir, excludeDirs);
                    results = results.concat(subRes);
                } else {
                    results.push({ fullPath, relativePath });
                }
            }
        } catch (err) {
            console.error(`[getRecursiveFiles] Error reading ${dir}:`, err.message);
        }
        return results;
    }

    async syncFromS3(localRootPath, onProgress) {
        if (!this.s3Client) return { success: false, message: 'S3 Client not initialized' };
        if (this.isSyncing) return { success: false, message: 'Sync already in progress' };

        this.isSyncing = true;
        try {
            console.log(`[Sync] Starting Bidirectional Sync: ${this.bucketName} <-> ${localRootPath}`);
            if (onProgress) onProgress({ type: 'info', message: 'Fetching S3 bucket list...' });

            const { Contents } = await this.s3Client.send(new ListObjectsV2Command({ Bucket: this.bucketName }));
            const s3Items = (Contents || []).filter(item => {
                // Filter out any nested FMS/FMS/... garbage keys from S3
                const parts = item.Key.split('/');
                // Skip keys that look like infinite recursion artifacts
                const uniqueParts = new Set(parts.filter(p => p));
                if (uniqueParts.size === 1 && parts.length > 3) return false;
                return true;
            });
            const s3Keys = new Set(s3Items.map(item => item.Key));

            let downloadCount = 0;
            let uploadCount = 0;
            const { pipeline } = require('stream/promises');

            // --- Phase 1: Download (S3 → Local) ---
            if (onProgress) onProgress({ type: 'info', message: `Found ${s3Items.length} files in S3. Checking local...` });

            for (const item of s3Items) {
                const localFilePath = path.join(localRootPath, item.Key);
                const localDir = path.dirname(localFilePath);
                await fsPromises.mkdir(localDir, { recursive: true });

                try {
                    await fsPromises.access(localFilePath);
                    continue; // Already exists locally
                } catch {
                    // Missing locally — download it
                }

                console.log(`[Sync-Down] ${item.Key}`);
                if (onProgress) onProgress({ type: 'download', filename: item.Key, status: 'active' });

                const data = await this.s3Client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: item.Key }));
                await pipeline(data.Body, fs.createWriteStream(localFilePath));

                if (onProgress) onProgress({ type: 'download', filename: item.Key, status: 'done' });
                downloadCount++;
            }

            // --- Phase 2: Upload (Local → S3) ---
            if (onProgress) onProgress({ type: 'info', message: 'Scanning local files for upload...' });
            const localFiles = await this.getRecursiveFiles(localRootPath);

            for (const file of localFiles) {
                if (!s3Keys.has(file.relativePath)) {
                    console.log(`[Sync-Up] ${file.relativePath}`);
                    if (onProgress) onProgress({ type: 'upload', filename: file.relativePath, status: 'active' });

                    await this.uploadFileToS3(file.fullPath, file.relativePath);

                    if (onProgress) onProgress({ type: 'upload', filename: file.relativePath, status: 'done' });
                    uploadCount++;
                }
            }

            const summary = `Sync done. ↓ ${downloadCount} downloaded, ↑ ${uploadCount} uploaded.`;
            console.log(`[Sync] ${summary}`);
            // Signal completion — active: false stops the spinner
            if (onProgress) onProgress({ type: 'complete', message: summary, downloadCount, uploadCount });
            return { success: true, message: summary, downloadCount, uploadCount };

        } catch (error) {
            console.error('[Sync] Error:', error);
            if (onProgress) onProgress({ type: 'error', message: error.message });
            return { success: false, message: error.message };
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Zip a folder into a temp directory first, then move to destination.
     * This prevents the watcher from picking up an incomplete zip.
     */
    async zipFolderToTemp(folderPath, destDir, zipName) {
        const archiver = require('archiver');
        const tempDir = path.join(os.tmpdir(), '_fms_temp');
        await fsPromises.mkdir(tempDir, { recursive: true });

        const tempZipPath = path.join(tempDir, zipName);
        const finalZipPath = path.join(destDir, zipName);

        console.log(`[Zip] Creating zip in temp: ${tempZipPath}`);
        const output = fs.createWriteStream(tempZipPath);
        const archive = archiver('zip', { zlib: { level: 6 } });

        await new Promise((resolve, reject) => {
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            archive.directory(folderPath, false);
            archive.finalize();
        });

        console.log(`[Zip] Moving zip to destination: ${finalZipPath}`);
        await fsPromises.rename(tempZipPath, finalZipPath);
        return finalZipPath;
    }

    async uploadItems(items, currentDirectory, shouldZip) {
        const results = [];
        for (const itemPath of items) {
            if (!itemPath) {
                results.push({ success: false, error: 'Invalid path (undefined)' });
                continue;
            }
            try {
                const stat = await fsPromises.stat(itemPath);
                const itemName = path.basename(itemPath);
                const destinationPath = path.join(currentDirectory, itemName);

                // Safety check: prevent copying a folder into itself
                const normalizedSrc = path.resolve(itemPath);
                const normalizedDest = path.resolve(destinationPath);
                if (normalizedDest.startsWith(normalizedSrc)) {
                    console.warn(`[Upload] Skipping self-copy: ${itemPath} -> ${destinationPath}`);
                    results.push({ success: false, path: itemPath, error: 'Cannot copy folder into itself' });
                    continue;
                }

                if (stat.isDirectory()) {
                    if (shouldZip) {
                        const zipName = `${itemName}.zip`;
                        // Zip to temp first, then move — watcher will auto-upload when it lands
                        const finalZipPath = await this.zipFolderToTemp(itemPath, currentDirectory, zipName);
                        console.log(`[Upload] Zip ready at: ${finalZipPath}`);
                        results.push({ success: true, path: finalZipPath });
                    } else {
                        await fsPromises.mkdir(destinationPath, { recursive: true });
                        await this.recursiveCopy(itemPath, destinationPath);
                        results.push({ success: true, path: destinationPath });
                    }
                } else {
                    // File: copy to destination — watcher will auto-upload
                    await fsPromises.copyFile(itemPath, destinationPath);
                    results.push({ success: true, path: destinationPath });
                }
            } catch (error) {
                console.error(`[Upload] Error for ${itemPath}:`, error.message);
                results.push({ success: false, path: itemPath, error: error.message });
            }
        }
        return results;
    }

    async recursiveCopy(sourceDir, targetDir) {
        // Safety: never copy into self
        const normalizedSrc = path.resolve(sourceDir);
        const normalizedDest = path.resolve(targetDir);
        if (normalizedDest.startsWith(normalizedSrc)) {
            throw new Error(`Cannot copy directory into itself: ${sourceDir} -> ${targetDir}`);
        }

        const entries = await fsPromises.readdir(sourceDir, { withFileTypes: true });
        for (const entry of entries) {
            const src = path.join(sourceDir, entry.name);
            const dest = path.join(targetDir, entry.name);
            if (entry.isDirectory()) {
                await fsPromises.mkdir(dest, { recursive: true });
                await this.recursiveCopy(src, dest);
            } else {
                await fsPromises.copyFile(src, dest);
            }
        }
    }

    async handleFileDrop(droppedPaths, currentDirectory) {
        return this.uploadItems(droppedPaths, currentDirectory, false);
    }
}

module.exports = new BackendManager();
