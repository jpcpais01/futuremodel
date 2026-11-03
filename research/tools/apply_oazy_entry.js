// Points Oazy's Library entry at Oazy Research, with its card, banner and logo.
// Oazy keeps its library in memory and rewrites the file, so this must run while Oazy is closed.
// Usage: node apply_oazy_entry.js [libraryFile]   (a file argument edits that copy, for testing)
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ID = 'com.oazy.research';
const art = path.join(process.env.LOCALAPPDATA, 'Programs', 'oazy-research').replace(/\\/g, '/');
const file = process.argv[2] || path.join(process.env.APPDATA, 'OazyLauncher', 'library.json');

if (!process.argv[2] && /OazyLauncher\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq OazyLauncher.exe"', { encoding: 'utf8' }))) {
  console.error('Oazy is running; close it first.');
  process.exit(3);
}

const raw = fs.readFileSync(file, 'utf8');
const list = JSON.parse(raw);
const fields = {
  name: 'Oazy Research',
  app_id: ID,
  path: 'shell:AppsFolder\\' + ID,
  kind: 'app',
  cover: art + '/cover.png',
  hero: art + '/hero.png',
  logo: art + '/logo.png',
  color: '2fd6a8',
};
let entry = list.find((e) => e.app_id === 'com.paizy.core' || e.app_id === ID || e.name === 'Paizy Core');
if (entry) {
  Object.assign(entry, fields);
} else {
  entry = {
    added_at: Math.floor(Date.now() / 1000), args: '', cwd: '', epic_app: '', epic_uri: '', favorite: true,
    id: Date.now().toString(16) + 'a0', last_played: 0, launches: 0, oazy: '', playtime: 0, source: 'custom', steam_appid: '',
    ...fields,
  };
  list.push(entry);
}
if (!process.argv[2]) fs.writeFileSync(file + '.pre-research.bak', raw);
fs.writeFileSync(file, JSON.stringify(list));
console.log('updated', entry.id, entry.name, '->', entry.path);
