// The market calendar: what is coming in the next few weeks. Free public sources only.
//  - FOMC decisions from the Federal Reserve's own calendar page (with this year's dates kept as a fallback).
//  - US economic releases (jobs, CPI, PPI, PCE, GDP, retail sales, ISM...) from Nasdaq's public calendar.
//  - Earnings of the companies in the universe from Nasdaq's public earnings calendar.
//  - Options expiry, quad witching, market holidays and early closes, worked out from the exchange's rules.
// Every source is optional: what fails is left out, and the rule-based dates are always there.
'use strict';
const net = require('../net');
const C = require('../config');

const DAY = 864e5;
const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d, 12));
const addDays = (s, n) => iso(new Date(Date.parse(s + 'T12:00:00Z') + n * DAY));
const dow = (s) => new Date(s + 'T12:00:00Z').getUTCDay();
const nyToday = (ts = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));

/* ── Rules: holidays, early closes, expiries ──────────────────────────────── */
function nthWeekday(y, m, wd, n) { const first = utc(y, m, 1), off = (wd - first.getUTCDay() + 7) % 7; return utc(y, m, 1 + off + (n - 1) * 7); }
function lastWeekday(y, m, wd) { const last = utc(y, m + 1, 0), off = (last.getUTCDay() - wd + 7) % 7; return utc(y, m, last.getUTCDate() - off); }
function easter(y) {   // anonymous Gregorian computus
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, mo - 1, da);
}
const observed = (d) => { const w = d.getUTCDay(); return w === 6 ? new Date(+d - DAY) : w === 0 ? new Date(+d + DAY) : d; };
/* NYSE full-day closures for a year, as { date: name }. */
function holidays(y) {
  const H = {};
  const nyd = utc(y, 0, 1); if (nyd.getUTCDay() !== 6) H[iso(observed(nyd))] = "New Year's Day";   // a Saturday New Year is not made up
  H[iso(nthWeekday(y, 0, 1, 3))] = 'Martin Luther King Jr. Day';
  H[iso(nthWeekday(y, 1, 1, 3))] = "Presidents' Day";
  H[iso(new Date(+easter(y) - 2 * DAY))] = 'Good Friday';
  H[iso(lastWeekday(y, 4, 1))] = 'Memorial Day';
  H[iso(observed(utc(y, 5, 19)))] = 'Juneteenth';
  H[iso(observed(utc(y, 6, 4)))] = 'Independence Day';
  H[iso(nthWeekday(y, 8, 1, 1))] = 'Labor Day';
  H[iso(nthWeekday(y, 10, 4, 4))] = 'Thanksgiving';
  H[iso(observed(utc(y, 11, 25)))] = 'Christmas';
  return H;
}
const isHoliday = (s) => !!holidays(+s.slice(0, 4))[s];
const isTradingDay = (s) => dow(s) % 6 !== 0 && !isHoliday(s);
/* 1pm closes: the day after Thanksgiving, Christmas Eve and July 3 when they are trading days. */
function earlyCloses(y) {
  const E = {}, add = (d, why) => { const s = iso(d); if (isTradingDay(s)) E[s] = why; };
  add(new Date(+nthWeekday(y, 10, 4, 4) + DAY), 'Early close (1pm) after Thanksgiving');
  add(utc(y, 11, 24), 'Early close (1pm), Christmas Eve');
  if (utc(y, 6, 4).getUTCDay() !== 6 && utc(y, 6, 4).getUTCDay() !== 0) add(utc(y, 6, 3), 'Early close (1pm) before Independence Day');
  return E;
}
function ruleEvents(from, to) {
  const out = [];
  for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
    for (const [d, n] of Object.entries(holidays(y))) out.push({ date: d, kind: 'market', tier: 2, title: 'Market closed', detail: n });
    for (const [d, n] of Object.entries(earlyCloses(y))) out.push({ date: d, kind: 'market', tier: 3, title: 'Early close', detail: n });
    for (let m = 0; m < 12; m++) {
      let d = iso(nthWeekday(y, m, 5, 3));
      if (isHoliday(d)) d = addDays(d, -1);   // a holiday Friday moves expiry to Thursday
      const quad = m % 3 === 2;
      out.push({ date: d, kind: 'market', tier: quad ? 2 : 3, title: quad ? 'Quad witching' : 'Monthly options expiry',
        detail: quad ? 'Stock and index options and futures all expire. Heavy volume and index rebalancing flows.' : 'Monthly stock and index options expire. Volume and pinning around big strikes.' });
    }
  }
  return out.filter((e) => e.date >= from && e.date <= to);
}

