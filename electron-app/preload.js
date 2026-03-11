const { contextBridge, ipcRenderer, webUtils } = require('electron');

// ── IPC Timing Instrumentation ────────────────────────────────────────────
const ipcTimingLog = [];
const IPC_LOG_MAX = 100;
const ipcTimingListeners = new Set();

function timedInvoke(channel, ...args) {
  const start = performance.now();
  return ipcRenderer.invoke(channel, ...args).then(
    (result) => {
      const duration = Math.round((performance.now() - start) * 100) / 100;
      const entry = { channel, duration, ts: Date.now(), ok: true };
      ipcTimingLog.push(entry);
      if (ipcTimingLog.length > IPC_LOG_MAX) ipcTimingLog.shift();
      ipcTimingListeners.forEach(cb => cb(entry));
      return result;
    },
    (err) => {
      const duration = Math.round((performance.now() - start) * 100) / 100;
      const entry = { channel, duration, ts: Date.now(), ok: false };
      ipcTimingLog.push(entry);
      if (ipcTimingLog.length > IPC_LOG_MAX) ipcTimingLog.shift();
      ipcTimingListeners.forEach(cb => cb(entry));
      throw err;
    }
  );
}

contextBridge.exposeInMainWorld('ipcTiming', {
  getLog: () => [...ipcTimingLog],
  onEntry: (cb) => {
    ipcTimingListeners.add(cb);
    return () => ipcTimingListeners.delete(cb);
  },
});

