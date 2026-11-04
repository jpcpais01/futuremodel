// Offline checks of the parts that must never be wrong: limits, the ledger, the numbers, the indexes.
'use strict';
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-test-'));
const store = require('../engine/store'), fsBackend = require('../engine/store-fs'); store.use(fsBackend(tmp));
const p = (rel) => path.join(tmp, rel);
const rules = require('../engine/rules'), ledger = require('../engine/ledger'), M = require('../engine/metrics');
const sec = require('../engine/data/sec'), llm = require('../engine/llm');
const B = require('../engine/book'), C = require('../engine/config'), session = require('../engine/session');
let n = 0, failed = 0;
async function t(name, fn) { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

(async () => {
  console.log('Oazy Research tests');
  await t('universe has no duplicates and every seat exists', () => {
    const ts = C.UNIVERSE.map((u) => u[0]); assert.strictEqual(new Set(ts).size, ts.length);
    for (const p of Object.values(C.PRESETS)) for (const m of p.members) assert.ok(C.SEATS[m], m);
  });
  await t('limits: vetoes, caps, unknown names, weights sum to 100', () => {
    const chair = { cash_pct: 0, holdings: [{ ticker: 'NVDA', weight: 40 }, { ticker: 'AMD', weight: 30 }, { ticker: 'FAKE', weight: 10 }, { ticker: 'XOM', weight: 20 }, { ticker: 'JPM', weight: 10 }] };
    const risk = { vetoes: [{ ticker: 'AMD', reason: 'x' }], caps: [{ ticker: 'XOM', max_weight: 10 }], min_cash_pct: 5, max_sector_pct: 40 };
    const r = rules.enforce(chair, risk, B.META);
    const w = Object.fromEntries(r.holdings.map((h) => [h.ticker, h.weight]));
    assert.ok(!w.AMD && !w.FAKE, 'vetoed and unknown names dropped');
    assert.ok(w.XOM <= 10 + 1e-9, 'risk cap');
    assert.ok(r.cash_pct >= 5 - 1e-9, 'cash floor');
    const sum = r.holdings.reduce((a, h) => a + h.weight, 0) + r.cash_pct; assert.ok(Math.abs(sum - 100) < 0.2, 'sums to 100, got ' + sum);
  });
  await t('no fixed limits: any number of holdings and any weight survive', () => {
    const names = C.UNIVERSE.slice(0, 30).map((u) => u[0]);
    const chair = { cash_pct: 0, holdings: [{ ticker: names[0], weight: 60 }, ...names.slice(1).map((t) => ({ ticker: t, weight: 40 / 29 }))] };
    const r = rules.enforce(chair, { vetoes: [], caps: [], min_cash_pct: 0, max_sector_pct: 100 }, B.META);
    assert.strictEqual(r.holdings.length, 30); assert.ok(Math.abs(r.holdings[0].weight - 60) < 0.01); assert.ok(r.cash_pct < 0.05);
  });
  await t('consensus averages every seat, nothing dropped', () => {
    const c = rules.consensus({ a: { picks: [{ ticker: 'X', weight: 10 }] }, b: { picks: [{ ticker: 'Y', weight: 20 }] } });
    assert.deepStrictEqual(c.map((x) => x.ticker).sort(), ['X', 'Y']);
  });
  await t('ledger: hash chain detects edits', () => {
    ledger.append({ type: 'note', x: 1 }, 'l.jsonl'); ledger.append({ type: 'note', x: 2 }, 'l.jsonl');
    assert.ok(ledger.verify('l.jsonl').ok);
    const f = p('l.jsonl'), lines = fs.readFileSync(f, 'utf8').trim().split('\n'); const e = JSON.parse(lines[0]); e.x = 9; lines[0] = JSON.stringify(e); fs.writeFileSync(f, lines.join('\n') + '\n');
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
  await t('ledger: apply now fills at the recorded prices, a chosen open waits for its day, newer decisions replace waiting ones', () => {
    const mk = (px) => ({ bars: px.map((p, i) => ({ d: `2026-11-${String(2 + i).padStart(2, '0')}`, o: p[0], h: p[1], l: p[0], c: p[1], ac: p[1] / 2, v: 1 })) });
    // ac is half of c (a split-style adjustment): fills at raw prices must be scaled the same way.
    const H = { SPY: mk([[100, 100], [100, 110], [110, 110], [110, 121]]), QQQ: mk([[50, 50], [50, 50], [50, 50], [50, 50]]), AAA: mk([[10, 10], [10, 12], [12, 12], [12, 12]]), BBB: mk([[20, 20], [20, 20], [20, 20], [25, 30]]) };
    ledger.ensureGenesis(100000, 'n.jsonl');
    // Applied now on Nov 3 at 11:00 ET, AAA at 11 and SPY at 105 at that moment.
    ledger.recordDecision({ id: 'S-a', preset: 'low', final: { cash_pct: 0, holdings: [{ ticker: 'AAA', weight: 100 }] } }, 'n.jsonl', { mode: 'now', pxAt: '2026-11-03T16:00:00Z', px: { AAA: 11, SPY: 105, QQQ: 50 } });
    let r = ledger.replay((t) => H[t], 'n.jsonl');
    assert.strictEqual(r.fills[0].date, '2026-11-03'); assert.strictEqual(r.fills[0].mode, 'now'); assert.strictEqual(r.fills[0].trades[0].px, 11);
    assert.ok(r.series[0].open && r.series[0].d === '2026-11-03T16:00:00.000Z', 'the record starts at the moment it was applied');
    const close3 = r.series.find((p) => p.d === '2026-11-03');
    assert.ok(Math.abs(close3.nav - (100000 * 12 / 11 - 100)) < 1, 'NAV at the close ' + close3.nav);
    assert.ok(Math.abs(close3.spy - 100000 * 110 / 105) < 1, 'SPY from the same moment');
    // Scheduled for the open of Nov 5: waits, then a newer decision made before that open replaces it.
    ledger.append({ type: 'decision', session: 'S-b', cash: 0, target: { BBB: 100 }, apply: 'open', on: '2026-11-05', at: '2026-11-03T22:00:00Z' }, 'n.jsonl');
    r = ledger.replay((t) => ({ bars: H[t].bars.slice(0, 3) }), 'n.jsonl');
    assert.strictEqual(r.pending.length, 1); assert.strictEqual(r.pending[0].on, '2026-11-05'); assert.strictEqual(r.fills.length, 1);
    r = ledger.replay((t) => H[t], 'n.jsonl');
    assert.strictEqual(r.fills.length, 2); assert.strictEqual(r.fills[1].date, '2026-11-05'); assert.strictEqual(r.fills[1].trades.find((x) => x.t === 'BBB').px, 25);
    ledger.append({ type: 'decision', session: 'S-c', cash: 100, target: {}, apply: 'open', on: '2026-11-05', at: '2026-11-04T22:00:00Z' }, 'n.jsonl');
    r = ledger.replay((t) => H[t], 'n.jsonl');
    assert.strictEqual(r.fills[1].session, 'S-c', 'the newer decision replaced the waiting one'); assert.strictEqual(r.positions.length, 0);
    // An open that has already passed when the decision is made is never used.
    assert.strictEqual(ledger.fillDate(Date.parse('2026-11-03T15:00:00Z'), ['2026-11-03', '2026-11-04'], { apply: 'open', on: '2026-11-03' }), '2026-11-04');
    assert.strictEqual(ledger.nextOpenDate(Date.parse('2026-11-06T15:00:00Z')), '2026-11-09');   // Friday 10:00 ET -> Monday
    assert.strictEqual(ledger.nextOpenDate(Date.parse('2026-11-04T12:00:00Z')), '2026-11-04');   // Wednesday 07:00 ET -> today
    assert.ok(ledger.verify('n.jsonl').ok);
  });
  await t('hash: plain JavaScript SHA-256 matches Node', () => {
    const { sha256 } = require('../engine/hash'), crypto = require('crypto');
    for (const x of ['', 'abc', 'é∑ 🚀'.repeat(40), 'x'.repeat(5000)]) assert.strictEqual(sha256(x), crypto.createHash('sha256').update(x).digest('hex'));
  });
  await t('every level runs the same meeting; rounds are their own setting', () => {
    const keys = (o) => Object.keys(o).sort().join();
    const P = Object.values(C.PRESETS); P.forEach((x) => assert.strictEqual(keys(x), keys(P[0])));
    P.forEach((x) => assert.strictEqual(x.members.length, 8));
    assert.deepStrictEqual(C.roundPlan(1), ['closing']); assert.strictEqual(C.roundPlan(8).length, 8); assert.strictEqual(C.roundPlan(99).length, 8);
    assert.ok(C.roundPlan(7).slice(0, -1).every((f) => C.FORMATS[f]) && new Set(C.roundPlan(7)).size >= 6, 'varied formats');
    assert.ok(session.estimate('normal', 1).mid < session.estimate('normal', 5).mid, 'more rounds cost more');
  });
  await t('duels pair the seats that disagree most', () => {
    const pr = (...t) => ({ picks: t.map((x) => ({ ticker: x, weight: 20 })) });
    const props = { a: pr('X', 'Y'), b: pr('X', 'Y'), c: pr('Z', 'W'), d: pr('Z', 'W') };
    const d = session.duelPairs(props, ['a', 'b', 'c', 'd']);
    assert.ok(['c', 'd'].includes(d.a) && ['a', 'b'].includes(d.c), JSON.stringify(d));
  });
  await t('a whole demo meeting: every format, apply at the next open, then the index', async () => {
    const net = require('../engine/net'), indexer = require('../engine/indexer');
    const mem = store.use(store.memory());
    const days = []; for (let t = Date.parse('2025-01-02T12:00:00Z'); days.length < 470; t += 864e5) { const d = new Date(t); if (d.getUTCDay() % 6) days.push(d); }
    net.setFetch(async (url) => {
      const m = /chart\/([^?]+)/.exec(url);
      if (!/finance\.yahoo/.test(url) || !m) return new Response('no', { status: 404 });
      const seed = [...decodeURIComponent(m[1])].reduce((a, c) => a + c.charCodeAt(0), 0);
      const close = days.map((d, i) => 100 + seed % 50 + i * ((seed % 7) - 2) / 20 + Math.sin(i / 9 + seed) * 3);
      return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: close.at(-1) }, timestamp: days.map((d) => d / 1000), indicators: { quote: [{ open: close, high: close, low: close, close, volume: close.map(() => 1e6) }], adjclose: [{ adjclose: close }] } }] } }), { status: 200 });
    });
    process.env.OAZY_BUDGET_SCALE = '0.002'; llm.setMock(true, 400);
    const seen = new Set(), pairs = [];
    try {
      const s = await session.run({ preset: 'low', rounds: 7, apply: null, emit: (e) => { if (e.type === 'phase') seen.add(e.format || e.key); if (e.type === 'pairs') pairs.push(e); } });
      assert.strictEqual(s.status, 'decided'); assert.strictEqual(s.plan.length, 7);
      for (const f of ['floor', 'cross', 'devil', 'duel', 'premortem', 'steelman', 'closing', 'redteam', 'rebuttal', 'risk', 'chair']) assert.ok(seen.has(f), 'phase ' + f);
      assert.ok(pairs.length >= 3 && pairs.every((x) => x.pairs.length === 8));
      assert.ok(s.events.some((e) => e.type === 'said' && e.kind === 'question'), 'cross-examination questions recorded');
      await session.applyDecision(s, 'open');
      assert.strictEqual(s.status, 'done'); assert.strictEqual(s.applied.mode, 'open');
      const L = store.readLines('demo-ledger.jsonl'); assert.strictEqual(L.length, 2); assert.strictEqual(L[1].apply, 'open');
      assert.ok(store.readJSON(`sessions/${s.id}.json`).applied);
      assert.ok(mem.files.size > 100, 'prices kept in memory');
    } finally { llm.setMock(false); delete process.env.OAZY_BUDGET_SCALE; net.setFetch((...a) => fetch(...a)); store.use(fsBackend(tmp)); }
  });
  await t('index: an empty council writes valid JSON', async () => {
    const indexer = require('../engine/indexer');
    store.use(store.memory());
    const out = await indexer.build({ fetchPrices: false });
    const st = JSON.parse(out.json); assert.strictEqual(st.cash, 100); assert.strictEqual(st.positions.length, 0);
  });
  await t('index: built from the ledger and meetings, waiting decisions shown, README and chart', async () => {
    const indexer = require('../engine/indexer');
    store.use(store.memory());
    const bars = (px) => px.map((q, i) => ({ d: `2026-11-0${4 + i}`, o: q[0], h: q[1], l: q[0], c: q[1], ac: q[1], v: 1 }));
    const H = { SPY: bars([[100, 101], [101, 102]]), QQQ: bars([[50, 50], [50, 51]]), AAA: bars([[10, 11], [11, 12]]) };
    for (const t in H) store.writeJSON(`prices/${t}.json`, { sym: t, bars: H[t] });
    const sess = { id: 'S-20261104-1300', status: 'done', preset: 'normal', plan: ['floor', 'closing'], final: { holdings: [{ ticker: 'AAA', weight: 60 }], cash_pct: 40, summary: 'test' }, endedAt: '2026-11-04T13:10:00Z', events: [{}] };
    store.writeJSON(`sessions/${sess.id}.json`, sess);
    ledger.ensureGenesis(100000);
    ledger.recordDecision(sess, 'ledger.jsonl', { mode: 'open', on: '2026-11-04' });
    let out = await indexer.build({ fetchPrices: false, prior: { sessions: [{ id: 'S-20261101-0900', status: 'skipped' }] } });
    assert.strictEqual(out.state.fills.length, 1); assert.strictEqual(out.state.positions[0].t, 'AAA'); assert.strictEqual(out.state.positions[0].entryWeight, 60);
    assert.strictEqual(out.state.sessions.length, 2, 'older meetings kept from the previous state'); assert.strictEqual(out.state.lastId, sess.id);
    assert.ok(/^# Oazy Council · Oazy Research/.test(out.readme) && /\(ledger\.jsonl\)/.test(out.readme) && out.chart.startsWith('<svg')); assert.ok(JSON.parse(out.json).verify.ok);
    store.use(fsBackend(tmp));
  });
  await t('councils: the first is always there, new ones get their own folder, the Awareness reaches every role', () => {
    const CO = require('../engine/councils'), P = require('../engine/prompts'), indexer = require('../engine/indexer');
    let list = CO.parse(null); assert.deepStrictEqual(list.map((c) => c.id), ['council']);
    const a = CO.make(list, { name: 'Dividend Guardians', awareness: 'Income first. Never chase.' }); assert.strictEqual(a.id, 'council-dividend-guardians'); assert.notStrictEqual(a.color, list[0].color);
    list = CO.parse(CO.serialize([...list, a])); assert.strictEqual(list.length, 2);
    assert.throws(() => CO.make(list, { name: 'dividend guardians', awareness: 'x' }), /already/);
    assert.throws(() => CO.make(list, { name: 'X', awareness: ' ' }), /Awareness/);
    assert.strictEqual(CO.make(list, { name: 'Ação & Ouro!', awareness: 'y' }).id, 'council-acao-ouro');
    assert.strictEqual(P.soul(list[0]), null, 'no Awareness, no block');
    for (const r of ['member', 'analyst', 'scout']) assert.ok(P.soul(a, r).text.includes('Income first. Never chase.'));
    assert.ok(/All councils/.test(indexer.readme({ name: a.name, awareness: a.awareness, series: [], positions: [], capital: 1e5 })));
    const root = indexer.rootReadme(list.map((c) => ({ council: c, state: null }))); assert.ok(root.includes('[Dividend Guardians](council-dividend-guardians/README.md)'));
  });
  await t('every seat and officer has its own personality', () => {
    const all = { ...C.SEATS, ...C.OFFICERS }, ps = Object.values(all).map((x) => x.persona);
    assert.ok(ps.every((p) => p && p.length > 300)); assert.strictEqual(new Set(ps).size, ps.length);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
