// Fundamentals and filings straight from SEC EDGAR, free and official.
// Frames give one concept for every company in one call, so 9 quarters x a few concepts covers the whole universe.
'use strict';
const { getJSON, pool } = require('../net');
const store = require('../store');

const REVENUE = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenuesNetOfInterestExpense', 'SalesRevenueNet'];
const ITEMS = {
  '1.01': 'material agreement', '1.02': 'agreement terminated', '1.03': 'bankruptcy', '2.01': 'acquisition or disposal completed',
  '2.02': 'earnings results', '2.03': 'new debt', '2.05': 'restructuring costs', '2.06': 'impairment', '3.01': 'listing notice',
  '4.02': 'past financials unreliable', '5.02': 'executive or director change', '5.07': 'shareholder vote', '7.01': 'Reg FD disclosure', '8.01': 'other event',
};

async function cikMap(signal) {
  const rel = 'sec/tickers.json';
  const c = store.readJSON(rel);
  if (c && store.age(rel) < 30 * 864e5) return c;
  const j = await getJSON('https://www.sec.gov/files/company_tickers.json', { signal });
  const m = {};
  Object.values(j).forEach((x) => { m[x.ticker.toUpperCase()] = x.cik_str; });
  store.writeJSON(rel, m);
  return m;
}


/* One concept for one company, every fact it ever filed. Cached until the company files a new 10-Q or 10-K. */
async function concept(cik, tax, name, unit, freshAfter, signal) {
  const rel = `sec/concept/${cik}_${name}.json`;
  const c = store.readJSON(rel);
  if (c && c.at > freshAfter && Date.now() - c.at < 10 * DAY) return c.facts;
  try {
    const j = await getJSON(`https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, '0')}/${tax}/${name}.json`, { signal, tries: 2 });
    const facts = (j.units?.[unit] || []).map((f) => ({ s: f.start, e: f.end, v: f.val, f: f.filed }));
    store.writeJSON(rel, { at: Date.now(), facts });
    return facts;
  } catch (e) {
    if (signal?.aborted) throw e;
    if (/HTTP 404/.test(e.message)) { store.writeJSON(rel, { at: Date.now(), facts: [] }); return []; }
    return c?.facts || [];
  }
}

const DAY = 864e5, dur = (f) => (Date.parse(f.e) - Date.parse(f.s)) / DAY;
/* Turns 10-Q and 10-K facts (discrete quarters and year-to-date figures alike) into a clean quarterly series. */
function quarterly(facts) {
  const best = new Map();
  for (const f of facts) { if (!f.s) continue; const k = f.s + '|' + f.e; if (!best.has(k) || best.get(k).f < f.f) best.set(k, f); }
  const q = new Map(), add = (end, start, v, direct) => { const cur = q.get(end); if (!cur || (direct && !cur.direct)) q.set(end, { e: end, s: start, v, direct }); };
  const all = [...best.values()];
  for (const f of all) if (dur(f) >= 80 && dur(f) <= 100) add(f.e, f.s, f.v, true);
  // Year-to-date figures share a start date; the difference between consecutive ones is a quarter (this is how fiscal Q4 appears).
  const byStart = {};
  for (const f of all) if (dur(f) > 100 && dur(f) <= 380) (byStart[f.s] = byStart[f.s] || []).push(f);
  for (const [start, list] of Object.entries(byStart)) {
    list.sort((a, b) => a.e.localeCompare(b.e));
    const q1 = all.find((x) => x.s === start && dur(x) >= 80 && dur(x) <= 100);
    let prevEnd = q1 ? q1.e : null, prevVal = q1 ? q1.v : 0;
    for (const f of list) {
      const gap = prevEnd ? (Date.parse(f.e) - Date.parse(prevEnd)) / DAY : 0;
      if (prevEnd && gap >= 80 && gap <= 100) add(f.e, prevEnd, f.v - prevVal, false);
      prevEnd = f.e; prevVal = f.v;
    }
  }
  return [...q.values()].sort((a, b) => a.e.localeCompare(b.e));
}
/* The newest run of up to eight back-to-back quarters, oldest first. */
function lastEight(qs) {
  const out = [];
  for (let i = qs.length - 1; i >= 0 && out.length < 8; i--) {
    if (out.length) { const gap = (Date.parse(out[0].e) - Date.parse(qs[i].e)) / DAY; if (gap < 75) continue; if (gap > 105) break; }
    out.unshift(qs[i]);
  }
  return out;
}
const quarterlyShares = (facts) => { const q = facts.filter((f) => f.s && dur(f) >= 80 && dur(f) <= 100).sort((a, b) => a.e.localeCompare(b.e) || a.f.localeCompare(b.f)); return q.length ? q[q.length - 1].v : null; };
const sum4 = (q, from) => (q.length >= from + 4 ? q.slice(q.length - from - 4, q.length - from).reduce((a, x) => a + x.v, 0) : null);

