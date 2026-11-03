// Builds the briefs the council reads: the macro brief, each analyst's packet, and the full market book.
'use strict';
const { UNIVERSE, CONTEXT, LIMITS } = require('./config');
const M = require('./metrics');

const META = Object.fromEntries(UNIVERSE.map((u) => [u[0], u]));
const dstr = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '?');
const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));

function macroBrief({ asOf, fred, vol, context, metrics, headlines }) {
  const L = [`# Macro and market brief`, `Prepared ${new Date(asOf).toUTCString()}. Latest daily prices: ${metrics.SPY?.asOf || '?'}.`, '', '## Rates, inflation, credit and liquidity (FRED)'];
  for (const [id, f] of Object.entries(fred)) {
    const ch = (old) => (old == null ? '—' : (f.v - old >= 0 ? '+' : '') + (f.unit === 'index' || f.unit === '$M' || f.unit === '$B' || f.unit === 'k' ? ((f.v / old - 1) * 100).toFixed(1) + '%' : (f.v - old).toFixed(2)));
    L.push(`- ${f.label}: ${num(f.v, f.v > 1000 ? 0 : 2)}${['%', 'pp'].includes(f.unit) ? f.unit === '%' ? '%' : 'pp' : ''} (${f.date}; 1m ${ch(f.m1)}, 3m ${ch(f.m3)}, 1y ${ch(f.y1)})`);
  }
  L.push('', '## Volatility (CBOE)');
  if (vol.VIX) L.push(`- VIX ${vol.VIX}, VIX9D ${vol.VIX9D ?? '—'}, VIX3M ${vol.VIX3M ?? '—'}, VVIX ${vol.VVIX ?? '—'}, SKEW ${vol.SKEW ?? '—'}. Term structure VIX/VIX3M ${vol.VIX3M ? (vol.VIX / vol.VIX3M).toFixed(2) : '—'} (above 1 means near-term stress).`);
  L.push('', '## Cross-asset (daily closes)');
  for (const [sym, label] of CONTEXT) { const m = context[sym]; if (m?.ok) L.push(`- ${label}: ${num(m.px)} (1w ${M.pc(m.r1w)}, 1m ${M.pc(m.r1m)}, 3m ${M.pc(m.r3m)}, 12m ${M.pc(m.r12m)})`); }
  const stocks = UNIVERSE.filter((u) => u[3] === 'S').map((u) => metrics[u[0]]).filter((m) => m?.ok);
  if (stocks.length) {
    const share = (f) => Math.round((stocks.filter(f).length / stocks.length) * 100);
    L.push('', '## Breadth across the universe', `- ${share((m) => m.vs200 > 0)}% of stocks above their 200-day average, ${share((m) => m.vs50 > 0)}% above their 50-day, ${share((m) => m.offHigh > -0.05)}% within 5% of a 52-week high.`);
    if (metrics.RSP?.ok && metrics.SPY?.ok) L.push(`- Equal-weight vs cap-weight S&P 500 over 3 months: ${M.pc(metrics.RSP.r3m - metrics.SPY.r3m)}.`);
    const bySec = {};
    stocks.forEach((m) => { const s = META[m.t][2]; (bySec[s] = bySec[s] || []).push(m); });
    L.push('- Average stock return by sector (1m / 3m / 12m): ' + Object.entries(bySec).map(([s, a]) => { const avg = (k) => a.reduce((x, m) => x + (m[k] || 0), 0) / a.length; return `${s} ${M.pc(avg('r1m'), 0)} / ${M.pc(avg('r3m'), 0)} / ${M.pc(avg('r12m'), 0)}`; }).join('; ') + '.');
  }
  if (headlines?.length) { L.push('', '## Macro and market headlines (newest first)'); headlines.slice(0, 45).forEach((h) => L.push(`- ${dstr(h.t)} ${h.source}: ${h.title}`)); }
  return L.join('\n');
}

