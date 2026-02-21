
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const https = require('https');
const chokidar = require('chokidar');
const si = require('systeminformation');
const { query, initDB } = require('./src/lib/db');
const { initSync, stopSync } = require('./src/services/SyncEngine');
const backendManager = require('./backend/index.js');

const ROOT_PATH = '/home/abhishek/FMS';

let mainWindow;
let watcher;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Cloud Vault',
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0f172a',
    show: false,
  });

  // Load the Vite dev server URL
  mainWindow.loadURL('http://localhost:5173');
  
  // Open DevTools for debugging
  // mainWindow.webContents.openDevTools();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize(); // Make full screen
  });

  // Send network stats periodically
  setInterval(async () => {
      try {
          const stats = await si.networkStats();
          if (stats && stats.length > 0) {
              const mainInterface = stats.find(i => i.operstate === 'up') || stats[0];
              if (mainWindow) {
                mainWindow.webContents.send('network-stats', {
                    rx_sec: mainInterface.rx_sec, // Bytes per second received
                    tx_sec: mainInterface.tx_sec  // Bytes per second transmitted
                });
              }
          }
      } catch (e) {
          // console.error('Network stats error', e);
      }
  }, 1000);
  
  // Send disk stats periodically (every 10 seconds)
  setInterval(async () => {
    try {
        const disks = await si.fsSize();
        if (disks && disks.length > 0) {
            // Try to find the root volume or just take the first one
            const mainDisk = disks.find(d => d.mount === '/' || d.mount === 'C:') || disks[0];
            if (mainWindow) {
                mainWindow.webContents.send('disk-stats', {
                    total: mainDisk.size,
                    used: mainDisk.used,
                    available: mainDisk.available,
                    mount: mainDisk.mount,
                    use_percent: mainDisk.use
                });
            }
        }
    } catch (e) {
        console.error('Disk stats error', e);
    }
  }, 10000);
}

app.whenReady().then(async () => {
  try {
    await initDB();
  } catch (err) {
    console.error("DB Initialization Failed", err);
  }
  
  if (!fs.existsSync(ROOT_PATH)) {
      fs.mkdirSync(ROOT_PATH, { recursive: true });
  }

  console.log("@@@ root path", ROOT_PATH)

  watcher = chokidar.watch(ROOT_PATH, {
      ignored: /(^|[\/\\])\../, 
      persistent: true,
      ignoreInitial: true,
      depth: 99,
  });

  watcher
    .on('add', async (filePath) => {
      console.log("@@@ file added", filePath)
      if (mainWindow) mainWindow.webContents.send('file-added', filePath);
      try { await backendManager.onLocalFileAdded(filePath, ROOT_PATH); } catch(e) {}
    })
    .on('change', async (filePath) => {
      console.log("@@@ file changed", filePath)
      if (mainWindow) mainWindow.webContents.send('file-changed', filePath);
      try { await backendManager.onLocalFileAdded(filePath, ROOT_PATH); } catch(e) {}
    })
    .on('unlink', async (filePath) => {
      console.log("@@@ file removed", filePath)
      if (mainWindow) mainWindow.webContents.send('file-removed', filePath);
      try { await backendManager.onLocalFileRemoved(filePath, ROOT_PATH); } catch(e) { console.error('[Watcher] unlink handler error:', e.message); }
    })
    .on('addDir', (filePath) => {
      console.log("@@@ dir added", filePath)
      if (mainWindow) mainWindow.webContents.send('dir-added', filePath);
    })
    .on('unlinkDir', async (filePath) => {
      console.log("@@@ dir removed", filePath)
      if (mainWindow) mainWindow.webContents.send('dir-removed', filePath);
      try { await backendManager.onLocalDirRemoved(filePath, ROOT_PATH); } catch(e) { console.error('[Watcher] unlinkDir handler error:', e.message); }
    })
    .on('error', (error) => {
      console.log("@@@ watcher error", error)
      console.error(`Watcher error: ${error}`);
      if(mainWindow) mainWindow.webContents.send('sync-error', error.message);
    });

  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (watcher) watcher.close();
  if (process.platform !== 'darwin') app.quit();
});

