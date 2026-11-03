// The paper portfolio. Decisions are written to an append-only, hash-chained log the moment the chair decides.
// Fills and every mark after them are recomputed from market data, so nothing can be adjusted after the fact.
//
// Fill rule (honest by construction): a decision fills at the first regular-session open after it was made.
// Values are tracked on dividend- and split-adjusted prices, so the record is a total return.
'use strict';
const crypto = require('crypto');
const store = require('./store');
const { LIMITS } = require('./config');

const FILE = 'ledger.jsonl';
const hashOf = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');

function events(file = FILE) { return store.readLines(file); }

function append(ev, file = FILE) {
  const all = events(file), prev = all.length ? all[all.length - 1].hash : '0'.repeat(64);
  const body = { ...ev, at: ev.at || new Date().toISOString(), seq: all.length, prev };
  const full = { ...body, hash: hashOf(body) };
  store.appendLine(file, full);
  return full;
}

/* True when every entry still hashes to what was written and links to the one before. */
function verify(file = FILE) {
  const all = events(file); let prev = '0'.repeat(64);
  for (const e of all) { const { hash, ...body } = e; if (e.prev !== prev || hashOf(body) !== hash) return { ok: false, at: e.seq }; prev = hash; }
  return { ok: true, n: all.length };
}

function ensureGenesis(capital = LIMITS.startCapital, file = FILE) {
  if (!events(file).length) append({ type: 'genesis', capital, costBps: LIMITS.costBps, rule: 'Fills at the first regular-session open after each decision. Adjusted prices, total return.' }, file);
}

function recordDecision(s, file = FILE) {
  ensureGenesis(LIMITS.startCapital, file);
  return append({
    type: 'decision', session: s.id, preset: s.preset, trigger: s.trigger || 'scheduled',
    cash: s.final.cash_pct, target: Object.fromEntries(s.final.holdings.map((h) => [h.ticker, +h.weight.toFixed(2)])),
    briefHash: s.briefHash,
  }, file);
}

/* New York calendar date and minutes after midnight for a timestamp. */
function etParts(ts) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
}
function fillDate(ts, days) {
  const { date, min } = etParts(ts);
  return days.find((d) => (d === date ? min < 570 : d > date)) || null;   // 570 = 09:30
}

/**
 * Rebuilds the whole record from the log and price histories.
 * hist(t) returns { bars: [{d,o,c,ac}] } for a ticker. Uses SPY's calendar as the trading calendar.
 */
