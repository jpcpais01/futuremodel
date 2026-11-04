// The two Oazy portfolios as paper indexes, kept in the repository under index/.
//
//   index/core/book.json        Core's holdings and weights. Edit it on GitHub to rotate Core; the next update records it.
//   index/<p>/ledger.jsonl      every decision, hash-chained (Council writes its own after each session)
//   index/<p>/state.json        what the apps read: value, record, holdings, price history (rebuilt after each close)
//   index/council/sessions/     every council session, with the whole debate
//   index/README.md, chart.svg  the same numbers, readable on GitHub
//
// Every decision enters at the 09:30 New York open of its trading day (see ledger.js). Free daily prices only.
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./config');
const store = require('./store');
const ledger = require('./ledger');
const prices = require('./data/prices');
const M = require('./metrics');

const UNI = Object.fromEntries(C.UNIVERSE.map((u) => [u[0], { t: u[0], n: u[1], s: u[2], k: u[3] }]));
const META = {
  core: { name: 'Core v1.0', blurb: 'A hand-built book of AI, regime and hedge positions with fixed rotation rules.' },
  council: { name: 'Council', blurb: 'A council of Claude agents that reads 155 names every week and holds what it judges the best portfolio.' },
};
const histOf = (t) => store.readJSON(`prices/${t.replace(/[^\w.-]/g, '_')}.json`);
const r2 = (v) => (v == null ? v : Math.round(v * 100) / 100);

/* Core: when book.json no longer matches the last decision, the change is written to the ledger as a new decision. */
function syncCoreBook() {
  const book = store.readJSON('book.json'); if (!book) return null;
  const target = Object.fromEntries(book.holdings.map((h) => [h.ticker, +h.weight]));
  const cash = Math.max(0, 100 - Object.values(target).reduce((a, b) => a + b, 0));
  const last = ledger.events().filter((e) => e.type === 'decision').pop();
  const same = last && JSON.stringify(Object.entries(last.target).sort()) === JSON.stringify(Object.entries(target).sort());
  if (!same) {
    if (!ledger.events().length) ledger.append({ type: 'genesis', capital: C.LIMITS.startCapital, costBps: C.LIMITS.costBps, rule: ledger.RULE, at: book.start });
    ledger.append({ type: 'decision', session: 'core-book', preset: 'book', trigger: last ? 'rotation' : 'start', cash: r2(cash), target, ...(last ? {} : { at: book.start }) });
  }
  return {
    final: { holdings: book.holdings.map((h) => ({ ticker: h.ticker, weight: +h.weight, thesis: h.thesis, rotate_if: h.rotate_if, conviction: h.conviction, role: h.role })), cash_pct: r2(cash), summary: book.summary },
    decidedAt: ledger.events().filter((e) => e.type === 'decision').pop().at, names: book.names || {},
  };
}

function councilInfo() {
  const files = store.list('sessions').filter((f) => f.endsWith('.json')).sort().reverse();
  const all = files.map((f) => store.readJSON('sessions/' + f)).filter((s) => s && !s.demo);
  const last = all.find((s) => s.status === 'done' && s.final);
  return {
    final: last?.final || null, lastId: last?.id || null, decidedAt: last?.endedAt || null, decidedOn: last?.device || null,
    sessions: all.slice(0, 80).map((s) => ({ id: s.id, preset: s.preset, trigger: s.trigger, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, cost: s.cost, error: s.error, device: s.device,
      holdings: s.final?.holdings?.length || 0, summary: s.final?.summary, confidence: s.final?.confidence, replay: !!s.events?.length })),
  };
}

