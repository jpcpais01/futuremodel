// Hard limits applied after the chair decides. The council argues; code makes sure the result is a sane portfolio.
'use strict';
const { LIMITS } = require('./config');

function enforce(chair, risk, meta) {
  const notes = [], vetoed = new Set((risk?.vetoes || []).map((v) => v.ticker.toUpperCase()));
  const capOf = Object.fromEntries((risk?.caps || []).map((c) => [c.ticker.toUpperCase(), +c.max_weight]));
  const byT = {};
  for (const h of chair.holdings || []) {
    const t = String(h.ticker || '').toUpperCase().trim();
    if (!meta[t]) { notes.push(`${t} is not in the universe and was dropped.`); continue; }
    if (vetoed.has(t)) { notes.push(`${t} was vetoed by the risk manager and was dropped.`); continue; }
    if (!(h.weight > 0)) continue;
    if (byT[t]) byT[t].weight += +h.weight; else byT[t] = { ...h, ticker: t, weight: +h.weight };
  }
  let list = Object.values(byT).sort((a, b) => b.weight - a.weight);
  if (list.length > LIMITS.maxPositions) { notes.push(`Trimmed to the ${LIMITS.maxPositions} largest positions.`); list = list.slice(0, LIMITS.maxPositions); }

  let cash = Math.max(+chair.cash_pct || 0, +risk?.min_cash_pct || 0, 0);
  cash = Math.min(cash, LIMITS.maxCash);
  const secCap = Math.min(LIMITS.maxSector, +risk?.max_sector_pct > 0 ? +risk.max_sector_pct : Infinity);
  const cap = (h) => Math.min(meta[h.ticker][3] === 'E' ? LIMITS.maxEtf : LIMITS.maxStock, capOf[h.ticker] ?? Infinity);
  const sec = (h) => meta[h.ticker][2];

  // Water-filling: scale to the investable total, clip to caps, hand the excess to names with room, repeat.
  for (let pass = 0; pass < 2; pass++) {
    const S = 100 - cash, tot = list.reduce((a, h) => a + h.weight, 0) || 1;
    list.forEach((h) => { h.weight = (h.weight / tot) * S; });
    for (let it = 0; it < 30; it++) {
      list.forEach((h) => { h.weight = Math.min(h.weight, cap(h)); });
      const sums = {}; list.forEach((h) => { sums[sec(h)] = (sums[sec(h)] || 0) + h.weight; });
      for (const [s, v] of Object.entries(sums)) if (v > secCap && s !== 'Broad market') { const k = secCap / v; list.filter((h) => sec(h) === s).forEach((h) => { h.weight *= k; }); }
      const short = S - list.reduce((a, h) => a + h.weight, 0);
      if (short < 0.01) break;
      const sums2 = {}; list.forEach((h) => { sums2[sec(h)] = (sums2[sec(h)] || 0) + h.weight; });
      const room = list.filter((h) => h.weight < cap(h) - 1e-6 && (sums2[sec(h)] < secCap - 1e-6 || sec(h) === 'Broad market'));
      const rt = room.reduce((a, h) => a + h.weight, 0);
      if (!room.length || rt <= 0) { cash += short; notes.push(`Limits left ${short.toFixed(1)}% unallocated; it was moved to cash.`); break; }
      room.forEach((h) => { h.weight += (short * h.weight) / rt; });
    }
    const small = list.filter((h) => h.weight < LIMITS.minWeight);
    if (!small.length) break;
    small.forEach((h) => notes.push(`${h.ticker} fell below ${LIMITS.minWeight}% after limits and was dropped.`));
    list = list.filter((h) => h.weight >= LIMITS.minWeight);
  }
  if (cash > LIMITS.maxCash) notes.push(`Cash is ${cash.toFixed(1)}%, above the usual ${LIMITS.maxCash}% ceiling, because the limits left no room.`);
  if (list.length < LIMITS.minPositions) notes.push(`Only ${list.length} positions survived; the minimum is ${LIMITS.minPositions}. Kept as decided, flagged for review.`);
  list.forEach((h) => { h.weight = Math.round(h.weight * 100) / 100; });
  cash = Math.round((100 - list.reduce((a, h) => a + h.weight, 0)) * 100) / 100;
  return { holdings: list, cash_pct: cash, notes };
}

/* Average of the seats' final proposals, weighted equally. Shown as "consensus"; it is a view, not a decision. */
function consensus(proposals) {
  const w = {}, votes = {};
  const seats = Object.values(proposals).filter(Boolean);
  for (const p of seats) {
    const tot = (p.picks || []).reduce((a, x) => a + Math.max(0, +x.weight || 0), 0) || 1, inv = 100 - Math.min(100, Math.max(0, +p.cash_pct || 0));
    for (const x of p.picks || []) { const t = String(x.ticker).toUpperCase(); w[t] = (w[t] || 0) + (Math.max(0, +x.weight || 0) / tot) * inv / seats.length; votes[t] = (votes[t] || 0) + 1; }
  }
  return Object.entries(w).map(([t, weight]) => ({ ticker: t, weight, votes: votes[t] })).sort((a, b) => b.weight - a.weight);
}

module.exports = { enforce, consensus };
