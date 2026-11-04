// Oazy Research: one window, two paper indexes (Core v1.0 and the Council).
// The app only reads. GitHub keeps the indexes up to date in the futuremodel repository (index/), and this window
// shows what is there, with a copy kept on disk so it opens instantly and still works offline.
const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const REPO = 'jpcpais01/futuremodel';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/index/`;
const GITHUB = `https://github.com/${REPO}/tree/main/index`;

let win = null;
const statePath = () => path.join(app.getPath('userData'), 'window.json');
const prefsPath = () => path.join(app.getPath('userData'), 'prefs.json');
const cacheDir = () => path.join(app.getPath('userData'), 'index');
const prefs = () => { try { return JSON.parse(fs.readFileSync(prefsPath(), 'utf8')); } catch { return {}; } };
const setPref = (k, v) => { try { fs.writeFileSync(prefsPath(), JSON.stringify({ ...prefs(), [k]: v })); } catch {} };

/* ── Reading the repository ──────────────────────────────────────────────── */
const SAFE = /^(core|council)\/(state\.json|sessions\/S-[\d-]+\.json)$/;
async function get(rel, fresh) {
  if (!SAFE.test(rel)) return { error: 'Not part of the index.' };
  // For development: read a local index/ folder instead of GitHub.
  if (process.env.OAZY_INDEX_DIR) { try { return { data: JSON.parse(fs.readFileSync(path.join(process.env.OAZY_INDEX_DIR, rel), 'utf8')), at: Date.now() }; } catch (e) { return { error: e.message }; } }
  const file = path.join(cacheDir(), rel);
  const cached = () => { try { return { data: JSON.parse(fs.readFileSync(file, 'utf8')), cached: true, at: fs.statSync(file).mtimeMs }; } catch { return null; } };
  // A session never changes once it is written, so a saved copy is always good.
  if (!fresh && rel.includes('/sessions/')) { const c = cached(); if (c) return c; }
  try {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 20000);
    const r = await fetch(RAW + rel + (fresh ? `?t=${Date.now()}` : ''), { signal: ac.signal, headers: { 'Cache-Control': 'no-cache' } }).finally(() => clearTimeout(t));
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    const text = await r.text(), data = JSON.parse(text);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
    return { data, cached: false, at: Date.now() };
  } catch (e) {
    return cached() || { error: 'Could not reach GitHub: ' + e.message };
  }
}

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
const portfolio = (p) => (p === 'council' ? 'council' : 'core');
function load(p) { win.loadFile(path.join(__dirname, 'app', 'index.html'), { query: { p: portfolio(p) } }); }
function createWindow() {
  const saved = loadBounds();
  win = new BrowserWindow({
    width: saved?.width ?? 1440, height: saved?.height ?? 900, x: saved?.x, y: saved?.y, minWidth: 1080, minHeight: 660,
    frame: false, show: false, backgroundColor: '#07080d', icon: path.join(__dirname, 'app', 'icon.png'), title: 'Oazy Research',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (!process.argv.includes('--windowed')) win.setFullScreen(true);
  load(process.argv.find((a) => a.startsWith('--portfolio='))?.split('=')[1] || prefs().portfolio || 'core');
  win.once('ready-to-show', () => win.show());
  win.on('close', saveBounds);
  win.on('focus', () => send('index:focus'));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
  });
  // Links open in the real browser. The app only moves between its own pages.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
}
function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.oazy.research');
  app.on('second-instance', () => { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); });
  app.whenReady().then(() => {
    ipcMain.handle('index:get', (_e, rel, fresh) => get(String(rel), !!fresh));
    ipcMain.handle('open:url', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
    ipcMain.handle('app:info', () => ({ version: app.getVersion(), repo: REPO, github: GITHUB }));
    ipcMain.on('portfolio:go', (_e, p) => { setPref('portfolio', portfolio(p)); load(p); });
    ipcMain.on('win:min', () => win?.minimize());
    ipcMain.on('win:max', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
    ipcMain.on('win:close', () => win?.close());
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
