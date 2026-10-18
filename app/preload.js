const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getInitialData: () => ipcRenderer.invoke('get-initial-data'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  toggleEngine: (running) => ipcRenderer.invoke('toggle-engine', running),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  testAccountConnection: (account) => ipcRenderer.invoke('test-account-connection', account),
  processManualFile: (filePath) => ipcRenderer.invoke('process-manual-file', filePath),

  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),

  // Window control
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),

  // Event Listeners
  onEmailSaved: (callback) => {
    ipcRenderer.on('email-saved', (event, data) => callback(data));
  },
  onEngineStatusChanged: (callback) => {
    ipcRenderer.on('engine-status-changed', (event, status) => callback(status));
  },
  onQuotaExceeded: (callback) => {
    ipcRenderer.on('quota-exceeded', (event, data) => callback(data));
  }
});
