// Macro inputs: FRED series (free, no key), CBOE volatility indexes, and Hyperliquid's tradable list.
'use strict';
const { get, getJSON, postJSON, pool } = require('../net');
const store = require('../store');

async function fredSeries(id, signal) {
  const rel = `fred/${id}.json`;
  const c = store.readJSON(rel);
  if (c && store.age(rel) < 12 * 3600e3) return c;
  try {
    const from = new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10);
    const csv = await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${from}`, { signal, tries: 3, timeout: 40000, headers: { 'User-Agent': 'OazyCouncil/1.0' } });
    const rows = csv.trim().split('\n').slice(1).map((l) => l.split(',')).filter((r) => r[1] && r[1] !== '.').map((r) => [r[0], +r[1]]).filter((r) => Number.isFinite(r[1]));
    const s = rows.slice(-800);
    store.writeJSON(rel, s);
    return s;
  } catch (e) { if (signal?.aborted) throw e; return c || []; }
}

/* Latest value and changes over about 1 month, 3 months and 1 year, from a dated series. */
function changes(s) {
  if (!s || !s.length) return null;
  const last = s[s.length - 1], at = (days) => {
    const t = Date.parse(last[0]) - days * 864e5;
    for (let i = s.length - 1; i >= 0; i--) if (Date.parse(s[i][0]) <= t) return s[i][1];
    return null;
  };
  return { date: last[0], v: last[1], m1: at(30), m3: at(91), y1: at(365) };
}

async function fred(list, { signal } = {}) {
  const out = {};
  await pool(list, 2, async ([id, label, unit]) => { const c = changes(await fredSeries(id, signal)); if (c) out[id] = { label, unit, ...c }; });
  return out;
}

async function vol({ signal } = {}) {
  const out = {};
  for (const s of ['_VIX9D', '_VIX', '_VIX3M', '_VVIX', '_SKEW']) {
    try { const j = await getJSON(`https://cdn.cboe.com/api/global/delayed_quotes/quotes/${s}.json`, { signal, tries: 2 }); out[s.slice(1)] = +j.data.current_price; } catch (e) { if (signal?.aborted) throw e; }
  }
  return out;
}

/* Which tickers can actually be traded as perps on Hyperliquid (trade.xyz and para dexes). Display only. */
async function hyperliquid({ signal } = {}) {
  const rel = 'hl.json';
  const c = store.readJSON(rel);
  if (c && store.age(rel) < 864e5) return c;
  const out = {};
  for (const dex of ['xyz', 'para']) {
    try {
      const m = await postJSON('https://api.hyperliquid.xyz/info', { type: 'meta', dex }, { signal, tries: 2 });
      m.universe.forEach((u) => { if (!u.isDelisted) { const t = u.name.split(':')[1]; if (!out[t]) out[t] = u.name; } });
    } catch (e) { if (signal?.aborted) throw e; }
  }
  if (Object.keys(out).length) store.writeJSON(rel, out);
  return Object.keys(out).length ? out : c || {};
}

module.exports = { fred, vol, hyperliquid, changes };
