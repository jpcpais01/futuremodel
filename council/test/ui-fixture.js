// Builds the data a browser test of the window needs, from a real data folder (demo record).
'use strict';
const path = require('path'), fs = require('fs');
const store = require('../engine/store');
store.setRoot(process.env.OAZY_COUNCIL_DATA);
const C = require('../engine/config'), session = require('../engine/session'), ledger = require('../engine/ledger');
const histOf = (t) => store.readJSON(`prices/${t.replace(/[^\w.-]/g, '_')}.json`);
const presets = Object.fromEntries(Object.entries(C.PRESETS).map(([k, p]) => [k, { label: p.label, blurb: p.blurb, est: session.estimate(k), members: p.members, rounds: p.rounds, redTeam: p.redTeam, rebuttal: p.rebuttal, scout: !!p.scout,
  models: { analyst: C.MODELS[p.analyst.model].label, member: C.MODELS[p.member.model].label, chair: C.MODELS[p.chair.model].label }, effort: p.member.effort }]));
const st = ledger.replay(histOf, 'demo-ledger.jsonl'), last = session.lastSession(true);
const sessions = store.list('sessions').filter((f) => f.endsWith('.json')).sort().reverse().map((f) => store.readJSON('sessions/' + f));
const out = {
  state: { settings: { preset: 'normal', schedule: { enabled: true, day: 0, hour: 20, minute: 0 }, watch: { enabled: true, hour: 22, minute: 30 }, autoEmergency: false, catchUp: true, tray: true, secContact: '' },
    hasKey: false, presets, seats: C.SEATS, officers: C.OFFICERS, universe: C.UNIVERSE.map((u) => ({ t: u[0], n: u[1], s: u[2], k: u[3] })), limits: C.LIMITS,
    running: null, next: { session: Date.now() + 4 * 864e5, watch: Date.now() + 864e5 }, spentThisMonth: 0, dataDir: 'C:\\Users\\jpcpa\\AppData\\Roaming\\Oazy Council\\data', version: '1.0.0' },
  portfolio: { ...st, series: st.series.map((p) => [p.d, +p.nav.toFixed(2), p.spy && +p.spy.toFixed(2), p.qqq && +p.qqq.toFixed(2)]), final: last?.final, lastId: last?.id, decidedAt: last?.endedAt, hl: store.readJSON('hl.json', {}), watch: [] },
  sessions,
};
fs.writeFileSync(process.argv[2], 'window.FIX = ' + JSON.stringify(out) + ';');
console.log('fixture', (fs.statSync(process.argv[2]).size / 1024).toFixed(0) + 'KB', 'sessions', sessions.length, 'series', out.portfolio.series.length);
