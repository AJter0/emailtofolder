const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { ImapWorker } = require('./imap-worker');
const { OutlookLocalWorker } = require('./outlook-local');

// Set official Application Name & Windows App User Model ID
app.setName('Email to Folder');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.emailtofolder.app');
}

// Single instance lock to prevent duplicate tray icons on Windows
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Icon assets
const appIconIco = path.join(__dirname, 'assets', 'icon.ico');
const appIconPng = path.join(__dirname, 'assets', 'icon.png');
const trayIconIco = path.join(__dirname, 'assets', 'tray.ico');
const trayIconPng = path.join(__dirname, 'assets', 'tray.png');

// Data directory for configuration & history
const dataDir = path.join(app.getPath('userData'), 'EmailToFolderData');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const configFilePath = path.join(dataDir, 'config.json');
const historyFilePath = path.join(dataDir, 'history.json');

function getCurrentMonthString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Default initial configuration matching the demo site + pre-connected Outlook Classic
const defaultConfig = {
  isRunning: true,
  pollIntervalMinutes: 1,
  startWithWindows: false,
  minimizeToTray: true,
  notificationsEnabled: true,
  autoUpdate: true,
  theme: 'dark',
  accounts: [
    {
      id: 'acc-outlook-local',
      type: 'outlook_local',
      name: 'Microsoft Outlook Classic (Local)',
      user: 'Outlook Classic (Auto-Detect)',
      enabled: true
    }
  ],
  rules: [
    {
      id: 'rule-1',
      name: 'Invoice to Finance',
      enabled: true,
      conditionType: 'subject_contains',
      conditionValue: 'Invoice',
      targetFolder: path.join(app.getPath('documents'), 'Finance', 'Invoices'),
      saveEml: true,
      saveAttachments: true,
      folderPerEmail: false
    },
    {
      id: 'rule-2',
      name: 'Project A Correspondence',
      enabled: true,
      conditionType: 'from_contains',
      conditionValue: '@projecta.co.th',
      targetFolder: path.join(app.getPath('documents'), 'Projects', '2026-A'),
      saveEml: true,
      saveAttachments: true,
      folderPerEmail: false
    },
    {
      id: 'rule-3',
      name: 'Contracts & Legal',
      enabled: true,
      conditionType: 'subject_contains',
      conditionValue: 'Contract',
      targetFolder: path.join(app.getPath('documents'), 'Legal', 'Contracts'),
      saveEml: true,
      saveAttachments: true,
      folderPerEmail: false
    },
    {
      id: 'rule-4',
      name: 'Human Resources',
      enabled: true,
      conditionType: 'from_contains',
      conditionValue: 'hr@company.com',
      targetFolder: path.join(app.getPath('documents'), 'HR'),
      saveEml: true,
      saveAttachments: true,
      folderPerEmail: false
    },
    {
      id: 'rule-5',
      name: 'General Inbox Auto-Archive',
      enabled: true,
      conditionType: 'all_emails',
      conditionValue: '',
      targetFolder: path.join(app.getPath('documents'), 'EmailArchive', 'Inbox'),
      saveEml: true,
      saveAttachments: true,
      folderPerEmail: false
    }
  ],
  stats: {
    totalSaved: 1284,
    todaySaved: 14
  },
  quota: {
    limit: 100,
    used: 14,
    month: getCurrentMonthString(),
    isUnlimited: false
  }
};

