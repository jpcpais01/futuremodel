// The council as a service: everything both apps need, with no window and no platform code.
// The PC app (Electron) and the phone app (Android web view) each wrap this with their own shell.
'use strict';
const store = require('./store');
const C = require('./config');
const llm = require('./llm');
const session = require('./session');
const watch = require('./watch');
const ledger = require('./ledger');
const prices = require('./data/prices');
const sync = require('./sync');

/* Settings the two apps share (synced) and settings that belong to one device. */
const SHARED_DEFAULTS = {
  preset: 'normal',
  schedule: { enabled: true, day: 0, hour: 20, minute: 0 },   // Sunday 20:00, the device's local time
  watch: { enabled: true, hour: 22, minute: 30 },           // weekdays, after the US close
  autoEmergency: false, catchUp: true, secContact: '',
};
const LOCAL_DEFAULTS = { tray: true, syncRepo: '', device: '' };
const SHARED_KEYS = Object.keys(SHARED_DEFAULTS);

function createCore({ platform = 'pc', version = '1.0.0', deviceName = 'device', secrets = null, onEvents = () => {}, onChanged = () => {}, keepAlive = () => {}, notify = () => {} } = {}) {
  let running = null;   // { id, preset, demo, ac }
  let queue = [], flushT = null, live = [];

  /* ── Settings ── */
  function settings() {
    const sh = store.readJSON('shared.json', {}), lo = store.readJSON('settings.json', {});
    return {
      ...SHARED_DEFAULTS, ...pick(sh, SHARED_KEYS), schedule: { ...SHARED_DEFAULTS.schedule, ...sh.schedule }, watch: { ...SHARED_DEFAULTS.watch, ...sh.watch },
      ...LOCAL_DEFAULTS, ...pick(lo, Object.keys(LOCAL_DEFAULTS)), device: lo.device || deviceName,
    };
  }
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  async function setSettings(patch) {
    const cur = settings(), sh = store.readJSON('shared.json', {}), lo = store.readJSON('settings.json', {});
    let sharedChanged = false;
    for (const k of Object.keys(patch)) {
      if (SHARED_KEYS.includes(k)) { sh[k] = k === 'schedule' || k === 'watch' ? { ...cur[k], ...patch[k] } : patch[k]; sharedChanged = true; }
      else if (k in LOCAL_DEFAULTS) lo[k] = patch[k];
    }
    if (sharedChanged) { sh.updatedAt = Date.now(); sh.by = settings().device; store.writeJSON('shared.json', sh); }
    store.writeJSON('settings.json', lo);
    if ('syncRepo' in patch || 'device' in patch) configureSync();
    if (sharedChanged && sync.enabled()) sync.pull().catch(() => {}).then(() => onChanged('sync'));
    return state();
  }

  /* ── Secrets: the API key (phone) and the sync token. Kept by the platform, never synced. ── */
  function configureSync() {
    const s = settings(), token = secrets?.get('syncToken') || '';
    return sync.configure({ repo: s.syncRepo, token, device: s.device, api: (typeof process !== 'undefined' && process.env && process.env.OAZY_SYNC_API) || undefined });   // the override is for tests
  }
  function applyKey() { const k = secrets?.get('anthropicKey'); if (k) llm.setKey(k); }
  function setSecret(name, value) {
    if (!secrets || !['anthropicKey', 'syncToken'].includes(name)) return state();
    secrets.set(name, String(value || '').trim());
    if (name === 'anthropicKey') llm.setKey(String(value || '').trim() || null);
    if (name === 'syncToken') configureSync();
    return state();
  }

  /* ── Reading the record ── */
  const histOf = (t) => store.readJSON(`prices/${t.replace(/[^\w.-]/g, '_')}.json`);
  function sessions(demoMode) {
    return store.list('sessions').filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 80).map((f) => {
      const s = store.readJSON('sessions/' + f);
      if (!s || !!s.demo !== !!demoMode) return null;
      return { id: s.id, preset: s.preset, trigger: s.trigger, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, cost: s.cost, error: s.error, device: s.device,
        holdings: s.final?.holdings?.length || 0, summary: s.final?.summary, confidence: s.final?.confidence, demo: !!s.demo };
    }).filter(Boolean);
  }
  const getSession = (id) => (/^S-[\d-]+$/.test(String(id)) ? store.readJSON(`sessions/${id}.json`) : null);
  function portfolio(demoMode) {
    const file = demoMode ? 'demo-ledger.jsonl' : 'ledger.jsonl';
    const st = ledger.replay(histOf, file), last = session.lastSession(demoMode);
    return {
      ...st, series: st.series.map((p) => [p.d, +p.nav.toFixed(2), p.spy && +p.spy.toFixed(2), p.qqq && +p.qqq.toFixed(2)]),
      final: last?.final || null, lastId: last?.id || null, decidedAt: last?.endedAt || null, decidedOn: last?.device || null, hl: store.readJSON('hl.json', {}),
      watch: store.readLines(demoMode ? 'demo-watch.jsonl' : 'watch.jsonl').slice(-14).reverse(),
    };
  }
  function state() {
    const s = settings();
    const presets = Object.fromEntries(Object.entries(C.PRESETS).map(([k, p]) => [k, { label: p.label, blurb: p.blurb, est: session.estimate(k), members: p.members, rounds: p.rounds, redTeam: p.redTeam, rebuttal: p.rebuttal, scout: !!p.scout,
      models: { analyst: C.MODELS[p.analyst.model].label, member: C.MODELS[p.member.model].label, chair: C.MODELS[p.chair.model].label }, effort: p.member.effort }]));
    const month = 'S-' + new Date().toISOString().slice(0, 7).replace('-', '');
    const spent = store.list('sessions').filter((f) => f.startsWith(month)).reduce((a, f) => a + (store.readJSON('sessions/' + f)?.cost || 0), 0);
    return {
      platform, settings: s, hasKey: llm.hasKey(), hasToken: !!secrets?.get('syncToken'), canPasteKey: platform === 'android', presets, seats: C.SEATS, officers: C.OFFICERS,
      universe: C.UNIVERSE.map((u) => ({ t: u[0], n: u[1], s: u[2], k: u[3] })), limits: C.LIMITS,
      running: running && { id: running.id, preset: running.preset, demo: running.demo },
      next: { session: nextSession(s), watch: nextWatch(s) }, due: due(s), spentThisMonth: spent, dataDir: store.root(), version, sync: sync.status(),
    };
  }

  /* ── Schedule ── */
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
  /* Is the weekly session owed? Any device's real session since the last slot counts, so two devices never both run it. */
  function due(s = settings(), now = Date.now()) {
    const n = nextSession(s, now); if (!n) return null;
    const slot = n - 7 * 864e5;
    if (now - slot > (s.catchUp ? 3 * 864e5 : 10 * 60e3)) return null;
    const last = store.list('sessions').filter((f) => f.endsWith('.json')).sort().reverse().map((f) => store.readJSON('sessions/' + f)).find((x) => x && !x.demo && x.status === 'done');
    return last && Date.parse(last.startedAt) >= slot ? null : { slot };
  }
  function watchDue(s = settings(), now = Date.now()) {
    const w = nextWatch(s, now - 864e5);
    if (!s.watch.enabled || !w || w > now || now - w > 6 * 3600e3 || !session.lastSession(false)) return null;
    const lastW = store.readLines('watch.jsonl').slice(-1)[0];
    return lastW && Date.parse(lastW.at) >= w ? null : { slot: w };
  }

  /* ── Events out of a running session, batched so the screen stays smooth ── */
  function emit(e) {
    queue.push(e);
    if (e.type === 'start') live = [];
    if (e.type === 'speak') { const i = live.findIndex((x) => x.type === 'speak' && x.seat === e.seat); if (i >= 0) live.splice(i, 1); live.push(e); }
    else if (e.type !== 'think') live.push(e);
    if (!flushT) flushT = setTimeout(() => { flushT = null; const q = queue; queue = []; onEvents(q); }, 40);
    // What other devices see.
    if (sync.enabled() && running && !running.demo) {
      if (e.type === 'phase') { running.phase = { key: e.key, label: e.label, i: e.i, n: e.n }; sync.setLive(liveBody()); }
      if (e.type === 'said') { running.lastSaid = { seat: e.seat, text: String(e.data?.statement || e.text || '').slice(0, 400) }; sync.setLive(liveBody()); }
    }
  }
  const liveBody = () => ({ active: true, id: running.id, preset: running.preset, startedAt: running.startedAt, phase: running.phase, last: running.lastSaid, cost: running.cost });

  /* ── Convening ── */
  async function run(preset = 'normal', demo = false, trigger = 'manual') {
    if (running) throw new Error('The council is already in session.');
    if (!C.PRESETS[preset]) preset = 'normal';
    applyKey();
    if (!demo && !llm.hasKey()) throw Object.assign(new Error(platform === 'android' ? 'Paste your Anthropic API key in Settings first.' : 'ANTHROPIC_API_KEY is not set. See Settings.'), { code: 'NO_KEY' });
    // Get the shared record first: the council must know what it holds, wherever it last met.
    if (sync.enabled()) {
      try { await sync.pull(); } catch (e) { emitLog('Sync unavailable, using this device\'s copy: ' + e.message); }
      if (!demo) { const other = await sync.getLive(); if (other) throw new Error(`The council is already in session on ${other.device}.`); }
    }
    const ac = new AbortController();
    running = { id: null, preset, demo: !!demo, ac, startedAt: new Date().toISOString(), cost: 0 };
    llm.setMock(!!demo);
    keepAlive(true, 'The council is in session');
    onChanged('running');
    try {
      const s = await session.run({ preset, trigger, signal: ac.signal, settings: settings(), device: settings().device,
        emit: (e) => { if (e.type === 'start') { running.id = e.session.id; if (sync.enabled() && !demo) sync.setLive(liveBody(), true); } if (e.type === 'cost') running.cost = e.total; emit(e); } });
      if (trigger !== 'manual') notify(`The council decided: ${s.final.holdings.length} holdings`, s.final.summary);
      return { id: s.id };
    } finally {
      running = null; llm.setMock(false); keepAlive(false);
      if (sync.enabled()) { if (!demo) await sync.setLive(null, true); await sync.pull().catch((e) => emitLog('Could not sync the result yet: ' + e.message)); }
      onChanged('idle'); refreshMarks();
    }
  }
  function emitLog(text) { onEvents([{ type: 'log', text }]); }
  function cancel() { running?.ac.abort(); return true; }
  async function runWatch(demo = false) {
    if (running) return { error: 'The council is in session.' };
    applyKey();
    llm.setMock(!!demo);
    try {
      if (!demo && !llm.hasKey()) throw new Error('No API key.');
      if (sync.enabled()) await sync.pull().catch(() => {});
      const r = await watch.run({ emit: (e) => onEvents([e]) });
      if (sync.enabled()) await sync.pull().catch(() => {});
      onChanged('watch');
      return r;
    } catch (e) { return { error: e.message }; } finally { llm.setMock(false); }
  }

  /* ── Upkeep ── */
  let refreshing = false;
  async function refreshMarks() {
    if (refreshing) return; refreshing = true;
    try {
      const want = new Set(['SPY', 'QQQ']);
      for (const f of ['ledger.jsonl', 'demo-ledger.jsonl']) ledger.events(f).filter((e) => e.type === 'decision').forEach((e) => Object.keys(e.target).forEach((t) => want.add(t)));
      for (const t of want) await prices.history(t).catch(() => null);
      onChanged('marks');
    } finally { refreshing = false; }
  }
  async function syncNow() {
    if (!sync.enabled()) return { off: true };
    try { const r = await sync.pull(); if (r.changed) onChanged('sync'); return { ok: true, ...sync.status() }; }
    catch (e) { return { error: e.message, ...sync.status() }; }
  }
  const remoteLive = () => (sync.enabled() ? sync.getLive() : Promise.resolve(null));

  // One-time move of shared settings from the old single settings file.
  if (!store.readJSON('shared.json')) { const old = store.readJSON('settings.json', {}), m = pick(old, SHARED_KEYS); if (Object.keys(m).length) store.writeJSON('shared.json', { ...m, updatedAt: 0 }); }
  configureSync(); applyKey();
  return { settings, setSettings, setSecret, state, sessions, session: getSession, portfolio, run, cancel, watch: runWatch, refreshMarks, syncNow, remoteLive, due, watchDue, live: () => (running ? live : []), isRunning: () => !!running, verify: (demo) => ledger.verify(demo ? 'demo-ledger.jsonl' : 'ledger.jsonl') };
}

module.exports = { createCore, SHARED_DEFAULTS };
