// A council session from start to finish: gather data, analysts read everything, the seats deliberate, the chair decides.
'use strict';
const crypto = require('crypto');
const C = require('./config');
const store = require('./store');
const net = require('./net');
const llm = require('./llm');
const P = require('./prompts');
const B = require('./book');
const M = require('./metrics');
const rules = require('./rules');
const ledger = require('./ledger');
const prices = require('./data/prices');
const sec = require('./data/sec');
const newsSrc = require('./data/news');
const macroSrc = require('./data/macro');
const demo = require('./demo');

const SEAT = { ...C.SEATS, ...C.OFFICERS };
const nameOf = (k) => SEAT[k]?.name || k;

/* ── Data ─────────────────────────────────────────────────────────────────── */
async function gather({ signal, emit, settings = {} }) {
  const step = (key, label) => emit({ type: 'progress', key, label, done: 0, total: 1 });
  const U = C.UNIVERSE, health = {};
  net.setSecContact(settings.secContact || process.env.SEC_CONTACT || '');

  emit({ type: 'log', text: `Reading two years of daily prices for ${U.length} names` });
  const hist = {}; let done = 0;
  await net.pool([...U.map((u) => u[0]), ...C.CONTEXT.map((c) => c[0])], 4, async (t) => {
    hist[t] = await prices.history(t, { signal }).catch(() => null);
    emit({ type: 'progress', key: 'prices', label: 'Prices', done: ++done, total: U.length + C.CONTEXT.length });
  });
  health.prices = U.filter((u) => hist[u[0]]?.bars?.length > 25).length;

  step('sec', 'SEC fundamentals');
  const stocks = U.filter((u) => u[3] === 'S').map((u) => u[0]);
  let fund = { byTicker: {} }, filings = {};
  let periodic = {};
  try { const f = await sec.filings(stocks, { signal }); filings = f.recent; periodic = f.periodic; } catch (e) { if (signal?.aborted) throw e; emit({ type: 'log', text: 'SEC filings unavailable: ' + e.message }); }
  try { fund = await sec.fundamentals(stocks, { signal, latestFiling: periodic, log: (t) => emit({ type: 'log', text: t }) }); } catch (e) { if (signal?.aborted) throw e; emit({ type: 'log', text: 'SEC fundamentals unavailable: ' + e.message }); }
  health.fundamentals = Object.values(fund.byTicker).filter((f) => f && f.revTTM).length;
  emit({ type: 'progress', key: 'sec', label: 'SEC fundamentals', done: 1, total: 1 });

  const cutoff = Date.now();
  const news = await newsSrc.companyNews(U, { signal, cutoff, onProgress: (d, n) => emit({ type: 'progress', key: 'news', label: 'Company news', done: d, total: n }) });
  health.news = Object.values(news).filter((n) => n.length).length;
  step('macro', 'Macro');
  const [headlines, fred, vol, hl] = await Promise.all([
    newsSrc.macroNews(C.MACRO_FEEDS, { signal, cutoff }).catch(() => []),
    macroSrc.fred(C.FRED, { signal }).catch(() => ({})),
    macroSrc.vol({ signal }).catch(() => ({})),
    macroSrc.hyperliquid({ signal }).catch(() => ({})),
  ]);
  health.fred = Object.keys(fred).length; health.headlines = headlines.length;
  emit({ type: 'progress', key: 'macro', label: 'Macro', done: 1, total: 1 });

  const metrics = {}, context = {};
  for (const u of U) metrics[u[0]] = M.compute(u[0], hist[u[0]], hist.SPY, fund.byTicker[u[0]]);
  for (const [s] of C.CONTEXT) context[s] = M.compute(s, hist[s], null, null);
  M.percentiles(Object.values(metrics), ['mom12_1', 'r3m']);
  return { asOf: cutoff, hist, metrics, context, news, filings, headlines, fred, vol, hl, health };
}

/* ── Council machinery ────────────────────────────────────────────────────── */
function makeSession(preset, trigger) {
  const now = new Date(), id = 'S-' + now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return { id, preset, trigger, demo: llm.isMock(), startedAt: now.toISOString(), cost: 0, costBy: {}, calls: [], rounds: [], reports: {}, errors: [] };
}

