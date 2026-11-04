// The portfolio's path between the daily marks, for the chart: Today (5-minute prices), a week (15-minute), a month
// (hourly), the year to date (daily) and the whole record (whichever of these fits its length). Free Yahoo prices.
// What the council held at each moment is rebuilt from the record's fills: the units each trade left, and the cash.
'use strict';
const net = require('./net');
const prices = require('./data/prices');

const RANGES = { today: { interval: '5m', range: '1d' }, '1w': { interval: '15m', range: '5d' }, '1m': { interval: '60m', range: '1mo' } };

/* Holdings after each fill: [{ at, units: {t: n}, cash }]. Units are priced at the fill's own prices. */
function periods(state) {
  const out = []; let units = {}, cash = state.capital;
  for (const f of state.fills || []) {
    const u = { ...units };
    let spent = 0;
    for (const tr of f.trades || []) {
      const want = (f.nav * tr.to) / 100, have = (f.nav * tr.from) / 100;
      spent += want - have;
      if (want > 0 && tr.px > 0) u[tr.t] = want / tr.px; else delete u[tr.t];
    }
    cash = cash - spent - (f.fee || 0);
    units = u;
    out.push({ at: Date.parse(f.at), units, cash });
  }
  return out;
}

/* Which range 'all' means for a record of this length. */
function allRange(state, now = Date.now()) {
  const first = Date.parse(state.fills?.[0]?.at || 0), days = (now - first) / 864e5;
  return days <= 1.2 ? 'today' : days <= 6.5 ? '1w' : days <= 29 ? '1m' : null;
}

/* Rows [ms, nav, spy, qqq] on the S&P's time grid, from the first fill (or the start of the range). null when the range
   is daily (use the record's own daily series) or prices are missing. */
async function intraday(state, key, { signal } = {}) {
  if (key === 'all') key = allRange(state);
  const R = RANGES[key]; if (!R || !state?.fills?.length) return null;
  const P = periods(state), first = P[0].at;
  const names = [...new Set(P.flatMap((p) => Object.keys(p.units)))];
  const px = {};
  await net.pool(['SPY', 'QQQ', ...names], 4, async (t) => { px[t] = await prices.intraday(t, R.interval, R.range, signal).catch(() => null); });
  const grid = (px.SPY || []).map((r) => r[0]).filter((t) => t >= first - 60e3);
  if (grid.length < 2) return null;
  // last known price at or before t, walking forward
  const cursor = (s) => { let i = 0; return (t) => { if (!s?.length) return null; while (i + 1 < s.length && s[i + 1][0] <= t) i++; return s[i][0] <= t ? s[i][1] : null; }; };
  const cur = Object.fromEntries(Object.keys(px).map((t) => [t, cursor(px[t])]));
  let pi = 0;
  const rows = [];
  // The record's first moment, if it falls in the range: the fill itself, at the opening prices.
  const bar0 = (px.SPY || []).find((r) => r[3] >= first - 60e3);
  if (bar0 && bar0[3] - first < 6e4) {
    const f = state.fills[0], q0 = (px.QQQ || []).find((r) => r[3] === bar0[3]);
    rows.push([first, f.nav - (f.fee || 0), bar0[2], q0 ? q0[2] : null]);
  }
  for (const t of grid) {
    while (pi + 1 < P.length && P[pi + 1].at <= t) pi++;
    if (P[pi].at > t + 60e3) continue;
    const p = P[pi];
    let nav = p.cash;
    for (const [n, u] of Object.entries(p.units)) {
      const v = cur[n](t);
      if (v == null) { const tr = (state.fills.find((f) => f.trades?.some((x) => x.t === n)))?.trades.find((x) => x.t === n); nav += u * (tr?.px || 0); } else nav += u * v;
    }
    rows.push([t, nav, cur.SPY(t), cur.QQQ ? cur.QQQ(t) : null]);
  }
  return rows.length > 1 ? { key, rows, interval: R.interval } : null;
}

module.exports = { intraday, periods, allRange, RANGES };