contextBridge.exposeInMainWorld('electronAPI', {
  // 1. File Browser & Management
  listContent: (args) => {
    if (typeof args === 'string') {
        return timedInvoke('list-path-content', { folderPath: args });
    }
    return timedInvoke('list-path-content', args);
  },
  createFolder: (path) => timedInvoke('create-folder', path),
  openFile: (path) => timedInvoke('open-file', path),
  
  // 2. Transfers
  selectFileForUpload: () => timedInvoke('select-file'),
  selectFolderForUpload: () => timedInvoke('select-folder-upload'),
  uploadItems: (items, currentPath, shouldZip) => timedInvoke('upload-items', { items, currentPath, shouldZip }),
  downloadFile: (url, targetPath) => timedInvoke('download-file', { url, targetPath }),
  downloadS3File: (bucketId, s3Key, localPath, totalSize) => timedInvoke('download-s3-file', { bucketId, s3Key, localPath, totalSize }),
  selectDownloadFolder: () => timedInvoke('select-sync-folder'), // reuse existing folder picker

  // 2b. Get the real filesystem path from a File object (Electron 32+ replacement for File.prototype.path)
  getFilePath: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (e) {
      console.error('[Preload] getFilePath error:', e.message);
      return null;
    }
  },
  
  // 2c. Get the root sync path from main process
  getRootPath: () => timedInvoke('get-root-path'),

  // 3. Status Tracking
  getActiveTransfers: () => timedInvoke('get-active-transfers'),
  pauseTransfer:      (id) => timedInvoke('pause-transfer', id),
  resumeTransfer:     (id) => timedInvoke('resume-transfer', id),
  terminateTransfer:  (id) => timedInvoke('terminate-transfer', id),
  getIncompleteTransfers: () => timedInvoke('get-incomplete-transfers'),
  retryTransfer:      (id) => timedInvoke('retry-transfer', id),
  onTransferStatusUpdate: (callback) => {
    const sub = (_, val) => callback(val);
    ipcRenderer.on('transfer-status-update', sub);
    return () => ipcRenderer.removeListener('transfer-status-update', sub);
  },

  // 4. Monitoring (Network/Disk)
  onNetworkStats: (callback) => {
    const sub = (_, val) => callback(val);
    ipcRenderer.on('network-stats', sub);
    return () => ipcRenderer.removeListener('network-stats', sub);
  },
  onDiskStats: (callback) => {
    const sub = (_, val) => callback(val);
    ipcRenderer.on('disk-stats', sub);
    return () => ipcRenderer.removeListener('disk-stats', sub);
  },

  // 5. Sync Engine
  initSync: (token) => timedInvoke('init-sync', token),
  stopSync: () => timedInvoke('stop-sync'),
  forceSync: () => timedInvoke('force-sync'),
  syncBucketsNow: () => timedInvoke('sync-buckets-now'),
  syncConfigNow: (configId) => timedInvoke('sync-config-now', configId),
  retryFailedSync: (syncActivityId) => timedInvoke('retry-failed-sync', syncActivityId),
  onAuthExpired: (callback) => {
    const sub = () => callback();
    ipcRenderer.on('auth-expired', sub);
    return () => ipcRenderer.removeListener('auth-expired', sub);
  },
  onSyncActivityLogged: (callback) => {
    const sub = (_, val) => callback(val);
    ipcRenderer.on('sync-activity-logged', sub);
    return () => ipcRenderer.removeListener('sync-activity-logged', sub);
  },

  // 6. DB Helpers
  dbQuery: (sql, params) => timedInvoke('db-query', { sql, params }),
  searchFiles: (query) => timedInvoke('search-files', { query }),
  getSyncConfigs: () => timedInvoke('get-sync-configs'),
  createSyncConfig: (config) => timedInvoke('create-sync-config', config),
  updateSyncConfig: (data) => timedInvoke('update-sync-config', data),
  deleteSyncConfig: (id) => timedInvoke('delete-sync-config', id),
  getLocalSyncActivities: (configId) => timedInvoke('get-local-sync-activities', configId),
  getSyncJobs: (configId) => timedInvoke('get-sync-jobs', configId),
  selectSyncFolder: () => timedInvoke('select-sync-folder'),

  // 7. Watcher Events
  onFileChange: (event, callback) => {
    const sub = (_, val) => callback(val);
    ipcRenderer.on(`file-${event}`, sub);
    return () => ipcRenderer.removeListener(`file-${event}`, sub);
  },

  // 8. Auth (Cognito IPC)
  auth: {
    login:           (email, password)               => timedInvoke('auth:login', { email, password }),
    newPassword:     (username, newPassword, session) => timedInvoke('auth:new-password', { username, newPassword, session }),
    refresh:         ()                               => timedInvoke('auth:refresh'),
    logout:          ()                               => timedInvoke('auth:logout'),
    getSession:      ()                               => timedInvoke('auth:get-session'),
    forgotPassword:  (email)                          => timedInvoke('auth:forgot-password', { email }),
    confirmPassword: (email, code, newPassword)       => timedInvoke('auth:confirm-password', { email, code, newPassword }),
    openBrowserSSO:  ()                               => timedInvoke('auth:open-browser-sso'),
    onSSOResult: (cb) => {
      const sub = (_, data) => cb(data);
      ipcRenderer.on('sso-auth-result', sub);
      return () => ipcRenderer.removeListener('sso-auth-result', sub);
    },
  },

  // 9. Bot Auth
  bot: {
    generateKeyPair: ()         => timedInvoke('bot:generate-keypair'),
    getPublicKey:    ()         => timedInvoke('bot:get-public-key'),
    saveBotId:       (botId)    => timedInvoke('bot:save-bot-id', { botId }),
    getBotId:        ()         => timedInvoke('bot:get-bot-id'),
    handshake:       (botId)    => timedInvoke('bot:handshake', { botId }),
    attemptAutoLogin: ()        => timedInvoke('bot:attempt-auto-login'),
    deregister:      ()         => timedInvoke('bot:deregister'),
  },

  // 10. Doctor Diagnostics
  doctor: {
    getHeartbeatHistory:  (minutes) => timedInvoke('doctor:get-heartbeat-history', minutes),
    runDiagnostics:       ()        => timedInvoke('doctor:run-diagnostics'),
    runSingle:            (name)    => timedInvoke('doctor:run-single', name),
    getLastDiagnostics:   ()        => timedInvoke('doctor:get-last-diagnostics'),
    onDoctorProgress: (cb) => {
      const sub = (_, val) => cb(val);
      ipcRenderer.on('doctor:progress', sub);
      return () => ipcRenderer.removeListener('doctor:progress', sub);
    },
    onHeartbeatStatus: (cb) => {
      const sub = (_, val) => cb(val);
      ipcRenderer.on('heartbeat:status', sub);
      return () => ipcRenderer.removeListener('heartbeat:status', sub);
    },
  },
});
