// A council session from start to finish: gather data, analysts read everything, the seats deliberate, the chair decides.
'use strict';
const { sha256 } = require('./hash');
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
const calSrc = require('./data/calendar');
const demo = require('./demo');

const SEAT = { ...C.SEATS, ...C.OFFICERS };
const nameOf = (k) => SEAT[k]?.name || k;
/* Who a seat is: mandate first, then its personality. The council's Awareness sits above both, in the system prompt. */
const who = (k) => `You are ${nameOf(k)}, the council's ${SEAT[k].role}. ${SEAT[k].mandate || ''}\n\nYour personality: ${SEAT[k].persona}`.replace('. \n', '.\n');


/* ── Data ─────────────────────────────────────────────────────────────────── */
async function gather({ signal, emit, settings = {} }) {
  const step = (key, label) => emit({ type: 'progress', key, label, done: 0, total: 1 });
  const U = C.UNIVERSE, health = {};
  net.setSecContact(settings.secContact || (typeof process !== 'undefined' && process.env?.SEC_CONTACT) || '');

  // Prices, SEC filings and company news come from different places, so they are gathered side by side.
  // Every source after prices gets a time budget: a slow or blocked source must never hold the council up.
  // What arrived in time is used; the rest is reported and left out.
  const within = async (ms, what, fn) => {
    const ac = new AbortController(), stop = () => ac.abort(); signal?.addEventListener('abort', stop);
    let late = false; const t = setTimeout(() => { late = true; ac.abort(); }, ms * (+(typeof process !== 'undefined' && process.env?.OAZY_BUDGET_SCALE) || 1));   // the scale is for tests
    try { return await fn(ac.signal); }
    catch (e) { if (signal?.aborted) throw e; if (!late) emit({ type: 'log', text: `${what} unavailable: ${e.message}${/403/.test(e.message) && /sec/i.test(what) && !settings.secContact ? '. The SEC asks for a name and email: add one as SEC contact in Settings.' : ''}` }); return undefined; }
    finally { clearTimeout(t); signal?.removeEventListener('abort', stop); if (late) emit({ type: 'log', text: `${what} took too long; continuing with what arrived.` }); }
  };
  emit({ type: 'log', text: `Reading two years of daily prices for ${U.length} names` });
  const hist = {}; let done = 0;
  const pricesP = net.pool([...new Set([...U.map((u) => u[0]), ...C.BENCH, ...C.CONTEXT.map((c) => c[0])])], 4, async (t) => {
    hist[t] = await prices.history(t, { signal }).catch(() => null);
    emit({ type: 'progress', key: 'prices', label: 'Prices', done: ++done, total: new Set([...U.map((u) => u[0]), ...C.BENCH]).size + C.CONTEXT.length });
  }, signal);
  step('sec', 'SEC filings');
  const stocks = U.filter((u) => u[3] === 'S').map((u) => u[0]);
  let fund = { byTicker: {} }, filings = {};
  const secP = (async () => {
    let periodic = {};
    const f = await within(90e3, 'SEC filings', (sg) => sec.filings(stocks, { signal: sg }));
    if (f) { filings = f.recent; periodic = f.periodic; }
    await within(240e3, 'SEC fundamentals', (sg) => sec.fundamentals(stocks, { signal: sg, latestFiling: periodic, into: fund.byTicker, onProgress: (d, n) => emit({ type: 'progress', key: 'sec', label: 'SEC fundamentals', done: d, total: n }) }));
  })();
  const cutoff = Date.now(), news = {};
  const newsP = within(120e3, 'Company news', (sg) => newsSrc.companyNews(U, { signal: sg, cutoff, into: news, onProgress: (d, n) => emit({ type: 'progress', key: 'news', label: 'Company news', done: d, total: n }) }));
  await Promise.all([pricesP, secP, newsP]);
  if (signal?.aborted) throw new Error('cancelled');
  health.prices = U.filter((u) => hist[u[0]]?.bars?.length > 25).length;
  health.fundamentals = Object.values(fund.byTicker).filter((x) => x && x.revTTM).length;
  health.news = Object.values(news).filter((n) => n.length).length;
  step('macro', 'Macro and rates');
  const [headlines, fred, vol, calendar] = await Promise.all([
    within(60e3, 'Macro headlines', (sg) => newsSrc.macroNews(C.MACRO_FEEDS, { signal: sg, cutoff })).then((x) => x || []),
    within(60e3, 'FRED rates', (sg) => macroSrc.fred(C.FRED, { signal: sg })).then((x) => x || {}),
    within(30e3, 'Volatility', (sg) => macroSrc.vol({ signal: sg })).then((x) => x || {}),
    within(45e3, 'Market calendar', (sg) => calSrc.upcoming({ days: 42, signal: sg })).then((x) => x || null),
  ]);
  health.fred = Object.keys(fred).length; health.headlines = headlines.length; health.calendar = calendar?.events?.length || 0;
  emit({ type: 'progress', key: 'macro', label: 'Macro', done: 1, total: 1 });

  const metrics = {}, context = {};
  for (const u of U) metrics[u[0]] = M.compute(u[0], hist[u[0]], hist.SPY, fund.byTicker[u[0]]);
  for (const [s] of C.CONTEXT) context[s] = M.compute(s, hist[s], null, null);
  M.percentiles(Object.values(metrics), ['mom12_1', 'r3m']);
  return { asOf: cutoff, hist, metrics, context, news, filings, headlines, fred, vol, calendar, health };
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
/* apply: how the decision enters the record, decided before the meeting ('now', 'open', or a date for that day's open),
   or null to leave it waiting for applyDecision() (Oazy Research asks at the end of the meeting). */
async function run({ preset = 'normal', rounds = C.ROUNDS.default, trigger = 'manual', emit = () => {}, signal, settings = {}, device = null, apply = 'open', council = null }) {
  const cfg = C.PRESETS[preset];
  if (!cfg) throw new Error('Unknown preset ' + preset);
  const plan = C.roundPlan(rounds);
  if (!llm.isMock() && !llm.hasKey()) throw Object.assign(new Error('ANTHROPIC_API_KEY is not set.'), { code: 'NO_KEY' });
  // Keep a compact log of the session so the chamber can replay it later.
  const rec = [], t0 = Date.now(), live = emit;
  emit = (e) => { if (['start', 'phase', 'turn', 'said', 'final', 'pairs', 'reveal', 'hunt'].includes(e.type) || (e.type === 'desk' && e.state !== 'reading')) rec.push({ ...e, ms: Date.now() - t0 }); live(e); };
  const s = makeSession(preset, trigger); s.device = device; s.plan = plan;
  if (council) s.council = { id: council.id, name: council.name, awareness: council.awareness || '' };
  const soulOf = (role) => { const b = P.soul(council, role); return b ? [b] : []; };
  const ledgerFile = s.demo ? 'demo-ledger.jsonl' : 'ledger.jsonl';
  const phases = ['data', 'analysts', 'scout', 'round1', ...plan.map((_, i) => 'debate' + (i + 1)), 'redteam', 'rebuttal', 'risk', 'chair', 'record'];
  const LABEL = { data: 'Gathering the evidence', analysts: 'The desk reads the universe', scout: 'Scout searches the web', round1: 'The blind vote', redteam: 'The red team attacks', rebuttal: 'Rebuttals', risk: 'Risk review', chair: 'The chair decides', record: 'The decision' };
  const labelOf = (k) => LABEL[k] || (k.startsWith('debate') ? C.FORMATS[plan[+k.slice(6) - 1]].label : k);
  const phase = (key) => emit({ type: 'phase', key, label: labelOf(key), format: key.startsWith('debate') ? plan[+key.slice(6) - 1] : null, i: phases.indexOf(key), n: phases.length });
  emit({ type: 'start', session: { id: s.id, preset, trigger, demo: s.demo, plan, members: cfg.members, officers: ['vex', 'sentinel', 'arbiter'], phases: phases.map((k) => ({ key: k, label: labelOf(k), format: k.startsWith('debate') ? plan[+k.slice(6) - 1] : null })) } });
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
    const aSystem = [{ type: 'text', text: P.ANALYST }, ...soulOf('analyst'), { type: 'text', text: macro, cache_control: { type: 'ephemeral' } }];
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
    const calNote = D.calendar?.events?.length ? `\n\nThe council already has the dates of the scheduled events below. Do not spend searches finding dates; search what the market expects from the ones that matter and anything unscheduled.\n\n${calSrc.brief(D.calendar)}` : '';
    {
      phase('scout');
      const ask = (tool, extra = '') => seatCall(s, emit, { seat: 'scout', round: 0, kind: 'scout', model: cfg.scout.model, effort: cfg.scout.effort, signal, maxTokens: 24000,
        system: [{ type: 'text', text: P.SCOUT }, ...soulOf('scout')], user: `Today is ${new Date().toUTCString()}. The council's universe is ${tickers.join(', ')}. Brief the council.${calNote}${extra}`,
        tools: [{ type: tool, name: 'web_search', max_uses: cfg.scout.searches }], mock: () => demo.scout(mockCtx) });
      const okSearches = () => s.calls.at(-1)?.usage?.web_search_ok ?? 99;
      try {
        // Plain web search hands the scout readable results; the filtering variant routes them through code and has come back thin.
        try { scout = await ask('web_search_20250305'); }
        catch (e) { if (signal?.aborted || e.code === 'NO_KEY' || e.status !== 400) throw e; scout = await ask('web_search_20260209'); }
        if (!llm.isMock() && okSearches() < 3) {
          emit({ type: 'log', text: 'Scout: too few searches came back. Searching again.' });
          const again = await ask('web_search_20250305', ' Your last attempt got too few search results. Use several short, simple queries (one topic each) and keep searching until you have enough to brief the council.');
          if (again && again.length > (scout || '').length * 0.6) scout = again;
        }
      } catch (e) { if (signal?.aborted || e.code === 'NO_KEY') throw e; if (!scout) s.errors.push('Scout: ' + e.message); }
    }
    s.scout = scout;

    /* 4. The market book every seat reads. One shared, cached prefix. */
    const book = B.marketBook({ asOf: D.asOf, macro, calendar: calSrc.brief(D.calendar), scout, portfolio: B.portfolioSection(state), metrics: D.metrics, reports: s.reports, news: D.news, filings: D.filings });
    s.briefHash = sha256(book);
    const system = [{ type: 'text', text: P.CHARTER }, ...soulOf('member'), { type: 'text', text: book, cache_control: { type: 'ephemeral' } }];
    const today = `Today is ${new Date().toUTCString()}.`;

    /* 5. The blind vote: every seat proposes privately, then the ballots are revealed together. */
    phase('round1');
    let props = {};
    const member = (k, round, user, fmt) => (onStart) => seatCall(s, (ev) => { if (ev.type === 'think' || ev.type === 'speak') onStart(); emit(ev); }, {
      seat: k, round, kind: 'member', model: cfg.member.model, effort: cfg.member.effort, system, user, schema: P.SCHEMA.member, signal, mock: () => demo.member(k, round, mockCtx, props, fmt),
    }).then((d) => { props[k] = d; onStart(); return d; }, (e) => { onStart(); throw e; });
    const r1 = (k) => `${today}\n\n${who(k)}\n\nThe blind vote. Your ballot is sealed: no seat sees any other seat's view until every ballot is in, and then all are revealed together. Do not guess what the others will say or position against them. Propose the portfolio you believe is best right now, from the whole universe, judged by your mandate. Hold as many or as few names as you judge best, at any weights; weights plus cash add up to 100. Leave "responses" empty.`;
    await settled(warmParallel(cfg.members.map((k) => member(k, 1, r1(k))), 6), s, emit);
    s.rounds.push({ key: 'round1', proposals: { ...props } });
    emit({ type: 'reveal', round: 1, seats: cfg.members.filter((k) => props[k]) });

    /* 6. Debate rounds, each in its own format (see C.FORMATS). */
    const cast = cfg.members;
    for (let r = 1; r <= plan.length; r++) {
      const fmt = plan[r - 1], key = 'debate' + r, round = r + 1;
      phase(key);
      const snap = { ...props }, cons = fmtConsensus(rules.consensus(snap));
      const intro = (k) => `${today}\n\n${who(k)}\n\nDebate round ${r} of ${plan.length}: ${C.FORMATS[fmt].label}.`;
      const mine = (k) => `Your current proposal:\n${fmtProposal(k, snap[k])}`;
      const others = (k) => cast.filter((x) => x !== k).map((x) => fmtProposal(x, snap[x])).join('\n\n');
      const tail = 'Then give your revised proposal. Changing your mind for a good reason is a strength; holding firm needs evidence.';
      let ask;
      if (fmt === 'cross') {
        // Everyone questions one seat and is questioned by one seat; the pairing shifts with the round.
        const shift = 1 + ((r - 1) % (cast.length - 1)), target = Object.fromEntries(cast.map((k, i) => [k, cast[(i + shift) % cast.length]]));
        emit({ type: 'pairs', round, format: fmt, pairs: cast.map((k) => [k, target[k]]) });
        const qs = {};
        await settled(warmParallel(cast.map((k) => (onStart) => seatCall(s, (ev) => { if (ev.type === 'think' || ev.type === 'speak') onStart(); emit(ev); }, {
          seat: k, round, kind: 'question', model: cfg.member.model, effort: cfg.member.effort, system, schema: P.SCHEMA.questions, signal, mock: () => demo.questions(k, target[k], snap),
          user: `${intro(k)} You are cross-examining ${nameOf(target[k])}. Read their proposal and put 2 or 3 hard, specific questions to them: the weakest pick, the shakiest number, the assumption that matters most. No speeches; questions they must answer.\n\n${nameOf(target[k])}'s proposal:\n${fmtProposal(target[k], snap[target[k]])}\n\n${mine(k)}`,
        }).then((d) => { qs[k] = d; onStart(); return d; }, (e) => { onStart(); throw e; })), 6), s, emit);
        ask = (k) => { const from = cast.filter((x) => target[x] === k && qs[x]); return `${intro(k)} You were cross-examined. Answer every question directly, in "responses" addressed to the seat that asked, and concede where the question exposed a real weakness.\n\nQuestions put to you:\n${from.map((x) => qs[x].questions.map((q) => `- ${nameOf(x)}: ${q.question}`).join('\n')).join('\n') || '- none arrived'}\n\n${mine(k)}\n\nThe consensus so far: ${cons}\n\n${tail}`; };
      } else if (fmt === 'duel' || fmt === 'steelman') {
        const far = farthest(snap, cast);
        const pairs = fmt === 'duel' ? duelPairs(snap, cast) : Object.fromEntries(cast.map((k) => [k, far[k]]));
        emit({ type: 'pairs', round, format: fmt, pairs: cast.map((k) => [k, pairs[k]]) });
        ask = fmt === 'duel'
          ? (k) => `${intro(k)} You are paired with ${nameOf(pairs[k])}, the seat whose portfolio is furthest from yours. Rebut their proposal directly: where exactly are they wrong, with evidence from the market book, and what in their case do you have no answer to? Put your rebuttal in "responses" addressed to ${nameOf(pairs[k])}.\n\n${nameOf(pairs[k])}'s proposal:\n${fmtProposal(pairs[k], snap[pairs[k]])}\n\n${mine(k)}\n\n${tail}`
          : (k) => `${intro(k)} Steelman ${nameOf(pairs[k])}, whose view is furthest from yours: make the strongest honest case for their portfolio, better than they made it themselves. Then say what in it you now accept. Put the steelman in "responses" addressed to ${nameOf(pairs[k])}.\n\n${nameOf(pairs[k])}'s proposal:\n${fmtProposal(pairs[k], snap[pairs[k]])}\n\n${mine(k)}\n\n${tail}`;
      } else if (fmt === 'shoes') {
        // Each seat argues as the seat it disagrees with most: that seat's mandate and character, not its own.
        const far = farthest(snap, cast);
        emit({ type: 'pairs', round, format: fmt, pairs: cast.map((k) => [k, far[k]]) });
        const asSeat = (x) => `${nameOf(x)}, the council's ${SEAT[x].role}. Their mandate: ${SEAT[x].mandate || ''} Their character: ${SEAT[x].persona}`;
        ask = (k) => `${intro(k)} Step into the shoes of ${asSeat(far[k])}\n\nThey are the seat whose portfolio is furthest from yours. For this round, think the way they do. Rebuild the council's portfolio from scratch as ${nameOf(far[k])} would build it from the market book, with their mandate, their temperament and their blind spots, and explain their reasoning better than they did. Put that in "responses" addressed to ${nameOf(far[k])}: the names and weights they should hold, and why. Then step back into your own seat and say what their view taught you.\n\n${nameOf(far[k])}'s current proposal:\n${fmtProposal(far[k], snap[far[k]])}\n\n${mine(k)}\n\nYour revised proposal is your own, judged by your own mandate. ${tail}`;
      } else if (fmt === 'hunt') {
        // The council's blind spots: names nobody holds. Each seat brings one to the table.
        const held = [...new Set(cast.flatMap((x) => (snap[x]?.picks || []).map((p) => p.ticker)))];
        emit({ type: 'hunt', round, held });
        ask = (k) => `${intro(k)} The hunt. The council has been looking at the same names. These ${held.length} companies are already held by at least one seat: ${held.join(', ') || 'none'}.\n\nGo through the rest of the universe and the desk's dossiers and find the one company nobody holds that most deserves a place, judged by your mandate. Pitch it: what the council is missing, the evidence, and what would prove you wrong. Put the pitch in "responses" addressed to the council, starting with the ticker. Add it to your own proposal at a weight you would defend, unless the evidence truly finds nothing; then say so plainly.\n\n${mine(k)}\n\nThe consensus so far: ${cons}\n\n${tail}`;
      } else if (fmt === 'devil') {
        ask = (k) => `${intro(k)} Play devil's advocate against yourself. Take your two largest picks and attack each as hard as the evidence allows: the bear case, the crowding, the valuation, the scenario that breaks it. Then decide, honestly, whether each survives. Put the attacks in "responses" addressed to yourself (${nameOf(k)}).\n\n${mine(k)}\n\nThe consensus so far: ${cons}\n\n${tail}`;
      } else if (fmt === 'premortem') {
        ask = (k) => `${intro(k)} Pre-mortem. Imagine it is six months from now and the council's current consensus portfolio has lost 20% while the S&P 500 rose. From your mandate, write the most plausible story of why it happened: which holdings, which shock, which assumption. Then change your proposal so that story cannot happen to it. Put the story in "responses" addressed to the council.\n\nThe consensus so far: ${cons}\n\n${mine(k)}\n\n${tail}`;
      } else if (fmt === 'closing') {
        ask = (k) => `${intro(k)} Closing arguments. This is your last word before the red team, the risk manager and the chair. Give your final proposal. In "statement", tell the chair the single most important reason to follow it. In "responses", name the seat whose argument most changed your mind during the debate and why (or say no one did).\n\n${mine(k)}\n\nThe other seats:\n${others(k)}\n\nThe consensus so far: ${cons}`;
      } else {
        ask = (k) => `${intro(k)} Open floor. ${mine(k)}\n\nThe other seats proposed:\n${others(k)}\n\nThe consensus so far: ${cons}\n\nChallenge the weakest arguments you see, by seat name and with evidence, and concede where someone is right. Put your challenges in "responses". ${tail}`;
      }
      await settled(warmParallel(cast.map((k) => member(k, round, ask(k), fmt)), 6), s, emit);
      s.rounds.push({ key, format: fmt, proposals: { ...props } });
    }

    /* 7. Red team attacks the consensus, then every seat answers it. */
    const proposalsText = () => cfg.members.map((k) => fmtProposal(k, props[k])).join('\n\n');
    phase('redteam');
    const red = await seatCall(s, emit, { seat: 'vex', round: 0, kind: 'redteam', model: cfg.officer.model, effort: cfg.officer.effort, system, signal, schema: P.SCHEMA.redteam, mock: () => demo.redteam(mockCtx, props),
      user: `${today}\n\n${who('vex')}\n\nYour only job is to find what is wrong with where the council is heading: hidden concentration, crowded trades, stale theses, valuation traps, correlated bets, missing hedges and event risk. Be specific and ruthless, but fair; an attack without evidence is noise.\n\nThe council consensus: ${fmtConsensus(rules.consensus(props))}\n\nThe seats' proposals:\n${proposalsText()}` });
    s.redteam = red;
    phase('rebuttal');
    {
      const attacks = `${red.statement}\n` + red.attacks.map((a) => `- [${a.severity}/5] ${a.target}: ${a.argument}`).join('\n') + `\nCut: ${red.cut.map((c) => c.ticker + ' (' + c.reason + ')').join('; ')}\nKiller scenario: ${red.killer_scenario}`;
      const snap = { ...props };
      await settled(warmParallel(cfg.members.map((k) => member(k, 90, `${today}\n\n${who(k)}\n\nThe red team attacked the council's direction:\n${attacks}\n\nYour current proposal:\n${fmtProposal(k, snap[k])}\n\nAnswer the attacks that touch your picks: defend with evidence or concede and change. Give your final proposal. Put your answers in "responses", addressed to Vex.`)), 6), s, emit);
      s.rounds.push({ key: 'rebuttal', proposals: { ...props } });
    }

    /* 8. Risk manager. Vetoes and caps are binding. */
    phase('risk');
    const cons = rules.consensus(props);
    const risk = await seatCall(s, emit, { seat: 'sentinel', round: 0, kind: 'risk', model: cfg.officer.model, effort: cfg.officer.effort, system, signal, schema: P.SCHEMA.risk, mock: () => demo.risk(mockCtx, props),
      user: `${today}\n\n${who('sentinel')}\n\nYou protect the capital. Your vetoes and caps are binding on the chair. There are no fixed limits: any number of holdings, any weight, any amount of cash. Your rulings are the only limits on the chair, so set them only where the evidence calls for it: excessive correlation, binary events, liquidity, accounting or governance red flags, or a regime that calls for more cash. Do not veto a name just because you would not have picked it.\n\nThe council consensus: ${fmtConsensus(cons)}\n\nThe seats' final proposals:\n${proposalsText()}${red ? `\n\nThe red team said: ${red.statement}\nAttacks: ${red.attacks.map((a) => `${a.target} [${a.severity}/5]: ${a.argument}`).join(' / ')}\nKiller scenario: ${red.killer_scenario}` : ''}` });
    s.risk = risk;

    /* 9. Chair decides. */
    phase('chair');
    const chair = await seatCall(s, emit, { seat: 'arbiter', round: 0, kind: 'chair', model: cfg.chair.model, effort: cfg.chair.effort, system, signal, schema: P.SCHEMA.chair, maxTokens: 64000, mock: () => demo.chair(mockCtx, props, risk),
      user: `${today}\n\n${who('arbiter')}\n\nYou decide the portfolio the council will hold until the next session. Weigh every seat by the quality of its evidence, not by headcount; the consensus below is a reference, not a vote you must follow. Respect the risk manager's vetoes and caps. Record the dissent you overrule. For every holding, state the thesis and the exact condition that would make the council sell it. Weights plus cash must add up to 100.\n\nThe council consensus: ${fmtConsensus(cons)}\n\nThe seats' final proposals:\n${proposalsText()}${red ? `\n\nThe red team: ${red.statement}\nAttacks: ${red.attacks.map((a) => `${a.target} [${a.severity}/5]: ${a.argument}`).join(' / ')}\nCut: ${red.cut.map((c) => c.ticker).join(', ') || 'none'}. Killer scenario: ${red.killer_scenario}` : ''}\n\nThe risk manager: ${risk.statement}\nVetoes: ${risk.vetoes.map((v) => `${v.ticker} (${v.reason})`).join('; ') || 'none'}. Caps: ${risk.caps.map((c) => `${c.ticker} ≤ ${c.max_weight}%`).join('; ') || 'none'}. Minimum cash ${risk.min_cash_pct}%. Maximum per sector ${risk.max_sector_pct}%. Concerns: ${risk.concerns.join('; ') || 'none'}.` });

    /* 10. Hard limits, then the ledger. */
    phase('record');
    const fixed = rules.enforce(chair, risk, B.META);
    s.chairRaw = chair;
    s.final = { ...chair, holdings: fixed.holdings, cash_pct: fixed.cash_pct, notes: fixed.notes };
    s.consensus = cons; s.proposals = props;
    s.previous = state.positions.map((p) => ({ ticker: p.t, weight: p.weight }));
    s.ledgerFile = ledgerFile;
    if (!apply) {
      emit({ type: 'final', final: s.final, previous: s.previous, ledgerHash: null, waiting: true });
      finish('decided');
      emit({ type: 'decided', id: s.id, cost: s.cost });
      return s;
    }
    await applyDecision(s, apply, { signal });
    emit({ type: 'final', final: s.final, previous: s.previous, ledgerHash: s.ledgerHash, applied: s.applied });
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

/* Writes a finished meeting's decision to the ledger. how: 'now' (at the prices of this moment), 'open' (the next open),
   or 'YYYY-MM-DD' (the open of that day, or the next trading day after it). */
async function applyDecision(s, how, { signal } = {}) {
  const file = s.ledgerFile || (s.demo ? 'demo-ledger.jsonl' : 'ledger.jsonl');
  let apply;
  if (how === 'now') {
    const held = ledger.replay((t) => store.readJSON(`prices/${t.replace(/[^\w.-]/g, '_')}.json`), file).positions.map((p) => p.t);
    const want = [...new Set(['SPY', 'QQQ', ...held, ...s.final.holdings.map((h) => h.ticker)])], px = {};
    await net.pool(want, 4, async (t) => { const q = await prices.lastPrice(t, signal).catch(() => null); if (q?.price) px[t] = q.price; });
    apply = { mode: 'now', px, pxAt: new Date().toISOString() };
  } else if (how === 'open' || how == null) apply = { mode: 'open', on: ledger.nextOpenDate() };
  else if (/^\d{4}-\d{2}-\d{2}$/.test(how)) apply = { mode: 'open', on: how < ledger.nextOpenDate() ? ledger.nextOpenDate() : how };
  else throw new Error('Unknown way to apply: ' + how);
  const entry = ledger.recordDecision(s, file, apply);
  s.ledgerHash = entry.hash; s.applied = { mode: apply.mode, on: apply.on || null, at: entry.at }; s.status = 'done';
  delete s.ledgerFile;
  store.writeJSON(`sessions/${s.id}.json`, s);
  return s;
}

/* How much two proposals hold in common: the sum of the smaller weight of each shared name (0 to 100). */
function overlap(a, b) {
  if (!a || !b) return 0;
  const w = Object.fromEntries((b.picks || []).map((x) => [String(x.ticker).toUpperCase(), +x.weight || 0]));
  return (a.picks || []).reduce((t, x) => t + Math.min(+x.weight || 0, w[String(x.ticker).toUpperCase()] || 0), 0);
}
/* For each seat, the seat whose proposal is furthest from its own. */
function farthest(props, cast) {
  return Object.fromEntries(cast.map((k) => [k, cast.filter((x) => x !== k).sort((x, y) => overlap(props[k], props[x]) - overlap(props[k], props[y]))[0]]));
}
/* Pairs every seat with a partner, most-disagreeing pairs first (an odd seat out duels the seat furthest from it). */
function duelPairs(props, cast) {
  const all = [];
  for (let i = 0; i < cast.length; i++) for (let j = i + 1; j < cast.length; j++) all.push([cast[i], cast[j], overlap(props[cast[i]], props[cast[j]])]);
  all.sort((a, b) => a[2] - b[2]);
  const out = {};
  for (const [a, b] of all) if (!out[a] && !out[b]) { out[a] = b; out[b] = a; }
  const far = farthest(props, cast);
  for (const k of cast) if (!out[k]) out[k] = far[k];
  return out;
}

/* A finished meeting whose decision João chose not to apply: kept as a record, the portfolio is unchanged. */
function skipDecision(s) {
  s.status = 'skipped'; s.applied = null; delete s.ledgerFile;
  store.writeJSON(`sessions/${s.id}.json`, s);
  return s;
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
function estimate(presetKey, rounds = C.ROUNDS.default) {
  const cfg = C.PRESETS[presetKey], price = (m) => C.MODELS[m], plan = C.roundPlan(rounds);
  const think = { low: 1200, medium: 3500, high: 8000, xhigh: 14000, max: 22000 };
  const N = C.UNIVERSE.length, bookTok = 3500 + N * 230, macroTok = 3000;
  const callCost = (m, { fresh, cached, write, out }) => { const p = price(m); return (fresh * p.in + cached * p.cacheRead + write * p.cacheWrite + out * p.out) / 1e6; };
  const batches = Math.ceil(N / cfg.analyst.batch);
  const shared = (m) => (m === cfg.member.model ? { cached: bookTok, write: 0 } : { cached: 0, write: bookTok });
  let total = 0, calls = 0;
  total += callCost(cfg.analyst.model, { fresh: 0, cached: 0, write: macroTok + 700, out: 0 });
  total += batches * callCost(cfg.analyst.model, { fresh: cfg.analyst.batch * 650, cached: macroTok + 700, write: 0, out: cfg.analyst.batch * 190 + think[cfg.analyst.effort] }); calls += batches;
  total += callCost(cfg.scout.model, { fresh: 40000, cached: 0, write: 0, out: 2500 + think[cfg.scout.effort] }) + cfg.scout.searches * C.WEB_SEARCH_PER_CALL; calls++;
  const nm = cfg.members.length, outM = 1300 + think[cfg.member.effort];
  total += callCost(cfg.member.model, { fresh: 0, cached: 0, write: bookTok, out: 0 });
  total += nm * callCost(cfg.member.model, { fresh: 400, cached: bookTok, write: 0, out: outM }); calls += nm;
  for (const f of plan) {
    const fresh = f === 'floor' || f === 'closing' ? 900 + nm * 650 : 2200;
    total += C.FORMATS[f].calls * nm * callCost(cfg.member.model, { fresh, cached: bookTok, write: 0, out: outM }); calls += C.FORMATS[f].calls * nm;
  }
  const om = cfg.officer.model;
  total += callCost(om, { fresh: 900 + nm * 650, ...shared(om), out: 1300 + think[cfg.officer.effort] }); calls++;                 // red team
  total += nm * callCost(cfg.member.model, { fresh: 1700, cached: bookTok, write: 0, out: outM }); calls += nm;                   // rebuttals
  total += callCost(om, { fresh: 1500 + nm * 650, cached: bookTok, write: 0, out: 900 + think[cfg.officer.effort] }); calls++;      // risk
  const cm = cfg.chair.model;
  total += callCost(cm, { fresh: 2500 + nm * 650, ...shared(cm), out: 2500 + think[cfg.chair.effort] }); calls++;
  return { mid: total, low: total * 0.7, high: total * 1.5, calls, plan };
}

module.exports = { run, applyDecision, skipDecision, gather, estimate, lastSession, warmParallel, overlap, duelPairs, farthest };