async function seatCall(s, emit, { seat, round, kind, model, effort, system, user, schema, signal, mock, maxTokens, tools }) {
  emit({ type: 'turn', seat, round, kind });
  let lastLen = 0;
  const onText = (txt) => { const st = schema ? llm.partialField(txt, 'statement') : txt; if (st.length !== lastLen) { lastLen = st.length; emit({ type: 'speak', seat, round, text: st }); } };
  const onThinking = (d) => emit({ type: 'think', seat, round, text: d });
  let r, tries = 0;
  for (;;) {
    try { r = await llm.call({ model, effort, system, messages: [{ role: 'user', content: user }], schema, maxTokens, tools, onText, onThinking, signal, mock }); break; }
    catch (e) {
      if (e.cost) { s.cost += e.cost; s.costBy[kind] = (s.costBy[kind] || 0) + e.cost; }
      if (signal?.aborted || e.code === 'NO_KEY' || ++tries > 1 || e.status === 401 || e.status === 400) throw e;
      emit({ type: 'log', text: `${nameOf(seat)}: ${e.message} Retrying once.` });
    }
  }
  s.cost += r.cost; s.costBy[kind] = (s.costBy[kind] || 0) + r.cost;
  s.calls.push({ seat, round, kind, model: r.model, usage: r.usage, cost: r.cost, ms: r.ms });
  emit({ type: 'said', seat, round, kind, data: r.data, text: schema ? undefined : r.text, cost: r.cost, model: r.model });
  emit({ type: 'cost', total: s.cost });
  return schema ? r.data : r.text;
}

/* Starts the first call alone, then the rest once the first has begun streaming, so the shared prompt is cached once. */
async function warmParallel(jobs, n = 5) {
  if (!jobs.length) return [];
  let release; const warm = new Promise((r) => { release = r; });
  const first = jobs[0](() => release());
  await Promise.race([warm, first.catch(() => {}), new Promise((r) => setTimeout(r, 45000))]);
  const rest = await net.pool(jobs.slice(1), n, (j) => j(() => {}));
  return [await first, ...rest];
}

function fmtProposal(k, p) {
  if (!p) return `${nameOf(k)}: no proposal.`;
  return [`### ${nameOf(k)} (${SEAT[k].role}). Risk appetite ${p.risk_appetite}/100, cash ${p.cash_pct}%. Regime: ${p.regime}`,
    `Said: "${p.statement}"`,
    ...p.picks.map((x) => `- ${x.ticker} ${x.weight}% (conviction ${x.conviction}): ${x.thesis} Risk: ${x.key_risk}`),
    p.avoid?.length ? 'Avoid: ' + p.avoid.map((a) => `${a.ticker} (${a.reason})`).join('; ') : '',
    p.responses?.length ? 'Responses: ' + p.responses.map((r) => `to ${r.to}: ${r.point}`).join(' / ') : ''].filter(Boolean).join('\n');
}
const fmtConsensus = (c) => c.slice(0, 25).map((x) => `${x.ticker} ${x.weight.toFixed(1)}% (${x.votes} seats)`).join(', ');

