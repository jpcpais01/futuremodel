// Bundles the engine for the phone into mobile/core.bundle.js.
const path = require('path');
const sh = (n) => path.join(__dirname, 'shims', n + '.js');
require('esbuild').build({
  entryPoints: [path.join(__dirname, 'entry.js')], bundle: true, format: 'iife', platform: 'browser', target: ['chrome90'],
  outfile: path.join(__dirname, '..', 'mobile', 'core.bundle.js'), minify: true, legalComments: 'none',
  alias: { fs: sh('fs'), path: sh('path'), os: sh('os'), crypto: sh('crypto') },
  inject: [sh('process')], logLevel: 'info',
}).catch(() => process.exit(1));
