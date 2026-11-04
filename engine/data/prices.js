// Daily price history: Yahoo Finance first, CBOE's free delayed history as a fallback for US listings.
'use strict';
const { getJSON } = require('../net');
const store = require('../store');

const FRESH = 4 * 3600e3;   // a cached series younger than this is reused
const day = (t) => new Date(t).toISOString().slice(0, 10);
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];   // two hosts, each paced on its own
let turn = 0;

/* Returns { sym, bars: [{d, o, h, l, c, ac, v}], meta } or null, in US dollars. ac = close adjusted for splits and dividends. */
async function yahoo(sym, range = '2y', signal, raw = false) {
  const u = `https://${HOSTS[(turn++) % 2]}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}&includeAdjustedClose=true&events=div%2Csplits`;
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
  const out = { sym, src: 'yahoo', bars, meta: { price: m.regularMarketPrice, time: m.regularMarketTime ? m.regularMarketTime * 1000 : null, currency: m.currency, name: m.longName || m.shortName, hi52: m.fiftyTwoWeekHigh, lo52: m.fiftyTwoWeekLow } };
  return raw || !m.currency || m.currency === 'USD' || /=X$/.test(sym) ? out : toUsd(out, signal);
}

/* Listings outside the US trade in their own currency. The portfolio is in dollars, so every price is converted at that
   day's exchange rate (Yahoo's XXX=X: units of XXX per dollar). Pence (GBp) are pounds / 100. */
const fx = new Map();
async function rates(cur, signal) {
  const hit = fx.get(cur); if (hit && Date.now() - hit.at < FRESH) return hit.p;
  const p = (async () => {
    const s = await yahoo(cur + '=X', '2y', signal, true);
    if (!s?.bars?.length) throw new Error('no exchange rate for ' + cur);
    return { days: s.bars.map((b) => [b.d, b.c]), last: s.meta.price || s.bars[s.bars.length - 1].c };
  })();
  fx.set(cur, { at: Date.now(), p }); p.catch(() => fx.delete(cur));
  return p;
}
async function toUsd(s, signal) {
  const cur = s.meta.currency, minor = cur === 'GBp' || cur === 'ILA' || cur === 'ZAc', base = minor ? { GBp: 'GBP', ILA: 'ILS', ZAc: 'ZAR' }[cur] : cur;
  const R = await rates(base, signal), k = minor ? 100 : 1;
  let j = 0, rate = R.days[0][1];
  for (const b of s.bars) {
    while (j < R.days.length && R.days[j][0] <= b.d) rate = R.days[j++][1];
    const f = 1 / (rate * k);
    b.o *= f; b.h *= f; b.l *= f; b.c *= f; b.ac *= f;
  }
  const f = 1 / (R.last * k);
  if (s.meta.price != null) s.meta.price *= f;
  if (s.meta.hi52 != null) s.meta.hi52 *= f;
  if (s.meta.lo52 != null) s.meta.lo52 *= f;
  s.meta.local = cur; s.meta.currency = 'USD';
  return s;
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
