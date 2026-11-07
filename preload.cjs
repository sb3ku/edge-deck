const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('edge', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  savePrinter: config => ipcRenderer.invoke('printer:save', config),
  media: (action, value) => ipcRenderer.invoke('media:command', action, value),
  chooseApp: () => ipcRenderer.invoke('app:choose'),
  openApp: target => ipcRenderer.invoke('app:open', target),
  appIcon: (target, id) => ipcRenderer.invoke('app:icon', target, id),
  fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  moveToDisplay: id => ipcRenderer.invoke('window:display', id),
  getDisplays: () => ipcRenderer.invoke('displays:get'),
  searchWeather: query => ipcRenderer.invoke('weather:search', query),
  saveWeather: input => ipcRenderer.invoke('weather:save', input),
  refreshWeather: () => ipcRenderer.invoke('weather:refresh'),
  savePlaylist: input => ipcRenderer.invoke('music:save-playlist', input),
  removePlaylist: id => ipcRenderer.invoke('music:remove-playlist', id),
  openPlaylist: uri => ipcRenderer.invoke('music:open-playlist', uri),
  setStartup: enabled => ipcRenderer.invoke('system:startup', enabled),
  createDesktopShortcut: () => ipcRenderer.invoke('system:desktop-shortcut'),
  onState: callback => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  }
});
