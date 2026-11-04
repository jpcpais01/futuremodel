// Where the engine keeps its files. In the apps everything lives in memory (the repository on GitHub is the real store);
// on the command line a folder on disk is used (store-fs.js). The engine itself never touches a file system.
'use strict';

/* A backend is { read(rel) -> string|null, write(rel, text), list(dir) -> names, age(rel) -> ms }. */
function memory() {
  const files = new Map(), times = new Map();
  return {
    read: (rel) => (files.has(rel) ? files.get(rel) : null),
    write: (rel, text) => { files.set(rel, text); times.set(rel, Date.now()); },
    list: (dir) => { const pre = dir.replace(/\/$/, '') + '/'; return [...files.keys()].filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map((k) => k.slice(pre.length)); },
    age: (rel) => (times.has(rel) ? Date.now() - times.get(rel) : Infinity),
    files,
  };
}

let B = memory();
function use(backend) { B = backend; return B; }
function backend() { return B; }

function readJSON(rel, fallback = null) { const t = B.read(rel); if (t == null) return fallback; try { return JSON.parse(t); } catch { return fallback; } }
function writeJSON(rel, obj) { B.write(rel, JSON.stringify(obj)); }
function readText(rel) { return B.read(rel); }
function writeText(rel, text) { B.write(rel, text); }
function readLines(rel) { const t = B.read(rel); if (!t) return []; return t.split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
function writeLines(rel, arr) { B.write(rel, arr.map((o) => JSON.stringify(o) + '\n').join('')); }
function appendLine(rel, obj) { B.write(rel, (B.read(rel) || '') + JSON.stringify(obj) + '\n'); }
function list(dir) { try { return B.list(dir); } catch { return []; } }
function age(rel) { return B.age(rel); }

module.exports = { memory, use, backend, readJSON, writeJSON, readText, writeText, readLines, writeLines, appendLine, list, age };
