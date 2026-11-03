// The daily watch: a cheap check of every holding against its own rotate-if condition.
// It can recommend an emergency session; it never trades by itself.
'use strict';
const store = require('./store');
const llm = require('./llm');
const P = require('./prompts');
const M = require('./metrics');
const ledger = require('./ledger');
const prices = require('./data/prices');
const newsSrc = require('./data/news');
const { lastSession } = require('./session');
const { UNIVERSE } = require('./config');

async function run({ signal, emit = () => {}, model = 'claude-sonnet-5-5' } = {}) {
  const demoMode = llm.isMock(), last = lastSession(demoMode);
  if (!last) return { skipped: 'No council portfolio yet.' };
  const file = demoMode ? 'demo-ledger.jsonl' : 'ledger.jsonl';
  const held = last.final.holdings.map((h) => h.ticker), hist = {};
  for (const t of ['SPY', 'QQQ', ...held]) hist[t] = await prices.history(t, { signal, force: true }).catch(() => null);
  const state = ledger.replay((t) => hist[t] || store.readJSON(`prices/${t}.json`), file);
  const meta = UNIVERSE.filter((u) => held.includes(u[0]));
  const news = await newsSrc.companyNews(meta, { signal, days: 5, max: 6 }).catch(() => ({}));
  const lines = last.final.holdings.map((h) => {
    const m = M.compute(h.ticker, hist[h.ticker], hist.SPY, null), p = state.positions.find((x) => x.t === h.ticker);
    return `### ${h.ticker} (${h.weight}% target)\nThesis: ${h.thesis}\nRotate if: ${h.rotate_if}\nPrice: ${m.ok ? `$${m.px.toFixed(2)} on ${m.asOf}; 1 week ${M.pc(m.r1w)}, 1 month ${M.pc(m.r1m)}, vs 50-day ${M.pc(m.vs50)}, vs 200-day ${M.pc(m.vs200)}` : 'unavailable'}${p ? `; P&L since entry ${M.pc(p.pnlPct)}` : ''}\nNews (5 days):\n${(news[h.ticker] || []).map((n) => `- ${new Date(n.t).toISOString().slice(0, 10)} ${n.source}: ${n.title}`).join('\n') || '- none'}`;
  }).join('\n\n');
  const r = await llm.call({
    model, effort: 'low', maxTokens: 16000, schema: P.SCHEMA.watch, signal,
    system: [{ type: 'text', text: 'You are the Oazy Council\'s overnight watch officer. For each holding, decide whether its own rotate-if condition has been met, or whether news has broken its thesis. Most days nothing has, and saying so is the right answer. Call for an emergency session only for a real break that should not wait for the weekly review.' }],
    messages: [{ role: 'user', content: `Today is ${new Date().toUTCString()}. The council's holdings:\n\n${lines}` }],
    mock: () => ({ statement: 'All theses intact; no rotate-if condition is met.', alerts: held.map((t) => ({ ticker: t, triggered: false, severity: 1, reason: 'Within normal range.' })), convene: false }),
  });
  const out = { at: new Date().toISOString(), demo: demoMode, cost: r.cost, nav: state.series.at(-1)?.nav, ...r.data };
  store.appendLine(demoMode ? 'demo-watch.jsonl' : 'watch.jsonl', out);
  emit({ type: 'watch', watch: out });
  return out;
}

module.exports = { run };
