// Phone link: a small read-mostly server on the home network, so the Oazy Council phone app can follow the council.
// Off by default. Every data request needs the pairing code; only local-network addresses may connect.
'use strict';
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let server = null, opts = null;
const clients = new Set();
const fails = new Map();   // ip -> { n, t }
const MOBILE = path.join(__dirname, '..', 'mobile');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

/* A pairing code people can type: 12 characters from an alphabet with no look-alikes. */
function newCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', b = crypto.randomBytes(12);
  const s = [...b].map((x) => A[x % A.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
const norm = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function same(a, b) { const x = Buffer.from(norm(a)), y = Buffer.from(norm(b)); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); }

function localIP(ip) {
  ip = String(ip || '').replace(/^::ffff:/, '');
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) || ip === '::1' || /^f[cd]|^fe80/i.test(ip);
}
function addresses(port) {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && localIP(a.address)) out.push({ name, url: `http://${a.address}:${port}` });
  return out;
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-council-code, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'X-Content-Type-Options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((ok, bad) => { let n = 0; const ch = []; req.on('data', (c) => { n += c.length; if (n > 1e4) { bad(new Error('too large')); req.destroy(); } else ch.push(c); }); req.on('end', () => { try { ok(ch.length ? JSON.parse(Buffer.concat(ch)) : {}); } catch (e) { bad(e); } }); });
}

async function handle(req, res) {
  const ip = req.socket.remoteAddress;
  if (!localIP(ip)) { res.destroy(); return; }
  if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
  const u = new URL(req.url, 'http://x'), p = u.pathname;

  // The phone app's own files, so a phone browser works too.
  if (!p.startsWith('/api/')) {
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p.slice(1));
    const f = path.join(MOBILE, rel);
    if (!f.startsWith(MOBILE + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream');
  }

  const f = fails.get(ip);
  if (f && f.n >= 10 && Date.now() - f.t < 5 * 60e3) return send(res, 429, { error: 'Too many wrong codes. Wait five minutes.' });
  if (!same(req.headers['x-council-code'] || u.searchParams.get('code'), opts.code())) {
    fails.set(ip, { n: (f && Date.now() - f.t < 5 * 60e3 ? f.n : 0) + 1, t: Date.now() });
    return send(res, 401, { error: 'Wrong pairing code.' });
  }
  fails.delete(ip);
  const api = opts.api, demo = u.searchParams.get('demo') === '1';
  try {
    if (p === '/api/hello') return send(res, 200, { ok: true, name: os.hostname(), allowRun: opts.allowRun() });
    if (p === '/api/state') return send(res, 200, await api.state());
    if (p === '/api/portfolio') return send(res, 200, await api.portfolio(demo));
    if (p === '/api/sessions') return send(res, 200, await api.sessions(demo));
    if (p === '/api/session') { const id = u.searchParams.get('id') || ''; return send(res, 200, /^S-[\d-]+$/.test(id) ? await api.session(id) : null); }
    if (p === '/api/live') return send(res, 200, api.live());
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write('retry: 3000\n\n');
      const c = { res, ping: setInterval(() => res.write(': ping\n\n'), 20e3) };
      clients.add(c); req.on('close', () => { clearInterval(c.ping); clients.delete(c); });
      return;
    }
    if (req.method === 'POST' && (p === '/api/run' || p === '/api/cancel' || p === '/api/watch')) {
      if (!opts.allowRun()) return send(res, 403, { error: 'Running the council from the phone is turned off in the desktop settings.' });
      const body = await readBody(req);
      if (p === '/api/cancel') return send(res, 200, await api.cancel());
      if (p === '/api/watch') return send(res, 200, await api.watch(!!body.demo));
      api.run(['low', 'normal', 'high'].includes(body.preset) ? body.preset : 'normal', !!body.demo).catch(() => {});
      return send(res, 202, { ok: true });
    }
    send(res, 404, { error: 'Unknown' });
  } catch (e) { send(res, 500, { error: e.message }); }
}

/* Live session events go to every connected phone. Thinking is left out: it is long and only the desktop shows it. */
function broadcast(events) {
  if (!clients.size) return;
  const list = events.filter((e) => e.type !== 'think');
  if (!list.length) return;
  const msg = `data: ${JSON.stringify(list)}\n\n`;
  for (const c of clients) c.res.write(msg);
}
function notify(kind) { for (const c of clients) c.res.write(`event: changed\ndata: ${JSON.stringify(kind)}\n\n`); }

function start(o) {
  stop(); opts = o;
  server = http.createServer((req, res) => { handle(req, res).catch(() => { try { send(res, 500, { error: 'error' }); } catch {} }); });
  server.on('error', (e) => o.onError?.(e));
  server.listen(o.port, '0.0.0.0');
  return addresses(o.port);
}
function stop() { for (const c of clients) { clearInterval(c.ping); c.res.end(); } clients.clear(); if (server) server.close(); server = null; }
const running = () => !!server;

module.exports = { start, stop, running, broadcast, notify, newCode, addresses };
