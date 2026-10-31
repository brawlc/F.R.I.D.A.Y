const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fridayDesktop', {
  showWindow: () => ipcRenderer.send('friday:show-window'),
  focusWindow: () => ipcRenderer.send('friday:focus-window'),
  exitFullscreen: () => ipcRenderer.send('friday:exit-fullscreen'),
  restartNativeVoice: () => ipcRenderer.invoke('friday:restart-native-voice'),
  openExternalUrl: (url) => ipcRenderer.invoke('friday:open-external-url', url),
  scanWebsite: (url) => ipcRenderer.invoke('friday:scan-website', url),
  openStudioProject: (id, download = true) => ipcRenderer.invoke('friday:studio-open', id, download),
  openStudioInCode: id => ipcRenderer.invoke('friday:studio-code', id),
  openGestureControl: () => ipcRenderer.invoke('friday:open-gesture-control'),
  getWindowsLocation: () => ipcRenderer.invoke('friday:get-windows-location'),
  onWindowHidden: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('friday:window-hidden', listener);
    return () => ipcRenderer.removeListener('friday:window-hidden', listener);
  },
  onWindowShown: (callback) => {
    const listener = (_event, detail) => callback(detail);
    ipcRenderer.on('friday:window-shown', listener);
    return () => ipcRenderer.removeListener('friday:window-shown', listener);
  },
  onNativeVoiceCommand: (callback) => {
    const listener = (_event, text) => callback(text);
    ipcRenderer.on('friday:native-voice-command', listener);
    return () => ipcRenderer.removeListener('friday:native-voice-command', listener);
  },
  onNativeVoiceStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('friday:native-voice-status', listener);
    return () => ipcRenderer.removeListener('friday:native-voice-status', listener);
  },
});