/* ── FOMC ─────────────────────────────────────────────────────────────────── */
// Decision days (the second day of each meeting). Used when the Fed's page cannot be read.
const FOMC_KNOWN = { '2026-01-28': 0, '2026-03-18': 1, '2026-04-29': 0, '2026-06-17': 1, '2026-07-29': 0, '2026-09-16': 1, '2026-10-28': 0, '2026-12-09': 1 };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/* Reads the Fed's calendar page: returns { 'YYYY-MM-DD': hasProjections }. */
function parseFomc(html) {
  const out = {}, parts = html.split(/<h4><a id="\d+">\s*(\d{4}) FOMC Meetings/);
  for (let i = 1; i < parts.length; i += 2) {
    const y = +parts[i], sect = parts[i + 1];
    const re = /fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g;
    let m;
    while ((m = re.exec(sect))) {
      const mon = m[1].trim().toLowerCase(), dt = m[2].trim();
      if (/notation|unscheduled|cancel/i.test(dt)) continue;
      const dm = /^(\d{1,2})(?:\s*-\s*(\d{1,2}))?(\*)?/.exec(dt); if (!dm) continue;
      const months = mon.split('/').map((x) => MONTHS.findIndex((n) => n.startsWith(x.trim().slice(0, 3))));
      const mi = months[months.length - 1]; if (mi < 0) continue;
      out[iso(utc(y, mi, +(dm[2] || dm[1])))] = !!dm[3];
    }
  }
  return out;
}
async function fomc(signal) {
  try { const html = await net.get('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', { signal, tries: 2, timeout: 15000 }); const p = parseFomc(html); if (Object.keys(p).length >= 4) return { ...FOMC_KNOWN, ...p }; } catch (e) { if (signal?.aborted) throw e; }
  return FOMC_KNOWN;
}
const fomcEvents = (map, from, to) => Object.entries(map).filter(([d]) => d >= from && d <= to).map(([d, sep]) => ({
  date: d, kind: 'fed', tier: 1, time: '2:00pm ET', title: 'Fed rate decision',
  detail: sep ? 'FOMC statement at 2pm, new economic projections and the dot plot, then the press conference at 2:30pm.' : 'FOMC statement at 2pm, then the press conference at 2:30pm.' }));

/* ── US economic releases (Nasdaq) ─────────────────────────────────────────── */
// The releases that move markets, by the name Nasdaq gives them.
const MACRO = [
  [/^Nonfarm Payrolls$/, 'Jobs report', 1, 'Nonfarm payrolls and the unemployment rate for last month.'],
  [/^CPI$/, 'CPI inflation', 1, 'Consumer prices for last month, headline and core.'],
  [/^PPI$/, 'PPI inflation', 2, 'Producer prices for last month.'],
  [/^(Core )?PCE Price Index/, 'PCE inflation', 1, "Personal consumption prices: the Fed's preferred inflation gauge."],
  [/^GDP( \(QoQ\)| Growth Rate| Annualized)?$|^GDP$/, 'GDP', 1, 'Growth of the US economy, quarter on quarter, annualised.'],
  [/^Retail Sales$/, 'Retail sales', 2, 'Consumer spending at stores and online for last month.'],
  [/^ISM Manufacturing PMI$/, 'ISM manufacturing', 2, 'Survey of factory activity; above 50 means expansion.'],
  [/^ISM (Non-Manufacturing|Services) PMI$/, 'ISM services', 2, 'Survey of services activity; above 50 means expansion.'],
  [/^JOLTs Job Openings$/, 'Job openings (JOLTS)', 3, 'Open positions across the economy.'],
  [/^Michigan Consumer Sentiment$/, 'Consumer sentiment', 3, 'University of Michigan survey, with inflation expectations.'],
  [/^CB Consumer Confidence$/, 'Consumer confidence', 3, 'Conference Board survey of households.'],
  [/^ADP Nonfarm Employment Change$/, 'ADP jobs', 3, 'Private payrolls estimate, two days before the jobs report.'],
  [/^FOMC Meeting Minutes$/, 'Fed minutes', 2, "The minutes of the Fed's last meeting."],
  [/^Fed Chair .* Speaks$|^Fed Chair Speaks$/, 'Fed chair speaks', 2, 'Remarks by the Fed chair.'],
];
const NASDAQ_HDR = { Accept: 'application/json, text/plain, */*' };
/* Nasdaq lists a day's US releases under the next day's date, so the day asked for is shifted back by one. */
async function macroDay(day, signal) {
  const j = await net.getJSON(`https://api.nasdaq.com/api/calendar/economicevents?date=${addDays(day, 1)}`, { signal, tries: 2, timeout: 12000, headers: NASDAQ_HDR });
  const seen = new Set(), out = [];
  for (const r of j?.data?.rows || []) {
    if (r.country !== 'United States') continue;
    const name = String(r.eventName || '').trim(), hit = MACRO.find(([re]) => re.test(name));
    if (!hit || seen.has(hit[1])) continue;
    seen.add(hit[1]);
    const cons = String(r.consensus || '').replace(/&nbsp;/g, '').trim(), prev = String(r.previous || '').replace(/&nbsp;/g, '').trim();
    out.push({ date: day, kind: 'macro', tier: hit[2], title: hit[1], expected: cons || undefined, detail: hit[3] + (cons ? ` Expected ${cons}.` : '') + (prev ? ` Last ${prev}.` : '') });
  }
  return out;
}

