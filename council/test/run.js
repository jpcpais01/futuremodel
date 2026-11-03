// Offline checks of the parts that must never be wrong: limits, the ledger, the numbers, the phone link.
'use strict';
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-test-'));
const store = require('../engine/store'); store.setRoot(tmp);
const rules = require('../engine/rules'), ledger = require('../engine/ledger'), M = require('../engine/metrics');
const sec = require('../engine/data/sec'), llm = require('../engine/llm'), phone = require('../engine/phone');
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
  await t('phone link: pairing code required, wrong codes locked out', async () => {
    const code = phone.newCode(); assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    phone.start({ port: 17717, code: () => code, allowRun: () => false, api: { state: () => ({ ok: 1 }) } });
    await new Promise((r) => setTimeout(r, 200));
    const get = (p, h = {}) => fetch('http://127.0.0.1:17717' + p, { headers: h });
    assert.strictEqual((await get('/api/state')).status, 401);
    assert.strictEqual((await get('/api/state', { 'x-council-code': code.toLowerCase().replace(/-/g, ' ') })).status, 200);
    assert.strictEqual((await fetch('http://127.0.0.1:17717/api/run', { method: 'POST', headers: { 'x-council-code': code }, body: '{}' })).status, 403);
    for (let i = 0; i < 10; i++) await get('/api/state', { 'x-council-code': 'nope' });
    assert.strictEqual((await get('/api/state', { 'x-council-code': code })).status, 429);
    phone.stop();
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
