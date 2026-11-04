// What the apps call: read the council from the repository, hold a meeting, save the result as one commit.
// Everything lives in memory while the app runs; GitHub is the only place anything is kept.
'use strict';
const C = require('./config');
const store = require('./store');
const llm = require('./llm');
const ledger = require('./ledger');
const session = require('./session');
const indexer = require('./indexer');
const gh = require('./github');

let prior = null, baseSha = null, loaded = new Set();

/* Loads the index into memory: the state the apps show, the ledger, and the latest meeting (the council reads its last decision). */
async function load() {
  const sha = await gh.latest();
  const [stateText, ledgerText] = await Promise.all([gh.read('council/state.json', { sha }), gh.read('council/ledger.jsonl', { sha })]);
  const keep = store.backend();
  const mem = store.use(store.memory());
  // Prices already fetched in this run stay; they are slow to gather.
  if (keep.files) for (const [k, v] of keep.files) if (k.startsWith('prices/') || k.startsWith('sec/') || k.startsWith('news/') || k.startsWith('macro/')) mem.write(k, v);
  if (ledgerText) mem.write('ledger.jsonl', ledgerText);
  prior = stateText ? JSON.parse(stateText) : null;
  if (prior?.lastId) { const t = await gh.read(`council/sessions/${prior.lastId}.json`, { sha }).catch(() => null); if (t) mem.write(`sessions/${prior.lastId}.json`, t); }
  baseSha = sha; loaded = new Set(ledger.events().map((e) => e.hash));
  return { state: prior, sha };
}

/* A meeting. key: the Anthropic key for this meeting (held in memory only). rehearsal: no AI, no cost, nothing saved. */
async function convene({ preset = 'normal', rounds = C.ROUNDS.default, key, rehearsal = false, emit, signal, device = 'Oazy Research' }) {
  llm.setMock(!!rehearsal);
  if (!rehearsal) llm.setKey(key);
  try { return await session.run({ preset, rounds, trigger: 'manual', emit, signal, device, apply: null }); }
  finally { if (rehearsal) llm.setMock(false); }
}

/* Saves a decided meeting. how: 'now', 'open', 'YYYY-MM-DD', or 'skip' (keep the record, leave the portfolio as it is). */
async function save(s, how, { token, onStep = () => {} } = {}) {
  if (s.demo) throw new Error('A rehearsal is never saved.');
  onStep('Recording the decision');
  // A save that failed after the decision was recorded (no token, no network) must not record it twice when tried again.
  const recorded = s.ledgerHash && ledger.events().some((e) => e.hash === s.ledgerHash);
  if (!recorded) { if (how === 'skip') session.skipDecision(s); else { if (s.status !== 'decided') s.status = 'decided'; await session.applyDecision(s, how); } }
  const mine = ledger.events().filter((e) => !loaded.has(e.hash));   // what this save adds: the decision (and the first entry of a new ledger)
  for (let attempt = 0; attempt < 4; attempt++) {
    onStep(attempt ? 'Catching up with GitHub' : 'Valuing the portfolio');
    const built = await indexer.build({ prior });
    const files = { 'council/state.json': built.json, 'README.md': built.readme, 'chart.svg': built.chart, [`council/sessions/${s.id}.json`]: JSON.stringify(s) };
    if (mine.length) files['council/ledger.jsonl'] = store.readText('ledger.jsonl');
    onStep('Saving to GitHub');
    try {
      baseSha = await gh.commit({ token, files, parent: baseSha, message: `Council meeting ${s.id}: ${how === 'skip' ? 'not applied' : how === 'now' ? 'applied now' : 'enters at the open on ' + (s.applied?.on || how)}` });
      prior = built.state;
      return built.state;
    } catch (e) {
      if (e.code !== 'MOVED') throw e;
      // Someone else wrote meanwhile (the hourly price update, or a meeting on another device): put this decision on top.
      const sha = await gh.latest(token);
      const [remote, st] = await Promise.all([gh.read('council/ledger.jsonl', { sha }), gh.read('council/state.json', { sha })]);
      const others = (remote || '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      if (mine.length) { const chained = ledger.chainOnto(others, mine); store.writeLines('ledger.jsonl', chained); mine.splice(0, mine.length, ...chained.slice(others.length)); loaded = new Set(others.map((e) => e.hash)); }
      if (st) prior = JSON.parse(st);
      baseSha = sha;
    }
  }
  throw new Error('GitHub kept changing while saving. Try again in a minute.');
}

const current = () => prior;
module.exports = { load, convene, save, current, estimate: session.estimate };