function replay(hist, file = FILE) {
  const all = events(file), gen = all.find((e) => e.type === 'genesis');
  const empty = { series: [], positions: [], fills: [], pending: [], stats: null, capital: gen?.capital || LIMITS.startCapital, verify: verify(file) };
  if (!gen) return empty;
  const spy = hist('SPY'), qqq = hist('QQQ');
  if (!spy?.bars?.length) return empty;
  const days = spy.bars.map((b) => b.d), cost = (gen.costBps ?? LIMITS.costBps) / 1e4;
  const idx = {}, get = (t) => { if (!idx[t]) { const h = hist(t); idx[t] = h ? new Map(h.bars.map((b) => [b.d, b])) : new Map(); } return idx[t]; };
  const adjOpen = (b) => b.o * (b.ac / b.c), lastBar = (t, d) => { const m = get(t); if (m.has(d)) return m.get(d); let best = null; for (const [k, v] of m) if (k <= d && (!best || k > best.d)) best = v; return best; };

  const decisions = all.filter((e) => e.type === 'decision').map((e) => ({ ...e, fill: fillDate(Date.parse(e.at), days) }));
  const pending = decisions.filter((e) => !e.fill);
  let cash = gen.capital, units = {}, basis = {}, series = [], fills = [], bench = null, entry = {};
  const pos = (d, px) => Object.entries(units).reduce((a, [t, u]) => { const b = lastBar(t, d); return a + u * (b ? px(b) : 0); }, 0);

  for (const d of days) {
    const todays = decisions.filter((e) => e.fill === d);
    if (todays.length) {
      const e = todays[todays.length - 1];   // several decisions before one open: the latest wins
      const nav = cash + pos(d, adjOpen), trades = [];
      let traded = 0;
      const target = e.target, names = new Set([...Object.keys(units), ...Object.keys(target)]);
      const newUnits = {};
      for (const t of names) {
        const b = get(t).get(d) || lastBar(t, d);
        if (!b) continue;
        const px = adjOpen(b), want = (nav * (target[t] || 0)) / 100, have = (units[t] || 0) * px;
        traded += Math.abs(want - have);
        if (want > 0) newUnits[t] = want / px;
        if (Math.abs(want - have) > nav * 1e-4) trades.push({ t, from: have / nav * 100, to: want / nav * 100, px: b.o });
        if (want > have) { basis[t] = (basis[t] || 0) + (want - have); if (!have) entry[t] = d; }
        else if (have > 0) basis[t] = (basis[t] || 0) * (want / have);
        if (!want) { delete basis[t]; delete entry[t]; }
      }
      const fee = traded * cost;
      units = newUnits;
      cash = nav - fee - Object.entries(units).reduce((a, [t, u]) => a + u * adjOpen(get(t).get(d) || lastBar(t, d)), 0);
      fills.push({ date: d, session: e.session, decided: e.at, nav, fee, trades, hash: e.hash });
      if (!bench) { const s = get('SPY').get(d), q = qqq && get('QQQ').get(d); bench = { spy: s ? adjOpen(s) : null, qqq: q ? adjOpen(q) : null, d }; }
    }
    if (!bench) continue;
    const nav = cash + pos(d, (b) => b.ac), s = get('SPY').get(d), q = qqq ? get('QQQ').get(d) : null;
    series.push({ d, nav, spy: s && bench.spy ? (gen.capital * s.ac) / bench.spy : null, qqq: q && bench.qqq ? (gen.capital * q.ac) / bench.qqq : null });
  }

  const lastD = days[days.length - 1], navNow = series.length ? series[series.length - 1].nav : gen.capital;
  const positions = Object.entries(units).map(([t, u]) => {
    const b = lastBar(t, lastD), value = b ? u * b.ac : 0;
    return { t, value, weight: (value / navNow) * 100, pnl: value - (basis[t] || 0), pnlPct: basis[t] ? value / basis[t] - 1 : null, since: entry[t], px: b?.c };
  }).sort((a, b) => b.value - a.value);
  return { series, positions, fills, pending: pending.map((e) => ({ session: e.session, at: e.at, target: e.target })), cash: (cash / navNow) * 100, stats: stats(series, gen.capital), capital: gen.capital, verify: verify(file) };
}

function stats(series, capital) {
  if (series.length < 2) return series.length ? { days: 1, ret: series[0].nav / capital - 1 } : null;
  const r = [], rs = [];
  for (let i = 1; i < series.length; i++) { r.push(series[i].nav / series[i - 1].nav - 1); if (series[i].spy && series[i - 1].spy) rs.push(series[i].spy / series[i - 1].spy - 1); }
  const mean = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, r.length - 1));
  let pk = -Infinity, dd = 0; for (const p of series) { pk = Math.max(pk, p.nav); dd = Math.min(dd, p.nav / pk - 1); }
  const last = series[series.length - 1];
  // Weekly hit rate against the S&P 500: share of 5-day windows where the council beat it.
  let wins = 0, n = 0;
  for (let i = 5; i < series.length; i += 5) { const a = series[i], b = series[i - 5]; if (a.spy && b.spy) { n++; if (a.nav / b.nav > a.spy / b.spy) wins++; } }
  return {
    days: series.length, ret: last.nav / capital - 1, spy: last.spy ? last.spy / capital - 1 : null, qqq: last.qqq ? last.qqq / capital - 1 : null,
    vol: sd * Math.sqrt(252), sharpe: sd ? (mean / sd) * Math.sqrt(252) : null, maxDD: dd, weeklyHit: n ? wins / n : null, weeks: n,
  };
}

module.exports = { events, append, verify, ensureGenesis, recordDecision, replay, fillDate, etParts };
