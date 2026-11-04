// Demo mode: plausible council output built from the real measured numbers, with no AI and no cost.
// It exists to show the chamber and test the plumbing. Its picks are simple factor tilts, not advice,
// and demo sessions are written to a separate demo ledger.
'use strict';
const C = require('./config');
const M = require('./metrics');
const META = Object.fromEntries(C.UNIVERSE.map((u) => [u[0], u]));

const z = (v) => (Number.isFinite(v) ? v : 0);
const TILT = {
  atlas:  (m, u) => (u[3] === 'E' ? 0.4 : 0) + z(m.r3m) * 0.8 - z(m.vol3m) * 0.3,
  nova:   (m) => z(m.revGrowth) * 1.5 + z(m.revAccel) * 3 + z(m.r6m) * 0.3,
  anchor: (m, u) => (u[3] === 'S' ? z(m.fcfYield) * 6 + z(m.opMargin) * 0.8 - (m.pe > 60 ? 0.4 : 0) : -0.5),
  pulse:  (m) => z(m.mom12_1) + z(m.r3m) * 0.8 + (m.vs200 > 0 ? 0.2 : -0.3),
  raven:  (m) => -z(m.r3m) * 0.8 + z(m.revGrowthQ) * 0.8 + (m.rsi < 40 ? 0.3 : 0),
  forge:  (m, u) => (['Semiconductors', 'Technology'].includes(u[2]) ? 0.5 : -1) + z(m.r6m) * 0.6 + z(m.revGrowth),
  harbor: (m, u) => (['Health Care', 'Utilities', 'Bonds', 'Commodities', 'Energy', 'Consumer'].includes(u[2]) ? 0.6 : -0.6) - z(m.vol3m) * 0.8 + z(m.r3m) * 0.4,
  scout:  (m) => z(m.r1m) * 1.5 + z(m.revGrowthQ),
};
const LINES = {
  atlas: 'The regime still rewards owning risk, but breadth and credit are what I watch. I want the core in broad leadership with a real hedge sleeve.',
  nova: 'Growth is where the compounding is. I only want names where revenue is accelerating, not just high, and the numbers here show who that is.',
  anchor: 'Half this list is priced for perfection. I want cash generation and a margin of safety, and I will not pay any multiple for a story.',
  pulse: 'Trend and relative strength are the most robust signals we have. I follow the leaders until the tape says otherwise.',
  raven: 'The crowd is all in one corner. I want the names where news is improving faster than price.',
  forge: 'The AI build-out is a supply chain, and the bottleneck owners capture the spend. That is where I want to be.',
  harbor: 'Someone has to own what holds up when growth stumbles. Defensives and real assets cost little in expected return and buy real protection.',
  scout: 'The next two weeks carry real catalysts. I want names with an event the market is underpricing and none with a binary risk we cannot size.',
};

function analyst(batch, { D }) {
  return { reports: batch.map((t) => {
    const m = D.metrics[t] || {}, u = META[t], n = (D.news[t] || []).length;
    const s = z(m.mom12_1) + z(m.revGrowth) - (m.vs200 < 0 ? 0.2 : 0);
    const verdict = s > 0.6 ? 'strong_buy' : s > 0.15 ? 'buy' : s > -0.1 ? 'hold' : s > -0.35 ? 'avoid' : 'strong_avoid';
    return {
      ticker: t, verdict,
      summary: `${u[1]} (${u[2]}). ${m.ok ? `Up ${M.pc(m.r12m)} over 12 months and ${M.pc(m.r3m)} over 3, ${M.pc(m.vs200)} versus its 200-day average.` : 'Price history unavailable.'}${m.revGrowth != null ? ` Revenue growing ${M.pc(m.revGrowth)} a year.` : ''}`,
      bull: m.r3m > 0 ? 'Trend intact and leadership broadening.' : 'Sentiment washed out with fundamentals holding.',
      bear: m.pe > 50 ? 'Valuation leaves no room for a miss.' : 'Momentum is fading and estimates may roll over.',
      catalysts: n ? ['Next earnings report'] : [], news_tone: n ? (m.r1m > 0 ? 'positive' : 'mixed') : 'none', red_flags: m.dd1y < -0.45 ? ['Deep drawdown in the last year'] : [],
    };
  }) };
}

function picksFor(k, D, n = 9) {
  const f = TILT[k] || TILT.pulse;
  return C.UNIVERSE.filter((u) => D.metrics[u[0]]?.ok && u[0] !== 'SPY' && u[0] !== 'SHY')
    .map((u) => ({ u, s: f(D.metrics[u[0]], u) })).sort((a, b) => b.s - a.s).slice(0, n)
    .map(({ u, s }, i) => ({ ticker: u[0], weight: 0, conviction: Math.max(1, 5 - Math.floor(i / 2)), thesis: `${u[1]}: ${M.pc(D.metrics[u[0]].r3m)} over 3 months, score ${s.toFixed(2)} on my lens.`, key_risk: 'The trend breaks below its 50-day average.' }));
}

