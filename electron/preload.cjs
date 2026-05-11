const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fridayDesktop', {
  showWindow: () => ipcRenderer.send('friday:show-window'),
});
