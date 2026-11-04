// What the apps call: read the councils from the repository, hold a meeting, save the result as one commit.
// Everything lives in memory while the app runs; GitHub is the only place anything is kept.
// Several councils can exist (councils.js). All run the same meeting; each has its own Awareness, portfolio and record.
'use strict';
const C = require('./config');
const CO = require('./councils');
const store = require('./store');
const llm = require('./llm');
const ledger = require('./ledger');
const session = require('./session');
const indexer = require('./indexer');
const gh = require('./github');

let councils = [CO.FIRST], cur = CO.FIRST, prior = null, baseSha = null, loaded = new Set();
const states = new Map();   // council id → its last state.json, for the list and the overview page on GitHub

const byId = (id) => councils.find((c) => c.id === id);

/* The councils, each with a short summary of its record. Reads index/councils.json and every council's state.json. */
async function list({ sha } = {}) {
  sha = sha || await gh.latest();
  councils = CO.parse(await gh.read('councils.json', { sha }));
  await Promise.all(councils.map(async (c) => { const t = await gh.read(`${c.id}/state.json`, { sha }).catch(() => null); if (t) { try { states.set(c.id, JSON.parse(t)); } catch {} } }));
  return councils.map(summary);
}
function summary(c) {
  const s = states.get(c.id);
  return { ...c, stats: s?.stats || null, holdings: s?.positions?.length || 0, meetings: (s?.sessions || []).length, since: s?.series?.[0]?.[0] || null, lastAt: s?.sessions?.[0]?.startedAt || null };
}

/* Loads one council into memory: the state the apps show, the ledger, and the latest meeting (the council reads its last decision). */
async function load(id) {
  const sha = await gh.latest();
  await list({ sha });
  cur = byId(id) || councils[0];
  const dir = cur.id;
  const [stateText, ledgerText] = await Promise.all([gh.read(`${dir}/state.json`, { sha }), gh.read(`${dir}/ledger.jsonl`, { sha })]);
  const keep = store.backend();
  const mem = store.use(store.memory());
  // Prices already fetched in this run stay; they are slow to gather, and every council reads the same market.
  if (keep.files) for (const [k, v] of keep.files) if (k.startsWith('prices/') || k.startsWith('sec/') || k.startsWith('news/') || k.startsWith('macro/')) mem.write(k, v);
  if (ledgerText) mem.write('ledger.jsonl', ledgerText);
  prior = stateText ? JSON.parse(stateText) : null;
  if (prior?.lastId) { const t = await gh.read(`${dir}/sessions/${prior.lastId}.json`, { sha }).catch(() => null); if (t) mem.write(`sessions/${prior.lastId}.json`, t); }
  baseSha = sha; loaded = new Set(ledger.events().map((e) => e.hash));
  return { state: prior, sha, council: summary(cur), councils: councils.map(summary) };
}

/* Creates a council: one commit adding it to councils.json. Its record starts at its first meeting. */
async function create({ name, awareness, token }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const sha = await gh.latest(token);
    const now = CO.parse(await gh.read('councils.json', { sha }));
    const c = CO.make(now, { name, awareness });
    try {
      await gh.commit({ token, parent: sha, files: { 'councils.json': CO.serialize([...now, c]) }, message: `New council: ${c.name}` });
      councils = [...now, c];
      return summary(c);
    } catch (e) { if (e.code !== 'MOVED') throw e; }
  }
  throw new Error('GitHub kept changing while saving. Try again in a minute.');
}

/* A meeting of the loaded council. key: the Anthropic key for this meeting (held in memory only). rehearsal: no AI, no cost, nothing saved. */
let convenes = 0;
async function convene({ preset = 'normal', rounds = C.ROUNDS.default, key, rehearsal = false, emit, signal, settings = {}, device = 'Oazy Research' }) {
  const gen = ++convenes;   // a stopped meeting that finishes letting go later must not switch the next one's mode
  llm.setMock(!!rehearsal);
  if (!rehearsal) llm.setKey(key);
  try { return await session.run({ preset, rounds, trigger: 'manual', emit, signal, settings, device, apply: null, council: cur }); }
  finally { if (rehearsal && gen === convenes) llm.setMock(false); }
}

