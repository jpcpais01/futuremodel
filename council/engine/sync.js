// Account sync: the PC app and the phone app share one record through a private GitHub repository.
// What is shared: the ledgers, the watch logs, every session transcript, the shared settings and the live status.
// What is never shared: API keys, the sync token, and caches (each device fetches its own market data).
'use strict';
const store = require('./store');
const ledger = require('./ledger');

const LEDGERS = ['ledger.jsonl', 'demo-ledger.jsonl'];
const LOGS = ['watch.jsonl', 'demo-watch.jsonl'];
const STATE = 'sync-state.json';
let cfg = null, busy = null, liveTag = null, liveCache = null;

function configure(c) {
  const repo = String(c?.repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  cfg = repo && /^[\w.-]+\/[\w.-]+$/.test(repo) && c.token ? { repo, token: String(c.token).trim(), device: c.device || 'device', api: c.api || 'https://api.github.com' } : null;
  return !!cfg;
}
const enabled = () => !!cfg;
const device = () => cfg?.device;

/* UTF-8 safe base64, without Buffer, so the same code runs in Node and in the phone's web view. */
function b64(str) { const u = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

async function gh(path, { method = 'GET', body, raw = false, etag, timeout = 30000 } = {}) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(`${cfg.api}/repos/${cfg.repo}/${path}`, {
      method, signal: ac.signal,
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'OazyCouncil/1.0',
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...(etag ? { 'If-None-Match': etag } : {}) },
      body: body && JSON.stringify(body),
    });
    if (r.status === 304) return { status: 304 };
    const text = await r.text();
    if (!r.ok) {
      let msg = text; try { msg = JSON.parse(text).message; } catch {}
      const hint = r.status === 401 ? ' The sync token is wrong or expired.' : r.status === 404 && !path.startsWith('contents') ? '' : r.status === 403 ? ' The token needs Contents: read and write on this repository.' : '';
      throw Object.assign(new Error(`GitHub ${r.status}: ${msg}.${hint}`), { status: r.status });
    }
    return { status: r.status, data: raw ? text : text ? JSON.parse(text) : null, etag: r.headers.get('etag') };
  } finally { clearTimeout(t); }
}
async function listDir(dir) {
  try { const r = await gh('contents/' + enc(dir)); return Array.isArray(r.data) ? r.data : []; }
  catch (e) { if (e.status === 404) return []; throw e; }      // a brand-new, empty repository
}
const getRaw = async (path) => (await gh('contents/' + enc(path), { raw: true })).data;
async function put(path, text, st, message) {
  const body = { message: message || `${cfg.device}: ${path}`, content: b64(text), ...(st.sha[path] ? { sha: st.sha[path] } : {}) };
  try {
    const r = await gh('contents/' + enc(path), { method: 'PUT', body });
    st.sha[path] = r.data.content.sha;
  } catch (e) {
    if (e.status !== 409 && e.status !== 422) throw e;
    // Our idea of the file was out of date: learn its current version and try once more.
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const f = (await listDir(dir)).find((x) => x.path === path);
    if (f) body.sha = f.sha; else delete body.sha;
    const r = await gh('contents/' + enc(path), { method: 'PUT', body });
    st.sha[path] = r.data.content.sha;
  }
}
const parseLines = (t) => String(t || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const keyOf = (e) => e.hash || JSON.stringify(e);

/* Ledgers are hash chains: keep the shared chain and re-link anything only this device has on top of it. */
function mergeLedger(R, L) {
  const have = new Set(R.map(keyOf)), extra = L.filter((e) => !have.has(keyOf(e)));
  if (!extra.length) return { out: R, push: false };
  if (L.length > R.length && R.every((e, i) => keyOf(e) === keyOf(L[i]))) return { out: L, push: true };
  return { out: ledger.chainOnto(R, extra), push: true };
}
/* Logs are plain lists: the union, in time order. */
function mergeLog(R, L) {
  const m = new Map(); for (const e of [...R, ...L]) m.set(keyOf(e), e);
  const out = [...m.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { out, push: out.length !== R.length };
}

async function syncList(name, rsha, st, merge) {
  const L = store.readLines(name); st.n = st.n || {};
  if (!rsha && !L.length) return false;
  if (rsha && rsha === st.sha[name] && L.length === st.n[name]) return false;   // nothing new on either side
  const R = rsha ? parseLines(await getRaw(name)) : [];
  if (rsha) st.sha[name] = rsha;
  const { out, push } = merge(R, L);
  const changedLocal = out.length !== L.length || out.some((e, i) => keyOf(e) !== keyOf(L[i]));
  if (changedLocal) store.writeLines(name, out);
  if (push) await put(name, out.map((o) => JSON.stringify(o) + '\n').join(''), st);
  st.n[name] = out.length;
  return changedLocal;
}

async function syncShared(rsha, st) {
  const L = store.readJSON('shared.json'), localNew = L && (L.updatedAt || 0) > (st.sharedAt || 0);
  if (!rsha) { if (L) { await put('shared.json', JSON.stringify(L, null, 1), st); st.sharedAt = L.updatedAt || 0; } return false; }
  if (rsha === st.sha['shared.json'] && !localNew) return false;
  const R = JSON.parse(await getRaw('shared.json')); st.sha['shared.json'] = rsha;
  if (!L || (R.updatedAt || 0) >= (L.updatedAt || 0)) { store.writeJSON('shared.json', R); st.sharedAt = R.updatedAt || 0; return JSON.stringify(R) !== JSON.stringify(L); }
  await put('shared.json', JSON.stringify(L, null, 1), st); st.sharedAt = L.updatedAt || 0; return false;
}

/* Brings both sides up to date. Safe to call often; it only downloads what changed. */
async function pull() {
  if (!cfg) return { off: true };
  if (busy) return busy;
  busy = (async () => {
    const st = store.readJSON(STATE, {}); st.sha = st.sha || {};
    if (st.repo !== cfg.repo) { st.sha = {}; st.repo = cfg.repo; }   // a different account: start clean
    try {
      const root = await listDir('');
      const rsha = Object.fromEntries(root.filter((f) => f.type === 'file').map((f) => [f.name, f.sha]));
      let changed = false;
      for (const n of LEDGERS) changed = (await syncList(n, rsha[n], st, mergeLedger)) || changed;
      for (const n of LOGS) changed = (await syncList(n, rsha[n], st, mergeLog)) || changed;
      changed = (await syncShared(rsha['shared.json'], st)) || changed;
      const remote = root.some((f) => f.name === 'sessions' && f.type === 'dir') ? await listDir('sessions') : [];
      const rs = new Map(remote.map((f) => [f.name, f.sha]));
      for (const [name, sha] of rs) {
        const rel = 'sessions/' + name;
        if (st.sha[rel] === sha && store.readText(rel) != null) continue;
        if (store.readText(rel) == null || st.sha[rel] !== sha) { store.writeJSON(rel, JSON.parse(await getRaw(rel))); changed = true; }
        st.sha[rel] = sha;
      }
      for (const name of store.list('sessions').filter((f) => /^S-[\d-]+\.json$/.test(f))) {
        if (rs.has(name)) continue;
        const s = store.readJSON('sessions/' + name);
        if (s?.status && s.status !== 'running') await put('sessions/' + name, JSON.stringify(s), st, `${cfg.device}: session ${s.id} (${s.status})`);
      }
      st.last = Date.now(); st.error = null;
      return { changed };
    } catch (e) { st.error = e.message; throw e; }
    finally { store.writeJSON(STATE, st); busy = null; }
  })();
  return busy;
}

/* The live status other devices see while a session runs here. Writes are spaced out to stay well inside GitHub's limits. */
let liveT = null, livePending = null, liveLast = 0;
function setLive(obj, now = false) {
  if (!cfg) return;
  livePending = obj ? { ...obj, device: cfg.device, heartbeat: Date.now() } : { active: false, device: cfg.device, heartbeat: Date.now() };
  const go = async () => {
    liveT = null; const body = livePending; livePending = null; if (!body) return;
    liveLast = Date.now();
    const st = store.readJSON(STATE, {}); st.sha = st.sha || {};
    try { await put('live.json', JSON.stringify(body), st, `${cfg.device}: live`); const cur = store.readJSON(STATE, {}); cur.sha = { ...(cur.sha || {}), 'live.json': st.sha['live.json'] }; store.writeJSON(STATE, cur); } catch {}
  };
  if (now) { clearTimeout(liveT); return go(); }
  if (!liveT) liveT = setTimeout(go, Math.max(0, 12000 - (Date.now() - liveLast)));
}
/* What another device is doing right now, or null. A session that stopped reporting for 20 minutes is treated as gone. */
async function getLive() {
  if (!cfg) return null;
  try {
    const r = await gh('contents/live.json', { raw: true, etag: liveTag });
    if (r.status !== 304) { liveTag = r.etag; liveCache = JSON.parse(r.data); }
  } catch (e) { if (e.status === 404) liveCache = null; else return liveCache && liveCache.active && liveCache.device !== cfg.device ? liveCache : null; }
  const l = liveCache;
  return l && l.active && l.device !== cfg.device && Date.now() - (l.heartbeat || 0) < 20 * 60e3 ? l : null;
}
function status() { const st = store.readJSON(STATE, {}); return { on: !!cfg, repo: cfg?.repo || null, device: cfg?.device || null, last: st.last || null, error: st.error || null }; }

module.exports = { configure, enabled, device, pull, setLive, getLive, status, mergeLedger, mergeLog };
