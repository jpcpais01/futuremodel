// Daily price history: Yahoo Finance first, CBOE's free delayed history as a fallback for US listings.
'use strict';
const { getJSON } = require('../net');
const store = require('../store');

const FRESH = 4 * 3600e3;   // a cached series younger than this is reused
const day = (t) => new Date(t).toISOString().slice(0, 10);

/* Returns { sym, bars: [{d, o, h, l, c, ac, v}], meta } or null. ac = close adjusted for splits and dividends. */
async function yahoo(sym, range = '2y', signal) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}&includeAdjustedClose=true&events=div%2Csplits`;
  const j = await getJSON(u, { signal });
  const r = j?.chart?.result?.[0];
  if (!r || !r.timestamp) return null;
  const q = r.indicators.quote[0], ac = r.indicators.adjclose?.[0]?.adjclose || q.close, bars = [];
  r.timestamp.forEach((t, i) => {
    const c = q.close[i];
    if (c == null || !Number.isFinite(c)) return;
    bars.push({ d: day(t * 1000), o: q.open[i] ?? c, h: q.high[i] ?? c, l: q.low[i] ?? c, c, ac: ac[i] ?? c, v: q.volume[i] ?? 0 });
  });
  const m = r.meta || {};
  return { sym, src: 'yahoo', bars, meta: { price: m.regularMarketPrice, time: m.regularMarketTime ? m.regularMarketTime * 1000 : null, currency: m.currency, name: m.longName || m.shortName, hi52: m.fiftyTwoWeekHigh, lo52: m.fiftyTwoWeekLow } };
}

async function cboe(sym, signal) {
  const s = sym.replace(/^\^/, '_').replace('-', '.');
  const j = await getJSON(`https://cdn.cboe.com/api/global/delayed_quotes/charts/historical/${encodeURIComponent(s)}.json`, { signal, tries: 2 });
  const rows = (j?.data || []).slice(-520);
  if (!rows.length) return null;
  const bars = rows.map((x) => ({ d: x.date, o: +x.open, h: +x.high, l: +x.low, c: +x.close, ac: +x.close, v: +x.volume || 0 })).filter((b) => b.c > 0);
  return { sym, src: 'cboe', bars, meta: { price: bars[bars.length - 1].c } };
}

/* need: a 'YYYY-MM-DD' the series should reach. A cache that stops short is refetched (at most every 10 minutes). */
async function history(sym, { signal, force = false, need = null } = {}) {
  const rel = `prices/${sym.replace(/[^\w.-]/g, '_')}.json`;
  const cached = store.readJSON(rel), lastD = cached?.bars?.[cached.bars.length - 1]?.d;
  const short = need && (!lastD || lastD < need) && store.age(rel) > 10 * 60e3;
  if (cached && !force && !short && store.age(rel) < FRESH) return cached;
  let s = null;
  try { s = await yahoo(sym, '2y', signal); } catch (e) { if (signal?.aborted) throw e; }
  if (!s || s.bars.length < 30) { try { s = (await cboe(sym, signal)) || s; } catch (e) { if (signal?.aborted) throw e; } }
  if (!s) return cached;                       // stale beats nothing; the brief shows the data date
  store.writeJSON(rel, s);
  return s;
}

/* A quick last price for valuing fills and today's marks. */
async function lastPrice(sym, signal) {
  try { const s = await yahoo(sym, '5d', signal); if (s?.meta?.price) return { price: s.meta.price, time: s.meta.time }; } catch {}
  const s = await history(sym, { signal });
  const b = s?.bars?.[s.bars.length - 1];
  return b ? { price: b.c, time: Date.parse(b.d + 'T21:00:00Z') } : null;
}

module.exports = { history, lastPrice, yahoo };
