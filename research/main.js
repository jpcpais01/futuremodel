// Oazy Research: one window that holds several portfolios.
//   Core v1.0  - the live Hyperliquid book (app/index.html), unchanged.
//   Council    - the AI investment council's paper portfolio (app/council.html), run by the shared council engine.
const { app, BrowserWindow, ipcMain, shell, screen, Tray, Menu, nativeImage, powerSaveBlocker, safeStorage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

/* The council keeps its data where the standalone Oazy Council app kept it, so nothing is lost in the move. */
const councilDir = path.join(app.getPath('appData'), 'Oazy Council');
const store = require('./engine/store');
store.setRoot(path.join(councilDir, 'data'));
const { createCore } = require('./engine/core');

let win = null, tray = null, quitting = false, blocker = null, core = null;
const statePath = () => path.join(app.getPath('userData'), 'window.json');
const prefsPath = () => path.join(app.getPath('userData'), 'prefs.json');
const PAGES = { core: 'index.html', council: 'council.html' };
const prefs = () => { try { return JSON.parse(fs.readFileSync(prefsPath(), 'utf8')); } catch { return {}; } };
const setPref = (k, v) => { try { fs.writeFileSync(prefsPath(), JSON.stringify({ ...prefs(), [k]: v })); } catch {} };

/* Secrets (the Anthropic key and the sync token) are encrypted with Windows' own per-user protection and never leave this computer. */
const secretsFile = () => path.join(councilDir, 'secrets.bin');
const testPlain = () => process.env.OAZY_TEST_SECRETS && process.platform === 'linux' && safeStorage.setUsePlainTextEncryption?.(true);
const secrets = {
  all() { testPlain(); try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(secretsFile()))); } catch { return {}; } },
  get(name) { return this.all()[name] || ''; },
  set(name, value) {
    testPlain();
    if (!safeStorage.isEncryptionAvailable() && !process.env.OAZY_TEST_SECRETS) throw new Error('This computer\'s secure storage is not available, so it was not saved.');
    const all = this.all(); if (value) all[name] = value; else delete all[name];
    fs.mkdirSync(councilDir, { recursive: true });
    fs.writeFileSync(secretsFile(), safeStorage.encryptString(JSON.stringify(all)));
  },
};

/* ── Window ──────────────────────────────────────────────────────────────── */
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    const area = screen.getDisplayMatching(b).workArea;
    const visible = b.x < area.x + area.width && b.x + b.width > area.x && b.y < area.y + area.height && b.y + b.height > area.y;
    return visible ? b : null;
  } catch { return null; }
}
function saveBounds() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try { fs.writeFileSync(statePath(), JSON.stringify(win.getNormalBounds())); } catch { /* the window position is not worth failing over */ }
}
function pageFile(p) { return path.join(__dirname, 'app', PAGES[p] || PAGES.core); }
function createWindow() {
  const saved = loadBounds();
  win = new BrowserWindow({
    width: saved?.width ?? 1440, height: saved?.height ?? 900, x: saved?.x, y: saved?.y, minWidth: 1080, minHeight: 660,
    frame: false, show: false, backgroundColor: '#07080d', icon: path.join(__dirname, 'app', 'icon.png'), title: 'Oazy Research',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (!process.argv.includes('--windowed')) win.setFullScreen(true);
  const start = process.argv.find((a) => a.startsWith('--portfolio='))?.split('=')[1] || prefs().portfolio || 'core';
  win.loadFile(pageFile(start));
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.on('close', (e) => {
    saveBounds();
    if (!quitting && core?.settings().tray) { e.preventDefault(); win.hide(); }   // keep the council's schedule running from the tray
  });
  win.on('focus', () => core?.syncNow());
  win.on('enter-full-screen', () => send('win:state', true));
  win.on('leave-full-screen', () => send('win:state', false));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
  });
  // Links open in the real browser. The app only moves between its own pages.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
}
function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }
function showWin(p) { if (!win) createWindow(); if (p) win.loadFile(pageFile(p)); win.show(); if (win.isMinimized()) win.restore(); win.focus(); }
function makeTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'app', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Oazy Research');
  tray.on('click', () => showWin());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Oazy Research', click: () => showWin() },
    { label: 'Open the Council', click: () => showWin('council') },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}
function notify(title, body) { if (win?.isVisible() && win.isFocused()) return; try { new Notification({ title, body: String(body || '').slice(0, 200), icon: path.join(__dirname, 'app', 'icon.png') }).show(); } catch {} }

/* ── The council's schedule: the weekly session and the daily watch. Whichever device is awake runs them, once. ── */
let ticking = false;
async function tick() {
  if (ticking || core.isRunning()) return; ticking = true;
  try {
    await core.syncNow();
    const s = core.settings();
    if (core.due(s) && core.state().hasKey) {
      if (await core.remoteLive()) return;
      await core.run(s.preset, false, 'scheduled').catch((e) => notify('Scheduled council session failed', e.message));
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
  ipcMain.handle('history:get', (_e, t) => core.history(String(t)));
  ipcMain.handle('live:get', () => core.live());
  ipcMain.handle('sessions:list', (_e, demo) => core.sessions(!!demo));
  ipcMain.handle('session:get', (_e, id) => core.session(id));
  ipcMain.handle('session:run', safe((_e, o) => core.run(o.preset, !!o.demo)));
  ipcMain.handle('session:cancel', () => core.cancel());
  ipcMain.handle('watch:run', safe((_e, demo) => core.watch(!!demo)));
  ipcMain.handle('settings:set', safe(async (_e, patch) => { const st = await core.setSettings(patch); if (st.settings.tray) makeTray(); return st; }));
  ipcMain.handle('secret:set', safe((_e, name, value) => core.setSecret(name, value)));
  ipcMain.handle('sync:now', () => core.syncNow());
  ipcMain.handle('sync:live', () => core.remoteLive());
  ipcMain.handle('ledger:verify', (_e, demo) => core.verify(!!demo));
  ipcMain.handle('open:data', () => shell.openPath(store.root()));
  ipcMain.handle('open:url', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.on('portfolio:go', (_e, p) => { if (!PAGES[p]) return; setPref('portfolio', p); win?.loadFile(pageFile(p)); });
  ipcMain.on('win:min', () => win?.minimize());
  ipcMain.on('win:max', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
  ipcMain.on('win:close', () => win?.close());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.oazy.research');
  app.on('second-instance', () => showWin());
  app.on('before-quit', () => { quitting = true; });
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
  app.on('window-all-closed', () => { if (!core?.settings().tray) app.quit(); });
}
