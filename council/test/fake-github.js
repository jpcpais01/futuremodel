// A small stand-in for GitHub's Contents API, enough to test account sync between two devices offline.
const http = require('http'), crypto = require('crypto');
function fakeGitHub(port, token = 'test-token') {
  const files = new Map();   // path -> text
  const sha = (t) => crypto.createHash('sha1').update('blob ' + Buffer.byteLength(t) + '\0' + t).digest('hex');
  let puts = 0;
  const srv = http.createServer((req, res) => {
    const send = (code, body, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (req.headers.authorization !== 'Bearer ' + token) return send(401, { message: 'Bad credentials' });
    const m = req.url.match(/^\/repos\/[^/]+\/[^/]+\/contents\/?(.*)$/); if (!m) return send(404, { message: 'Not Found' });
    const p = decodeURIComponent(m[1]).replace(/\/$/, '');
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      if (req.method === 'GET') {
        if (files.has(p)) {
          const t = files.get(p), tag = '"' + sha(t) + '"';
          if (/raw/.test(req.headers.accept || '')) { if (req.headers['if-none-match'] === tag) return send(304, ''); return send(200, t, { etag: tag, 'content-type': 'text/plain' }); }
          return send(200, { type: 'file', path: p, name: p.split('/').pop(), sha: sha(t) });
        }
        const pre = p ? p + '/' : '', kids = new Map();
        for (const k of files.keys()) if (k.startsWith(pre)) { const rest = k.slice(pre.length), name = rest.split('/')[0]; kids.set(name, rest.includes('/') ? { type: 'dir', name, path: pre + name, sha: 'd' } : { type: 'file', name, path: k, sha: sha(files.get(k)) }); }
        if (!kids.size) return send(404, { message: 'Not Found' });
        return send(200, [...kids.values()]);
      }
      if (req.method === 'PUT') {
        const j = JSON.parse(body), cur = files.get(p);
        if (cur != null && j.sha !== sha(cur)) return send(cur != null && !j.sha ? 422 : 409, { message: 'sha mismatch' });
        const t = Buffer.from(j.content, 'base64').toString('utf8'); files.set(p, t); puts++;
        return send(cur != null ? 200 : 201, { content: { path: p, sha: sha(t) } });
      }
      send(405, { message: 'no' });
    });
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ files, close: () => srv.close(), puts: () => puts })));
}
module.exports = { fakeGitHub };
