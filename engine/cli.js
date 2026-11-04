#!/usr/bin/env node
// Command line for the council index. GitHub runs `update` on a schedule (.github/workflows/index.yml); it only marks prices.
//   node engine/cli.js update                     rebuild index/council/state.json, index/README.md and index/chart.svg
//   node engine/cli.js session --demo [--preset low|normal|high] [--rounds 1-8] [--apply now|open|YYYY-MM-DD]
//                                                 a meeting from the command line (the app is the normal way to hold one)
//   node engine/cli.js estimate                   cost per meeting for each level and round count
//   node engine/cli.js verify                     check the ledger's hash chain
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./config');
const llm = require('./llm');
const store = require('./store');
const session = require('./session');
const ledger = require('./ledger');
const indexer = require('./indexer');

const args = process.argv.slice(2), cmd = args[0] || 'help';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
if (flag('demo')) llm.setMock(true);
const INDEX = path.resolve(opt('dir', path.join(__dirname, '..', 'index')));
fs.mkdirSync(path.join(INDEX, 'council'), { recursive: true });
store.use(require('./store-fs')(path.join(INDEX, 'council')));

async function writeIndex() {
  const out = await indexer.build({ prior: store.readJSON('state.json'), log: (m) => console.log(m) });
  fs.writeFileSync(path.join(INDEX, 'council', 'state.json'), out.json);
  fs.writeFileSync(path.join(INDEX, 'README.md'), out.readme);
  fs.writeFileSync(path.join(INDEX, 'chart.svg'), out.chart);
}

function printer() {
  const SEAT = { ...C.SEATS, ...C.OFFICERS };
  return (e) => {
    if (e.type === 'phase') console.log(`\n== ${e.label} (${e.i + 1}/${e.n})`);
    else if (e.type === 'progress' && e.done === e.total) console.log(`   ${e.label}: ${e.total} done`);
    else if (e.type === 'log') console.log('   ' + e.text);
    else if (e.type === 'said') console.log(`\n${SEAT[e.seat]?.name || e.seat} ($${e.cost.toFixed(3)}, ${e.model}):\n  ${(e.data?.statement || e.text || '').replace(/\n/g, '\n  ')}`);
    else if (e.type === 'final') { console.log('\nFINAL PORTFOLIO'); e.final.holdings.forEach((h) => console.log(`  ${h.ticker.padEnd(6)} ${h.weight.toFixed(1).padStart(5)}%  ${h.thesis}`)); console.log(`  CASH   ${e.final.cash_pct.toFixed(1).padStart(5)}%`); }
    else if (e.type === 'done') console.log(`\nMeeting ${e.id} done. Cost $${e.cost.toFixed(2)}.`);
    else if (e.type === 'failed') console.error(`\nMeeting failed: ${e.error}`);
  };
}

(async () => {
  if (cmd === 'update') await writeIndex();
  else if (cmd === 'session') {
    const preset = opt('preset', 'normal'), rounds = +opt('rounds', C.ROUNDS.default);
    console.log(`Convening the council (${C.PRESETS[preset].label}, ${rounds} rounds${llm.isMock() ? ', demo' : ''}). Estimated cost $${session.estimate(preset, rounds).mid.toFixed(2)}.`);
    await session.run({ preset, rounds, trigger: 'cli', emit: printer(), apply: opt('apply', 'open'), device: opt('device', 'command line') });
    if (!llm.isMock()) await writeIndex();
  } else if (cmd === 'estimate') {
    for (const k of Object.keys(C.PRESETS)) console.log(`${C.PRESETS[k].label.padEnd(7)} ` + [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${r}: $${session.estimate(k, r).mid.toFixed(2)}`).join('  '));
  } else if (cmd === 'verify') {
    const v = ledger.verify(); console.log(v.ok ? `Ledger intact: ${v.n} entries.` : `Ledger broken at entry ${v.at}.`); process.exitCode = v.ok ? 0 : 1;
  } else {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 8).join('\n').replace(/\/\/ ?/g, ''));
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