/* Saves a decided meeting. how: 'now', 'open', 'YYYY-MM-DD', or 'skip' (keep the record, leave the portfolio as it is). */
async function save(s, how, { token, onStep = () => {} } = {}) {
  if (s.demo) throw new Error('A rehearsal is never saved.');
  const c = byId(s.council?.id) || cur;
  if (c.id !== cur.id) throw new Error(`This meeting belongs to ${c.name}. Switch to it, then save.`);
  const dir = c.id;
  onStep('Recording the decision');
  // A save that failed after the decision was recorded (no token, no network) must not record it twice when tried again.
  const recorded = s.ledgerHash && ledger.events().some((e) => e.hash === s.ledgerHash);
  if (!recorded) { if (how === 'skip') session.skipDecision(s); else { if (s.status !== 'decided') s.status = 'decided'; await session.applyDecision(s, how); } }
  const mine = ledger.events().filter((e) => !loaded.has(e.hash));   // what this save adds: the decision (and the first entry of a new ledger)
  for (let attempt = 0; attempt < 4; attempt++) {
    onStep(attempt ? 'Catching up with GitHub' : 'Valuing the portfolio');
    const built = await indexer.build({ prior, council: c });
    states.set(c.id, built.state);
    const all = councils.map((x) => ({ council: x, state: states.get(x.id) || null }));
    const files = { [`${dir}/state.json`]: built.json, [`${dir}/README.md`]: built.readme, [`${dir}/chart.svg`]: built.chart, [`${dir}/sessions/${s.id}.json`]: JSON.stringify(s),
      'README.md': indexer.rootReadme(all), 'chart.svg': indexer.chartSvg(all.map((x) => x.state)) };
    if (mine.length) files[`${dir}/ledger.jsonl`] = store.readText('ledger.jsonl');
    onStep('Saving to GitHub');
    try {
      baseSha = await gh.commit({ token, files, parent: baseSha, message: `${c.name} meeting ${s.id}: ${how === 'skip' ? 'not applied' : how === 'now' ? 'applied now' : 'enters at the open on ' + (s.applied?.on || how)}` });
      prior = built.state;
      return built.state;
    } catch (e) {
      if (e.code !== 'MOVED') throw e;
      // Someone else wrote meanwhile (the hourly price update, or a meeting on another device): put this decision on top.
      const sha = await gh.latest(token);
      const [remote, st] = await Promise.all([gh.read(`${dir}/ledger.jsonl`, { sha }), gh.read(`${dir}/state.json`, { sha })]);
      councils = CO.parse(await gh.read('councils.json', { sha }));
      const others = (remote || '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      if (mine.length) { const chained = ledger.chainOnto(others, mine); store.writeLines('ledger.jsonl', chained); mine.splice(0, mine.length, ...chained.slice(others.length)); loaded = new Set(others.map((e) => e.hash)); }
      if (st) prior = JSON.parse(st);
      baseSha = sha;
    }
  }
  throw new Error('GitHub kept changing while saving. Try again in a minute.');
}

/* The record in the repository is re-priced by GitHub every hour. When that has not happened (the schedule is off, or late),
   the app values the portfolio itself, from the same ledger and fresh prices, so an entry that is due shows as entered.
   This only changes what is shown; nothing is written. */
function stale(st, now = Date.now()) {
  if (!st) return false;
  const age = now - Date.parse(st.updatedAt || 0), today = ledger.etParts(now).date, open = Date.parse(ledger.openIso(today));
  const due = (st.pending || []).some((p) => p.mode === 'now' || (p.on && (p.on < today || (p.on === today && now > open))));
  return due || age > 75 * 6e4;
}
const refreshedAt = new Map();
async function refresh() {
  if (!prior || !stale(prior) || Date.now() - (refreshedAt.get(cur.id) || 0) < 15 * 6e4) return null;
  refreshedAt.set(cur.id, Date.now());
  const built = await indexer.build({ prior, council: cur });
  prior = built.state;
  return built.state;
}

const current = () => prior;
const currentCouncil = () => summary(cur);
module.exports = { load, list, create, convene, save, refresh, stale, current, currentCouncil, estimate: session.estimate, LIMITS: CO.LIMITS };
