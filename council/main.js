// Oazy Council for the PC: the window, the tray and the weekly schedule around the shared council core.
const { app, BrowserWindow, ipcMain, shell, screen, Tray, Menu, nativeImage, powerSaveBlocker, safeStorage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const store = require('./engine/store');
store.setRoot(path.join(app.getPath('userData'), 'data'));   // %APPDATA%\Oazy Council\data, shared with the command line
const { createCore } = require('./engine/core');

/* Secrets (the sync token) are encrypted with Windows' own per-user protection and never leave this computer. OAZY_TEST_SECRETS is only for the Linux test harness. */
const secretsFile = () => path.join(app.getPath('userData'), 'secrets.bin');
const secrets = {
  all() { if (process.env.OAZY_TEST_SECRETS && process.platform === 'linux') safeStorage.setUsePlainTextEncryption?.(true); try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(secretsFile()))); } catch { return {}; } },
  get(name) { return this.all()[name] || ''; },
  set(name, value) {
    if (process.env.OAZY_TEST_SECRETS && process.platform === 'linux') safeStorage.setUsePlainTextEncryption?.(true);
    if (!safeStorage.isEncryptionAvailable() && !process.env.OAZY_TEST_SECRETS) throw new Error('This computer\'s secure storage is not available, so the token was not saved.');
    const all = this.all(); if (value) all[name] = value; else delete all[name];
    fs.writeFileSync(secretsFile(), safeStorage.encryptString(JSON.stringify(all)));
  },
};

let win = null, tray = null, quitting = false, blocker = null, core = null;

/* ── Window ──────────────────────────────────────────────────────────────── */
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');
function loadBounds() {
  try { const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8')), a = screen.getDisplayMatching(b).workArea; return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y ? b : null; } catch { return null; }
}
function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    width: b?.width ?? 1480, height: b?.height ?? 920, x: b?.x, y: b?.y, minWidth: 1180, minHeight: 720,
    frame: false, show: false, backgroundColor: '#06070c', title: 'Oazy Council', icon: path.join(__dirname, 'app', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.on('close', (e) => {
    try { if (!win.isMinimized()) fs.writeFileSync(boundsFile(), JSON.stringify(win.getNormalBounds())); } catch {}
    if (!quitting && core.settings().tray) { e.preventDefault(); win.hide(); }
  });
  win.on('focus', () => core.syncNow());
  win.on('maximize', () => send('win:state', true)); win.on('unmaximize', () => send('win:state', false));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
}
function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }
function show() { if (!win) createWindow(); win.show(); if (win.isMinimized()) win.restore(); win.focus(); }
function makeTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'app', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Oazy Council');
  tray.on('click', show);
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Oazy Council', click: show }, { type: 'separator' }, { label: 'Quit', click: () => { quitting = true; app.quit(); } }]));
}
function notify(title, body) { if (win?.isVisible() && win.isFocused()) return; try { new Notification({ title, body: String(body || '').slice(0, 200), icon: path.join(__dirname, 'app', 'icon.png') }).show(); } catch {} }

/* ── Schedule: the weekly session and the daily watch. Whichever device is awake runs them, once. ── */
let ticking = false;
async function tick() {
  if (ticking || core.isRunning()) return; ticking = true;
  try {
    await core.syncNow();
    const s = core.settings();
    if (core.due(s) && core.state().hasKey) {
      if (await core.remoteLive()) return;
      await core.run(s.preset, false, 'scheduled').catch((e) => notify('Scheduled session failed', e.message));
      return;
    }
    if (core.watchDue(s) && core.state().hasKey) {
      const r = await core.watch(false);
      if (r?.convene) {
        notify('The watch flagged a broken thesis', r.statement);
        if (s.autoEmergency) core.run(s.preset, false, 'emergency').catch(() => {});
      }
    }
  } finally { ticking = false; }
}

/* ── IPC ─────────────────────────────────────────────────────────────────── */
function wire() {
  const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { return { error: e.message, code: e.code }; } };
  ipcMain.handle('state:get', () => core.state());
  ipcMain.handle('portfolio:get', (_e, demo) => core.portfolio(!!demo));
  ipcMain.handle('sessions:list', (_e, demo) => core.sessions(!!demo));
  ipcMain.handle('session:get', (_e, id) => core.session(id));
  ipcMain.handle('session:run', safe((_e, o) => core.run(o.preset, !!o.demo)));
  ipcMain.handle('session:cancel', () => core.cancel());
  ipcMain.handle('watch:run', (_e, demo) => core.watch(!!demo));
  ipcMain.handle('settings:set', safe(async (_e, patch) => { const st = await core.setSettings(patch); if (st.settings.tray) makeTray(); return st; }));
  ipcMain.handle('secret:set', safe((_e, name, value) => core.setSecret(name, value)));
  ipcMain.handle('sync:now', () => core.syncNow());
  ipcMain.handle('sync:live', () => core.remoteLive());
  ipcMain.handle('ledger:verify', (_e, demo) => core.verify(!!demo));
  ipcMain.handle('open:data', () => shell.openPath(store.root()));
  ipcMain.handle('open:url', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.on('win:min', () => win?.minimize());
  ipcMain.on('win:max', () => { if (!win) return; win.isMaximized() ? win.unmaximize() : win.maximize(); });
  ipcMain.on('win:close', () => win?.close());
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId('com.oazy.council');
  app.on('second-instance', show);
  app.whenReady().then(() => {
    core = createCore({
      platform: 'pc', version: app.getVersion(), deviceName: `PC (${os.hostname()})`, secrets, notify,
      onEvents: (list) => send('council:events', list),
      onChanged: (why) => send('state:changed', why),
      keepAlive: (on) => { if (on && blocker == null) blocker = powerSaveBlocker.start('prevent-app-suspension'); if (!on && blocker != null) { powerSaveBlocker.stop(blocker); blocker = null; } },
    });
    wire(); createWindow();
    if (core.settings().tray) makeTray();
    setInterval(() => tick().catch(() => {}), 60e3); setTimeout(() => tick().catch(() => {}), 15e3);
    setInterval(() => core.syncNow(), 5 * 60e3);
    core.refreshMarks(); setInterval(() => core.refreshMarks(), 30 * 60e3);
  });
  app.on('before-quit', () => { quitting = true; core?.cancel(); });
  app.on('window-all-closed', () => { if (!core?.settings().tray) app.quit(); });
}