async function updateOne(dir, id, { log = () => {} } = {}) {
  store.setRoot(dir);
  const info = id === 'core' ? syncCoreBook() : councilInfo();
  if (!info) { log(`${id}: nothing to do`); return null; }
  const want = new Set(['SPY', 'QQQ', ...(info.final?.holdings || []).map((h) => h.ticker)]);
  ledger.events().filter((e) => e.type === 'decision').forEach((e) => Object.keys(e.target).forEach((t) => want.add(t)));
  const today = ledger.etParts(Date.now()).date;
  for (const t of want) { const s = await prices.history(t, { need: today }).catch(() => null); if (!s) log(`${id}: no prices for ${t}`); }
  const st = ledger.replay(histOf, 'ledger.jsonl');
  const from = Date.now() - 400 * 864e5, history = {}, universe = {};
  for (const t of want) {
    if (t === 'SPY' || t === 'QQQ') continue;
    const h = histOf(t); if (h?.bars) history[t] = h.bars.map((b) => [Date.parse(b.d + 'T21:00:00Z'), r2(b.ac ?? b.c)]).filter((p) => p[0] >= from);
    universe[t] = { ...(UNI[t] || { t, n: t, s: 'Other', k: 'S' }), ...(info.names?.[t] || {}) };
  }
  const state = {
    id, ...META[id], updatedAt: new Date().toISOString(),
    capital: st.capital, cash: st.cash, stats: st.stats, verify: st.verify, pending: st.pending, fills: st.fills,
    series: st.series.map((p) => [p.d, r2(p.nav), r2(p.spy), r2(p.qqq)]),
    positions: st.positions.map((p) => ({ ...p, value: r2(p.value), weight: r2(p.weight), pnl: r2(p.pnl) })),
    final: info.final, decidedAt: info.decidedAt, decidedOn: info.decidedOn || null, lastId: info.lastId || null,
    names: Object.values(universe), history,
    ...(id === 'council' ? {
      sessions: info.sessions, universe: C.UNIVERSE.map((u) => ({ t: u[0], n: u[1], s: u[2], k: u[3] })), seats: C.SEATS, officers: C.OFFICERS,
      presets: Object.fromEntries(Object.entries(C.PRESETS).map(([k, p]) => [k, { label: p.label }])),
    } : {}),
  };
  // Keep the committed file readable in a diff: one line per top-level key.
  fs.writeFileSync(path.join(dir, 'state.json'), '{\n' + Object.entries(state).map(([k, v]) => JSON.stringify(k) + ':' + JSON.stringify(v)).join(',\n') + '\n}\n');
  log(`${id}: ${st.stats ? M.pc(st.stats.ret) : 'no record yet'} · ${st.positions.length} positions · ledger ${st.verify.ok ? 'intact' : 'BROKEN'}`);
  return state;
}

/* The page GitHub shows for index/: both records in a table, the holdings, and a chart. */
function readme(states) {
  const pc = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%'), usd = (v) => '$' + Math.round(v).toLocaleString('en-US');
  const L = ['# Oazy Research · the indexes', '', 'Two paper portfolios, each entered at the 09:30 New York open of its decision day and marked on free daily closes, after 0.1% per trade. Compared with SPY and QQQ bought at the same open.', '',
    `Updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`, '', '![Both indexes against SPY and QQQ](chart.svg)', '',
    '| Portfolio | Value | Return | vs S&P 500 | vs Nasdaq-100 | Max drawdown | Since |', '|---|---:|---:|---:|---:|---:|---|'];
  for (const s of states) {
    const st = s.stats, nav = s.series.length ? s.series[s.series.length - 1][1] : s.capital;
    L.push(`| **${s.name}** | ${usd(nav)} | ${pc(st?.ret)} | ${st?.spy != null ? pc(st.ret - st.spy) : '—'} | ${st?.qqq != null ? pc(st.ret - st.qqq) : '—'} | ${st?.maxDD ? pc(st.maxDD) : '0.00%'} | ${s.series[0]?.[0]?.slice(0, 10) || 'not started'} |`);
  }
  for (const s of states) {
    L.push('', `## ${s.name}`, '', s.blurb, '');
    if (s.id === 'council' && s.final?.summary) L.push(`> ${s.final.summary}`, '');
    L.push('| Holding | Weight now | Since entry |', '|---|---:|---:|');
    for (const p of s.positions) L.push(`| ${p.t} ${s.names.find((u) => u.t === p.t)?.n || ''} | ${p.weight.toFixed(1)}% | ${pc(p.pnlPct)} |`);
    L.push(`| Cash | ${(s.cash ?? s.final?.cash_pct ?? 0).toFixed(1)}% | |`);
    if (s.pending?.length) L.push('', `A decision from ${s.pending[s.pending.length - 1].at} enters at its trading day's open once those prices are in.`);
  }
  L.push('', 'Ledgers: [core](core/ledger.jsonl) · [council](council/ledger.jsonl). Each entry is hashed with the one before it, so nothing can be changed after the fact.', '');
  return L.join('\n');
}

function chartSvg(states) {
  const W = 880, H = 300, padL = 16, padR = 120, padT = 18, padB = 28, lines = [];
  const pick = (s, i) => s.series.filter((p) => p[i] != null).map((p) => [Date.parse(p[0].length > 10 ? p[0] : p[0] + 'T21:00:00Z'), (p[i] / s.capital - 1) * 100]);
  const longest = states.slice().sort((a, b) => b.series.length - a.series.length)[0];
  if (longest?.series.length) { lines.push({ n: 'S&P 500', c: '#ffb547', p: pick(longest, 2), w: 1.4 }, { n: 'Nasdaq-100', c: '#a99bff', p: pick(longest, 3), w: 1.4 }); }
  const COL = { core: '#3ddc97', council: '#ffd76a' };
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

async function updateAll(root, opts = {}) {
  const states = [];
  for (const id of ['core', 'council']) { const s = await updateOne(path.join(root, id), id, opts); if (s) states.push(s); }
  fs.writeFileSync(path.join(root, 'README.md'), readme(states));
  fs.writeFileSync(path.join(root, 'chart.svg'), chartSvg(states));
  return states;
}

module.exports = { updateAll, updateOne, readme, chartSvg };
