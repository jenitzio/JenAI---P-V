'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = ch => cb => { const h = (_e, d) => cb(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('jen', {
  models: () => ipcRenderer.invoke('models:list'),
  download: id => ipcRenderer.invoke('models:download', id),
  cancelDownload: id => ipcRenderer.invoke('models:cancel', id),
  deleteModel: id => ipcRenderer.invoke('models:delete', id),
  generate: opts => ipcRenderer.invoke('gen:run', opts),
  cancel: () => ipcRenderer.invoke('gen:cancel'),
  readFile: p => ipcRenderer.invoke('file:read', p),
  reveal: p => ipcRenderer.invoke('file:reveal', p),
  saveBuffer: (name, data) => ipcRenderer.invoke('file:saveBuffer', { name, data }),
  pickImage: () => ipcRenderer.invoke('file:pickImage'),
  pickDir: () => ipcRenderer.invoke('file:pickDir'),
  gallery: () => ipcRenderer.invoke('gallery:list'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: s => ipcRenderer.invoke('settings:set', s),
  onDownload: on('download-progress'),
  onProgress: on('gen-progress'),
  onLog: on('gen-log')
});