/* ── The session ─────────────────────────────────────────────────────────── */
async function run({ preset = 'normal', trigger = 'manual', emit = () => {}, signal, settings = {}, device = null }) {
  const cfg = C.PRESETS[preset];
  if (!cfg) throw new Error('Unknown preset ' + preset);
  if (!llm.isMock() && !llm.hasKey()) throw Object.assign(new Error('ANTHROPIC_API_KEY is not set.'), { code: 'NO_KEY' });
  // Keep a compact log of the session so the chamber can replay it later.
  const rec = [], t0 = Date.now(), live = emit;
  emit = (e) => { if (['start', 'phase', 'turn', 'said', 'final'].includes(e.type) || (e.type === 'desk' && e.state !== 'reading')) rec.push({ ...e, ms: Date.now() - t0 }); live(e); };
  const s = makeSession(preset, trigger); s.device = device;
  const ledgerFile = s.demo ? 'demo-ledger.jsonl' : 'ledger.jsonl';
  const phases = ['data', 'analysts', ...(cfg.scout ? ['scout'] : []), 'round1', ...Array.from({ length: cfg.rounds }, (_, i) => 'debate' + (i + 1)), ...(cfg.redTeam ? ['redteam'] : []), ...(cfg.rebuttal ? ['rebuttal'] : []), 'risk', 'chair', 'record'];
  const LABEL = { data: 'Gathering data', analysts: 'Analysts read the universe', scout: 'Scout searches the web', round1: 'Independent proposals', redteam: 'Red team attacks', rebuttal: 'Rebuttals', risk: 'Risk review', chair: 'Chair decides', record: 'Recording' };
  const phase = (key) => emit({ type: 'phase', key, label: LABEL[key] || (key.startsWith('debate') ? `Debate, round ${key.slice(6)}` : key), i: phases.indexOf(key), n: phases.length });
  emit({ type: 'start', session: { id: s.id, preset, trigger, demo: s.demo, members: cfg.members, officers: [...(cfg.redTeam ? ['vex'] : []), 'sentinel', 'arbiter'], phases: phases.map((k) => ({ key: k, label: LABEL[k] || (k.startsWith('debate') ? `Debate ${k.slice(6)}` : k) })) } });
  const finish = (status, extra = {}) => { s.status = status; s.endedAt = new Date().toISOString(); s.events = rec; Object.assign(s, extra); store.writeJSON(`sessions/${s.id}.json`, s); return s; };

  try {
    /* 1. Data */
    phase('data');
    const D = await gather({ signal, emit, settings });
    s.health = D.health; s.dataAsOf = D.metrics.SPY?.asOf;
    const hist = (t) => D.hist[t] || store.readJSON(`prices/${t.replace(/[^\w.-]/g, '_')}.json`);
    const state = ledger.replay(hist, ledgerFile), last = lastSession(s.demo);
    state.lastHoldings = last ? Object.fromEntries(last.final.holdings.map((h) => [h.ticker, h])) : {};
    state.lastSummary = last?.final?.summary;
    const macro = B.macroBrief({ asOf: D.asOf, ...D });
    const mockCtx = { D, state };

    /* 2. Analysts read every name. */
    phase('analysts');
    const tickers = C.UNIVERSE.map((u) => u[0]), batches = [];
    for (let i = 0; i < tickers.length; i += cfg.analyst.batch) batches.push(tickers.slice(i, i + cfg.analyst.batch));
    const aSystem = [{ type: 'text', text: P.ANALYST }, { type: 'text', text: macro, cache_control: { type: 'ephemeral' } }];
    let aDone = 0;
    await warmParallel(batches.map((b, bi) => async (onStart) => {
      emit({ type: 'desk', batch: bi, tickers: b, state: 'reading' });
      try {
        const r = await llm.call({ model: cfg.analyst.model, effort: cfg.analyst.effort, system: aSystem, maxTokens: 24000, schema: P.SCHEMA.analyst, signal, mock: () => demo.analyst(b, mockCtx),
          messages: [{ role: 'user', content: `Write a dossier for each of these ${b.length} names, in this order: ${b.join(', ')}.\n\n${B.analystPacket(b, D)}` }],
          onThinking: onStart, onText: onStart });
        s.cost += r.cost; s.costBy.analysts = (s.costBy.analysts || 0) + r.cost; s.calls.push({ seat: 'desk', kind: 'analyst', model: r.model, usage: r.usage, cost: r.cost, ms: r.ms });
        for (const rep of r.data.reports || []) { const t = String(rep.ticker).toUpperCase(); if (b.includes(t)) s.reports[t] = rep; }
        emit({ type: 'desk', batch: bi, tickers: b, state: 'done', reports: b.map((t) => s.reports[t] ? { t, v: s.reports[t].verdict } : { t, v: null }) });
      } catch (e) {
        onStart();
        if (signal?.aborted || e.code === 'NO_KEY') throw e;
        if (e.cost) s.cost += e.cost;
        s.errors.push(`Analyst batch ${b.join(',')}: ${e.message}`);
        emit({ type: 'desk', batch: bi, tickers: b, state: 'failed' });
      }
      emit({ type: 'progress', key: 'analysts', label: 'Dossiers', done: ++aDone, total: batches.length });
      emit({ type: 'cost', total: s.cost });
    }), 6);
    const missing = tickers.filter((t) => !s.reports[t]);
    if (missing.length > tickers.length * 0.3) throw new Error(`Analysts could not cover ${missing.length} of ${tickers.length} names. Session stopped so the council never decides half-blind.`);

    /* 3. Scout (high preset): live web research shared with every seat. */
    let scout = null;
    if (cfg.scout) {
      phase('scout');
      try {
        scout = await seatCall(s, emit, { seat: 'scout', round: 0, kind: 'scout', model: cfg.scout.model, effort: cfg.scout.effort, signal, maxTokens: 24000,
          system: [{ type: 'text', text: P.SCOUT }], user: `Today is ${new Date().toUTCString()}. The council's universe is ${tickers.join(', ')}. Brief the council.`,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: cfg.scout.searches }], mock: () => demo.scout(mockCtx) });
      } catch (e) { if (signal?.aborted || e.code === 'NO_KEY') throw e; s.errors.push('Scout: ' + e.message); }
    }
    s.scout = scout;

    /* 4. The market book every seat reads. One shared, cached prefix. */
    const book = B.marketBook({ asOf: D.asOf, macro, scout, portfolio: B.portfolioSection(state), metrics: D.metrics, reports: s.reports, news: D.news, filings: D.filings, hl: D.hl });
    s.briefHash = crypto.createHash('sha256').update(book).digest('hex');
    store.writeJSON(`books/${s.id}.json`, { book });
    const system = [{ type: 'text', text: P.CHARTER }, { type: 'text', text: book, cache_control: { type: 'ephemeral' } }];
    const today = `Today is ${new Date().toUTCString()}.`;

    /* 5. Round 1: independent proposals. Nobody sees anyone else. */
    phase('round1');
    let props = {};
    const member = (k, round, user) => (onStart) => seatCall(s, (ev) => { if (ev.type === 'think' || ev.type === 'speak') onStart(); emit(ev); }, {
      seat: k, round, kind: 'member', model: cfg.member.model, effort: cfg.member.effort, system, user, schema: P.SCHEMA.member, signal, mock: () => demo.member(k, round, mockCtx, props),
    }).then((d) => { props[k] = d; onStart(); return d; }, (e) => { onStart(); throw e; });
    const r1 = (k) => `${today}\n\nYou are ${nameOf(k)}, the council's ${SEAT[k].role}. ${SEAT[k].mandate}\n\nRound 1. You have not seen anyone else's view. Propose the portfolio you believe is best right now, from the whole universe, judged by your mandate. Use 5 to 15 names; weights plus cash add up to 100. Leave "responses" empty.`;
    await settled(warmParallel(cfg.members.map((k) => member(k, 1, r1(k))), 6), s, emit);
    s.rounds.push({ key: 'round1', proposals: { ...props } });

    /* 6. Debate rounds: everyone sees everyone, challenges, and revises. */
    for (let r = 1; r <= cfg.rounds; r++) {
      phase('debate' + r);
      const others = (k) => cfg.members.filter((x) => x !== k).map((x) => fmtProposal(x, props[x])).join('\n\n');
      const snap = { ...props };
      await settled(warmParallel(cfg.members.map((k) => member(k, r + 1, `${today}\n\nYou are ${nameOf(k)}, the council's ${SEAT[k].role}. ${SEAT[k].mandate}\n\nDebate, round ${r}. Your current proposal:\n${fmtProposal(k, snap[k])}\n\nThe other seats proposed:\n${others(k)}\n\nThe council consensus so far: ${fmtConsensus(rules.consensus(snap))}\n\nChallenge the weakest arguments you see, by seat name and with evidence, and concede where someone is right. Then give your revised proposal. Changing your mind for a good reason is a strength. Put your challenges in "responses".`)), 6), s, emit);
      s.rounds.push({ key: 'debate' + r, proposals: { ...props } });
    }

    /* 7. Red team attacks the consensus. */
    let red = null;
    const proposalsText = () => cfg.members.map((k) => fmtProposal(k, props[k])).join('\n\n');
    if (cfg.redTeam) {
      phase('redteam');
      red = await seatCall(s, emit, { seat: 'vex', round: 0, kind: 'redteam', model: cfg.member.model, effort: cfg.member.effort, system, signal, schema: P.SCHEMA.redteam, mock: () => demo.redteam(mockCtx, props),
        user: `${today}\n\nYou are Vex, the council's red team. Your only job is to find what is wrong with where the council is heading: hidden concentration, crowded trades, stale theses, valuation traps, correlated bets, missing hedges and event risk. Be specific and ruthless, but fair; an attack without evidence is noise.\n\nThe council consensus: ${fmtConsensus(rules.consensus(props))}\n\nThe seats' proposals:\n${proposalsText()}` });
      s.redteam = red;
      if (cfg.rebuttal) {
        phase('rebuttal');
        const attacks = `${red.statement}\n` + red.attacks.map((a) => `- [${a.severity}/5] ${a.target}: ${a.argument}`).join('\n') + `\nCut: ${red.cut.map((c) => c.ticker + ' (' + c.reason + ')').join('; ')}\nKiller scenario: ${red.killer_scenario}`;
        const snap = { ...props };
        await settled(warmParallel(cfg.members.map((k) => member(k, 9, `${today}\n\nYou are ${nameOf(k)}, the council's ${SEAT[k].role}. ${SEAT[k].mandate}\n\nThe red team attacked the council's direction:\n${attacks}\n\nYour current proposal:\n${fmtProposal(k, snap[k])}\n\nAnswer the attacks that touch your picks: defend with evidence or concede and change. Give your final proposal. Put your answers in "responses", addressed to Vex.`)), 6), s, emit);
        s.rounds.push({ key: 'rebuttal', proposals: { ...props } });
      }
    }

    /* 8. Risk manager. Vetoes and caps are binding. */
    phase('risk');
    const cons = rules.consensus(props);
    const risk = await seatCall(s, emit, { seat: 'sentinel', round: 0, kind: 'risk', model: cfg.risk.model, effort: cfg.risk.effort, system, signal, schema: P.SCHEMA.risk, mock: () => demo.risk(mockCtx, props),
      user: `${today}\n\nYou are Sentinel, the council's risk manager. You protect the capital. Your vetoes and caps are binding on the chair. Standard limits already enforced by code: ${C.LIMITS.minPositions} to ${C.LIMITS.maxPositions} positions, at most ${C.LIMITS.maxStock}% in one stock or ${C.LIMITS.maxEtf}% in one ETF, at most ${C.LIMITS.maxSector}% in one sector, cash at most ${C.LIMITS.maxCash}%. Only tighten them where the evidence calls for it: excessive correlation, binary events, liquidity, accounting or governance red flags, or a regime that calls for more cash. Do not veto a name just because you would not have picked it.\n\nThe council consensus: ${fmtConsensus(cons)}\n\nThe seats' final proposals:\n${proposalsText()}${red ? `\n\nThe red team said: ${red.statement}\nAttacks: ${red.attacks.map((a) => `${a.target} [${a.severity}/5]: ${a.argument}`).join(' / ')}\nKiller scenario: ${red.killer_scenario}` : ''}` });
    s.risk = risk;

    /* 9. Chair decides. */
    phase('chair');
    const chair = await seatCall(s, emit, { seat: 'arbiter', round: 0, kind: 'chair', model: cfg.chair.model, effort: cfg.chair.effort, system, signal, schema: P.SCHEMA.chair, maxTokens: 64000, mock: () => demo.chair(mockCtx, props, risk),
      user: `${today}\n\nYou are Arbiter, the chair of the council. You decide the portfolio the council will hold until the next session. Weigh every seat by the quality of its evidence, not by headcount; the consensus below is a reference, not a vote you must follow. Respect the risk manager's vetoes and caps. Record the dissent you overrule. For every holding, state the thesis and the exact condition that would make the council sell it. Weights plus cash must add up to 100.\n\nThe council consensus: ${fmtConsensus(cons)}\n\nThe seats' final proposals:\n${proposalsText()}${red ? `\n\nThe red team: ${red.statement}\nAttacks: ${red.attacks.map((a) => `${a.target} [${a.severity}/5]: ${a.argument}`).join(' / ')}\nCut: ${red.cut.map((c) => c.ticker).join(', ') || 'none'}. Killer scenario: ${red.killer_scenario}` : ''}\n\nThe risk manager: ${risk.statement}\nVetoes: ${risk.vetoes.map((v) => `${v.ticker} (${v.reason})`).join('; ') || 'none'}. Caps: ${risk.caps.map((c) => `${c.ticker} ≤ ${c.max_weight}%`).join('; ') || 'none'}. Minimum cash ${risk.min_cash_pct}%. Maximum per sector ${risk.max_sector_pct}%. Concerns: ${risk.concerns.join('; ') || 'none'}.` });

    /* 10. Hard limits, then the ledger. */
    phase('record');
    const fixed = rules.enforce(chair, risk, B.META);
    s.chairRaw = chair;
    s.final = { ...chair, holdings: fixed.holdings, cash_pct: fixed.cash_pct, notes: fixed.notes };
    s.consensus = cons; s.proposals = props;
    s.previous = state.positions.map((p) => ({ ticker: p.t, weight: p.weight }));
    const entry = ledger.recordDecision(s, ledgerFile);
    s.ledgerHash = entry.hash;
    emit({ type: 'final', final: s.final, previous: s.previous, ledgerHash: entry.hash });
    finish('done');
    emit({ type: 'done', id: s.id, cost: s.cost });
    return s;
  } catch (e) {
    const cancelled = signal?.aborted;
    finish(cancelled ? 'cancelled' : 'failed', { error: cancelled ? 'Cancelled' : e.message });
    emit({ type: 'failed', id: s.id, error: cancelled ? 'Cancelled' : e.message, code: e.code, cost: s.cost });
    throw e;
  }
}

