// Turns raw prices and filings into readable numbers. It measures; it never ranks anything out.
'use strict';
const { UNIVERSE } = require('./config');
const SECTOR = Object.fromEntries(UNIVERSE.map((u) => [u[0], u[2]]));

const ret = (bars, n) => (bars.length > n ? bars[bars.length - 1].ac / bars[bars.length - 1 - n].ac - 1 : null);
const sma = (bars, n) => (bars.length >= n ? bars.slice(-n).reduce((a, b) => a + b.c, 0) / n : null);
function dailyRets(bars, n) { const r = []; for (let i = Math.max(1, bars.length - n); i < bars.length; i++) r.push(bars[i].ac / bars[i - 1].ac - 1); return r; }
const sd = (a) => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
function rsi(bars, n = 14) {
  if (bars.length <= n) return null; let up = 0, dn = 0;
  for (let i = bars.length - n; i < bars.length; i++) { const d = bars[i].c - bars[i - 1].c; if (d > 0) up += d; else dn -= d; }
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
}
function maxDD(bars, n) { let pk = -Infinity, dd = 0; for (const b of bars.slice(-n)) { pk = Math.max(pk, b.ac); dd = Math.min(dd, b.ac / pk - 1); } return dd; }
function beta(bars, spy, n = 250) {
  const m = new Map(spy.map((b, i) => [b.d, i])), x = [], y = [];
  for (let i = Math.max(1, bars.length - n); i < bars.length; i++) {
    const j = m.get(bars[i].d), k = m.get(bars[i - 1].d);
    if (j == null || k == null) continue;
    y.push(bars[i].ac / bars[i - 1].ac - 1); x.push(spy[j].ac / spy[k].ac - 1);
  }
  if (x.length < 60) return null;
  const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length;
  let cv = 0, vx = 0; for (let i = 0; i < x.length; i++) { cv += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; }
  return vx ? cv / vx : null;
}

function compute(t, hist, spyHist, fund) {
  const bars = hist?.bars || [];
  if (bars.length < 25) return { t, ok: false, asOf: bars[bars.length - 1]?.d || null };
  const last = bars[bars.length - 1], px = last.c, hi = Math.max(...bars.slice(-252).map((b) => b.h)), lo = Math.min(...bars.slice(-252).map((b) => b.l));
  const r12 = ret(bars, 252), r1 = ret(bars, 21);
  const m = {
    t, ok: true, asOf: last.d, px,
    r1w: ret(bars, 5), r1m: r1, r3m: ret(bars, 63), r6m: ret(bars, 126), r12m: r12,
    mom12_1: r12 != null && r1 != null ? (1 + r12) / (1 + r1) - 1 : null,
    vs50: sma(bars, 50) ? px / sma(bars, 50) - 1 : null, vs200: sma(bars, 200) ? px / sma(bars, 200) - 1 : null,
    offHigh: px / hi - 1, offLow: px / lo - 1,
    vol3m: sd(dailyRets(bars, 63)) * Math.sqrt(252), dd1y: maxDD(bars, 252), rsi: rsi(bars),
    beta: spyHist ? beta(bars, spyHist.bars) : null,
    adv: bars.slice(-20).reduce((a, b) => a + b.c * b.v, 0) / 20,
  };
  if (fund && fund.shares) {
    const cap = fund.shares * px;
    Object.assign(m, {
      cap, ps: fund.revTTM ? cap / fund.revTTM : null, pe: fund.niTTM > 0 ? cap / fund.niTTM : null,
      fcfYield: fund.fcf != null && SECTOR[t] !== 'Financials' ? fund.fcf / cap : null,   // bank cash flows are not free cash flow
    });
  }
  if (fund) Object.assign(m, {
    revTTM: fund.revTTM, revGrowth: fund.revGrowth, revGrowthQ: fund.revGrowthQ, revAccel: fund.revAccel,
    opMargin: fund.revTTM && fund.opTTM != null ? fund.opTTM / fund.revTTM : null,
    netMargin: fund.revTTM && fund.niTTM != null ? fund.niTTM / fund.revTTM : null,
    grossMargin: fund.revTTM && fund.gpTTM != null ? fund.gpTTM / fund.revTTM : null,
    fundAsOf: fund.asOf,
  });
  return m;
}

/* Percentile of each name within the universe on a few headline measures, as context only. */
function percentiles(rows, keys) {
  for (const k of keys) {
    const v = rows.filter((r) => r.ok && Number.isFinite(r[k])).sort((a, b) => a[k] - b[k]);
    v.forEach((r, i) => { r['pct_' + k] = Math.round((i / Math.max(1, v.length - 1)) * 100); });
  }
}

/* Formatting for the briefs. */
const pc = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
const pct0 = (v) => (v == null || !Number.isFinite(v) ? '—' : (v * 100).toFixed(0) + '%');
const x1 = (v) => (v == null || !Number.isFinite(v) ? '—' : v >= 100 ? v.toFixed(0) + 'x' : v.toFixed(1) + 'x');
const big = (v) => (v == null || !Number.isFinite(v) ? '—' : v >= 1e12 ? '$' + (v / 1e12).toFixed(2) + 'T' : v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : '$' + (v / 1e6).toFixed(0) + 'M');

function line(m, meta) {
  const [t, name, sector, kind] = meta;
  if (!m.ok) return `${t} (${name}, ${sector}): no usable price history.`;
  const parts = [
    `${t} ${name} [${sector}${kind === 'E' ? ', ETF' : ''}] $${m.px.toFixed(2)} (${m.asOf})`,
    `ret 1w ${pc(m.r1w)} 1m ${pc(m.r1m)} 3m ${pc(m.r3m)} 6m ${pc(m.r6m)} 12m ${pc(m.r12m)}`,
    `vs50d ${pc(m.vs50)} vs200d ${pc(m.vs200)} off-high ${pc(m.offHigh)} RSI ${m.rsi == null ? '—' : m.rsi.toFixed(0)}`,
    `vol ${pct0(m.vol3m)} beta ${m.beta == null ? '—' : m.beta.toFixed(2)} maxDD1y ${pc(m.dd1y, 0)}`,
  ];
  if (kind !== 'E' && m.revTTM != null) parts.push(`rev TTM ${big(m.revTTM)} growth ${pc(m.revGrowth)} (latest q ${pc(m.revGrowthQ)}, accel ${m.revAccel == null ? '—' : (m.revAccel >= 0 ? '+' : '') + (m.revAccel * 100).toFixed(1) + 'pp'}) gross ${pct0(m.grossMargin)} op ${pct0(m.opMargin)} net ${pct0(m.netMargin)} [${m.fundAsOf}]`);
  if (kind !== 'E' && m.cap) parts.push(`cap ${big(m.cap)} P/S ${x1(m.ps)} P/E ${x1(m.pe)} FCF yield ${pc(m.fcfYield)}`);
  return parts.join(' | ');
}

module.exports = { compute, percentiles, line, pc, pct0, x1, big };
