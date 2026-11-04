// The paper portfolio. Decisions are written to an append-only, hash-chained log the moment the chair decides.
// Fills and every mark after them are recomputed from market data, so nothing can be adjusted after the fact.
//
// Fill rule: the portfolio is an index, not a broker account. A decision enters at the regular-session open of the
// New York trading day it was made on (09:30), or at the next open when it was made on a weekend or holiday.
// A decision made after 09:30 therefore sees up to one session of hindsight; the record says so.
// Values are tracked on dividend- and split-adjusted prices, so the record is a total return.
'use strict';
const { sha256 } = require('./hash');
const store = require('./store');
const { LIMITS } = require('./config');

const FILE = 'ledger.jsonl';
const RULE = 'Each decision enters either at the price of the moment it is applied, or at the 09:30 New York open of the day chosen for it. A newer decision replaces one still waiting. Adjusted prices, total return.';
const hashOf = (o) => sha256(JSON.stringify(o));

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
  if (!events(file).length) append({ type: 'genesis', capital, costBps: LIMITS.costBps, rule: RULE }, file);
}

/* apply: { mode: 'now', px: {ticker: price}, pxAt } enters at those prices (the moment it is applied),
   or { mode: 'open', on: 'YYYY-MM-DD' } enters at the 09:30 New York open of that day (or the next trading day). */
function recordDecision(s, file = FILE, apply = null) {
  ensureGenesis(LIMITS.startCapital, file);
  return append({
    type: 'decision', session: s.id, preset: s.preset, trigger: s.trigger || 'manual',
    cash: s.final.cash_pct, target: Object.fromEntries(s.final.holdings.map((h) => [h.ticker, +h.weight.toFixed(2)])),
    briefHash: s.briefHash,
    ...(apply?.mode === 'now' ? { apply: 'now', px: apply.px, pxAt: apply.pxAt } : apply?.mode === 'open' ? { apply: 'open', on: apply.on } : {}),
  }, file);
}

/* New York calendar date and minutes after midnight for a timestamp. */
function etParts(ts) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
}
/* 09:30 New York on a date, as an ISO time (handles daylight saving). */
function openIso(d) {
  for (const h of [13, 14]) { const t = Date.parse(`${d}T${h}:30:00Z`); if (etParts(t).min === 570) return new Date(t).toISOString(); }
  return `${d}T14:30:00.000Z`;
}
/* The trading day a decision enters on. Null while it is still waiting (its day has not come, or its prices have not arrived).
   'now': the day of the prices it was applied at. 'open': the first trading day on or after its chosen date whose open is after the decision.
   Older decisions without a mode enter at the open of their own New York date (the next session after a weekend or holiday). */