function analystPacket(batch, { metrics, news, filings, hl }) {
  return batch.map((t) => {
    const m = metrics[t], L = [`### ${t}`, m ? M.line(m, META[t]) : `${t}: no data.`];
    if (hl[t]) L.push(`Tradable as a Hyperliquid perp (${hl[t]}).`);
    const f = filings[t] || [];
    if (f.length) L.push('Recent SEC filings: ' + f.map((x) => `${x.date} ${x.form}${x.what ? ' (' + x.what + ')' : ''}`).join('; '));
    const n = news[t] || [];
    L.push(n.length ? 'Headlines:\n' + n.map((h) => `- ${dstr(h.t)} ${h.source}: ${h.title}`).join('\n') : 'Headlines: none found in the last 10 days.');
    return L.join('\n');
  }).join('\n\n');
}

function portfolioSection(state) {
  const L = ['## Current portfolio (paper record)'];
  if (!state || (!state.positions.length && !state.pending.length)) { L.push('The council holds nothing yet; this session builds the first portfolio. Capital: $' + LIMITS.startCapital.toLocaleString('en-US') + '.'); return L.join('\n'); }
  const st = state.stats;
  if (st) L.push(`Since inception (${state.series[0]?.d?.slice(0, 10)}): ${M.pc(st.ret)} vs S&P 500 ${M.pc(st.spy)} and Nasdaq-100 ${M.pc(st.qqq)}; max drawdown ${M.pc(st.maxDD)}.`);
  state.positions.forEach((p) => {
    const last = state.lastHoldings?.[p.t];
    L.push(`- ${p.t} ${num(p.weight, 1)}% of the portfolio, held since ${p.since}, P&L ${M.pc(p.pnlPct)}${last ? `. Thesis: ${last.thesis} Rotate if: ${last.rotate_if}` : ''}`);
  });
  L.push(`- Cash ${num(state.cash, 1)}%.`);
  if (state.pending.length) L.push(`A decision from ${state.pending[state.pending.length - 1].at} enters at the open of its trading day once that day's prices are in.`);
  if (state.lastSummary) L.push(`Last session's thesis: ${state.lastSummary}`);
  return L.join('\n');
}

function marketBook({ asOf, macro, scout, portfolio, metrics, reports, news, filings, hl }) {
  const L = [`# Market book, ${new Date(asOf).toISOString().slice(0, 16).replace('T', ' ')} UTC`, '', macro, ''];
  if (scout) L.push('## Scout briefing (live web research)', scout, '');
  L.push(portfolio, '', '## The universe', `${UNIVERSE.length} names, grouped by sector. Each has measured numbers, the analyst's dossier, the two newest headlines and recent filings. HL marks names tradable as Hyperliquid perps.`, '');
  const sectors = [...new Set(UNIVERSE.map((u) => u[2]))];
  for (const s of sectors) {
    L.push(`### ${s}`);
    for (const u of UNIVERSE.filter((x) => x[2] === s)) {
      const t = u[0], m = metrics[t], r = reports[t];
      const parts = [m ? M.line(m, u) : `${t}: no data.`];
      if (r) {
        parts.push(`Analyst: ${r.verdict.replace('_', ' ').toUpperCase()}. ${r.summary} Bull: ${r.bull} Bear: ${r.bear}`);
        if (r.catalysts?.length) parts.push('Catalysts: ' + r.catalysts.join('; '));
        if (r.red_flags?.length) parts.push('Red flags: ' + r.red_flags.join('; '));
        parts.push(`News tone: ${r.news_tone}.`);
      } else parts.push('Analyst: no dossier (the analyst call failed).');
      const n = (news[t] || []).slice(0, 2);
      if (n.length) parts.push('Latest: ' + n.map((h) => `${h.title} (${dstr(h.t)})`).join(' / '));
      const f = (filings[t] || []).slice(0, 2);
      if (f.length) parts.push('Filed: ' + f.map((x) => `${x.date} ${x.form}${x.what ? ' ' + x.what : ''}`).join('; '));
      if (hl[t]) parts.push('HL');
      L.push('- ' + parts.join(' | '));
    }
    L.push('');
  }
  return L.join('\n');
}

module.exports = { META, macroBrief, analystPacket, portfolioSection, marketBook };
