const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oazyWin', {
  min: () => ipcRenderer.send('win:min'),
  max: () => ipcRenderer.send('win:max'),
  close: () => ipcRenderer.send('win:close'),
});
/* The two indexes, read from the repository. go() switches between them. */
contextBridge.exposeInMainWorld('oazy', {
  go: (p) => ipcRenderer.send('portfolio:go', p),
  get: (rel, fresh) => ipcRenderer.invoke('index:get', rel, fresh),
  info: () => ipcRenderer.invoke('app:info'),
  openUrl: (u) => ipcRenderer.invoke('open:url', u),
  onFocus: (fn) => ipcRenderer.on('index:focus', () => fn()),
});