/* For each ticker: trailing-twelve-month figures, growth, margins, free cash flow and shares outstanding. */
async function fundamentals(tickers, { signal, log = () => {}, latestFiling = {}, onProgress = () => {}, into = {} } = {}) {
  const map = await cikMap(signal);
  const byTicker = into; let done = 0;
  log(`SEC fundamentals for ${tickers.length} companies (cached until each files a new report)`);
  await pool(tickers, 3, async (t) => {
    if (signal?.aborted) return;
    const cik = map[t.replace('-', '.')] ?? map[t];
    if (!cik) { byTicker[t] = null; return; }
    const fresh = latestFiling[t] ? Date.parse(latestFiling[t]) + DAY : 0;
    let rev = [];
    for (const c of REVENUE) {
      const f = lastEight(quarterly(await concept(cik, 'us-gaap', c, 'USD', fresh, signal)));
      if (f.length >= 4 && (!rev.length || f[f.length - 1].e > rev[rev.length - 1].e || (f[f.length - 1].e === rev[rev.length - 1].e && f.length > rev.length))) rev = f;
      if (rev.length >= 8 && Date.parse(rev[rev.length - 1].e) > Date.now() - 200 * DAY) break;
    }
    const series = async (c) => lastEight(quarterly(await concept(cik, 'us-gaap', c, 'USD', fresh, signal)));
    const ni = await series('NetIncomeLoss'), oi = await series('OperatingIncomeLoss'), gp = await series('GrossProfit');
    const ocf = await series('NetCashProvidedByUsedInOperatingActivities'), cx = await series('PaymentsToAcquirePropertyPlantAndEquipment');
    const sh = await concept(cik, 'dei', 'EntityCommonStockSharesOutstanding', 'shares', fresh, signal);
    // Companies with several share classes report one figure per class on the same date; they add up.
    const lastDate = sh.reduce((a, f) => (f.e > a ? f.e : a), '');
    const lastFiled = sh.filter((f) => f.e === lastDate).reduce((a, f) => (f.f > a ? f.f : a), '');
    const shares = lastDate ? [...new Set(sh.filter((f) => f.e === lastDate && f.f === lastFiled).map((f) => f.v))].reduce((a, v) => a + v, 0) : null;
    let sharesOut = shares > 1e7 ? shares : null;
    if (!sharesOut) {   // fall back to the diluted share count of the latest quarter
      const w = quarterlyShares(await concept(cik, 'us-gaap', 'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares', fresh, signal));
      sharesOut = w > 1e7 ? w : null;
    }
    const end = rev.length ? rev[rev.length - 1].e : null;
    const aligned = (s) => (s.length >= 4 && end && s[s.length - 1].e === end ? sum4(s, 0) : null);
    const r0 = sum4(rev, 0), r1 = sum4(rev, 4), n = rev.length;
    const yoy = (i) => (n >= i + 5 && rev[n - 5 - i].v ? rev[n - 1 - i].v / rev[n - 5 - i].v - 1 : null);
    const capexTTM = cx.length >= 4 && ocf.length && cx[cx.length - 1].e === ocf[ocf.length - 1].e ? sum4(cx, 0) : 0;
    byTicker[t] = {
      cik, asOf: end, revTTM: r0, revGrowth: r0 && r1 ? r0 / r1 - 1 : null, revGrowthQ: yoy(0), revAccel: yoy(0) != null && yoy(1) != null ? yoy(0) - yoy(1) : null,
      niTTM: aligned(ni), opTTM: aligned(oi), gpTTM: aligned(gp), fcf: ocf.length >= 4 ? sum4(ocf, 0) - capexTTM : null, shares: sharesOut,
    };
    onProgress(++done, tickers.length);
  }).catch((e) => { if (!signal?.aborted) throw e; });
  return { at: Date.now(), byTicker };
}

/* Recent 8-K filings, translated into plain words. */
async function filings(tickers, { signal, days = 45 } = {}) {
  const map = await cikMap(signal);
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const out = {}, periodic = {};
  await pool(tickers, 3, async (t) => {
    if (signal?.aborted) return;
    const cik = map[t.replace('-', '.')] ?? map[t];
    if (!cik) return;
    const rel = `sec/sub/${cik}.json`;
    let j = store.age(rel) < 12 * 3600e3 ? store.readJSON(rel) : null;
    if (!j) {
      try {
        const raw = await getJSON(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, { signal, tries: 2 });
        const r = raw.filings.recent;
        j = []; for (let i = 0; i < r.form.length && j.length < 40; i++) j.push({ f: r.form[i], d: r.filingDate[i], it: r.items[i] || '', desc: r.primaryDocDescription[i] || '' });
        store.writeJSON(rel, j);
      } catch (e) { if (signal?.aborted) throw e; return; }
    }
    periodic[t] = (j.find((x) => /^(10-Q|10-K|20-F|40-F)/.test(x.f)) || {}).d || null;
    out[t] = j.filter((x) => x.d >= since && /^(8-K|10-Q|10-K|6-K|20-F|S-1|SC 13D)/.test(x.f)).slice(0, 8).map((x) => ({
      date: x.d, form: x.f, what: x.it ? x.it.split(',').map((c) => ITEMS[c.trim()] || 'item ' + c.trim()).join(', ') : x.desc,
    }));
  });
  return { recent: out, periodic };
}

module.exports = { fundamentals, filings, quarterly, lastEight };
