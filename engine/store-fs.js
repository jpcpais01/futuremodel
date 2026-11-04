// A folder on disk as the engine's store (command line and tests only). Writes are atomic.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function fsBackend(root) {
  const p = (rel) => path.join(root, rel);
  return {
    root,
    p,
    read: (rel) => { try { return fs.readFileSync(p(rel), 'utf8'); } catch { return null; } },
    write: (rel, text) => { const f = p(rel); fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, f); },
    list: (dir) => { try { return fs.readdirSync(p(dir)); } catch { return []; } },
    age: (rel) => { try { return Date.now() - fs.statSync(p(rel)).mtimeMs; } catch { return Infinity; } },
  };
};
