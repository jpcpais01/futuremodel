const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('council', {
  state: () => ipcRenderer.invoke('state:get'),
  portfolio: (demo) => ipcRenderer.invoke('portfolio:get', demo),
  sessions: (demo) => ipcRenderer.invoke('sessions:list', demo),
  session: (id) => ipcRenderer.invoke('session:get', id),
  run: (preset, demo) => ipcRenderer.invoke('session:run', { preset, demo }),
  cancel: () => ipcRenderer.invoke('session:cancel'),
  watch: (demo) => ipcRenderer.invoke('watch:run', demo),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  verify: (demo) => ipcRenderer.invoke('ledger:verify', demo),
  openData: () => ipcRenderer.invoke('open:data'),
  phoneInfo: () => ipcRenderer.invoke('phone:info'),
  phoneNewCode: () => ipcRenderer.invoke('phone:newCode'),
  openUrl: (u) => ipcRenderer.invoke('open:url', u),
  onEvents: (fn) => ipcRenderer.on('council:events', (_e, list) => fn(list)),
  onChanged: (fn) => ipcRenderer.on('state:changed', (_e, why) => fn(why)),
});
contextBridge.exposeInMainWorld('oazyWin', {
  min: () => ipcRenderer.send('win:min'),
  max: () => ipcRenderer.send('win:max'),
  close: () => ipcRenderer.send('win:close'),
  onState: (fn) => ipcRenderer.on('win:state', (_e, m) => fn(m)),
});