function loadConfig() {
  try {
    if (fs.existsSync(configFilePath)) {
      const data = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
      const cfg = { ...defaultConfig, ...data };
      const currentMonth = getCurrentMonthString();
      if (!cfg.quota) {
        cfg.quota = { limit: 100, used: 0, month: currentMonth, isUnlimited: false };
      } else if (cfg.quota.month !== currentMonth) {
        console.log(`New month (${currentMonth}) detected. Resetting monthly quota.`);
        cfg.quota.month = currentMonth;
        cfg.quota.used = 0;
      }
      if (!Array.isArray(cfg.accounts) || cfg.accounts.length === 0) {
        cfg.accounts = [...defaultConfig.accounts];
      }
      if (!Array.isArray(cfg.rules) || cfg.rules.length === 0) {
        cfg.rules = [...defaultConfig.rules];
      }
      return cfg;
    }
  } catch (err) {
    console.error('Failed to load config, using default:', err);
  }
  return JSON.parse(JSON.stringify(defaultConfig));
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(configFilePath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

function loadHistory() {
  try {
    if (fs.existsSync(historyFilePath)) {
      return JSON.parse(fs.readFileSync(historyFilePath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load history:', err);
  }
  return [
    {
      id: 'hist-1',
      date: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
      subject: 'Invoice #INV-2026-0418',
      from: 'accounting@vendor.co.th',
      ruleName: 'Invoice to Finance',
      targetFolder: path.join(app.getPath('documents'), 'Finance', 'Invoices'),
      filesSaved: ['Invoice #INV-2026-0418.eml', 'Invoice.pdf'],
      status: 'success'
    },
    {
      id: 'hist-2',
      date: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
      subject: 'Contract Draft v3',
      from: 'legal@partner.com',
      ruleName: 'Contracts & Legal',
      targetFolder: path.join(app.getPath('documents'), 'Legal', 'Contracts'),
      filesSaved: ['Contract Draft v3.eml', 'Contract_v3.pdf'],
      status: 'success'
    },
    {
      id: 'hist-3',
      date: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      subject: 'Site report – Week 41',
      from: 'pm@projecta.co.th',
      ruleName: 'Project A Correspondence',
      targetFolder: path.join(app.getPath('documents'), 'Projects', '2026-A'),
      filesSaved: ['Site report – Week 41.eml', 'Report.xlsx'],
      status: 'success'
    },
    {
      id: 'hist-4',
      date: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
      subject: 'Meeting minutes',
      from: 'hr@company.com',
      ruleName: 'Human Resources',
      targetFolder: path.join(app.getPath('documents'), 'HR'),
      filesSaved: ['Meeting minutes.eml'],
      status: 'success'
    }
  ];
}

function appendHistory(item) {
  try {
    const history = loadHistory();
    history.unshift(item);
    if (history.length > 500) history.pop();
    fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to append history:', err);
  }
}

let appConfig = loadConfig();
let imapWorker = null;
let outlookLocalWorker = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Email to Folder',
    icon: process.platform === 'win32' ? appIconIco : appIconPng,
    width: 1180,
    height: 800,
    minWidth: 800,
    minHeight: 520,
    resizable: true,
    frame: false,
    backgroundColor: '#0b0b0e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && appConfig.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      if (tray && Notification.isSupported()) {
        new Notification({
          title: 'Email to Folder',
          icon: appIconPng,
          body: 'แอปกำลังทำงานอยู่เบื้องหลังใน System Tray'
        }).show();
      }
    }
  });
}

