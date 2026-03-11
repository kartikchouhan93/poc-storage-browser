/**
 * transferState.js — Persistent transfer state for resumable uploads/downloads.
 * Wraps the TransferState SQLite table with typed helpers.
 */

const database = require('../database');

/**
 * Persist a new transfer record.
 * @param {{ id, type, bucketId, s3Key, localPath, totalSize, mimeType, configId, syncJobId, userId }} opts
 */
function saveTransferState(opts) {
    database.query(`
        INSERT INTO "TransferState"
            (id, type, status, "bucketId", "s3Key", "localPath", "totalSize", "mimeType", "configId", "syncJobId", "userId", "updatedAt")
        VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, datetime('now'))
        ON CONFLICT (id) DO NOTHING
    `, [
        opts.id,
        opts.type,
        opts.bucketId,
        opts.s3Key,
        opts.localPath,
        opts.totalSize || 0,
        opts.mimeType || null,
        opts.configId || null,
        opts.syncJobId || null,
        opts.userId || null,
    ]);
}

/**
 * Load a transfer record by its deterministic ID.
 * @param {string} id
 * @returns {object|null}
 */
function getTransferState(id) {
    const res = database.query(
        `SELECT * FROM "TransferState" WHERE id = $1 LIMIT 1`,
        [id]
    );
    if (!res.rows.length) return null;
    const row = res.rows[0];
    // Deserialise completedParts JSON
    if (row.completedParts) {
        try { row.completedParts = JSON.parse(row.completedParts); } catch { row.completedParts = []; }
    } else {
        row.completedParts = [];
    }
    return row;
}

/**
 * Update mutable fields on an existing record.
 * @param {string} id
 * @param {{ status?, bytesTransferred?, uploadId?, completedParts?, error? }} patch
 */
function updateTransferState(id, patch) {
    const sets = [];
    const params = [];

    if (patch.status !== undefined)           { sets.push(`status = $${params.length + 1}`);             params.push(patch.status); }
    if (patch.bytesTransferred !== undefined) { sets.push(`"bytesTransferred" = $${params.length + 1}`); params.push(patch.bytesTransferred); }
    if (patch.uploadId !== undefined)         { sets.push(`"uploadId" = $${params.length + 1}`);         params.push(patch.uploadId); }
    if (patch.completedParts !== undefined)   { sets.push(`"completedParts" = $${params.length + 1}`);   params.push(JSON.stringify(patch.completedParts)); }
    if (patch.error !== undefined)            { sets.push(`error = $${params.length + 1}`);              params.push(patch.error); }

    if (!sets.length) return;
    sets.push(`"updatedAt" = datetime('now')`);
    params.push(id);

    database.query(
        `UPDATE "TransferState" SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params
    );
}

/**
 * Mark a transfer as done and remove it from the table.
 * @param {string} id
 */
function deleteTransferState(id) {
    database.query(`DELETE FROM "TransferState" WHERE id = $1`, [id]);
}

/**
 * Return all transfers that are not yet complete — used on startup to re-queue.
 * Scoped to the current user if userId is provided.
 * @param {string|null} userId
 * @returns {object[]}
 */
function getIncompleteTransfers(userId = null) {
    const res = userId
        ? database.query(
            `SELECT * FROM "TransferState" WHERE status NOT IN ('done') AND "userId" = $1 ORDER BY "createdAt" ASC`,
            [userId]
          )
        : database.query(
            `SELECT * FROM "TransferState" WHERE status NOT IN ('done') ORDER BY "createdAt" ASC`
          );
    return res.rows.map(row => {
        if (row.completedParts) {
            try { row.completedParts = JSON.parse(row.completedParts); } catch { row.completedParts = []; }
        } else {
            row.completedParts = [];
        }
        return row;
    });
}

module.exports = { saveTransferState, getTransferState, updateTransferState, deleteTransferState, getIncompleteTransfers };