/* A round survives one seat failing; it stops only if most of the council could not answer. */
async function settled(p, s, emit) {
  try { return await p; } catch (e) {
    if (e.code === 'NO_KEY' || /cancel/i.test(e.message)) throw e;
    s.errors.push(e.message); emit({ type: 'log', text: 'A seat could not answer: ' + e.message });
    return [];
  }
}

function lastSession(demoMode) {
  const ids = store.list('sessions').filter((f) => f.endsWith('.json')).sort().reverse();
  for (const f of ids) { const x = store.readJSON('sessions/' + f); if (x?.status === 'done' && !!x.demo === !!demoMode) return x; }
  return null;
}

/* ── Cost estimate per session, from typical token counts. Real sessions report their measured cost. ── */
function estimate(presetKey) {
  const cfg = C.PRESETS[presetKey], price = (m) => C.MODELS[m];
  const think = { low: 1200, medium: 3500, high: 8000, xhigh: 14000, max: 22000 };
  const N = C.UNIVERSE.length, bookTok = 3500 + N * 230, macroTok = 3000;
  const callCost = (m, { fresh, cached, write, out }) => { const p = price(m); return (fresh * p.in + cached * p.cacheRead + write * p.cacheWrite + out * p.out) / 1e6; };
  const batches = Math.ceil(N / cfg.analyst.batch);
  let total = 0;
  total += callCost(cfg.analyst.model, { fresh: 0, cached: 0, write: macroTok + 700, out: 0 });
  total += batches * callCost(cfg.analyst.model, { fresh: cfg.analyst.batch * 650, cached: macroTok + 700, write: 0, out: cfg.analyst.batch * 190 + think[cfg.analyst.effort] });
  if (cfg.scout) total += callCost(cfg.scout.model, { fresh: 40000, cached: 0, write: 0, out: 2500 + think[cfg.scout.effort] }) + cfg.scout.searches * C.WEB_SEARCH_PER_CALL;
  const nm = cfg.members.length, outM = 1300 + think[cfg.member.effort];
  total += callCost(cfg.member.model, { fresh: 0, cached: 0, write: bookTok, out: 0 });
  total += nm * callCost(cfg.member.model, { fresh: 400, cached: bookTok, write: 0, out: outM });
  total += cfg.rounds * nm * callCost(cfg.member.model, { fresh: 900 + nm * 650, cached: bookTok, write: 0, out: outM });
  if (cfg.redTeam) total += callCost(cfg.member.model, { fresh: 900 + nm * 650, cached: bookTok, write: 0, out: 1300 + think[cfg.member.effort] });
  if (cfg.rebuttal) total += nm * callCost(cfg.member.model, { fresh: 1700, cached: bookTok, write: 0, out: outM });
  const rm = cfg.risk.model;
  total += callCost(rm, { fresh: 1500 + nm * 650, cached: rm === cfg.member.model ? bookTok : 0, write: rm === cfg.member.model ? 0 : bookTok, out: 900 + think[cfg.risk.effort] });
  const cm = cfg.chair.model;
  total += callCost(cm, { fresh: 2500 + nm * 650, cached: cm === cfg.member.model ? bookTok : 0, write: cm === cfg.member.model ? 0 : bookTok, out: 2500 + think[cfg.chair.effort] });
  return { mid: total, low: total * 0.7, high: total * 1.5, calls: 1 + batches + (cfg.scout ? 1 : 0) + nm * (1 + cfg.rounds + (cfg.rebuttal ? 1 : 0)) + (cfg.redTeam ? 1 : 0) + 2 };
}

module.exports = { run, gather, estimate, lastSession, warmParallel };
