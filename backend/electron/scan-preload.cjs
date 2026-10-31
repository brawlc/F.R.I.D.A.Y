const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('scanPanel', {
  onUpdate: callback => ipcRenderer.on('friday:scan-update', (_event, data) => callback(data)),
  stop: () => ipcRenderer.send('friday:scan-stop'),
});
