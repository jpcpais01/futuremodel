// The council's paper index, kept in the repository under index/.
//
//   index/council/ledger.jsonl   every decision, hash-chained
//   index/council/state.json     what the apps read: value, record, holdings, price history
//   index/council/sessions/      every council meeting, with the whole debate
//   index/README.md, chart.svg   the same numbers, readable on GitHub
//
// The engine's store is rooted at index/council. build() only computes; the command line and the apps write the files.
// A decision enters when João applies it: at the price of the moment, or at an open he picks (see ledger.js).
'use strict';
const C = require('./config');
const store = require('./store');
const ledger = require('./ledger');
const prices = require('./data/prices');
const M = require('./metrics');

const UNI = Object.fromEntries(C.UNIVERSE.map((u) => [u[0], { t: u[0], n: u[1], s: u[2], k: u[3] }]));
const META = { name: 'Council', blurb: 'A council of Claude agents that reads 155 names, debates, and holds what it judges the best portfolio.' };
const histOf = (t) => store.readJSON(`prices/${t.replace(/[^\w.-]/g, '_')}.json`);
const r2 = (v) => (v == null ? v : Math.round(v * 100) / 100);

const brief = (s) => ({ id: s.id, preset: s.preset, rounds: s.plan?.length ?? null, trigger: s.trigger, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, cost: s.cost, error: s.error, device: s.device,
  holdings: s.final?.holdings?.length || 0, summary: s.final?.summary, confidence: s.final?.confidence, applied: s.applied || null, replay: !!s.events?.length });

/* Meetings: the ones in the store (full files), plus the summaries of older ones from the previous state.json. */
function councilInfo(prior) {
  const files = store.list('sessions').filter((f) => f.endsWith('.json'));
  const here = files.map((f) => store.readJSON('sessions/' + f)).filter((s) => s && !s.demo);
  const byId = new Map((prior?.sessions || []).map((x) => [x.id, x]));
  for (const s of here) byId.set(s.id, brief(s));
  const list = [...byId.values()].sort((a, b) => (a.id < b.id ? 1 : -1));
  // The portfolio shown is the latest decision that was applied (entered or waiting for its open).
  const lastFull = here.filter((s) => s.status === 'done' && s.final).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  const lastId = list.find((x) => x.status === 'done')?.id || null;
  const keepPrior = prior?.lastId && (!lastFull || prior.lastId > lastFull.id);
  const pick = keepPrior ? { final: prior.final, id: prior.lastId, endedAt: prior.decidedAt, device: prior.decidedOn } : lastFull ? { final: lastFull.final, id: lastFull.id, endedAt: lastFull.endedAt, device: lastFull.device } : null;
  return { final: pick?.final || null, lastId: pick?.id || lastId, decidedAt: pick?.endedAt || null, decidedOn: pick?.device || null, sessions: list.slice(0, 200) };
}

