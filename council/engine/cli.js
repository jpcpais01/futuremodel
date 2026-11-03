#!/usr/bin/env node
// Command line for the council, for scheduled runs without the app open.
//   node engine/cli.js session [--preset low|normal|high] [--demo]
//   node engine/cli.js watch [--demo]       daily check of every holding
//   node engine/cli.js status               the paper portfolio and its record
//   node engine/cli.js estimate             cost per session for each preset
//   node engine/cli.js verify               check the ledger's hash chain
'use strict';
const C = require('./config');
const llm = require('./llm');
const store = require('./store');
const session = require('./session');
const ledger = require('./ledger');
const M = require('./metrics');

const args = process.argv.slice(2), cmd = args[0] || 'help';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
if (flag('demo')) llm.setMock(true);
const settings = store.readJSON('settings.json', {});

function printer() {
  let speaking = null;
  return (e) => {
    if (e.type === 'phase') console.log(`\n== ${e.label} (${e.i + 1}/${e.n})`);
    else if (e.type === 'progress' && e.done === e.total) console.log(`   ${e.label}: ${e.total} done`);
    else if (e.type === 'log') console.log('   ' + e.text);
    else if (e.type === 'said') { const nm = { ...C.SEATS, ...C.OFFICERS }[e.seat]?.name || e.seat; console.log(`\n${nm} ($${e.cost.toFixed(3)}, ${e.model}):\n  ${(e.data?.statement || e.text || '').replace(/\n/g, '\n  ')}`); speaking = null; }
    else if (e.type === 'final') { console.log('\nFINAL PORTFOLIO'); e.final.holdings.forEach((h) => console.log(`  ${h.ticker.padEnd(6)} ${h.weight.toFixed(1).padStart(5)}%  ${h.thesis}`)); console.log(`  CASH   ${e.final.cash_pct.toFixed(1).padStart(5)}%`); e.final.notes.forEach((n) => console.log('  note: ' + n)); console.log('  ledger ' + e.ledgerHash.slice(0, 16)); }
    else if (e.type === 'done') console.log(`\nSession ${e.id} done. Cost $${e.cost.toFixed(2)}.`);
    else if (e.type === 'failed') console.error(`\nSession failed: ${e.error}`);
    void speaking;
  };
}

(async () => {
  if (cmd === 'session') {
    const preset = opt('preset', settings.preset || 'normal');
    console.log(`Convening the council (${C.PRESETS[preset].label}${llm.isMock() ? ', demo' : ''}). Estimated cost $${session.estimate(preset).mid.toFixed(2)}.`);
    await session.run({ preset, trigger: opt('trigger', 'cli'), emit: printer(), settings });
  } else if (cmd === 'watch') {
    const w = await require('./watch').run({ emit: () => {} });
    console.log(w.skipped || `${w.statement}\n` + (w.alerts || []).map((a) => `  ${a.triggered ? 'ALERT' : 'ok   '} ${a.ticker}: ${a.reason}`).join('\n') + `\nConvene: ${w.convene}. Cost $${(w.cost || 0).toFixed(3)}.`);
    if (w.convene && settings.autoEmergency && !llm.isMock()) await session.run({ preset: settings.preset || 'normal', trigger: 'emergency', emit: printer(), settings });
  } else if (cmd === 'estimate') {
    for (const k of Object.keys(C.PRESETS)) { const e = session.estimate(k); console.log(`${C.PRESETS[k].label.padEnd(7)} ~$${e.mid.toFixed(2)} per session (range $${e.low.toFixed(2)}–$${e.high.toFixed(2)}), ${e.calls} model calls. ${C.PRESETS[k].blurb}`); }
  } else if (cmd === 'status') {
    const file = llm.isMock() ? 'demo-ledger.jsonl' : 'ledger.jsonl';
    const st = ledger.replay((t) => store.readJSON(`prices/${t.replace(/[^\w.-]/g, '_')}.json`), file);
    console.log(`Ledger: ${st.verify.ok ? 'intact' : 'BROKEN at entry ' + st.verify.at}, ${st.verify.n || 0} entries.`);
    if (st.stats) console.log(`Return ${M.pc(st.stats.ret)} vs S&P 500 ${M.pc(st.stats.spy)} vs Nasdaq-100 ${M.pc(st.stats.qqq)} over ${st.stats.days} days. Max drawdown ${M.pc(st.stats.maxDD)}.`);
    st.positions.forEach((p) => console.log(`  ${p.t.padEnd(6)} ${p.weight.toFixed(1).padStart(5)}%  P&L ${M.pc(p.pnlPct)}`));
    st.pending.forEach((p) => console.log(`  pending fill: decision ${p.at}`));
  } else if (cmd === 'verify') {
    const v = ledger.verify(); console.log(v.ok ? `Ledger intact: ${v.n} entries.` : `Ledger broken at entry ${v.at}.`); process.exitCode = v.ok ? 0 : 1;
  } else {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 8).join('\n').replace(/\/\/ ?/g, ''));
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
