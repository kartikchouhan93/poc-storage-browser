const { ipcMain } = require('electron');
const syncHistory = require('../syncHistory');

class TransferStatusManager {
    constructor() {
        this.transfers = new Map();
        this.mainWindow = null;
        this.pendingTimeout = null;
        // transferId -> { resolve, reject } for pause/terminate signals
        this._pauseSignals = new Map();   // transferId -> { isPaused, resume: fn }
        this._abortControllers = new Map(); // transferId -> AbortController
    }

    init(mainWindow) {
        this.mainWindow = mainWindow;
        console.log(`[TransferStatusManager] Initialized with window ID: ${mainWindow?.id}`);
    }

    startTransfer(id, name, type, size = 0, totalChunks = 0) {
        console.log(`[TransferStatusManager] Starting ${type}: ${name} (${id}) - Size: ${size}`);
        const transfer = {
            id,
            name,
            type, // 'upload', 'download', 'zip', 'copy'
            size,
            progress: 0,
            loaded: 0,
            status: 'active',
            startTime: Date.now(),
            lastUpdate: Date.now(),
            speed: 0,
            // chunks: [{ index, status: 'pending'|'active'|'done'|'error', progress: 0-100 }]
            chunks: totalChunks > 0
                ? Array.from({ length: totalChunks }, (_, i) => ({ index: i + 1, status: 'pending', progress: 0 }))
                : []
        };
        this.transfers.set(id, transfer);
        this.notify(true); // Immediate update for start
        return id;
    }

    /**
     * Update overall progress.
     * @param {string} id
     * @param {number} progress - 0-100
     * @param {number|null} loaded - bytes loaded so far
     */
    updateProgress(id, progress, loaded = null) {
        const transfer = this.transfers.get(id);
        if (transfer) {
            const now = Date.now();
            const timeDiff = (now - transfer.lastUpdate) / 1000; // seconds
            
            if (loaded !== null && timeDiff > 0) {
                const bytesDiff = loaded - transfer.loaded;
                transfer.speed = bytesDiff / timeDiff; // bytes per second
                transfer.loaded = loaded;
            }
            
            transfer.progress = progress;
            transfer.lastUpdate = now;
            this.notify();
        }
    }

    /**
     * Update a single chunk's status/progress.
     * @param {string} id - transfer id
     * @param {number} chunkIndex - 1-based part number
     * @param {'pending'|'active'|'done'|'error'} status
     * @param {number} progress - 0-100
     */
    updateChunk(id, chunkIndex, status, progress = 0) {
        const transfer = this.transfers.get(id);
        if (!transfer || !transfer.chunks.length) return;
        const chunk = transfer.chunks.find(c => c.index === chunkIndex);
        if (chunk) {
            chunk.status = status;
            chunk.progress = progress;
            this.notify();
        }
    }

    completeTransfer(id, status = 'done') {
        const transfer = this.transfers.get(id);
        if (transfer) {
            console.log(`[TransferStatusManager] Completed ${id} with status: ${status}`);
            transfer.status = status;
            transfer.progress = 100;
            transfer.speed = 0;
            this.notify(true); // Immediate update for completion
            
            // Remove after some time
            setTimeout(() => {
                if (this.transfers.has(id)) {
                    this.transfers.delete(id);
                    this.notify();
                }
            }, 5000);
        }
    }

    // ── Pause / Resume / Terminate ────────────────────────────────────────────

    registerAbortController(id, controller) {
        this._abortControllers.set(id, controller);
    }

    pauseTransfer(id) {
        const transfer = this.transfers.get(id);
        if (!transfer || transfer.status !== 'active') return false;
        transfer.status = 'paused';
        transfer.speed = 0;
        // Set pause flag — upload/download loops poll this
        if (!this._pauseSignals.has(id)) this._pauseSignals.set(id, { isPaused: true, _waiters: [] });
        else this._pauseSignals.get(id).isPaused = true;
        this.notify(true);
        // Log to Recent Activities
        const action = transfer.type === 'download' ? 'DOWNLOAD' : 'UPLOAD';
        syncHistory.logActivity(action, transfer.name, 'PAUSED').catch(() => {});
        return true;
    }

    resumeTransfer(id) {
        const transfer = this.transfers.get(id);
        if (!transfer || transfer.status !== 'paused') return false;
        transfer.status = 'active';
        const sig = this._pauseSignals.get(id);
        if (sig) {
            sig.isPaused = false;
            // Wake all waiters
            for (const resolve of sig._waiters) resolve();
            sig._waiters = [];
        }
        this.notify(true);
        return true;
    }

    terminateTransfer(id) {
        const transfer = this.transfers.get(id);
        if (!transfer) return false;
        // Wake any paused waiters so the loop can exit
        const sig = this._pauseSignals.get(id);
        if (sig) {
            sig.isPaused = false;
            sig.terminated = true;
            for (const resolve of sig._waiters) resolve();
            sig._waiters = [];
        }
        // Signal abort controller if present
        const ctrl = this._abortControllers.get(id);
        if (ctrl) ctrl.abort();
        transfer.status = 'terminated';
        transfer.speed = 0;
        this.notify(true);
        // Log to Recent Activities
        const action = transfer.type === 'download' ? 'DOWNLOAD' : 'UPLOAD';
        syncHistory.logActivity(action, transfer.name, 'CANCELLED').catch(() => {});
        // Clean up after a short delay
        setTimeout(() => {
            this.transfers.delete(id);
            this._pauseSignals.delete(id);
            this._abortControllers.delete(id);
            this.notify();
        }, 3000);
        return true;
    }

    /** Call this inside upload/download loops to honour pause/terminate. 
     *  Returns true if the transfer was terminated (caller should throw/return). */
    async checkPauseSignal(id) {
        const sig = this._pauseSignals.get(id);
        if (!sig) return false;
        if (sig.terminated) return true;
        if (sig.isPaused) {
            await new Promise(resolve => sig._waiters.push(resolve));
        }
        return sig.terminated || false;
    }

    isPaused(id) {
        return this._pauseSignals.get(id)?.isPaused === true;
    }

    isTerminated(id) {
        return this._pauseSignals.get(id)?.terminated === true;
    }

    getTransfers() {
        return Array.from(this.transfers.values());
    }

    notify(immediate = false) {
        if (immediate) {
            if (this.pendingTimeout) {
                clearTimeout(this.pendingTimeout);
                this.pendingTimeout = null;
            }
            this._sendUpdate();
            return;
        }

        if (this.pendingTimeout) return;
        
        this.pendingTimeout = setTimeout(() => {
            this.pendingTimeout = null;
            this._sendUpdate();
        }, 50); // 50ms throttle for smoothness
    }

    _sendUpdate() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            const transferList = this.getTransfers();
            this.mainWindow.webContents.send('transfer-status-update', transferList);
        }
    }
}

module.exports = new TransferStatusManager();
