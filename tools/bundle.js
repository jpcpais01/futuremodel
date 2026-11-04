// Bundles the engine for the apps' web view: app/engine.js, one file, global OazyEngine.
const path = require('path');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, '..', 'engine', 'browser.js')], bundle: true, format: 'iife', globalName: 'OazyEngine', platform: 'browser',
  target: ['chrome110'], outfile: path.join(__dirname, '..', 'app', 'engine.js'), minify: true, legalComments: 'none', logLevel: 'warning',
  banner: { js: '/* Oazy Research engine, built by tools/bundle.js from engine/. Do not edit. */' },
});
console.log('Bundled app/engine.js');