// Handle folder selection
ipcMain.handle('select-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (canceled) {
    return null;
  }
  return filePaths[0];
});

// start-sync IPC removed since watcher is now global
// List content in a specific path
ipcMain.handle('list-path-content', async (event, folderPath) => {
  try {
    const entries = await fsPromises.readdir(folderPath, { withFileTypes: true });
    return entries.map(dirent => ({
      name: dirent.name,
      isDirectory: dirent.isDirectory()
    }));
  } catch (error) {
    console.error('Error listing path content:', error);
    return [];
  }
});


// Create folder
ipcMain.handle('create-folder', async (event, folderPath) => {
    try {
        await fsPromises.mkdir(folderPath, { recursive: true });
        return true;
    } catch (error) {
        console.error('Error creating folder:', error);
        return false;
    }

});

// Backend Manager moved to top
// Download File Handler
ipcMain.handle('download-file', async (event, { url, targetPath }) => {
    // ... existing download code ...
    return new Promise((resolve, reject) => {
        const fileName = path.basename(url);
        const destination = path.join(targetPath, fileName);
        const file = fs.createWriteStream(destination);

        https.get(url, (response) => {
            // ... existing code ...
            if (response.statusCode !== 200) {
                file.close();
                fs.unlink(destination, () => {}); 
                reject(`Server responded with ${response.statusCode}: ${response.statusMessage}`);
                return;
            }

            const totalBytes = parseInt(response.headers['content-length'], 10);
            let receivedBytes = 0;

            response.on('data', (chunk) => {
                receivedBytes += chunk.length;
                if (totalBytes) {
                     const progress = (receivedBytes / totalBytes) * 100;
                     if (mainWindow) {
                         mainWindow.webContents.send('download-progress', {
                             filename: fileName,
                             progress: progress,
                             received: receivedBytes,
                             total: totalBytes
                         });
                     }
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close(() => resolve({ success: true, path: destination }));
            });

            file.on('error', (err) => {
                fs.unlink(destination, () => {}); 
                reject(err.message);
            });
        }).on('error', (err) => {
            fs.unlink(destination, () => {}); 
            reject(err.message);
        });
    });
});

// Handle File Drop (Copy & Sync)
ipcMain.handle('handle-file-drop', async (event, { files, currentPath }) => {
    console.log('Files dropped:', files, 'Current Directory:', currentPath);
    return await backendManager.handleFileDrop(files, currentPath);
});

// Handle S3 Sync
ipcMain.handle('sync-s3-to-local', async (event, folderPath) => {
    return await backendManager.syncFromS3(folderPath, (data) => {
        if (event.sender) {
            event.sender.send('sync-progress', data);
        }
    });
});

// Select File for Upload
ipcMain.handle('select-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections']
    });
    if (canceled) return null;
    return filePaths;
});

// Select Folder for Upload
ipcMain.handle('select-folder-upload', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'multiSelections'] 
    });
    if (canceled) return null;
    return filePaths;
});

// Upload Items (with Zip option)
ipcMain.handle('upload-items', async (event, { items, currentPath, shouldZip }) => {
    return await backendManager.uploadItems(items, currentPath, shouldZip);
});

// Database Query Handler
ipcMain.handle('db-query', async (event, { text, params }) => {
  try {
    const result = await query(text, params);
    return { rows: result.rows, rowCount: result.rowCount };
  } catch (error) {
    console.error('DB Query Error:', error);
    throw error;
  }
});

// Init Sync Engine
ipcMain.handle('init-sync', (event, token) => {
    initSync(token, () => {
        if (mainWindow) {
            mainWindow.webContents.send('auth-expired');
        }
    });
    return true;
});

// Stop Sync Engine
ipcMain.handle('stop-sync', () => {
    stopSync();
    return true;
});
