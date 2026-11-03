// The phone's native side, reached through the Android bridge (window.Native).
// Opened in a desktop browser for testing, it falls back to memory, localStorage and the browser's own fetch.
const N = typeof window !== 'undefined' ? window.Native : null;

function memoryHost() {
  const files = new Map(), dirs = new Set(['']), mt = new Map();
  const touch = (r) => { mt.set(r, Date.now()); let d = r; while (d.includes('/')) { d = d.slice(0, d.lastIndexOf('/')); dirs.add(d); } };
  for (const [k, v] of Object.entries(window.__ocSeed || {})) { files.set(k, v); touch(k); }   // test fixtures
  return {
    fsRead: (r) => (files.has(r) ? files.get(r) : null),
    fsWrite: (r, t) => { files.set(r, t); touch(r); return true; },
    fsAppend: (r, t) => { files.set(r, (files.get(r) || '') + t); touch(r); return true; },
    fsRename: (a, b) => { if (!files.has(a)) return false; files.set(b, files.get(a)); files.delete(a); touch(b); return true; },
    fsMkdirs: (r) => { dirs.add(r); return true; },
    fsList: (r) => { const pre = r ? r + '/' : ''; if (r && !dirs.has(r)) return null; const out = new Set(); for (const k of [...files.keys(), ...dirs]) if (k.startsWith(pre) && k !== r) out.add(k.slice(pre.length).split('/')[0]); return JSON.stringify([...out].filter(Boolean)); },
    fsMtime: (r) => (files.has(r) ? mt.get(r) : dirs.has(r) ? 0 : -1),
    secretGet: (k) => { try { return localStorage.getItem('oc.secret.' + k) || ''; } catch { return ''; } },
    secretSet: (k, v) => { try { v ? localStorage.setItem('oc.secret.' + k, v) : localStorage.removeItem('oc.secret.' + k); } catch {} return true; },
    keepAlive: () => {}, notify: () => {}, deviceName: () => 'Phone (browser test)', native: false,
  };
}
export const host = N ? {
  fsRead: (r) => N.fsRead(r), fsWrite: (r, t) => N.fsWrite(r, t), fsAppend: (r, t) => N.fsAppend(r, t), fsRename: (a, b) => N.fsRename(a, b),
  fsMkdirs: (r) => N.fsMkdirs(r), fsList: (r) => N.fsList(r), fsMtime: (r) => N.fsMtime(r),
  secretGet: (k) => N.secretGet(k) || '', secretSet: (k, v) => N.secretSet(k, v || ''),
  keepAlive: (on, text) => N.keepAlive(!!on, text || ''), notify: (t, b) => N.notify(String(t || ''), String(b || '')), deviceName: () => N.deviceName(), native: true,
} : memoryHost();

/* fetch through the phone's own network stack: no browser CORS rules, responses streamed back in pieces. */
if (N) {
  const pending = new Map(); let seq = 0;
  const NULL_BODY = new Set([101, 204, 205, 304]);
  const b64bytes = (s) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  window.__ocNet = {
    head(id, status, headersJson) {
      const p = pending.get(id); if (!p) return;
      const headers = new Headers(); for (const [k, v] of JSON.parse(headersJson)) { try { headers.append(k, v); } catch {} }
      const body = NULL_BODY.has(status) || p.method === 'HEAD' ? null : new ReadableStream({ start: (c) => { p.ctrl = c; } });
      p.headed = true; p.resolve(new Response(body, { status, headers }));
      if (!body) { pending.delete(id); }
    },
    chunk(id, b64) { const p = pending.get(id); if (p?.ctrl) p.ctrl.enqueue(b64bytes(b64)); },
    end(id) { const p = pending.get(id); if (!p) return; pending.delete(id); try { p.ctrl?.close(); } catch {} },
    error(id, msg) { const p = pending.get(id); if (!p) return; pending.delete(id); const e = new TypeError('Network error: ' + msg); if (!p.headed) p.reject(e); else try { p.ctrl?.error(e); } catch {} },
  };
  const bodyText = async (b) => (b == null ? null : typeof b === 'string' ? b : b instanceof URLSearchParams ? b.toString() : b instanceof Blob ? b.text() : new TextDecoder().decode(b instanceof ArrayBuffer ? b : b.buffer ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : b));
  const webFetch = window.fetch.bind(window);
  window.fetch = async function nativeFetch(input, init = {}) {
    const req = input instanceof Request ? input : null, url = String(req ? req.url : input);
    if (!/^https?:/i.test(url)) return webFetch(input, init);
    const method = String(init.method || req?.method || 'GET').toUpperCase(), headers = new Headers(init.headers || req?.headers || {});
    const body = await bodyText(init.body !== undefined ? init.body : req && method !== 'GET' && method !== 'HEAD' ? await req.text() : null);
    const signal = init.signal || req?.signal;
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const p = { method, resolve, reject, ctrl: null, headed: false };
      pending.set(id, p);
      signal?.addEventListener('abort', () => {
        if (!pending.has(id)) return; pending.delete(id); N.fetchAbort(id);
        const e = new DOMException('The operation was aborted.', 'AbortError');
        if (!p.headed) reject(e); else try { p.ctrl?.error(e); } catch {}
      }, { once: true });
      N.fetchStart(id, method, url, JSON.stringify([...headers]), body == null ? null : body);
    });
  };
}
