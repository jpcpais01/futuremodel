// Offline checks of the parts that must never be wrong: limits, the ledger, the numbers, the indexes.
'use strict';
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-test-'));
const store = require('../engine/store'); store.setRoot(tmp);
const rules = require('../engine/rules'), ledger = require('../engine/ledger'), M = require('../engine/metrics');
const sec = require('../engine/data/sec'), llm = require('../engine/llm');
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
  await t('ledger: decisions enter at the open of their own trading day (ET)', () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04'];
    assert.strictEqual(ledger.fillDate(Date.parse('2026-11-03T13:00:00Z'), days), '2026-11-03');   // 08:00 ET, before the open
    assert.strictEqual(ledger.fillDate(Date.parse('2026-11-03T15:00:00Z'), days), '2026-11-03');   // 10:00 ET, after the open: same day's open
    assert.strictEqual(ledger.fillDate(Date.parse('2026-11-03T22:30:00Z'), days), '2026-11-03');   // 17:30 ET, after the close
    assert.strictEqual(ledger.fillDate(Date.parse('2026-11-04T03:00:00Z'), days), '2026-11-03');   // 22:00 ET, still Nov 3 in New York
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
    assert.ok(r.series[0].open && r.series[0].d === '2026-10-10T13:30:00.000Z' && r.series[0].spy === 100000, 'the record starts at the 09:30 open');
    assert.strictEqual(r.stats.days, 4);
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
  await t('indexes: Core enters its book at the open, rotations are recorded, state and README are written', async () => {
    const prices = require('../engine/data/prices'), indexer = require('../engine/indexer');
    const root = path.join(tmp, 'index'), dir = path.join(root, 'core');
    const bars = (px) => px.map((p, i) => ({ d: `2026-11-0${3 + i}`, o: p[0], h: p[1], l: p[0], c: p[1], ac: p[1], v: 1 }));
    const H = { SPY: bars([[100, 101], [101, 102]]), QQQ: bars([[50, 50], [50, 51]]), AAA: bars([[10, 11], [11, 12]]), BBB: bars([[20, 20], [20, 20]]) };
    const orig = prices.history; prices.history = async (t) => { const s = { sym: t, bars: H[t] }; store.writeJSON(`prices/${t}.json`, s); return s; };
    try {
      fs.mkdirSync(dir, { recursive: true });
      const book = { start: '2026-11-03T13:00:00.000Z', summary: 'test', holdings: [{ ticker: 'AAA', weight: 60, thesis: 't', rotate_if: 'r', conviction: 4 }], names: { AAA: { n: 'Alpha' } } };
      fs.writeFileSync(path.join(dir, 'book.json'), JSON.stringify(book));
      let [core] = await indexer.updateAll(root);
      assert.strictEqual(core.fills[0].date, '2026-11-03'); assert.strictEqual(core.pending.length, 0);
      assert.ok(Math.abs(core.series[core.series.length - 1][1] - (60000 * 12 / 10 + 40000 - 60)) < 1, 'NAV ' + core.series.at(-1)[1]);
      assert.strictEqual(core.names[0].n, 'Alpha'); assert.ok(core.history.AAA.length === 2);
      [core] = await indexer.updateAll(root); store.setRoot(dir); assert.strictEqual(store.readLines('ledger.jsonl').length, 2, 'an unchanged book adds nothing');
      book.holdings.push({ ticker: 'BBB', weight: 20 }); store.setRoot(dir); fs.writeFileSync(path.join(dir, 'book.json'), JSON.stringify(book));
      [core] = await indexer.updateAll(root);
      store.setRoot(dir); const L = store.readLines('ledger.jsonl'); assert.strictEqual(L.length, 3); assert.strictEqual(L[2].trigger, 'rotation'); assert.ok(ledger.verify().ok);
      assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).final.holdings.length === 2);
      assert.ok(/Core v1.0/.test(fs.readFileSync(path.join(root, 'README.md'), 'utf8'))); assert.ok(fs.readFileSync(path.join(root, 'chart.svg'), 'utf8').startsWith('<svg'));
    } finally { prices.history = orig; store.setRoot(tmp); }
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
