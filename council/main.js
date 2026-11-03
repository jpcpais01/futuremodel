// Oazy Council: the window, the scheduler, and the bridge between the council engine and the chamber.
const { app, BrowserWindow, ipcMain, shell, screen, Tray, Menu, nativeImage, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');

const store = require('./engine/store');
store.setRoot(path.join(app.getPath('userData'), 'data'));   // %APPDATA%\Oazy Council\data, shared with the command line
const C = require('./engine/config');
const llm = require('./engine/llm');
const session = require('./engine/session');
const watch = require('./engine/watch');
const ledger = require('./engine/ledger');
const prices = require('./engine/data/prices');
const phone = require('./engine/phone');

const DEFAULTS = {
  preset: 'normal',
  schedule: { enabled: true, day: 0, hour: 20, minute: 0 },   // Sunday 20:00 local time
  watch: { enabled: true, hour: 22, minute: 30 },           // weekdays, after the US close
  autoEmergency: false, catchUp: true, tray: true, secContact: '',
  phone: { enabled: false, port: 7717, allowRun: true },
};
const settings = () => { const { phoneCode, ...s } = store.readJSON('settings.json', {}); return { ...DEFAULTS, ...s, schedule: { ...DEFAULTS.schedule, ...s.schedule }, watch: { ...DEFAULTS.watch, ...s.watch }, phone: { ...DEFAULTS.phone, ...s.phone } }; };

let win = null, tray = null, quitting = false;
let running = null;   // { id, preset, demo, ac, blocker }

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
    if (!quitting && settings().tray) { e.preventDefault(); win.hide(); }
  });
  win.on('maximize', () => send('win:state', true)); win.on('unmaximize', () => send('win:state', false));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
}
function send(ch, payload) {
  if (ch === 'state:changed') phone.notify(payload);
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
}
function show() { if (!win) createWindow(); win.show(); if (win.isMinimized()) win.restore(); win.focus(); }

function makeTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'app', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Oazy Council');
  tray.on('click', show);
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Oazy Council', click: show }, { type: 'separator' }, { label: 'Quit', click: () => { quitting = true; app.quit(); } }]));
}

/* ── Events from a running session, batched so the chamber stays smooth ── */
let queue = [], flushT = null, live = [];
function emit(e) {
  queue.push(e);
  // What a phone that connects mid-session needs to catch up: everything but the streaming text, plus each seat's latest words.
  if (e.type === 'start') live = [];
  if (e.type === 'speak') { const i = live.findIndex((x) => x.type === 'speak' && x.seat === e.seat); if (i >= 0) live.splice(i, 1); live.push(e); }
  else if (e.type !== 'think') live.push(e);
  if (!flushT) flushT = setTimeout(() => { flushT = null; const q = queue; queue = []; send('council:events', q); phone.broadcast(q); }, 40);
}

/* ── State for the renderer ──────────────────────────────────────────────── */
const histOf = (t) => store.readJSON(`prices/${t.replace(/[^\w.-]/g, '_')}.json`);
function summaries(demoMode) {
  return store.list('sessions').filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 80).map((f) => {
    const s = store.readJSON('sessions/' + f);
    if (!s || !!s.demo !== !!demoMode) return null;
    return { id: s.id, preset: s.preset, trigger: s.trigger, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, cost: s.cost, error: s.error,
      holdings: s.final?.holdings?.length || 0, summary: s.final?.summary, confidence: s.final?.confidence, demo: !!s.demo };
  }).filter(Boolean);
}
function portfolio(demoMode) {
  const file = demoMode ? 'demo-ledger.jsonl' : 'ledger.jsonl';
  const st = ledger.replay(histOf, file), last = session.lastSession(demoMode);
  const hl = store.readJSON('hl.json', {});
  return {
    ...st, series: st.series.map((p) => [p.d, +p.nav.toFixed(2), p.spy && +p.spy.toFixed(2), p.qqq && +p.qqq.toFixed(2)]),
    final: last?.final || null, lastId: last?.id || null, decidedAt: last?.endedAt || null, hl,
    watch: store.readLines(demoMode ? 'demo-watch.jsonl' : 'watch.jsonl').slice(-14).reverse(),
  };
}
function getState() {
  const s = settings();
  const presets = Object.fromEntries(Object.entries(C.PRESETS).map(([k, p]) => [k, { label: p.label, blurb: p.blurb, est: session.estimate(k), members: p.members, rounds: p.rounds, redTeam: p.redTeam, rebuttal: p.rebuttal, scout: !!p.scout,
    models: { analyst: C.MODELS[p.analyst.model].label, member: C.MODELS[p.member.model].label, chair: C.MODELS[p.chair.model].label }, effort: p.member.effort }]));
  const month = new Date().toISOString().slice(0, 7);
  const spent = store.list('sessions').filter((f) => f.startsWith('S-' + month.replace('-', ''))).reduce((a, f) => a + (store.readJSON('sessions/' + f)?.cost || 0), 0);
  return {
    settings: s, hasKey: llm.hasKey(), presets, seats: C.SEATS, officers: C.OFFICERS,
    universe: C.UNIVERSE.map((u) => ({ t: u[0], n: u[1], s: u[2], k: u[3] })), limits: C.LIMITS,
    running: running && { id: running.id, preset: running.preset, demo: running.demo },
    next: { session: nextSession(s), watch: nextWatch(s) }, spentThisMonth: spent, dataDir: store.root(), version: app.getVersion(),
  };
}

