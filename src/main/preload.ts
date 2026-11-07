import { contextBridge, ipcRenderer } from 'electron';
import type { API, TerminalEvent } from '../shared/model';
const api: API = {
  info: () => ipcRenderer.invoke('app:info'),
  list: () => ipcRenderer.invoke('tools:list'),
  save: tools => ipcRenderer.invoke('tools:save', tools),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  presence: () => ipcRenderer.invoke('presence:list'),
  createShortcut: () => ipcRenderer.invoke('app:shortcut'),
  run: (id, action) => ipcRenderer.invoke('terminal:run', id, action),
  input: (id, data) => ipcRenderer.send('terminal:input', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  stop: id => ipcRenderer.invoke('terminal:stop', id),
  onTerminal: callback => {
    const listener = (_event: Electron.IpcRendererEvent, event: TerminalEvent) => callback(event);
    ipcRenderer.on('terminal:event', listener);
    return () => ipcRenderer.removeListener('terminal:event', listener);
  }
};
contextBridge.exposeInMainWorld('rattib', api);
