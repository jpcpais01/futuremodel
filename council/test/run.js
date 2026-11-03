// Offline checks of the parts that must never be wrong: limits, the ledger, the numbers, account sync.
'use strict';
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-test-'));
const store = require('../engine/store'); store.setRoot(tmp);
const rules = require('../engine/rules'), ledger = require('../engine/ledger'), M = require('../engine/metrics');
const sec = require('../engine/data/sec'), llm = require('../engine/llm'), sync = require('../engine/sync');
const { fakeGitHub } = require('./fake-github');
const B = require('../engine/book'), C = require('../engine/config'), session = require('../engine/session');
let n = 0, failed = 0;
async function t(name, fn) { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

(async () => {
  console.log('Oazy Council tests');
  await t('universe has no duplicates and every seat exists', () => {
    const ts = C.UNIVERSE.map((u) => u[0]); assert.strictEqual(new Set(ts).size, ts.length);
    for (const p of Object.values(C.PRESETS)) for (const m of p.members) assert.ok(C.SEATS[m], m);
  });
  await t('limits: vetoes, caps, unknown names, weights sum to 100', () => {
    const chair = { cash_pct: 0, holdings: [{ ticker: 'NVDA', weight: 40 }, { ticker: 'AMD', weight: 30 }, { ticker: 'FAKE', weight: 10 }, { ticker: 'SPY', weight: 20 }, { ticker: 'XLE', weight: 10 }] };
    const risk = { vetoes: [{ ticker: 'AMD', reason: 'x' }], caps: [{ ticker: 'SPY', max_weight: 10 }], min_cash_pct: 5, max_sector_pct: 40 };
    const r = rules.enforce(chair, risk, B.META);
    const w = Object.fromEntries(r.holdings.map((h) => [h.ticker, h.weight]));
    assert.ok(!w.AMD && !w.FAKE, 'vetoed and unknown names dropped');
    assert.ok(w.NVDA <= C.LIMITS.maxStock + 1e-9, 'single-stock cap');
    assert.ok(w.SPY <= 10 + 1e-9, 'risk cap');
    assert.ok(r.cash_pct >= 5 - 1e-9, 'cash floor');
    const sum = r.holdings.reduce((a, h) => a + h.weight, 0) + r.cash_pct; assert.ok(Math.abs(sum - 100) < 0.2, 'sums to 100, got ' + sum);
  });
  await t('consensus averages every seat, nothing dropped', () => {
    const c = rules.consensus({ a: { picks: [{ ticker: 'X', weight: 10 }] }, b: { picks: [{ ticker: 'Y', weight: 20 }] } });
    assert.deepStrictEqual(c.map((x) => x.ticker).sort(), ['X', 'Y']);
  });
  await t('ledger: hash chain detects edits', () => {
    ledger.append({ type: 'note', x: 1 }, 'l.jsonl'); ledger.append({ type: 'note', x: 2 }, 'l.jsonl');
    assert.ok(ledger.verify('l.jsonl').ok);
    const f = store.p('l.jsonl'), lines = fs.readFileSync(f, 'utf8').trim().split('\n'); const e = JSON.parse(lines[0]); e.x = 9; lines[0] = JSON.stringify(e); fs.writeFileSync(f, lines.join('\n') + '\n');
    assert.strictEqual(ledger.verify('l.jsonl').ok, false);
  });
  await t('ledger: decisions fill at the next regular open (ET)', () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04'];
    assert.strictEqual(ledger.fillDate(Date.parse('2026-11-03T13:00:00Z'), days), '2026-11-03');   // 08:00 ET, before the open
    assert.strictEqual(ledger.fillDate(Date.parse('2026-11-03T15:00:00Z'), days), '2026-11-04');   // 10:00 ET, after the open
    assert.strictEqual(ledger.fillDate(Date.parse('2026-11-01T01:00:00Z'), days), '2026-11-02');   // Saturday evening
  });
  await t('ledger: replay buys at the open, charges costs, tracks benchmarks', () => {
    const mk = (px) => ({ bars: px.map((p, i) => ({ d: `2026-10-${String(10 + i).padStart(2, '0')}`, o: p, h: p, l: p, c: p, ac: p, v: 1e6 })) });
    const H = { AAA: mk([10, 10, 11, 12]), SPY: mk([100, 100, 100, 110]), QQQ: mk([50, 50, 50, 50]) };
    ledger.ensureGenesis(100000, 'r.jsonl');
    ledger.append({ type: 'decision', session: 'S-1', cash: 50, target: { AAA: 50 }, at: '2026-10-10T12:00:00Z' }, 'r.jsonl');   // 08:00 ET: fills at that day's open
    const r = ledger.replay((t) => H[t], 'r.jsonl');
    assert.strictEqual(r.fills.length, 1); assert.strictEqual(r.fills[0].date, '2026-10-10');
    const last = r.series[r.series.length - 1];
    assert.ok(Math.abs(last.nav - (50000 * 1.2 + 50000 - 50000 * 0.001)) < 1, 'NAV ' + last.nav);   // AAA +20%, 10 bps on the trade
    assert.ok(Math.abs(last.spy / 100000 - 1.1) < 1e-9, 'SPY benchmark');
    assert.ok(r.verify.ok);
  });
  await t('metrics: returns and drawdown from adjusted prices', () => {
    const bars = Array.from({ length: 300 }, (_, i) => ({ d: 'd' + i, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, ac: 100 + i, v: 1e6 }));
    const m = M.compute('X', { bars }, { bars }, null);
    assert.ok(Math.abs(m.r1w - (399 / 394 - 1)) < 1e-9); assert.strictEqual(m.dd1y, 0); assert.ok(Math.abs(m.beta - 1) < 1e-6);
  });
  await t('SEC: fiscal Q4 comes from the annual figure minus nine months', () => {
    const facts = [{ s: '2025-01-01', e: '2025-03-31', v: 10, f: '2025-05-01' }, { s: '2025-01-01', e: '2025-06-30', v: 22, f: '2025-08-01' }, { s: '2025-01-01', e: '2025-09-30', v: 35, f: '2025-11-01' }, { s: '2025-01-01', e: '2025-12-31', v: 50, f: '2026-02-01' }];
    const q = sec.quarterly(facts).map((x) => x.v); assert.deepStrictEqual(q, [10, 12, 13, 15]);
  });
  await t('statement streams out of partial JSON', () => {
    assert.strictEqual(llm.partialField('{"statement":"The council \\"holds\\" fi', 'statement'), 'The council "holds" fi');
  });
  await t('cost estimates are ordered low < normal < high', () => {
    const e = ['low', 'normal', 'high'].map((k) => session.estimate(k).mid); assert.ok(e[0] < e[1] && e[1] < e[2], e.join(' '));
  });
  await t('sync merge: ledgers re-link, logs union, nothing lost', () => {
    const mk = (file, evs) => { for (const e of evs) ledger.append(e, file); return store.readLines(file); };
    const base = mk('m-base.jsonl', [{ type: 'genesis', capital: 1e5 }, { type: 'decision', target: { A: 50 }, at: '2026-01-01T00:00:00Z' }]);
    store.writeLines('m-a.jsonl', base); store.writeLines('m-b.jsonl', base);
    const A = mk('m-a.jsonl', [{ type: 'decision', target: { B: 50 }, at: '2026-01-02T00:00:00Z' }]);
    const Bl = mk('m-b.jsonl', [{ type: 'decision', target: { C: 50 }, at: '2026-01-03T00:00:00Z' }]);
    const ext = sync.mergeLedger(base, A); assert.ok(ext.push); assert.strictEqual(ext.out, A);           // pure extension: taken as is
    const m = sync.mergeLedger(A, Bl); store.writeLines('m-out.jsonl', m.out);
    assert.strictEqual(m.out.length, 4); assert.ok(ledger.verify('m-out.jsonl').ok, 'merged chain must verify');
    assert.deepStrictEqual(m.out.slice(2).map((e) => Object.keys(e.target)[0]), ['B', 'C']);
    assert.strictEqual(sync.mergeLedger(m.out, A).push, false);                                              // already have everything
    const g = sync.mergeLedger([], [{ type: 'genesis', hash: 'x' }]); assert.strictEqual(g.out.length, 1);
    const lg = sync.mergeLog([{ at: '2', s: 'b' }, { at: '1', s: 'a' }], [{ at: '3', s: 'c' }, { at: '1', s: 'a' }]);
    assert.deepStrictEqual(lg.out.map((x) => x.s), ['a', 'b', 'c']); assert.ok(lg.push);
  });
  await t('account sync: two devices share one ledger, sessions, settings and live status', async () => {
    const gh = await fakeGitHub(17718), api = 'http://127.0.0.1:17718';
    const dA = path.join(tmp, 'devA'), dB = path.join(tmp, 'devB');
    const as = (root, device) => { store.setRoot(root); sync.configure({ repo: 'me/oazy-council-data', token: 'test-token', device, api }); };
    try {
      as(dA, 'PC');
      ledger.recordDecision({ id: 'S-20261101-1', preset: 'normal', final: { cash_pct: 10, holdings: [{ ticker: 'NVDA', weight: 90 }] } });
      store.writeJSON('sessions/S-20261101-1.json', { id: 'S-20261101-1', status: 'done', device: 'PC', startedAt: '2026-11-01T20:00:00Z' });
      store.writeJSON('sessions/S-20261102-1.json', { id: 'S-20261102-1', status: 'running' });   // unfinished: stays local
      store.writeJSON('shared.json', { preset: 'high', updatedAt: 1000 });
      await sync.pull();
      assert.ok(gh.files.has('ledger.jsonl') && gh.files.has('sessions/S-20261101-1.json') && gh.files.has('shared.json'));
      assert.ok(!gh.files.has('sessions/S-20261102-1.json'));

      as(dB, 'Phone');
      const r = await sync.pull(); assert.ok(r.changed);
      assert.strictEqual(store.readLines('ledger.jsonl').length, 2); assert.ok(ledger.verify().ok);
      assert.strictEqual(store.readJSON('sessions/S-20261101-1.json').device, 'PC');
      assert.strictEqual(store.readJSON('shared.json').preset, 'high');
      // The phone decides and logs a watch, the PC logs its own watch, both offline.
      ledger.recordDecision({ id: 'S-20261108-1', preset: 'low', final: { cash_pct: 0, holdings: [{ ticker: 'MSFT', weight: 100 }] } });
      store.appendLine('watch.jsonl', { at: '2026-11-04T22:30:00Z', statement: 'phone watch' });
      store.writeJSON('shared.json', { preset: 'low', updatedAt: 2000 });
      store.setRoot(dA); store.appendLine('watch.jsonl', { at: '2026-11-03T22:30:00Z', statement: 'pc watch' });
      as(dB, 'Phone'); await sync.pull();
      as(dA, 'PC'); await sync.pull();
      assert.strictEqual(store.readLines('ledger.jsonl').length, 3); assert.ok(ledger.verify().ok);
      assert.deepStrictEqual(store.readLines('watch.jsonl').map((w) => w.statement), ['pc watch', 'phone watch']);
      assert.strictEqual(store.readJSON('shared.json').preset, 'low');
      // Both devices decide while apart: the chains are joined, nothing is dropped, both still verify.
      ledger.recordDecision({ id: 'S-A', preset: 'low', final: { cash_pct: 0, holdings: [{ ticker: 'AAA', weight: 100 }] } });
      store.setRoot(dB); ledger.recordDecision({ id: 'S-B', preset: 'low', final: { cash_pct: 0, holdings: [{ ticker: 'BBB', weight: 100 }] } });
      as(dA, 'PC'); await sync.pull(); as(dB, 'Phone'); await sync.pull(); as(dA, 'PC'); await sync.pull();
      const la = store.readLines('ledger.jsonl'); store.setRoot(dB); const lb = store.readLines('ledger.jsonl');
      assert.strictEqual(la.length, 5); assert.deepStrictEqual(la.map((e) => e.hash), lb.map((e) => e.hash));
      assert.ok(ledger.verify().ok); assert.deepStrictEqual(la.slice(3).map((e) => e.session).sort(), ['S-A', 'S-B']);
      // A quiet second pull downloads and uploads nothing.
      const before = gh.puts(); await sync.pull(); assert.strictEqual(gh.puts(), before);
      // Live status: the phone sees the PC in session, the PC does not see itself.
      as(dA, 'PC'); await sync.setLive({ active: true, id: 'S-X', phase: { label: 'Debate' } }, true);
      assert.strictEqual(await sync.getLive(), null);
      as(dB, 'Phone'); const l = await sync.getLive(); assert.strictEqual(l?.device, 'PC'); assert.strictEqual(l.phase.label, 'Debate');
      as(dA, 'PC'); await sync.setLive(null, true); as(dB, 'Phone'); assert.strictEqual(await sync.getLive(), null);
      // A wrong token is reported plainly.
      sync.configure({ repo: 'me/oazy-council-data', token: 'nope', device: 'Phone', api });
      await assert.rejects(sync.pull(), /token is wrong/);
    } finally { gh.close(); sync.configure(null); store.setRoot(tmp); }
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