function fillDate(ts, days, e = {}) {
  if (e.apply === 'now') { const d = etParts(Date.parse(e.pxAt)).date; return days.find((x) => x >= d) || null; }
  const { date } = etParts(ts);
  if (e.apply === 'open') { const from = e.on > date ? e.on : date; return days.find((d) => d >= from && Date.parse(openIso(d)) >= ts) || null; }
  return days.find((d) => d >= date) || null;
}
/* The first weekday whose 09:30 New York open is still ahead (holidays are skipped when the fill happens). */
function nextOpenDate(ts = Date.now()) {
  let { date } = etParts(ts);
  for (let i = 0; i < 10; i++) {
    const dow = new Date(date + 'T12:00:00Z').getUTCDay();
    if (dow > 0 && dow < 6 && Date.parse(openIso(date)) > ts) return date;
    date = new Date(Date.parse(date + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
  }
  return date;
}
/* When a decision takes effect, for ordering: the moment of its prices, or its open. */
const effectAt = (e) => (e.apply === 'now' ? Date.parse(e.pxAt) : e.fill ? Date.parse(openIso(e.fill)) : Infinity);

/**
 * Rebuilds the whole record from the log and price histories.
 * hist(t) returns { bars: [{d,o,c,ac}] } for a ticker. Uses SPY's calendar as the trading calendar.
 */
function replay(hist, file = FILE) {
  const all = events(file), gen = all.find((e) => e.type === 'genesis');
  const empty = { series: [], positions: [], fills: [], pending: [], cash: 100, stats: null, capital: gen?.capital || LIMITS.startCapital, verify: verify(file) };
  if (!gen) return empty;
  const spy = hist('SPY'), qqq = hist('QQQ');
  if (!spy?.bars?.length) return empty;
  const days = spy.bars.map((b) => b.d), cost = (gen.costBps ?? LIMITS.costBps) / 1e4;
  const idx = {}, get = (t) => { if (!idx[t]) { const h = hist(t); idx[t] = h ? new Map(h.bars.map((b) => [b.d, b])) : new Map(); } return idx[t]; };
  const adjOpen = (b) => b.o * (b.ac / b.c), lastBar = (t, d) => { const m = get(t); if (m.has(d)) return m.get(d); let best = null; for (const [k, v] of m) if (k <= d && (!best || k > best.d)) best = v; return best; };

  const listed = all.filter((e) => e.type === 'decision').map((e) => ({ ...e, fill: fillDate(Date.parse(e.at), days, e) }));
  // A newer decision replaces an older one that had not entered yet when the newer one was made.
  const decisions = listed.filter((e) => !listed.some((f) => f.seq > e.seq && Date.parse(f.at) < effectAt(e)));
  const pending = decisions.filter((e) => !e.fill);
  let cash = gen.capital, units = {}, basis = {}, series = [], fills = [], bench = null, entry = {};
  const pos = (d, px) => Object.entries(units).reduce((a, [t, u]) => { const b = lastBar(t, d); return a + u * (b ? px(b) : 0); }, 0);

  for (const d of days) {
    // Open entries first (several before one open: the latest wins), then entries at the price of the moment, in order.
    const atOpen = decisions.filter((e) => e.fill === d && e.apply !== 'now'), atNow = decisions.filter((e) => e.fill === d && e.apply === 'now');
    const batches = [...(atOpen.length ? [[atOpen[atOpen.length - 1], adjOpen, (b) => b.o]] : []),
      ...atNow.map((e) => { const raw = (b, t) => (Number.isFinite(e.px?.[t]) ? e.px[t] : b.c); return [e, (b, t) => raw(b, t) * (b.ac / b.c), raw]; })];
    for (const [e, adj, raw] of batches) {
      const priced = (t) => get(t).get(d) || lastBar(t, d);
      const val = (t, u) => { const b = priced(t); return b ? u * adj(b, t) : 0; };
      const nav = cash + Object.entries(units).reduce((a, [t, u]) => a + val(t, u), 0), trades = [];
      let traded = 0;
      const target = e.target, names = new Set([...Object.keys(units), ...Object.keys(target)]);
      const newUnits = {};
      for (const t of names) {
        const b = priced(t);
        if (!b) continue;
        const px = adj(b, t), want = (nav * (target[t] || 0)) / 100, have = (units[t] || 0) * px;
        traded += Math.abs(want - have);
        if (want > 0) newUnits[t] = want / px;
        if (Math.abs(want - have) > nav * 1e-4) trades.push({ t, from: have / nav * 100, to: want / nav * 100, px: raw(b, t) });
        if (want > have) { basis[t] = (basis[t] || 0) + (want - have); if (!have) entry[t] = d; }
        else if (have > 0) basis[t] = (basis[t] || 0) * (want / have);
        if (!want) { delete basis[t]; delete entry[t]; }
      }
      const fee = traded * cost;
      units = newUnits;
      cash = nav - fee - Object.entries(units).reduce((a, [t, u]) => a + val(t, u), 0);
      fills.push({ date: d, session: e.session, decided: e.at, at: e.apply === 'now' ? e.pxAt : openIso(d), mode: e.apply === 'now' ? 'now' : 'open', nav, fee, trades, hash: e.hash });
      if (!bench) {
        const s = get('SPY').get(d), q = qqq && get('QQQ').get(d);
        bench = { spy: s ? adj(s, 'SPY') : null, qqq: q ? adj(q, 'QQQ') : null, d };
        // The index starts at its first entry, so the rest of day one is part of the record.
        series.push({ d: e.apply === 'now' ? new Date(Date.parse(e.pxAt)).toISOString() : openIso(d), nav: cash + Object.entries(units).reduce((a, [t, u]) => a + val(t, u), 0), spy: bench.spy ? gen.capital : null, qqq: bench.qqq ? gen.capital : null, open: true });
      }
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
  return { series, positions, fills, pending: pending.map((e) => ({ session: e.session, at: e.at, target: e.target, mode: e.apply || 'open', on: e.apply === 'open' ? e.on : null })), cash: (cash / navNow) * 100, stats: stats(series, gen.capital), capital: gen.capital, verify: verify(file) };
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
    days: new Set(series.map((p) => p.d.slice(0, 10))).size, ret: last.nav / capital - 1, spy: last.spy ? last.spy / capital - 1 : null, qqq: last.qqq ? last.qqq / capital - 1 : null,
    vol: sd * Math.sqrt(252), sharpe: sd ? (mean / sd) * Math.sqrt(252) : null, maxDD: dd, weeklyHit: n ? wins / n : null, weeks: n,
  };
}

/* Puts entries written elsewhere on top of a chain, re-linking each one. Used when two devices recorded at the same time. */
function chainOnto(base, extras) {
  const out = [...base], hasGenesis = base.some((e) => e.type === 'genesis');
  for (const e of extras) {
    if (e.type === 'genesis' && (hasGenesis || out.length)) continue;
    const { hash, prev, seq, ...rest } = e;
    const body = { ...rest, seq: out.length, prev: out.length ? out[out.length - 1].hash : '0'.repeat(64) };
    out.push({ ...body, hash: hashOf(body) });
  }
  return out;
}

module.exports = { RULE, openIso, nextOpenDate, events, append, verify, ensureGenesis, recordDecision, replay, fillDate, etParts, chainOnto, hashOf };
