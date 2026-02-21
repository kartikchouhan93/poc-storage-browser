const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER || 'agent_user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'agent_db',
  password: process.env.DB_PASSWORD || 'agent_password',
  port: parseInt(process.env.DB_PORT || '5434'),
});

const query = (text, params) => pool.query(text, params);

const initDB = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Mirroring Web App Schema (Simplified for Agent)
        
        // Tenants
        await client.query(`
            CREATE TABLE IF NOT EXISTS "Tenant" (
                "id" TEXT PRIMARY KEY,
                "name" TEXT NOT NULL,
                "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Accounts
        await client.query(`
            CREATE TABLE IF NOT EXISTS "Account" (
                "id" TEXT PRIMARY KEY,
                "name" TEXT NOT NULL,
                "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id"),
                "isActive" BOOLEAN DEFAULT true,
                "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Buckets
        await client.query(`
            CREATE TABLE IF NOT EXISTS "Bucket" (
                "id" TEXT PRIMARY KEY,
                "name" TEXT NOT NULL,
                "region" TEXT NOT NULL,
                "accountId" TEXT NOT NULL REFERENCES "Account"("id"),
                "storageClass" TEXT DEFAULT 'STANDARD',
                "versioning" BOOLEAN DEFAULT false,
                "encryption" BOOLEAN DEFAULT false,
                "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // FileObjects
        await client.query(`
            CREATE TABLE IF NOT EXISTS "FileObject" (
                "id" TEXT PRIMARY KEY,
                "name" TEXT NOT NULL,
                "key" TEXT NOT NULL,
                "isFolder" BOOLEAN DEFAULT false,
                "size" BIGINT,
                "mimeType" TEXT,
                "bucketId" TEXT NOT NULL REFERENCES "Bucket"("id"),
                "parentId" TEXT REFERENCES "FileObject"("id"),
                "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                "isSynced" BOOLEAN DEFAULT true, 
                "lastSyncedAt" TIMESTAMP
            );
        `);

        // Sync State (To track last sync time per bucket/global)
        await client.query(`
            CREATE TABLE IF NOT EXISTS "SyncState" (
                "id" TEXT PRIMARY KEY,
                "resourceId" TEXT UNIQUE NOT NULL, -- e.g., 'global_bucket_list' or specific bucket ID
                "lastSyncTimestamp" TIMESTAMP,
                "status" TEXT
            );
        `);

        await client.query('COMMIT');
        console.log('Local Database Initialized Successfully');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Failed to initialize local database', e);
        throw e;
    } finally {
        client.release();
    }
};

if (require.main === module) {
    initDB().catch(console.error);
}

module.exports = { query, initDB };
