const { query } = require("../lib/db");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT_PATH = "/home/abhishek/FMS";

// Sync Engine Configuration
// const SYNC_INTERVAL = 1000*60*5; // 5 minutes
const SYNC_INTERVAL = 1000 * 10; // 10 seconds
const API_URL = "http://localhost:3000/api";

let syncIntervalId = null;
let authToken = null;
let isSyncing = false;
let onAuthExpiredCallback = null;

// Initialize Sync Engine
const initSync = (token, onAuthExpired) => {
  authToken = token;
  if (onAuthExpired) onAuthExpiredCallback = onAuthExpired;

  if (syncIntervalId) clearInterval(syncIntervalId);

  // Initial Sync
  runSync();

  // Start Polling
  syncIntervalId = setInterval(runSync, SYNC_INTERVAL);
  console.log("Sync Engine Started");
};

const stopSync = () => {
  authToken = null;
  isSyncing = false;
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  console.log("Sync Engine Stopped due to Auth Expiration or Logout");
};

const handleAuthError = (error) => {
  if (error.response && error.response.status === 401) {
    console.error("Authentication error (401) in Sync Engine. Stopping Sync.");
    stopSync();
    if (onAuthExpiredCallback) {
      onAuthExpiredCallback();
    }
  } else {
    console.error("Sync error:", error.message);
  }
};

const runSync = async () => {
  if (isSyncing || !authToken) return;
  isSyncing = true;
  console.log("Starting Sync Cycle...");

  try {
    await syncBuckets();
    await syncFiles();
  } catch (error) {
    handleAuthError(error);
  } finally {
    isSyncing = false;
    console.log("Sync Cycle Completed");
  }
};

const getAuthHeaders = () => ({
  Authorization: `Bearer ${authToken}`,
  "Content-Type": "application/json",
});

// 1. Sync Buckets
const syncBuckets = async () => {
  try {
    // Fetch from Global API
    const response = await axios.get(`${API_URL}/buckets?limit=100`, {
      headers: getAuthHeaders(),
    });
    const { data: buckets } = response.data; // Assumes structure { data: [...], metadata: ... }

    // Ensure Root Profile exists
    if (!fs.existsSync(ROOT_PATH)) {
      fs.mkdirSync(ROOT_PATH, { recursive: true });
      console.log(`Created root folder: ${ROOT_PATH}`);
    }

    // Ensure Accounts exist (simple check/insert if missing to avoid FK error)
    const accountIds = [...new Set(buckets.map((b) => b.accountId))];
    for (const accountId of accountIds) {
      if (!accountId) continue;
      try {
        // Check if account exists
        const existingAccount = await query(
          'SELECT id FROM "Account" WHERE id = $1',
          [accountId],
        );
        if (existingAccount.rows.length === 0) {
          // Insert a placeholder account
          // Note: In a full sync we would want tenant IDs too. For this MVP we satisfy the constraint
          // First we need a placeholder tenant
          const dummyTenantId = "tenant_placeholder";
          const existingTenant = await query(
            'SELECT id FROM "Tenant" WHERE id = $1',
            [dummyTenantId],
          );
          if (existingTenant.rows.length === 0) {
            await query('INSERT INTO "Tenant" (id, name) VALUES ($1, $2)', [
              dummyTenantId,
              "Placeholder Tenant",
            ]);
          }

          await query(
            `
                        INSERT INTO "Account" (id, name, "tenantId", "isActive") 
                        VALUES ($1, $2, $3, $4)
                    `,
            [accountId, `Account ${accountId}`, dummyTenantId, true],
          );
          console.log(`Inserted placeholder account: ${accountId}`);
        }
      } catch (accErr) {
        console.error(
          `Failed to handle placeholder account ${accountId}:`,
          accErr.message,
        );
      }
    }

    // Upsert to Local DB
    for (const bucket of buckets) {
      await query(
        `
                INSERT INTO "Bucket" (id, name, region, "accountId", "storageClass", versioning, encryption, "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    region = EXCLUDED.region,
                    "storageClass" = EXCLUDED."storageClass",
                    "updatedAt" = EXCLUDED."updatedAt"
            `,
        [
          bucket.id,
          bucket.name,
          bucket.region,
          bucket.accountId,
          bucket.storageClass || "STANDARD",
          bucket.versioning,
          bucket.encryption,
          bucket.createdAt,
          bucket.updatedAt,
        ],
      );

      // Ensure bucket folder exists physically
      const bucketFolderPath = path.join(ROOT_PATH, bucket.name);
      if (!fs.existsSync(bucketFolderPath)) {
        fs.mkdirSync(bucketFolderPath, { recursive: true });
        console.log(`Created bucket folder: ${bucketFolderPath}`);
      }
    }
  } catch (error) {
    console.error("Failed to sync buckets:", error.message);
    throw error;
  }
};

// 2. Sync Files (Metadata Only for now)
const syncFiles = async () => {
  // This is complex. We need to iterate over buckets or fetch all changed files.
  // For MVP, let's just fetch files for the first bucket found locally to demonstrate.
  try {
    const { rows: buckets } = await query(`SELECT id FROM "Bucket" LIMIT 1`);
    if (buckets.length === 0) return;

    const bucketId = buckets[0].id;

    // Fetch files from Global API
    const response = await axios.get(
      `${API_URL}/files?bucketId=${bucketId}&syncAll=true`,
      { headers: getAuthHeaders() },
    );
    const files = response.data; // Assumes flat list or hierarchy. Adjust based on actual API.

    for (const file of files) {
      await query(
        `
                INSERT INTO "FileObject" (id, name, key, "isFolder", size, "mimeType", "bucketId", "parentId", "createdAt", "updatedAt", "isSynced")
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
                ON CONFLICT (id) DO UPDATE SET
                    size = EXCLUDED.size,
                    "updatedAt" = EXCLUDED."updatedAt"
            `,
        [
          file.id,
          file.name,
          file.key,
          file.isFolder,
          file.size,
          file.mimeType,
          file.bucketId,
          file.parentId,
          file.createdAt,
          file.updatedAt,
        ],
      );
    }
  } catch (error) {
    console.error("Failed to sync files:", error.message);
    throw error;
  }
};

module.exports = { initSync, stopSync, getAuthToken: () => authToken };
