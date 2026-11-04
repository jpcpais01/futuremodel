// Oazy Research for Windows. One window, the app from app/, served from app:// so it behaves like a web page.
// The page does everything itself (GitHub, the council, the AI). This file only gives it what a browser cannot:
// reading free data sources that do not send CORS headers, the SEC's contact header, a locked box for the GitHub
// token, staying awake during a meeting, and the window buttons.
'use strict';
const { app, BrowserWindow, protocol, net, session, ipcMain, shell, safeStorage, powerSaveBlocker, dialog } = require('electron');
const path = require('path'), fs = require('fs'), { pathToFileURL } = require('url');

const APP_DIR = path.join(__dirname, '..', 'app');
const SEC_UA = 'OazyResearch/3.0 (personal research) 158115534+jpcpais01@users.noreply.github.com';
// Free sources the council reads. They answer browsers without CORS headers, so the app adds them.
const DATA_HOSTS = /(^|\.)(finance\.yahoo\.com|sec\.gov|news\.google\.com|stlouisfed\.org|cboe\.com|gdeltproject\.org|nasdaq\.com|federalreserve\.gov)$/i;
const SEC_HOSTS = /(^|\.)sec\.gov$/i;

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.oazy.research');

let win = null, awake = null;
const tokenFile = () => path.join(app.getPath('userData'), 'github-token.bin');

function serve() {
  protocol.handle('app', (req) => {
    const u = new URL(req.url), rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(APP_DIR, rel));
    if (!file.startsWith(APP_DIR)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const ses = session.defaultSession;
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'] }, (d, cb) => {
    const host = new URL(d.url).hostname, h = { ...d.requestHeaders };
    if (DATA_HOSTS.test(host)) { delete h.Origin; delete h.origin; delete h.Referer; }
    if (SEC_HOSTS.test(host)) h['User-Agent'] = SEC_UA;
    cb({ requestHeaders: h });
  });
  ses.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, (d, cb) => {
    const host = new URL(d.url).hostname;
    if (!DATA_HOSTS.test(host)) return cb({});
    const h = { ...d.responseHeaders }, has = (k) => Object.keys(h).some((x) => x.toLowerCase() === k);
    if (!has('access-control-allow-origin')) h['Access-Control-Allow-Origin'] = ['*'];
    if (!has('access-control-allow-headers')) h['Access-Control-Allow-Headers'] = ['*'];
    if (d.method === 'OPTIONS') return cb({ responseHeaders: h, statusLine: 'HTTP/1.1 204 No Content' });
    cb({ responseHeaders: h });
  });
  ses.setPermissionRequestHandler((_wc, _perm, ok) => ok(false));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 980, minHeight: 640, frame: false, show: false, backgroundColor: '#07080d',
    title: 'Oazy Research', icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, additionalArguments: ['--oazy-version=' + app.getVersion()] },
  });
  win.setMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadURL('app://oazy/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
  // The page asks before closing while a meeting is running.
  win.webContents.on('will-prevent-unload', (e) => {
    const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Keep the meeting going', 'Close anyway'], defaultId: 0, cancelId: 0, title: 'Oazy Research', message: 'A council meeting is running.', detail: 'If you close now, the meeting stops and nothing is saved.' });
    if (r === 1) e.preventDefault();
  });
  win.on('closed', () => { win = null; });
}

ipcMain.handle('token:get', () => {
  try { const b = fs.readFileSync(tokenFile()); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : null; } catch { return null; }
});
ipcMain.handle('token:set', (_e, t) => {
  try {
    if (!t) { fs.rmSync(tokenFile(), { force: true }); return true; }
    if (!safeStorage.isEncryptionAvailable()) return false;
    fs.mkdirSync(path.dirname(tokenFile()), { recursive: true }); fs.writeFileSync(tokenFile(), safeStorage.encryptString(String(t))); return true;
  } catch { return false; }
});
ipcMain.on('open', (_e, u) => { if (/^https:\/\//.test(String(u))) shell.openExternal(u); });
ipcMain.on('awake', (_e, on) => {
  if (on && awake == null) awake = powerSaveBlocker.start('prevent-app-suspension');
  if (!on && awake != null) { powerSaveBlocker.stop(awake); awake = null; }
});
ipcMain.on('win', (_e, what) => {
  if (!win) return;
  if (what === 'min') win.minimize();
  else if (what === 'max') win.setFullScreen(!win.isFullScreen());
  else if (what === 'close') win.close();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { serve(); createWindow(); });
app.on('window-all-closed', () => app.quit());