function createTray() {
  const iconPath = process.platform === 'win32' ? trayIconIco : trayIconPng;
  const trayIcon = nativeImage.createFromPath(iconPath);

  tray = new Tray(trayIcon);
  tray.setToolTip('Email to Folder');

  updateTrayMenu();

  // Single click toggles window focus
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  tray.on('double-click', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const isRunning = appConfig.isRunning !== false;
  const quotaUsed = (appConfig.quota && appConfig.quota.used) || 0;
  const quotaLimit = (appConfig.quota && appConfig.quota.limit) || 100;
  const isUnlimited = appConfig.quota && appConfig.quota.isUnlimited;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Email to Folder',
      enabled: false
    },
    {
      label: isRunning ? '🟢 สถานะ: กำลังทำงาน (Live Sync)' : '⏸ สถานะ: หยุดชั่วคราว (Paused)',
      enabled: false
    },
    {
      label: `โควตาเดือนนี้: ${quotaUsed}/${isUnlimited ? '∞' : quotaLimit} ฉบับ`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'เปิด Email to Folder',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: '🔄 ซิงก์อีเมลทันที (Sync Now)',
      click: async () => {
        await performManualSync();
      }
    },
    {
      label: isRunning ? 'หยุดทำงานชั่วคราว' : 'เริ่มทำงานอัตโนมัติ',
      click: () => {
        toggleEngine(!appConfig.isRunning);
      }
    },
    { type: 'separator' },
    {
      label: 'ออกจากโปรแกรม (Exit)',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function toggleEngine(running) {
  appConfig.isRunning = running;
  saveConfig(appConfig);
  updateTrayMenu();

  if (mainWindow) {
    mainWindow.webContents.send('engine-status-changed', appConfig.isRunning);
  }

  if (running) {
    startEngine();
  } else {
    stopEngine();
  }
}

function startEngine() {
  console.log('Starting Email to Folder engine...');
  if (!imapWorker) {
    imapWorker = new ImapWorker(appConfig, onEmailProcessed, dataDir);
  } else {
    imapWorker.config = appConfig;
  }
  imapWorker.start();

  if (!outlookLocalWorker) {
    outlookLocalWorker = new OutlookLocalWorker(appConfig, onEmailProcessed, dataDir);
  } else {
    outlookLocalWorker.config = appConfig;
  }
  outlookLocalWorker.start();
}

function stopEngine() {
  console.log('Stopping Email to Folder engine...');
  if (imapWorker) {
    imapWorker.stop();
  }
  if (outlookLocalWorker) {
    outlookLocalWorker.stop();
  }
}

async function performManualSync() {
  if (!outlookLocalWorker) {
    outlookLocalWorker = new OutlookLocalWorker(appConfig, onEmailProcessed, dataDir);
  } else {
    outlookLocalWorker.config = appConfig;
  }

  if (!imapWorker) {
    imapWorker = new ImapWorker(appConfig, onEmailProcessed, dataDir);
  } else {
    imapWorker.config = appConfig;
  }

  const outlookRes = await outlookLocalWorker.poll(true);
  await imapWorker.pollAllAccounts();
  const envInfo = await outlookLocalWorker.detectEnvironment();

  return {
    success: true,
    checked: outlookRes.checked || 0,
    saved: outlookRes.saved || 0,
    outlookEnv: envInfo
  };
}

function onEmailProcessed(eventData) {
  if (eventData && eventData.quotaExceeded) {
    if (mainWindow) {
      mainWindow.webContents.send('quota-exceeded', { quota: appConfig.quota });
    }
    return;
  }

  // Check and update monthly quota
  const currentMonth = getCurrentMonthString();
  if (!appConfig.quota) {
    appConfig.quota = { limit: 100, used: 0, month: currentMonth, isUnlimited: false };
  } else if (appConfig.quota.month !== currentMonth) {
    appConfig.quota.month = currentMonth;
    appConfig.quota.used = 0;
  }

  if (!appConfig.quota.isUnlimited && appConfig.quota.used >= appConfig.quota.limit) {
    console.log(`Monthly free quota (${appConfig.quota.limit}) reached. Cannot save more emails this month.`);
    if (mainWindow) {
      mainWindow.webContents.send('quota-exceeded', { quota: appConfig.quota });
    }
    return;
  }

  // Update quota usage & stats
  appConfig.quota.used += 1;
  appConfig.stats.totalSaved += 1;
  appConfig.stats.todaySaved += 1;
  saveConfig(appConfig);

  // Append history
  appendHistory({
    id: 'hist-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    date: eventData.date || new Date().toISOString(),
    subject: eventData.subject,
    from: eventData.from,
    ruleName: eventData.ruleName,
    targetFolder: eventData.targetFolder,
    filesSaved: eventData.filesSaved || [],
    status: 'success'
  });

  // Notify UI
  if (mainWindow) {
    mainWindow.webContents.send('email-saved', {
      ...eventData,
      stats: appConfig.stats,
      quota: appConfig.quota
    });
  }

  // Update Tray tooltip and menu
  updateTrayMenu();

  // Windows Desktop Notification
  if (appConfig.notificationsEnabled && Notification.isSupported()) {
    new Notification({
      title: 'Email to Folder — บันทึกสำเร็จ',
      icon: appIconPng,
      body: `"${eventData.subject}" บันทึกลง ${path.basename(eventData.targetFolder)} เรียบร้อยแล้ว`
    }).show();
  }
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  createTray();

  if (appConfig.isRunning !== false) {
    startEngine();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopEngine();
});

// IPC Communication Handlers
ipcMain.handle('get-initial-data', async () => {
  if (!outlookLocalWorker) {
    outlookLocalWorker = new OutlookLocalWorker(appConfig, onEmailProcessed, dataDir);
  }
  const outlookEnv = await outlookLocalWorker.detectEnvironment();
  if (outlookEnv.account) {
    const olAcc = (appConfig.accounts || []).find(a => a.type === 'outlook_local');
    if (olAcc) {
      olAcc.user = outlookEnv.account;
      olAcc.name = `Microsoft Outlook Classic (${outlookEnv.account})`;
    }
  }
  return {
    config: appConfig,
    history: loadHistory(),
    outlookEnv
  };
});

ipcMain.handle('save-config', (event, newConfig) => {
  appConfig = { ...appConfig, ...newConfig };
  saveConfig(appConfig);

  if (process.platform === 'win32') {
    try {
      app.setLoginItemSettings({
        openAtLogin: Boolean(appConfig.startWithWindows)
      });
    } catch (e) {}
  }

  if (appConfig.isRunning) {
    stopEngine();
    startEngine();
  }
  return true;
});

ipcMain.handle('toggle-engine', (event, running) => {
  toggleEngine(running);
  return appConfig.isRunning;
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'เลือกโฟลเดอร์ปลายทางสำหรับจัดเก็บอีเมล'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  if (!fs.existsSync(folderPath)) {
    try {
      fs.mkdirSync(folderPath, { recursive: true });
    } catch (e) {
      return false;
    }
  }
  await shell.openPath(folderPath);
  return true;
});

ipcMain.handle('detect-outlook', async () => {
  if (!outlookLocalWorker) {
    outlookLocalWorker = new OutlookLocalWorker(appConfig, onEmailProcessed, dataDir);
  }
  return await outlookLocalWorker.detectEnvironment();
});

ipcMain.handle('sync-now', async () => {
  return await performManualSync();
});

ipcMain.handle('test-account-connection', async (event, account) => {
  if (account.type === 'outlook_local') {
    if (!outlookLocalWorker) {
      outlookLocalWorker = new OutlookLocalWorker(appConfig, onEmailProcessed, dataDir);
    }
    return await outlookLocalWorker.testConnection();
  } else {
    const testWorker = new ImapWorker(appConfig);
    return await testWorker.testConnection(account);
  }
});

// Manual File Drop Ingest: When user drags an .eml or .msg file onto the app window!
ipcMain.handle('process-manual-file', async (event, filePath) => {
  if (!fs.existsSync(filePath)) return { success: false, error: 'File does not exist' };

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.eml' && ext !== '.msg') {
    return { success: false, error: 'รองรับไฟล์อีเมลนามสกุล .eml หรือ .msg เท่านั้น' };
  }

  // Process through rule engine
  const { processEmailFile } = require('./file-processor');
  return await processEmailFile(filePath, appConfig, onEmailProcessed);
});

ipcMain.handle('open-external-url', async (event, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:'))) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

// Export audit history to CSV (Excel compatible with UTF-8 BOM)
ipcMain.handle('export-history-csv', async () => {
  const history = loadHistory();
  if (!history || history.length === 0) {
    return { success: false, message: 'ไม่มีข้อมูลประวัติสำหรับส่งออก' };
  }

  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'ส่งออกประวัติการจัดเก็บอีเมล (Export to CSV)',
    defaultPath: `EmailToFolder_History_${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [
      { name: 'CSV File (*.csv)', extensions: ['csv'] }
    ]
  });

  if (!filePath) return { success: false, canceled: true };

  try {
    const BOM = '\uFEFF';
    const headers = ['"Date & Time"', '"Subject"', '"From"', '"Rule Name"', '"Target Folder"', '"Saved Files"', '"Status"'];
    const escapeCsv = (val) => `"${String(val || '').replace(/"/g, '""')}"`;

    const rows = history.map(item => [
      escapeCsv(new Date(item.date).toLocaleString('th-TH')),
      escapeCsv(item.subject),
      escapeCsv(item.from),
      escapeCsv(item.ruleName),
      escapeCsv(item.targetFolder),
      escapeCsv(Array.isArray(item.filesSaved) ? item.filesSaved.join(', ') : item.filesSaved),
      escapeCsv(item.status || 'success')
    ].join(','));

    const csvContent = BOM + [headers.join(','), ...rows].join('\r\n');
    fs.writeFileSync(filePath, csvContent, 'utf8');

    return { success: true, filePath, count: history.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Clear audit history
ipcMain.handle('clear-history', async () => {
  try {
    fs.writeFileSync(historyFilePath, JSON.stringify([], null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Window controls (Custom Title Bar)
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

// Auto-Patch & Update Check Handlers
ipcMain.handle('check-for-updates', async () => {
  const https = require('https');

  function fetchVersionJson(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        timeout: 8000,
        headers: {
          'User-Agent': 'EmailToFolder-Updater/1.1.0',
          'Cache-Control': 'no-cache'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchVersionJson(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid version JSON'));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timeout'));
      });
    });
  }

  try {
    let remote;
    try {
      // Query GitHub Raw first with cache-buster so freshly pushed releases appear immediately
      remote = await fetchVersionJson(`https://raw.githubusercontent.com/AJter0/emailtofolder/main/version.json?t=${Date.now()}`);
    } catch (primaryErr) {
      remote = await fetchVersionJson(`https://emailtofolder.com/version.json?t=${Date.now()}`);
    }

    const currentVersion = '1.3.0';
    const currentRun = 4;
    const hasUpdate = (remote.runNumber && remote.runNumber > currentRun) ||
      (remote.version && remote.version !== currentVersion && remote.version > currentVersion);

    return {
      success: true,
      hasUpdate: Boolean(hasUpdate),
      currentVersion: `v${currentVersion} (Run #${currentRun})`,
      remoteVersion: remote.fullVersion || `v${remote.version}`,
      description: remote.description || '',
      descriptionEn: remote.descriptionEn || '',
      downloadUrl: remote.downloadUrl || 'https://raw.githubusercontent.com/AJter0/emailtofolder/main/downloads/EmailToFolder-Setup.exe'
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('apply-patch', async (event, downloadUrl) => {
  const urlToUse = downloadUrl || 'https://raw.githubusercontent.com/AJter0/emailtofolder/main/downloads/EmailToFolder-Setup.exe';
  const https = require('https');
  const http = require('http');
  const tempPath = path.join(app.getPath('temp'), `EmailToFolder-Patch-${Date.now()}.exe`);
  const isFirstPartyUrl = (targetUrl) => {
    try {
      const hostname = new URL(targetUrl).hostname.toLowerCase();
      return hostname === 'emailtofolder.com' || hostname.endsWith('.emailtofolder.com');
    } catch {
      return false;
    }
  };

  return new Promise((resolve) => {
    function downloadFile(targetUrl, fallbackAttempted = false) {
      const proto = targetUrl.startsWith('https') ? https : http;
      const req = proto.get(targetUrl, {
        headers: {
          'User-Agent': 'EmailToFolder-Updater/1.2.0',
          'Cache-Control': 'no-cache'
        }
      }, (res) => {
        // Handle redirect if any
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadFile(res.headers.location, fallbackAttempted);
        }
        if (res.statusCode !== 200) {
          if (!fallbackAttempted && !isFirstPartyUrl(targetUrl)) {
            return downloadFile('https://emailtofolder.com/downloads/EmailToFolder-Setup.exe', true);
          }
          return resolve({ success: false, error: `HTTP ${res.statusCode}` });
        }
        const fileStream = fs.createWriteStream(tempPath);
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(() => {
            try {
              const { spawn } = require('child_process');
              const appExePath = process.execPath;
              // Create a detached helper script that waits 2s for app to exit, runs NSIS installer silently (/S), and relaunches the updated app!
              const updaterBat = path.join(app.getPath('temp'), `EmailToFolder-RunPatch-${Date.now()}.bat`);
              const batContent = [
                '@echo off',
                'timeout /t 2 /nobreak >nul',
                `"${tempPath}" /S`,
                'timeout /t 2 /nobreak >nul',
                `start "" "${appExePath}"`,
                `del "%~f0"`
              ].join('\r\n');
              fs.writeFileSync(updaterBat, batContent, 'utf8');

              const child = spawn('cmd.exe', ['/c', updaterBat], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
              });
              child.unref();

              setTimeout(() => {
                isQuitting = true;
                app.quit();
              }, 800);
              resolve({ success: true, message: 'กำลังติดตั้ง Patch อัปเดตและเปิดโปรแกรมใหม่อัตโนมัติ...' });
            } catch (spawnErr) {
              resolve({ success: false, error: spawnErr.message });
            }
          });
        });
      });
      req.on('error', (err) => {
        if (!fallbackAttempted && !isFirstPartyUrl(targetUrl)) {
          return downloadFile('https://emailtofolder.com/downloads/EmailToFolder-Setup.exe', true);
        }
        resolve({ success: false, error: err.message });
      });
    }

    downloadFile(urlToUse);
  });
});