/* Rebuilds the council's state from its ledger, its meetings and prices. fetchPrices: false uses only what the store has. */
async function build({ prior = null, fetchPrices = true, log = () => {} } = {}) {
  const info = councilInfo(prior);
  const want = new Set(['SPY', 'QQQ', ...(info.final?.holdings || []).map((h) => h.ticker)]);
  ledger.events().filter((e) => e.type === 'decision').forEach((e) => Object.keys(e.target).forEach((t) => want.add(t)));
  const today = ledger.etParts(Date.now()).date;
  if (fetchPrices) await Promise.all([...want].map(async (t) => { const s = await prices.history(t, { need: today }).catch(() => null); if (!s) log(`no prices for ${t}`); }));
  const st = ledger.replay(histOf, 'ledger.jsonl');
  const from = Date.now() - 400 * 864e5, history = {}, universe = {};
  for (const t of want) {
    if (t === 'SPY' || t === 'QQQ') continue;
    const h = histOf(t); if (h?.bars) history[t] = h.bars.map((b) => [Date.parse(b.d + 'T21:00:00Z'), r2(b.ac ?? b.c)]).filter((p) => p[0] >= from);
    universe[t] = UNI[t] || { t, n: t, s: 'Other', k: 'S' };
  }
  // What each holding weighed when it last entered, so the apps can show how far it has drifted.
  const lastFill = st.fills[st.fills.length - 1];
  const entryW = Object.fromEntries((lastFill?.trades || []).map((x) => [x.t, r2(x.to)]));
  const target = ledger.events().filter((e) => e.type === 'decision' && st.fills.some((f) => f.hash === e.hash)).pop()?.target || {};
  const state = {
    id: 'council', ...META, updatedAt: new Date().toISOString(),
    capital: st.capital, cash: st.cash, stats: st.stats, verify: st.verify, pending: st.pending, fills: st.fills,
    series: st.series.map((p) => [p.d, r2(p.nav), r2(p.spy), r2(p.qqq)]),
    positions: st.positions.map((p) => ({ ...p, value: r2(p.value), weight: r2(p.weight), pnl: r2(p.pnl), entryWeight: target[p.t] ?? entryW[p.t] ?? null })),
    final: info.final, decidedAt: info.decidedAt, decidedOn: info.decidedOn || null, lastId: info.lastId || null,
    names: Object.values(universe), history, sessions: info.sessions,
    universe: C.UNIVERSE.map((u) => ({ t: u[0], n: u[1], s: u[2], k: u[3] })), seats: C.SEATS, officers: C.OFFICERS,
    presets: Object.fromEntries(Object.entries(C.PRESETS).map(([k, p]) => [k, { label: p.label, blurb: p.blurb }])), formats: C.FORMATS, rounds: C.ROUNDS,
  };
  log(`council: ${st.stats ? M.pc(st.stats.ret) : 'no record yet'} · ${st.positions.length} positions · ledger ${st.verify.ok ? 'intact' : 'BROKEN'}`);
  return { state, json: stateJson(state), readme: readme(state), chart: chartSvg(state) };
}
/* One line per top-level key, so the committed file reads well in a diff. */
const stateJson = (state) => '{\n' + Object.entries(state).map(([k, v]) => JSON.stringify(k) + ':' + JSON.stringify(v)).join(',\n') + '\n}\n';

/* The page GitHub shows for index/: both records in a table, the holdings, and a chart. */
function readme(s) {
  const pc = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%'), usd = (v) => '$' + Math.round(v).toLocaleString('en-US');
  const st = s.stats, nav = s.series.length ? s.series[s.series.length - 1][1] : s.capital;
  const L = ['# Oazy Research · the council index', '', 'A paper portfolio held by a council of Claude agents. Each decision enters when it is applied (at that moment\'s prices, or at a chosen 09:30 New York open), and holdings drift with prices until the next meeting. Marked on free daily closes, after 0.1% per trade, against SPY and QQQ bought at the same moment.', '',
    `Updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`, '', '![The council against SPY and QQQ](chart.svg)', '',
    '| Value | Return | vs S&P 500 | vs Nasdaq-100 | Max drawdown | Since |', '|---:|---:|---:|---:|---:|---|',
    `| ${usd(nav)} | ${pc(st?.ret)} | ${st?.spy != null ? pc(st.ret - st.spy) : '—'} | ${st?.qqq != null ? pc(st.ret - st.qqq) : '—'} | ${st?.maxDD ? pc(st.maxDD) : '0.00%'} | ${s.series[0]?.[0]?.slice(0, 10) || 'not started'} |`, ''];
  if (s.final?.summary) L.push(`> ${s.final.summary}`, '');
  L.push('| Holding | Weight now | At entry | Since entry |', '|---|---:|---:|---:|');
  for (const p of s.positions) L.push(`| ${p.t} ${s.names.find((u) => u.t === p.t)?.n || ''} | ${p.weight.toFixed(1)}% | ${p.entryWeight != null ? p.entryWeight.toFixed(1) + '%' : '—'} | ${pc(p.pnlPct)} |`);
  L.push(`| Cash | ${(s.cash ?? s.final?.cash_pct ?? 0).toFixed(1)}% | | |`);
  for (const p of s.pending || []) L.push('', p.mode === 'now' ? `A decision applied at ${p.at} enters once its prices are in.` : `A decision from ${p.at.slice(0, 10)} enters at the open on ${p.on}.`);
  L.push('', 'The [ledger](council/ledger.jsonl) hashes each entry with the one before it, so nothing can be changed after the fact. Meetings are in [council/sessions](council/sessions).', '');
  return L.join('\n');
}