/* Refresh the prices the record needs, then tell the window. */
let refreshing = false;
async function refreshMarks() {
  if (refreshing) return; refreshing = true;
  try {
    const want = new Set(['SPY', 'QQQ']);
    for (const f of ['ledger.jsonl', 'demo-ledger.jsonl']) ledger.events(f).filter((e) => e.type === 'decision').forEach((e) => Object.keys(e.target).forEach((t) => want.add(t)));
    for (const t of want) await prices.history(t).catch(() => null);
    send('state:changed', 'marks');
  } finally { refreshing = false; }
}

/* ── Running sessions ────────────────────────────────────────────────────── */
async function convene({ preset, demo = false, trigger = 'manual' }) {
  if (running) throw new Error('The council is already in session.');
  llm.setMock(!!demo);
  if (!demo && !llm.hasKey()) throw new Error('ANTHROPIC_API_KEY is not set. See Settings.');
  const ac = new AbortController();
  running = { id: null, preset, demo: !!demo, ac, blocker: powerSaveBlocker.start('prevent-app-suspension') };
  send('state:changed', 'running');
  try {
    const s = await session.run({ preset, trigger, signal: ac.signal, settings: settings(), emit: (e) => { if (e.type === 'start') running.id = e.session.id; emit(e); } });
    if (trigger !== 'manual' && !win?.isVisible()) notify(`The council decided: ${s.final.holdings.length} holdings`, s.final.summary);
    if (!demo) store.writeJSON('schedule.json', { ...store.readJSON('schedule.json', {}), lastSession: Date.now() });
    return { id: s.id };
  } finally {
    powerSaveBlocker.stop(running.blocker); running = null; llm.setMock(false);
    send('state:changed', 'idle'); refreshMarks();
  }
}
function notify(title, body) { try { const { Notification } = require('electron'); new Notification({ title, body: String(body || '').slice(0, 200), icon: path.join(__dirname, 'app', 'icon.png') }).show(); } catch {} }

