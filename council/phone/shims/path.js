// The few path helpers the engine uses, for forward-slash paths.
const norm = (p) => { const abs = p.startsWith('/'), out = []; for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return (abs ? '/' : '') + out.join('/'); };
export const sep = '/';
export function join(...parts) { return norm(parts.filter((x) => x !== '').join('/')); }
export function dirname(p) { const n = norm(p), i = n.lastIndexOf('/'); return i <= 0 ? (n.startsWith('/') ? '/' : '.') : n.slice(0, i); }
export function basename(p) { return norm(p).split('/').pop(); }
export default { sep, join, dirname, basename };