function member(k, round, { D }, props) {
  const picks = picksFor(k, D, 8 + (k.length % 3)), cash = k === 'harbor' || k === 'anchor' ? 10 : 5;
  const tw = picks.reduce((a, p) => a + p.conviction, 0);
  picks.forEach((p) => { p.weight = +((p.conviction / tw) * (100 - cash)).toFixed(1); });
  const others = Object.keys(props).filter((x) => x !== k);
  return {
    statement: round === 1 ? LINES[k] : `I have heard the room. ${others.length ? C.SEATS[others[0]]?.name + ' makes a fair point on concentration, so I trimmed my largest weight.' : ''} My core view stands.`,
    regime: 'Late-cycle expansion with sticky inflation', risk_appetite: { atlas: 60, nova: 80, anchor: 40, pulse: 75, raven: 50, forge: 85, harbor: 30, scout: 60 }[k] || 55,
    cash_pct: cash, picks, avoid: [], responses: round === 1 ? [] : others.slice(0, 2).map((o) => ({ to: C.SEATS[o].name, point: 'Your evidence on the leaders is solid, but your sizing ignores how correlated they are.' })),
  };
}

function redteam({ D }, props) {
  const cons = require('./rules').consensus(props).slice(0, 3);
  return { statement: `This portfolio is one trade wearing several tickers. ${cons.map((c) => c.ticker).join(', ')} all fall together in a growth scare, and nobody has priced that.`,
    attacks: cons.map((c) => ({ target: c.ticker, severity: 3, argument: `${c.ticker} is held by ${c.votes} seats for the same reason; that is crowding, not confirmation.` })),
    cut: cons.slice(0, 1).map((c) => ({ ticker: c.ticker, reason: 'Crowded and extended.' })), blind_spots: ['Correlation between the top holdings'], killer_scenario: 'A hawkish surprise lifts real yields and long-duration growth reprices 15% in a month.' };
}

function risk() {
  return { statement: 'No vetoes this week. Keep at least 5% cash and no sector above 35%: the top of this book is too correlated to run at the usual limits.', vetoes: [], caps: [], min_cash_pct: 5, max_sector_pct: 35, concerns: ['Correlation among the largest weights'] };
}

function chair(ctx, props, rk) {
  const cons = require('./rules').consensus(props).slice(0, 12);
  const tot = cons.reduce((a, c) => a + c.weight, 0) || 1;
  return {
    statement: 'The council converged more than it argued. I am taking the consensus core, trimming what the red team showed is crowded, and keeping the hedge sleeve the risk manager asked for.',
    summary: 'Own the leadership the evidence supports, size by conviction, and keep a hedge sleeve against a rates shock.',
    confidence: 62, cash_pct: Math.max(5, rk?.min_cash_pct || 0),
    holdings: cons.map((c) => ({ ticker: c.ticker, weight: +((c.weight / tot) * 95).toFixed(1), conviction: Math.min(5, c.votes), thesis: `Backed by ${c.votes} seat${c.votes === 1 ? "" : "s"} on independent evidence.`, rotate_if: 'Closes below its 200-day average or its thesis breaks on news.', champions: Object.keys(props).filter((k) => (props[k]?.picks || []).some((p) => p.ticker === c.ticker)).map((k) => C.SEATS[k].name) })),
    changes: 'Demo session: weights follow the seats\' consensus.', dissent: [{ seat: 'Raven', view: 'Wanted more in the laggards.' }], watch: ['Real yields', 'Breadth'],
  };
}

function questions(k, target, props) {
  const p = props[target], top = (p?.picks || []).slice().sort((a, b) => b.weight - a.weight)[0];
  const nm = C.SEATS[target].name;
  return { statement: `${nm}, your book rests on ${top ? top.ticker : 'a few names'}. I want to know how much of that is evidence and how much is habit.`,
    questions: [
      { to: nm, question: top ? `What exactly in the numbers says ${top.ticker} deserves ${top.weight}% rather than half that?` : 'What is your single strongest piece of evidence?' },
      { to: nm, question: 'Which of your picks falls hardest if real yields jump half a point next month, and why keep it?' },
    ] };
}

function scout() { return { digest: 'Demo mode has no live web research. In a real High session the scout searches the web for the last week of market-moving news and the next two weeks of catalysts, and every seat reads the briefing.' }; }

module.exports = { analyst, member, questions, redteam, risk, chair, scout };
