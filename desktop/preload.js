// What the page may ask of Windows. Nothing else from Node reaches it.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const version = (process.argv.find((a) => a.startsWith('--oazy-version=')) || '').split('=')[1] || '';
let ask = null;
window.addEventListener('beforeunload', (e) => { const msg = ask && ask(); if (msg) { e.preventDefault(); e.returnValue = msg; } });
contextBridge.exposeInMainWorld('oazyHost', {
  version,
  getToken: () => ipcRenderer.invoke('token:get'),
  setToken: (t) => ipcRenderer.invoke('token:set', t || ''),
  openUrl: (u) => ipcRenderer.send('open', String(u)),
  keepAwake: (on) => ipcRenderer.send('awake', !!on),
  win: { min: () => ipcRenderer.send('win', 'min'), max: () => ipcRenderer.send('win', 'max'), close: () => ipcRenderer.send('win', 'close') },
  onBeforeClose: (fn) => { ask = fn; },
});
