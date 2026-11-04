// What code does after the chair decides: keep names in the universe, apply the risk manager's rulings from this
// meeting (vetoes, caps, minimum cash, sector ceiling), and make the weights add up to 100. There are no fixed limits.
'use strict';

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

  let cash = Math.max(+chair.cash_pct || 0, +risk?.min_cash_pct || 0, 0);
  cash = Math.min(cash, 100);
  const secCap = +risk?.max_sector_pct > 0 ? +risk.max_sector_pct : Infinity;
  const cap = (h) => capOf[h.ticker] ?? Infinity;
  const sec = (h) => meta[h.ticker][2];

  // Water-filling: scale to the investable total, clip to caps, hand the excess to names with room, repeat.
  {
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
      if (!room.length || rt <= 0) { cash += short; notes.push(`The risk manager's caps left ${short.toFixed(1)}% unallocated; it was moved to cash.`); break; }
      room.forEach((h) => { h.weight += (short * h.weight) / rt; });
    }
  }
  list = list.filter((h) => h.weight >= 0.005);
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