function chartSvg(state) {
  const states = [state];
  const W = 880, H = 300, padL = 16, padR = 120, padT = 18, padB = 28, lines = [];
  const pick = (s, i) => s.series.filter((p) => p[i] != null).map((p) => [Date.parse(p[0].length > 10 ? p[0] : p[0] + 'T21:00:00Z'), (p[i] / s.capital - 1) * 100]);
  const longest = states.slice().sort((a, b) => b.series.length - a.series.length)[0];
  if (longest?.series.length) { lines.push({ n: 'S&P 500', c: '#ffb547', p: pick(longest, 2), w: 1.4 }, { n: 'Nasdaq-100', c: '#a99bff', p: pick(longest, 3), w: 1.4 }); }
  const COL = { council: '#ffd76a' };
  for (const s of states) if (s.series.length) lines.push({ n: s.name, c: COL[s.id], p: pick(s, 1), w: 2.4 });
  const pts = lines.flatMap((l) => l.p);
  const bg = `<rect width="${W}" height="${H}" rx="14" fill="#0b0d16"/>`;
  if (pts.length < 2) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${bg}<text x="${W / 2}" y="${H / 2}" fill="#8a90a8" font-family="sans-serif" font-size="14" text-anchor="middle">The record starts at the first open.</text></svg>\n`;
  const t0 = Math.min(...pts.map((p) => p[0])), t1 = Math.max(...pts.map((p) => p[0])) || t0 + 1;
  let lo = Math.min(0, ...pts.map((p) => p[1])), hi = Math.max(0, ...pts.map((p) => p[1])); const pad = (hi - lo) * 0.12 || 0.5; lo -= pad; hi += pad;
  const X = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR), Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const grid = [lo, 0, hi].map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#ffffff" stroke-opacity="${v === 0 ? 0.18 : 0.06}" stroke-dasharray="3 5"/>`).join('');
  const labels = []; const body = lines.map((l) => {
    const d = l.p.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(''), e = l.p[l.p.length - 1];
    labels.push({ y: Y(e[1]), c: l.c, t: `${l.n} ${(e[1] >= 0 ? '+' : '') + e[1].toFixed(2)}%` });
    return `<path d="${d}" fill="none" stroke="${l.c}" stroke-width="${l.w}" stroke-linejoin="round"/>`;
  }).join('');
  labels.sort((a, b) => a.y - b.y); for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 15);
  const lab = labels.map((l) => `<text x="${W - padR + 8}" y="${(l.y + 4).toFixed(1)}" fill="${l.c}" font-family="sans-serif" font-size="11.5" font-weight="600">${l.t}</text>`).join('');
  const d0 = new Date(t0).toISOString().slice(0, 10), d1 = new Date(t1).toISOString().slice(0, 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${bg}${grid}${body}${lab}<text x="${padL}" y="${H - 9}" fill="#8a90a8" font-family="sans-serif" font-size="11">${d0}</text><text x="${W - padR}" y="${H - 9}" fill="#8a90a8" font-family="sans-serif" font-size="11" text-anchor="end">${d1}</text></svg>\n`;
}

module.exports = { build, readme, chartSvg, stateJson, councilInfo };
