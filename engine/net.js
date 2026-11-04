// HTTP with timeouts, retries with backoff, and per-host pacing so free sources are never hammered.
'use strict';

const HOST_GAP = {                       // minimum milliseconds between requests to the same host
  'query1.finance.yahoo.com': 350, 'query2.finance.yahoo.com': 350, 'feeds.finance.yahoo.com': 400,
  'news.google.com': 700, 'www.sec.gov': 160, 'data.sec.gov': 160, 'api.gdeltproject.org': 5500,
  'fred.stlouisfed.org': 250, 'cdn.cboe.com': 200,
};
const lastHit = new Map();
const chains = new Map();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Requests to one host run one after another, spaced by HOST_GAP. */
function paced(host, fn) {
  const prev = chains.get(host) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const gap = HOST_GAP[host] ?? 120, since = Date.now() - (lastHit.get(host) || 0);
    if (since < gap) await wait(gap - since);
    lastHit.set(host, Date.now());
    return fn();
  });
  chains.set(host, next.catch(() => {}));
  return next;
}

/* The SEC asks automated readers for a contact. In the apps the host adds this header (a web page cannot). */
const SEC_DEFAULT = 'OazyResearch/3.0 (personal research) 158115534+jpcpais01@users.noreply.github.com';
let secAgent = SEC_DEFAULT;
function setSecContact(contact) { secAgent = contact ? `OazyResearch/3.0 ${contact}` : SEC_DEFAULT; }
/* In a web view, forbidden headers are left to the host, and fetch can be swapped (tests). */
const IN_PAGE = typeof window !== 'undefined' && typeof document !== 'undefined';
let doFetch = (...a) => fetch(...a);
function setFetch(fn) { doFetch = fn; }

async function get(url, { as = 'text', tries = 4, timeout = 25000, headers = {}, method = 'GET', body, signal } = {}) {
  const host = new URL(url).host;
  // SEC asks automated clients to identify themselves. Everyone else gets the runtime's default agent.
  const h0 = /sec\.gov$/.test(host) && !IN_PAGE ? { 'User-Agent': secAgent, 'Accept-Encoding': 'gzip, deflate', ...headers } : headers;
  const h = IN_PAGE ? Object.fromEntries(Object.entries(h0).filter(([k]) => !/^(user-agent|accept-encoding)$/i.test(k))) : h0;   // the host adds these in the apps
  let err;
  for (let i = 0; i < tries; i++) {
    if (signal?.aborted) throw new Error('cancelled');
    try {
      const res = await paced(host, async () => {
        const ac = new AbortController(), to = setTimeout(() => ac.abort(), timeout);
        const stop = () => ac.abort(); signal?.addEventListener('abort', stop);
        try { return await doFetch(url, { method, headers: h, body, signal: ac.signal, redirect: 'follow' }); }
        finally { clearTimeout(to); signal?.removeEventListener('abort', stop); }
      });
      if (res.status === 429 || res.status >= 500) { err = new Error(`HTTP ${res.status} ${host}`); await wait(1500 * 2 ** i + Math.random() * 500); continue; }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${host}`), { fatal: true });
      return as === 'json' ? await res.json() : await res.text();
    } catch (e) {
      if (e.fatal || signal?.aborted) throw e;
      err = e; await wait(800 * 2 ** i);
    }
  }
  throw err;
}
const getJSON = (url, o = {}) => get(url, { ...o, as: 'json' });
const postJSON = (url, obj, o = {}) => get(url, { ...o, as: 'json', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

/* Runs async jobs with a concurrency cap; per-host pacing still applies underneath. */
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

module.exports = { get, getJSON, postJSON, pool, wait, setSecContact, setFetch, secAgent: () => secAgent, SEC_DEFAULT };
