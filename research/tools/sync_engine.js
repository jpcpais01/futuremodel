// The council engine lives in ../council/engine (shared with the phone app). Oazy Research ships a copy of it.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', '..', 'council', 'engine'), dst = path.join(__dirname, '..', 'engine');
if (!fs.existsSync(src)) { if (fs.existsSync(dst)) { console.log('engine: using the existing copy'); process.exit(0); } throw new Error('council/engine not found next to research/'); }
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, filter: (p) => !/cli\.js$/.test(p) });
console.log('engine: copied from', src);
