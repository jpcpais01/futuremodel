// Where everything is kept on disk, with atomic writes so a crash never leaves a half-written file.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

/* The app and the command line share one folder: %APPDATA%\Oazy Council\data on Windows. */
function defaultRoot() {
  if (process.env.OAZY_COUNCIL_DATA) return process.env.OAZY_COUNCIL_DATA;
  const base = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
  return path.join(base, 'Oazy Council', 'data');
}
let ROOT = defaultRoot();
function setRoot(dir) { ROOT = dir; }
function root() { return ROOT; }
function p(...parts) { return path.join(ROOT, ...parts); }

function readJSON(rel, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p(rel), 'utf8')); } catch { return fallback; }
}
function writeJSON(rel, obj) {
  const f = p(rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, f);
}
function appendLine(rel, obj) {
  const f = p(rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, JSON.stringify(obj) + '\n');
}
function readLines(rel) {
  try { return fs.readFileSync(p(rel), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
function writeLines(rel, arr) {
  const f = p(rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, arr.map((o) => JSON.stringify(o) + '\n').join(''));
  fs.renameSync(tmp, f);
}
function readText(rel) { try { return fs.readFileSync(p(rel), 'utf8'); } catch { return null; } }
function list(rel) { try { return fs.readdirSync(p(rel)); } catch { return []; } }
function age(rel) { try { return Date.now() - fs.statSync(p(rel)).mtimeMs; } catch { return Infinity; } }

module.exports = { setRoot, root, p, readJSON, writeJSON, appendLine, readLines, writeLines, readText, list, age };