/* ── Earnings (Nasdaq) ─────────────────────────────────────────────────────── */
const SYM = (() => { const m = {}; for (const [t] of C.UNIVERSE) { m[t] = t; m[t.replace('-', '.')] = t; m[t.replace('-', '/')] = t; } return m; })();
const WHEN = { 'time-pre-market': 'before the open', 'time-after-hours': 'after the close' };
async function earningsDay(day, signal) {
  const j = await net.getJSON(`https://api.nasdaq.com/api/calendar/earnings?date=${day}`, { signal, tries: 2, timeout: 12000, headers: NASDAQ_HDR });
  const out = [];
  for (const r of j?.data?.rows || []) {
    const t = SYM[String(r.symbol || '').trim().toUpperCase()]; if (!t) continue;
    const u = C.UNIVERSE.find((x) => x[0] === t), eps = String(r.epsForecast || '').trim();
    out.push({ date: day, kind: 'earnings', tier: 2, ticker: t, title: `${u[1]} earnings`, when: WHEN[r.time] || '',
      detail: [WHEN[r.time] ? `Reports ${WHEN[r.time]}.` : '', eps && eps !== '--' ? `EPS expected ${eps}.` : '', r.fiscalQuarterEnding ? `Quarter ending ${r.fiscalQuarterEnding}.` : ''].filter(Boolean).join(' ') });
  }
  return out;
}

/* ── Everything together ───────────────────────────────────────────────────── */
let cache = null;
const TTL = 6 * 3600e3;
/* The next `days` calendar days, starting today in New York. Cached for six hours. */
async function upcoming({ days = 28, signal, fresh = false } = {}) {
  const from = nyToday(), to = addDays(from, days);
  if (!fresh && cache && cache.from === from && cache.days >= days && Date.now() - cache.at < TTL) return slice(cache, from, to);
  const weekdays = []; for (let d = from; d <= to; d = addDays(d, 1)) if (isTradingDay(d)) weekdays.push(d);
  const sources = { fed: 'rules', macro: 0, earnings: 0 };
  const [fmap, macro, earn] = await Promise.all([
    fomc(signal).then((m) => { sources.fed = m === FOMC_KNOWN ? 'kept dates' : 'federalreserve.gov'; return m; }),
    net.pool(weekdays, 2, (d) => macroDay(d, signal).then((x) => { sources.macro++; return x; }, () => [])),
    net.pool(weekdays, 2, (d) => earningsDay(d, signal).then((x) => { sources.earnings++; return x; }, () => [])),
  ]);
  const events = [...fomcEvents(fmap, from, to), ...macro.flat(), ...earn.flat(), ...ruleEvents(from, to)];
  // The jobs report is nearly always the first Friday. If Nasdaq has nothing for a month, show the usual date, marked as such.
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (dow(d) !== 5 || +d.slice(8) > 7 || !isTradingDay(d)) continue;
    const ym = d.slice(0, 7);
    if (!events.some((e) => e.title === 'Jobs report' && e.date.startsWith(ym)) && sources.macro < weekdays.length * 0.5)
      events.push({ date: d, kind: 'macro', tier: 1, title: 'Jobs report', usual: true, detail: 'Nonfarm payrolls and the unemployment rate. Usual date (first Friday); not confirmed.' });
  }
  const KORD = { fed: 0, macro: 1, market: 2, earnings: 3 };
  events.sort((a, b) => a.date.localeCompare(b.date) || a.tier - b.tier || KORD[a.kind] - KORD[b.kind] || a.title.localeCompare(b.title));
  cache = { at: Date.now(), from, days, events, sources: { ...sources, days: weekdays.length } };
  return slice(cache, from, to);
}
const slice = (c, from, to) => ({ asOf: c.at, from, to, sources: c.sources, events: c.events.filter((e) => e.date >= from && e.date <= to) });

/* For the market book: a compact view of the next three weeks, one line per day. */
function brief(cal, { days = 21 } = {}) {
  if (!cal?.events?.length) return '';
  const to = addDays(cal.from, days), byDay = {};
  for (const e of cal.events) if (e.date <= to && e.tier <= 2) (byDay[e.date] ||= []).push(e);
  const L = ['## Calendar, next three weeks', 'Scheduled events that can move prices. Dates from the Federal Reserve, Nasdaq\'s public calendars and exchange rules; check anything decisive. Earnings are for companies in the universe.'];
  for (const [d, es] of Object.entries(byDay)) {
    const lbl = new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const big = es.filter((e) => e.kind !== 'earnings').map((e) => e.title === 'Market closed' ? `Market closed (${e.detail})` : e.title + (e.usual ? ' (usual date)' : '') + (e.expected ? ` (expected ${e.expected})` : ''));
    const earn = es.filter((e) => e.kind === 'earnings').map((e) => C.label(e.ticker) + (e.when === 'before the open' ? ' (pre)' : e.when === 'after the close' ? ' (post)' : ''));
    L.push(`- ${lbl}: ${[...big, earn.length ? 'Earnings: ' + earn.join(', ') : ''].filter(Boolean).join('; ')}`);
  }
  return L.join('\n');
}

module.exports = { upcoming, brief, holidays, isTradingDay, ruleEvents, parseFomc, _reset: () => { cache = null; } };
