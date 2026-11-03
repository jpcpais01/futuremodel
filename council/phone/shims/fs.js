// The engine's files live in the app's private storage on the phone. Every call goes to the native bridge (or, in a desktop browser test, to memory).
import { host } from '../host.js';
const rel = (p) => { const r = String(p).replace(/^\/data\/?/, ''); if (r.split('/').includes('..')) throw new Error('bad path'); return r; };
const enoent = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
export function readFileSync(p) { const t = host.fsRead(rel(p)); if (t == null) throw enoent(p); return t; }
export function writeFileSync(p, text) { if (!host.fsWrite(rel(p), String(text))) throw new Error('write failed: ' + p); }
export function appendFileSync(p, text) { if (!host.fsAppend(rel(p), String(text))) throw new Error('append failed: ' + p); }
export function renameSync(a, b) { if (!host.fsRename(rel(a), rel(b))) throw new Error('rename failed: ' + a); }
export function mkdirSync(p) { host.fsMkdirs(rel(p)); }
export function readdirSync(p) { const j = host.fsList(rel(p)); if (j == null) throw enoent(p); return JSON.parse(j); }
export function statSync(p) { const m = Number(host.fsMtime(rel(p))); if (!(m >= 0)) throw enoent(p); return { mtimeMs: m }; }
export function existsSync(p) { return Number(host.fsMtime(rel(p))) >= 0; }
export default { readFileSync, writeFileSync, appendFileSync, renameSync, mkdirSync, readdirSync, statSync, existsSync };
