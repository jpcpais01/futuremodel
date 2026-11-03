const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oazyWin', {
  min: () => ipcRenderer.send('win:min'),
  max: () => ipcRenderer.send('win:max'),
  close: () => ipcRenderer.send('win:close'),
  onState: (fn) => ipcRenderer.on('win:state', (_e, maximized) => fn(maximized)),
});
/* Moving between the portfolios Oazy Research holds. */
contextBridge.exposeInMainWorld('oazy', { go: (p) => ipcRenderer.send('portfolio:go', p) });
/* The council engine, run by the main process. */
contextBridge.exposeInMainWorld('council', {
  state: () => ipcRenderer.invoke('state:get'),
  portfolio: (demo) => ipcRenderer.invoke('portfolio:get', demo),
  history: (t) => ipcRenderer.invoke('history:get', t),
  live: () => ipcRenderer.invoke('live:get'),
  sessions: (demo) => ipcRenderer.invoke('sessions:list', demo),
  session: (id) => ipcRenderer.invoke('session:get', id),
  run: (preset, demo) => ipcRenderer.invoke('session:run', { preset, demo }),
  cancel: () => ipcRenderer.invoke('session:cancel'),
  watch: (demo) => ipcRenderer.invoke('watch:run', demo),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setSecret: (name, value) => ipcRenderer.invoke('secret:set', name, value),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  remoteLive: () => ipcRenderer.invoke('sync:live'),
  verify: (demo) => ipcRenderer.invoke('ledger:verify', demo),
  openData: () => ipcRenderer.invoke('open:data'),
  openUrl: (u) => ipcRenderer.invoke('open:url', u),
  onEvents: (fn) => ipcRenderer.on('council:events', (_e, list) => fn(list)),
  onChanged: (fn) => ipcRenderer.on('state:changed', (_e, why) => fn(why)),
});