/* ── Schedule: one weekly session and a daily watch, in local time ──────── */
function nextSession(s, from = Date.now()) {
  if (!s.schedule.enabled) return null;
  const d = new Date(from); d.setHours(s.schedule.hour, s.schedule.minute, 0, 0);
  d.setDate(d.getDate() + ((s.schedule.day - d.getDay() + 7) % 7));
  if (d.getTime() <= from) d.setDate(d.getDate() + 7);
  return d.getTime();
}
function nextWatch(s, from = Date.now()) {
  if (!s.watch.enabled) return null;
  const d = new Date(from); d.setHours(s.watch.hour, s.watch.minute, 0, 0);
  while (d.getTime() <= from || d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.getTime();
}
function previousSlot(s, now = Date.now()) { const n = nextSession(s, now); return n ? n - 7 * 864e5 : null; }

async function tick() {
  const s = settings(), sch = store.readJSON('schedule.json', {}), now = Date.now();
  if (running) return;
  const slot = previousSlot(s, now);
  // The weekly session: at its slot, or catching up within three days if the computer was off.
  if (slot && (sch.lastSession || 0) < slot && now - slot < (s.catchUp ? 3 * 864e5 : 10 * 60e3) && llm.hasKey()) {
    store.writeJSON('schedule.json', { ...sch, lastSession: now });
    convene({ preset: s.preset, trigger: 'scheduled' }).catch((e) => notify('Scheduled session failed', e.message));
    return;
  }
  const w = nextWatch(s, now - 864e5);
  if (s.watch.enabled && w && w <= now && (sch.lastWatch || 0) < w && now - w < 6 * 3600e3 && llm.hasKey() && session.lastSession(false)) {
    store.writeJSON('schedule.json', { ...sch, lastWatch: now });
    try {
      const r = await watch.run({ emit: (e) => send('council:events', [e]) });
      send('state:changed', 'watch');
      if (r.convene) {
        notify('The watch flagged a broken thesis', r.statement);
        if (s.autoEmergency) convene({ preset: s.preset, trigger: 'emergency' }).catch(() => {});
      }
    } catch (e) { notify('Daily watch failed', e.message); }
  }
}

/* ── Phone link ──────────────────────────────────────────────────────────── */
let phoneAddrs = [], phoneError = null;
function phoneCode() {
  const cur = store.readJSON('settings.json', {});
  if (!cur.phoneCode) { cur.phoneCode = phone.newCode(); store.writeJSON('settings.json', cur); }
  return cur.phoneCode;
}
function phoneSync() {
  const p = settings().phone; phoneError = null;
  if (!p.enabled) { phone.stop(); phoneAddrs = []; return; }
  phoneAddrs = phone.start({
    port: p.port, code: phoneCode, allowRun: () => settings().phone.allowRun,
    onError: (e) => { phoneError = e.code === 'EADDRINUSE' ? `Port ${p.port} is already in use.` : e.message; send('state:changed', 'phone'); },
    api: {
      state: () => { const st = getState(); delete st.dataDir; return st; },
      portfolio, sessions: summaries, session: (id) => store.readJSON(`sessions/${id}.json`),
      live: () => (running ? live : []),
      run: (preset, demo) => convene({ preset, demo, trigger: 'phone' }),
      cancel: () => { running?.ac.abort(); return true; },
      watch: async (demo) => { if (running) return { error: 'The council is in session.' }; llm.setMock(!!demo); try { const r = await watch.run({}); send('state:changed', 'watch'); return r; } catch (e) { return { error: e.message }; } finally { llm.setMock(false); } },
    },
  });
}
const phoneInfo = () => ({ ...settings().phone, code: phoneCode(), addresses: phoneAddrs, error: phoneError, on: phone.running() });

/* ── IPC ─────────────────────────────────────────────────────────────────── */
function wire() {
  ipcMain.handle('state:get', () => getState());
  ipcMain.handle('portfolio:get', (_e, demo) => portfolio(!!demo));
  ipcMain.handle('sessions:list', (_e, demo) => summaries(!!demo));
  ipcMain.handle('session:get', (_e, id) => (/^S-[\d-]+$/.test(id) ? store.readJSON(`sessions/${id}.json`) : null));
  ipcMain.handle('session:run', async (_e, o) => { try { return await convene({ preset: C.PRESETS[o.preset] ? o.preset : 'normal', demo: !!o.demo }); } catch (e) { return { error: e.message, code: e.code }; } });
  ipcMain.handle('session:cancel', () => { running?.ac.abort(); return true; });
  ipcMain.handle('watch:run', async (_e, demo) => {
    if (running) return { error: 'The council is in session.' };
    llm.setMock(!!demo);
    try { if (!demo && !llm.hasKey()) throw new Error('ANTHROPIC_API_KEY is not set.'); const r = await watch.run({}); send('state:changed', 'watch'); return r; }
    catch (e) { return { error: e.message }; } finally { llm.setMock(false); }
  });
  ipcMain.handle('settings:set', (_e, patch) => {
    const cur = store.readJSON('settings.json', {}), next = { ...cur, ...patch };
    if (patch.schedule) next.schedule = { ...settings().schedule, ...patch.schedule };
    if (patch.watch) next.watch = { ...settings().watch, ...patch.watch };
    if (patch.phone) next.phone = { ...settings().phone, ...patch.phone };
    delete next.phoneCode; if (cur.phoneCode) next.phoneCode = cur.phoneCode;
    store.writeJSON('settings.json', next);
    if (next.tray) makeTray();
    if (patch.phone) phoneSync();
    return getState();
  });
  ipcMain.handle('phone:info', () => phoneInfo());
  ipcMain.handle('phone:newCode', () => { const cur = store.readJSON('settings.json', {}); cur.phoneCode = phone.newCode(); store.writeJSON('settings.json', cur); return phoneInfo(); });
  ipcMain.handle('ledger:verify', (_e, demo) => ledger.verify(demo ? 'demo-ledger.jsonl' : 'ledger.jsonl'));
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
    wire(); createWindow();
    if (settings().tray) makeTray();
    phoneSync();
    setInterval(() => tick().catch(() => {}), 60e3); setTimeout(() => tick().catch(() => {}), 15e3);
    refreshMarks(); setInterval(refreshMarks, 30 * 60e3);
  });
  app.on('before-quit', () => { quitting = true; running?.ac.abort(); phone.stop(); });
  app.on('window-all-closed', () => { if (!settings().tray) app.quit(); });
}
