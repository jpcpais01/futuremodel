// Free news: Google News and Yahoo Finance RSS per company, plus Fed, CNBC and market feeds for the macro brief.
'use strict';
const { get, pool } = require('../net');
const store = require('../store');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const dec = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m)).replace(/\s+/g, ' ').trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? dec(m[1]) : ''; };

function parseRSS(xml, src) {
  const out = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const x = m[0];
    let title = tag(x, 'title'), source = tag(x, 'source') || src;
    // Google News appends " - Publisher" to every headline.
    const dash = title.lastIndexOf(' - ');
    if (dash > 20 && /google/i.test(src)) { source = title.slice(dash + 3); title = title.slice(0, dash); }
    const t = Date.parse(tag(x, 'pubDate') || tag(x, 'dc:date') || tag(x, 'updated'));
    if (title) out.push({ title, source, t: Number.isFinite(t) ? t : null, link: tag(x, 'link') });
  }
  return out;
}

async function feed(url, src, { signal } = {}) {
  try { return parseRSS(await get(url, { signal, tries: 2, timeout: 15000 }), src); } catch (e) { if (signal?.aborted) throw e; return []; }
}

function tidy(items, days, cutoff, max) {
  const seen = new Set(), from = cutoff - days * 864e5;
  return items.filter((x) => x.t && x.t >= from && x.t <= cutoff)
    .sort((a, b) => b.t - a.t)
    .filter((x) => { const k = x.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 70); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max);
}

/* Headlines per ticker from the last `days` days, newest first. Only items published before `cutoff` are kept. */
async function companyNews(universe, { signal, days = 10, max = 10, cutoff = Date.now(), onProgress = () => {} } = {}) {
  const rel = 'news/companies.json';
  const c = store.readJSON(rel);
  if (c && store.age(rel) < 3 * 3600e3 && universe.every(([t]) => c[t])) return c;
  const out = {}; let done = 0;
  await pool(universe, 3, async ([t, name, , kind]) => {
    const q = kind === 'E' ? `"${t}" ETF` : `"${name.replace(/&/g, 'and')}" OR "${t}" stock`;
    const g = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ` when:${days}d`)}&hl=en-US&gl=US&ceid=US:en`;
    let items = await feed(g, 'Google News', { signal });
    if (items.length < 3) items = items.concat(await feed(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(t)}&region=US&lang=en-US`, 'Yahoo Finance', { signal }));
    out[t] = tidy(items, days, cutoff, max).map(({ title, source, t: ts }) => ({ title, source, t: ts }));
    onProgress(++done, universe.length);
  });
  store.writeJSON(rel, out);
  return out;
}

async function macroNews(feeds, { signal, days = 7, max = 60, cutoff = Date.now() } = {}) {
  const all = (await pool(feeds, 3, ([src, url]) => feed(url, src, { signal }))).flat();
  return tidy(all, days, cutoff, max).map(({ title, source, t }) => ({ title, source, t }));
}

module.exports = { companyNews, macroNews, parseRSS };
