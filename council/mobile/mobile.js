/* Oazy Research for the phone. It only reads: GitHub keeps both paper indexes (Core and Council) current in the futuremodel
   repository, and this app shows them, with a saved copy for when the phone is offline. */
'use strict';
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v, d = 2) => (v == null || !isFinite(v) ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pc = (v, d = 1) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
const cls = (v) => (v == null ? '' : v >= 0 ? 'up' : 'down');
const fw = (w) => (w == null ? '—' : (+w).toFixed(1) + '%');
const when = (ts) => new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const LS = { get: (k, d) => { try { const v = localStorage.getItem('oc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('oc.' + k, JSON.stringify(v)); } catch {} } };

const RAW = 'https://raw.githubusercontent.com/jpcpais01/futuremodel/main/index/';
let pf = LS.get('pf', 'core');
let S = null, P = null, sess = null, screen = 'portfolio', fetched = null;
const demo = false, SEAT = {}, UNI = {}, DATA = {};

function toast(m, err) { const t = $('#toast'); t.textContent = m; t.className = 'on' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 3800); }

if (window.Native) document.documentElement.classList.add('native');

/* ── Reading the repository ─────────────────────────────────────────── */
async function getJSON(rel, fresh) {
  const key = 'idx:' + rel;
  try {
    const r = await fetch(RAW + rel + (fresh ? '?t=' + Date.now() : ''), { cache: 'no-store' });
    if (!r.ok) throw new Error('GitHub answered ' + r.status);
    const text = await r.text(), data = JSON.parse(text);
    try { localStorage.setItem(key, text); } catch {}
    return { data };
  } catch (e) {
    try { const t = localStorage.getItem(key); if (t) return { data: JSON.parse(t), cached: true }; } catch {}
    return { error: e.message };
  }
}
const OC = {
  portfolio: () => DATA[pf] || null,
  sessions: () => DATA.council?.sessions || [],
  session: async (id) => { const k = 'sess:' + id; try { const t = localStorage.getItem(k); if (t) return JSON.parse(t); } catch {} const r = await getJSON('council/sessions/' + id + '.json'); return r.data || null; },
};

/* ── Boot ────────────────────────────────────────────────────────────── */
function start() {
  setMode(pf, true);
  for (const k of ['core', 'council']) { try { const t = localStorage.getItem(`idx:${k}/state.json`); if (t) DATA[k] = JSON.parse(t); } catch {} }
  refresh(); show('portfolio');
  load(true);
  setInterval(() => { if (!document.hidden && !sess) load(true); }, 5 * 60e3);
  $('#d-ver').textContent = 'Oazy Research for Android · reads github.com/jpcpais01/futuremodel';
}
async function load(fresh) {
  const rs = await Promise.all(['core', 'council'].map((k) => getJSON(k + '/state.json', fresh)));
  rs.forEach((r, i) => { if (r.data) DATA[['core', 'council'][i]] = r.data; });
  fetched = rs.find((r) => r.error && !r.data) ? 'bad' : rs.some((r) => r.cached) ? 'cached' : 'ok';
  conn(fetched === 'ok' ? 'ok' : 'bad');
  if (fetched !== 'ok') toast(rs.find((r) => r.error)?.error ? 'Offline: showing the saved copy.' : 'Showing the saved copy.');
  refresh();
}
function conn(state) { $('#conn').className = 'conn ' + state; }
function setup(st) {
  Object.assign(SEAT, st.seats || {}, st.officers || {}); (st.universe || []).forEach((u) => (UNI[u.t] = u));
  if (!Ch.ready && st.universe) Ch.init(st);
}
function refresh() {
  for (const k of ['council', 'core']) if (DATA[k]) (DATA[k].names || []).forEach((u) => (UNI[u.t] = { ...UNI[u.t], ...u }));
  if (DATA.council) { S = DATA.council; setup(S); }
  P = OC.portfolio();
  renderIdle();
  if (screen !== 'session') show(screen);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && !sess) load(true); });

/* Core or Council: which index the screens show. The Council and Sessions tabs only exist for the council. */
function setMode(k, quiet) {
  pf = k === 'council' ? 'council' : 'core'; LS.set('pf', pf);
  $('#mode').classList.toggle('right', pf === 'council'); $$('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.m === pf));
  document.body.dataset.pf = pf;
  $$('#tabs button').forEach((b) => b.classList.toggle('hidden', pf === 'core' && (b.dataset.s === 'council' || b.dataset.s === 'sessions')));
  P = OC.portfolio();
  if (!quiet) show(pf === 'core' && (screen === 'council' || screen === 'sessions' || screen === 'session') ? 'portfolio' : screen);
}
$$('#mode button').forEach((b) => (b.onclick = () => { if (b.dataset.m === pf) return; setMode(b.dataset.m); }));
$$('#tabs button').forEach((b) => (b.onclick = () => show(b.dataset.s)));
const TABS = ['portfolio', 'record', 'council', 'sessions', 'settings'];
function show(s) {
  const same = s === screen; screen = s; if (!same) window.scrollTo(0, 0);
  document.body.dataset.screen = s;
  const tab = s === 'session' ? 'sessions' : s;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.s === tab));
  const vis = TABS.filter((t) => !$(`#tabs button[data-s="${t}"]`).classList.contains('hidden'));
  $('.tab-glow').style.width = `calc((100% - 12px) / ${vis.length})`; $('.tab-glow').style.transform = `translateX(${Math.max(0, vis.indexOf(tab)) * 100}%)`;
  $$('.screen').forEach((x) => x.classList.toggle('on', x.id === 's-' + s));
  if (s === 'portfolio') renderPortfolio(); if (s === 'record') renderRecord(); if (s === 'sessions') renderSessions(); if (s === 'council') renderIdle();
}
/* A steady colour for each sector, used by the lettered fund badges. */
const hueOf = (t) => { const sec = UNI[t]?.s || t; let h = 0; for (const c of sec) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
/* Companies get their own logo (bundled in logos/); funds and anything without one get a lettered badge sized to fit. */
const LOGO = new Set('AAPL MSFT ORCL CRM ADBE NOW INTU PLTR IBM CRWD PANW NET SNOW DDOG SHOP DELL ANET CSCO APP NBIS CRWV NVDA AVGO AMD TSM ASML MU QCOM INTC AMAT LRCX KLAC MRVL ARM TXN SNDK WDC STX SMCI COHR GLW GOOGL META NFLX TMUS DIS RDDT SPOT TTWO AMZN TSLA COST WMT HD MCD NKE SBUX BKNG UBER ABNB MELI EBAY PG KO PEP DKNG BABA JPM BAC GS MS V MA AXP BRK-B BX ICE CME SCHW HOOD COIN SOFI PYPL MSTR LLY UNH JNJ ABBV MRK NVO ISRG TMO VRTX AMGN HIMS MRNA GE GEV CAT RTX LMT BA HON DE UNP ETN VRT RKLB BE XOM CVX COP OXY VST CEG NEE FCX NEM LIN IREN PLD EQIX AMT'.split(' '));
const fitK = (t) => (t.length <= 2 ? 0.42 : t.length === 3 ? 0.34 : t.length === 4 ? 0.28 : 0.23);
const av = (t, size = '') => { t = String(t || ''); return LOGO.has(t) ? `<img class="av ${size}" src="logos/${esc(t)}.webp" alt="">` : `<span class="av tx ${size}" style="--h:${hueOf(t)};--k:${fitK(t)}">${esc(t)}</span>`; };
const chip = (t, w) => `<span class="chip">${av(t)}<b>${esc(t)}</b>${w == null ? '' : fw(w)}</span>`;
/* Each seat's emblem, drawn on a coloured glass orb. */
const GLYPH = {
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 3.7 5.2 3.7 8.5s-1.2 6.1-3.7 8.5c-2.5-2.4-3.7-5.2-3.7-8.5S9.5 5.9 12 3.5z"/>',
  spark: '<path d="M12 3l1.9 7.1L21 12l-7.1 1.9L12 21l-1.9-7.1L3 12l7.1-1.9z"/>',
  anchor: '<circle cx="12" cy="5.5" r="2"/><path d="M12 7.5V20.5M8.5 11h7M4.5 13.5c.6 4.1 3.6 7 7.5 7s6.9-2.9 7.5-7"/>',
  pulse: '<path d="M3 12.5h4l2.5-6.5 4 13 2.5-6.5H21"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  flag: '<path d="M5.5 21V3.5M5.5 4.5h12l-2.5 4 2.5 4h-12"/>',
  blade: '<path d="M19.5 4.5L10 14M19.5 4.5h-4L8 12M19.5 4.5v4L12 16M6 12.5l5.5 5.5M8.2 15.8L4.5 19.5"/>',
  gauge: '<path d="M3.5 16.5a8.5 8.5 0 1 1 17 0"/><path d="M12 16.5l4.2-5"/><circle cx="12" cy="16.5" r="1.3"/>',
  crown: '<path d="M4 17.5L3 7.5l5 4 4-6.5 4 6.5 5-4-1 10z"/><path d="M5 20.5h14"/>',
};
const orb = (k, z) => { const d = SEAT[k] || { color: '#888' }; return `<span class="sorb" style="--c:${d.color}${z ? ';--z:' + z + 'px' : ''}"><svg viewBox="0 0 24 24">${GLYPH[d.glyph] || ''}</svg></span>`; };
const seatByName = (n) => Object.keys(SEAT).find((k) => SEAT[k].name.toLowerCase() === String(n).trim().toLowerCase());

/* ── Council ─────────────────────────────────────────────────────────── */
/* The stage's headline: eyebrow, title and one line under it. Re-animates only when the words change. */
function headline(eyebrow, title, sub) {
  const set = (sel, v) => { const el = $(sel); if (v == null || el.textContent === v) return; el.textContent = v; el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); };
  set('#l-step', eyebrow); set('#c-phase', title); set('#c-sub', sub);
}
/* The council meets on GitHub every Monday at 12:00 UTC, before the US open. */
function nextMeeting(from = Date.now()) { const d = new Date(from); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() + ((1 - d.getUTCDay() + 7) % 7)); if (d.getTime() <= from) d.setUTCDate(d.getUTCDate() + 7); return d.getTime(); }
function renderIdle() {
  const C = DATA.council; if (!C) return;
  $('#live').classList.toggle('hidden', !sess); $('#idle').classList.toggle('hidden', !!sess && !sess.ended);
  $('#next').textContent = 'Next meeting ' + when(nextMeeting()) + ', on GitHub';
  if (sess) return;
  $('#track').classList.add('hidden'); $('#l-cost').textContent = '';
  const f = C.final;
  if (f) headline('The council · adjourned', `Holding ${f.holdings.length} names`, `${fw(f.cash_pct)} cash · decided ${when(C.decidedAt)}`);
  else headline('The council', 'Not yet convened', `${C.universe.length} names on the ring. It meets every Monday before the US open.`);
  $('#last').innerHTML = f ? `<div class="l-top"><span class="eyebrow">${when(C.decidedAt)}</span><span class="grow"></span>${C.decidedOn ? `<span class="tag">${esc(C.decidedOn)}</span>` : ''}</div>
    <h3>${f.holdings.length} holdings · ${fw(f.cash_pct)} cash</h3><p>${esc(f.summary)}</p>
    <div class="chips">${f.holdings.slice().sort((a, b) => b.weight - a.weight).map((h) => chip(h.ticker, h.weight)).join('')}</div>`
    : `<span class="eyebrow">No decision yet</span><h3>The council has not met</h3><p>It reads all ${C.universe.length} names, debates, and decides what to hold.</p>`;
  $('#last').onclick = f ? () => show('portfolio') : null;
  if (Ch.ready) { if (f) Ch.final(f.holdings, false); else Ch.reset(); }
}
$('#l-cancel').onclick = () => { sess = null; Ch.reset(); renderIdle(); };

/* ── A live session ── */
const roundLabel = (e) => ({ redteam: 'Red team', risk: 'Risk review', chair: 'Decision', scout: 'Briefing' }[e.kind] || (e.round === 1 ? 'Round 1' : e.round === 9 ? 'Rebuttal' : 'Debate ' + (e.round - 1)));
const STEP = {
  data: 'Prices, filings, news and macro for every name.',
  analysts: 'Fast analysts read every name and give a verdict.',
  scout: 'The scout searches the web for what is coming.',
  round1: 'Each seat proposes a portfolio on its own.',
  redteam: 'Vex attacks where the council is heading.',
  rebuttal: 'The seats answer the red team.',
  risk: 'Sentinel sets the vetoes and caps.',
  chair: 'Arbiter weighs every seat and decides.',
  record: 'Written to the ledger.',
};
function handle(e) {
  if (e.type === 'start') {
    const i = e.session;
    sess = { info: i, seats: {}, focus: null, pin: null, cost: 0, est: 0, props: {}, cut: {}, veto: {}, reports: 0, step: -1, final: null };
    const keys = [...new Set([...i.members, ...(i.phases.some((p) => p.key === 'scout') ? ['scout'] : [])])];
    $('#seats').innerHTML = [...keys.map(seatEl), '<i class="seat-div"></i>', ...i.officers.map(seatEl)].join('');
    $$('#seats .seat').forEach((b) => (b.onclick = () => { sess.pin = sess.pin === b.dataset.k ? null : b.dataset.k; focus(b.dataset.k, true); }));
    Ch.reset(); $('#tip').classList.add('hidden');
    $('#feed').innerHTML = ''; $('#floor').classList.add('hidden'); $('#cons .cons-rows').innerHTML = ''; $('#cons .cons-rows').style.height = '0'; $('#cons').classList.remove('final');
    $('#cs-title').textContent = 'Where the council leans'; $('#cs-aside').textContent = '';
    $('#l-cost').textContent = i.demo ? 'Demo' : money(0); $('#track').classList.remove('hidden'); track(i.phases.length, -1);
    headline(i.demo ? 'Demo session' : 'In session', 'Convening', 'The council is taking its seats.');
    $('#l-cancel').classList.remove('hidden'); $('#l-cancel').disabled = false;
    if (screen !== 'council') show('council');
    renderIdle(); return;
  }
  if (!sess) return;
  switch (e.type) {
    case 'phase':
      sess.step = e.i; sess.phase = e.key; (window.__seen = window.__seen || []).push(e.key); track(e.n, e.i);
      headline(`Step ${e.i + 1} of ${e.n}`, e.label, STEP[e.key] || (e.key.startsWith('debate') ? 'Every seat reads the others, challenges them, and revises.' : ''));
      if (e.key === 'round1') Ch.center(null);
      break;
    case 'progress':
      if (sess.phase === 'data' || e.key === 'analysts') { $('#c-sub').textContent = e.total > 1 ? `${e.label} · ${e.done} of ${e.total}` : `${e.label}…`; }
      if (sess.phase === 'data') { const dp = sess.dp || (sess.dp = {}); dp[e.key] = e.total ? e.done / e.total : 1; const v = Object.values(dp); Ch.center(Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) + '%', 'of the market book gathered'); }
      break;
    case 'log': sysLine(e.text); break;
    case 'desk':
      if (e.state === 'reading') Ch.reading(e.tickers, true);
      else if (e.state === 'failed') Ch.reading(e.tickers, false);
      else if (e.reports) { e.reports.forEach((r) => Ch.verdict(r.t, r.v)); sess.reports += e.reports.filter((r) => r.v).length; Ch.center(String(sess.reports), `of ${S.universe.length} names read`); }
      break;
    case 'turn': case 'think':
      if (sess.seats[e.seat]?.state === 'thinking' && e.type === 'think') break;
      if (e.type === 'turn' || !sess.seats[e.seat] || sess.seats[e.seat].state === 'done') { sess.seats[e.seat] = { state: 'thinking', text: '', label: roundLabel(e) }; seatState(e.seat); }
      if (!sess.focus || sess.seats[sess.focus]?.state === 'done') focus(e.seat);
      break;
    case 'speak': {
      const st = sess.seats[e.seat] || (sess.seats[e.seat] = { label: roundLabel(e) }); const was = st.state; st.state = 'speaking'; st.text = e.text;
      if (was !== 'speaking') seatState(e.seat);
      if (!sess.pin && (!sess.focus || sess.seats[sess.focus]?.state !== 'speaking')) focus(e.seat);
      if (sess.focus === e.seat) paint();
      break;
    }
    case 'said': {
      const d = e.data || {}, st = sess.seats[e.seat] || (sess.seats[e.seat] = {}); st.state = 'done'; st.text = d.statement || e.text || ''; st.label = roundLabel(e);
      seatState(e.seat);
      if (d.picks && e.kind === 'member') { sess.props[e.seat] = d.picks; Ch.ripple(e.seat, d.picks.map((p) => p.ticker)); leans(); }
      if (e.kind === 'redteam') { (d.cut || []).forEach((c) => (sess.cut[c.ticker] = c.reason)); Ch.flags(sess.cut, sess.veto); Ch.ripple('vex', Object.keys(sess.cut)); leans(); }
      if (e.kind === 'risk') { (d.vetoes || []).forEach((v) => (sess.veto[v.ticker] = v.reason)); Ch.flags(sess.cut, sess.veto); Ch.ripple('sentinel', Object.keys(sess.veto)); leans(); }
      record(e, st.text, d);
      if (sess.focus === e.seat) { paint(); setTimeout(() => { if (!sess || sess.pin) return; const nx = Object.entries(sess.seats).find(([, v]) => v.state === 'speaking') || Object.entries(sess.seats).find(([, v]) => v.state === 'thinking'); if (nx && sess.seats[sess.focus]?.state === 'done') focus(nx[0]); }, 1800); }
      break;
    }
    case 'cost': sess.cost = e.total; if (!sess.info.demo) $('#l-cost').textContent = money(e.total) + (sess.est ? ' of ~' + money(sess.est) : ''); break;
    case 'final':
      sess.final = e.final; sess.pin = null; Ch.final(e.final.holdings, true); Ch.focusSeat(null);
      track(sess.info.phases.length, sess.info.phases.length);
      headline('Decided', 'The council has decided', `${e.final.holdings.length} holdings · ${fw(e.final.cash_pct)} cash · confidence ${e.final.confidence}`);
      Object.keys(sess.seats).forEach((k) => { if (sess.seats[k].state !== 'done') { sess.seats[k].state = 'done'; seatState(k); } });
      focus('arbiter'); leans();
      break;

  }
}
function track(n, cur) { $('#track').innerHTML = Array.from({ length: n }, (_, j) => `<i class="${j < cur ? 'done' : j === cur ? 'now' : ''}"></i>`).join(''); }
const seatEl = (k) => `<button class="seat idle" data-k="${k}" style="--c:${SEAT[k]?.color || '#888'}">${orb(k)}<span class="s-name">${esc(SEAT[k]?.name || k)}</span></button>`;
function seatState(k) {
  const el = $(`#seats .seat[data-k="${k}"]`); if (!el) return;
  const st = sess.seats[k]?.state || 'idle';
  el.classList.remove('idle', 'thinking', 'speaking', 'done'); el.classList.add(st);
}
function focus(k, user) {
  if (!sess || !SEAT[k]) return;
  sess.focus = k; const d = SEAT[k];
  $$('#seats .seat').forEach((b) => b.classList.toggle('focus', b.dataset.k === k));
  const el = $(`#seats .seat[data-k="${k}"]`); if (el) { const box = $('#seats'); box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' }); }
  $('#floor').classList.remove('hidden'); $('#floor').style.setProperty('--c', d.color);
  $('#f-av').innerHTML = orb(k, 38); $('#f-who').textContent = d.name; $('#f-role').textContent = d.role;
  Ch.focusSeat(k); paint();
  if (user && !sess.seats[k]) $('#f-text').innerHTML = `<span style="color:var(--tx3)">${esc(d.name)} has not spoken yet.</span>`;
}
function paint() {
  const st = sess.seats[sess.focus]; if (!st) return;
  $('#f-round').textContent = st.label || '';
  $('#f-text').innerHTML = st.text ? esc(st.text) + (st.state === 'speaking' ? '<span class="caret"></span>' : '')
    : `<div class="thinking-lines"><i></i><i></i><i></i><small>${esc(SEAT[sess.focus]?.name || '')} is weighing the evidence…</small></div>`;
}
/* The consensus so far: each seat's latest proposal, averaged. After the decision, the decision itself. */
function consensus() {
  const ks = Object.keys(sess.props), m = {};
  for (const k of ks) for (const p of sess.props[k]) { const r = m[p.ticker] || (m[p.ticker] = { t: p.ticker, w: 0, by: [] }); r.w += (+p.weight || 0) / ks.length; r.by.push(k); }
  return Object.values(m).sort((a, b) => b.w - a.w || b.by.length - a.by.length);
}
const ROW = 58;
function leans() {
  const fin = sess.final, all = fin ? fin.holdings.map((h) => ({ t: h.ticker, w: h.weight, by: (h.champions || []).map(seatByName).filter(Boolean) })).sort((a, b) => b.w - a.w) : consensus();
  if (!fin) Ch.weights(all);
  const rows = fin ? all : all.slice(0, 10), box = $('#cons .cons-rows'), max = Math.max(1, ...rows.map((r) => r.w));
  $('#cons').classList.toggle('final', !!fin);
  $('#cs-title').textContent = fin ? 'The decision' : 'Where the council leans';
  $('#cs-aside').textContent = fin ? `${fin.holdings.length} names · ${fw(fin.cash_pct)} cash` : `${Object.keys(sess.props).length} of ${sess.info.members.length} seats · ${all.length} names`;
  const keep = new Set(rows.map((r) => r.t));
  $$('.cr', box).forEach((el) => { if (!keep.has(el.dataset.t) && !el.classList.contains('out')) { el.classList.add('out'); setTimeout(() => el.remove(), 450); } });
  rows.forEach((r, i) => {
    let el = box.querySelector(`.cr[data-t="${CSS.escape(r.t)}"]:not(.out)`);
    if (!el) {
      el = document.createElement('div'); el.className = 'cr in'; el.dataset.t = r.t;
      el.innerHTML = `<span class="cr-i num"></span>${av(r.t, 'md')}<div class="cr-n"><b><span>${esc(r.t)}</span><span class="fl"></span></b><span>${esc(UNI[r.t]?.n || '')}</span></div><span class="cr-by"></span><span class="cr-w num"></span><span class="cr-bar"><i></i></span>`;
      el.style.transform = `translateY(${i * ROW + 14}px)`; box.appendChild(el); void el.offsetWidth; el.classList.remove('in');
    }
    el.style.transform = `translateY(${i * ROW}px)`;
    $('.cr-i', el).textContent = i + 1; $('.cr-w', el).textContent = fw(r.w);
    $('.cr-bar i', el).style.width = (r.w / max) * 100 + '%';
    $('.cr-by', el).innerHTML = r.by.map((k) => `<i style="background:${SEAT[k]?.color || '#888'}"></i>`).join('');
    const cut = !fin && sess.cut[r.t], veto = !fin && sess.veto[r.t];
    $('.fl', el).innerHTML = veto ? '<span class="flag veto">Vetoed</span>' : cut ? '<span class="flag cut">Attacked</span>' : '';
    el.classList.toggle('veto', !!veto);
  });
  box.style.height = rows.length * ROW + 'px';
}
function sysLine(text) { $('#feed').insertAdjacentHTML('afterbegin', `<div class="ev sys"><span class="sorb" style="--z:34px">i</span><div class="ev-b"><p>${esc(text)}</p></div></div>`); }
function record(e, text, d) {
  const s = SEAT[e.seat] || { name: e.seat, role: '', color: '#999' };
  let extra = '';
  if (d.picks) extra = `<div class="chips">${d.picks.slice().sort((a, b) => b.weight - a.weight).map((p) => chip(p.ticker, p.weight)).join('')}</div>`;
  if (e.kind === 'redteam') extra = `<ul class="ev-list">${(d.attacks || []).map((a) => `<li><b>${esc(a.target)}<span class="sev">${[1, 2, 3, 4, 5].map((j) => `<i class="${j <= a.severity ? 'on' : ''}"></i>`).join('')}</span></b><span>${esc(a.argument)}</span></li>`).join('')}</ul>`;
  if (e.kind === 'risk') extra = `<ul class="ev-list">${(d.vetoes || []).map((v) => `<li><b>Veto ${esc(v.ticker)}</b><span>${esc(v.reason)}</span></li>`).join('')}${(d.caps || []).map((c) => `<li><b>Cap ${esc(c.ticker)}</b><span>at most ${fw(c.max_weight)}</span></li>`).join('')}${d.min_cash_pct != null ? `<li><b>Cash</b><span>at least ${fw(d.min_cash_pct)}</span></li>` : ''}</ul>`;
  if (e.kind === 'chair' && d.holdings) extra = `<div class="chips">${d.holdings.slice().sort((a, b) => b.weight - a.weight).map((h) => chip(h.ticker, h.weight)).join('')}</div>`;
  $('#feed').insertAdjacentHTML('afterbegin', `<div class="ev" style="--c:${s.color}">${orb(e.seat, 34)}<div class="ev-b"><div class="ev-h"><b>${esc(s.name)}</b><span>${esc(s.role)}</span><span class="grow"></span><span class="tag">${esc(roundLabel(e))}</span></div><p class="clamp">${esc(text)}</p>${extra}</div></div>`);
  const p = $('#feed .ev p.clamp'); p.onclick = () => p.classList.toggle('clamp');
}

/* ── Portfolio ───────────────────────────────────────────────────────── */
const kpi = (a, b, c) => `<div class="glass kpi"><div class="eyebrow">${a}</div><span class="num">${b}</span><small>${c}</small></div>`;
function renderPortfolio() {
  P = OC.portfolio();
  if (!P) { $('#pf-asof').textContent = 'Loading from GitHub'; $('#pf-value').innerHTML = ''; $('#pf-change').textContent = fetched === 'bad' ? 'Could not reach GitHub. It tries again in a few minutes.' : ''; $('#pf-list').innerHTML = ''; $('#pf-kpis').innerHTML = ''; return; }
  const f = P.final, st = P.stats, nav = P.series.length ? P.series[P.series.length - 1][1] : P.capital;
  $('#pf-asof').textContent = `${P.name} · paper index` + (P.updatedAt ? ' · updated ' + when(P.updatedAt) : '');
  const [whole, cents] = money(nav, 2).split('.');
  $('#pf-value').innerHTML = `${whole}<small>.${cents}</small>`;
  $('#pf-change').innerHTML = st ? `<b class="${cls(st.ret)}">${pc(st.ret)}</b> since the open of ${new Date(String(P.series[0][0]).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Starting capital, bought at the open of the decision day';
  $('#pf-sumcard').classList.toggle('hidden', !f?.summary);
  if (!f) { $('#pf-kpis').innerHTML = ''; $('#pf-list').innerHTML = '<div class="fine">Nothing held yet.</div>'; $('#pf-count').textContent = ''; $('#pf-note').classList.add('hidden'); return; }
  $('#pf-kpis').innerHTML = kpi('vs Nasdaq 100', st?.qqq != null ? `<span class="${cls(st.ret - st.qqq)}">${pc(st.ret - st.qqq)}</span>` : '—', st?.qqq != null ? `QQQ ${pc(st.qqq)}` : 'once filled')
    + kpi('vs S&P 500', st?.spy != null ? `<span class="${cls(st.ret - st.spy)}">${pc(st.ret - st.spy)}</span>` : '—', st?.spy != null ? `SPY ${pc(st.spy)}` : 'once filled')
    + (pf === 'council' ? kpi('Confidence', `${f.confidence ?? '—'}<small style="display:inline;font-size:13px">/100</small>`, 'from the chair') : kpi('Max drawdown', st?.maxDD ? pc(st.maxDD) : '0.0%', 'worst fall from a peak'))
    + kpi('Cash', fw(P.positions?.length ? P.cash : f.cash_pct), `${f.holdings.length} holdings`);
  $('#pf-note').classList.toggle('hidden', !P.pending?.length); $('#pf-note').textContent = 'The latest decision is bought at its day\'s 9:30 New York open once GitHub has that day\'s prices.';
  $('#pf-sum').textContent = f.summary;
  $('#pf-count').textContent = `${f.holdings.length} names`;
  const pos = Object.fromEntries((P.positions || []).map((p) => [p.t, p])), max = Math.max(...f.holdings.map((h) => h.weight));
  $('#pf-list').innerHTML = f.holdings.slice().sort((a, b) => b.weight - a.weight).map((h) => { const p = pos[h.ticker];
    return `<div class="hold" style="--h:${hueOf(h.ticker)}"><div class="hold-top">${av(h.ticker, 'lg')}
        <div class="hold-name"><b>${esc(h.ticker)}</b><span>${esc(UNI[h.ticker]?.n || '')}</span></div>
        <div class="hold-w"><b>${fw(p ? p.weight : h.weight)}</b>${p ? `<span class="${cls(p.pnlPct)}">${pc(p.pnlPct)}</span>` : '<span>pending</span>'}</div></div>
      <div class="wbar"><i style="width:${(h.weight / max) * 100}%"></i></div>
      <div class="why"><div><span class="stars">${'★'.repeat(h.conviction || 0)}<s>${'★'.repeat(5 - (h.conviction || 0))}</s></span><br>${esc(h.thesis)}<em><b>Sell if</b> ${esc(h.rotate_if)}</em><em>${fw(h.weight)} at entry${p ? ` · ${fw(p.weight)} now` : ''}${h.champions?.length ? ` · backed by ${esc(h.champions.join(', '))}` : h.role ? ` · ${esc(h.role)} sleeve` : ''}</em></div></div></div>`; }).join('');
  $$('#pf-list .hold').forEach((el) => (el.onclick = () => el.classList.toggle('open')));
}

/* ── Record ──────────────────────────────────────────────────────────── */
function renderRecord() {
  P = OC.portfolio(); if (!P) return;
  $('#rc-name').textContent = pf === 'council' ? 'Council' : 'Core';
  const st = P.stats, ser = P.series, has = st && ser.length > 1;
  $('#rc-value').innerHTML = has ? `<span class="${cls(st.ret)}">${pc(st.ret)}</span>` : '<span style="color:var(--tx3)">—</span>';
  $('#rc-sub').innerHTML = has ? `over ${st.days} trading days · <b class="${cls(st.ret - st.qqq)}">${pc(st.ret - st.qqq)}</b> vs QQQ` : 'Starts at the open of the first decision day';
  $('#rc-kpis').innerHTML = has ? kpi('Nasdaq 100', pc(st.qqq), 'QQQ, same days') + kpi('S&P 500', pc(st.spy), 'SPY, same days') + kpi('Max drawdown', pc(st.maxDD), 'worst fall from a peak') + kpi('Sharpe', st.sharpe == null ? '—' : st.sharpe.toFixed(2), 'annualised') : '';
  $('#rc-ledger').innerHTML = P.verify?.ok ? `<span class="up">● Ledger intact</span>, ${P.verify.n} entries.` : `<span class="down">● Ledger broken at entry ${P.verify?.at}.</span>`;
  chart(ser, P.capital);
}
function chart(ser, cap) {
  const cv = $('#chart'), ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  if (ser.length < 2) { ctx.fillStyle = 'rgba(220,228,255,.4)'; ctx.font = '13px Inter'; ctx.textAlign = 'center'; ctx.fillText('The line starts at the first open.', W / 2, H / 2); return; }
  const L = 6, R = 40, T = 10, B = 20, v = ser.flatMap((p) => [p[1], p[2], p[3]]).filter((x) => x != null).map((x) => x / cap - 1);
  let lo = Math.min(0, ...v), hi = Math.max(0, ...v); const pad = (hi - lo) * 0.12 || 0.01; lo -= pad; hi += pad;
  const X = (i) => L + (i / (ser.length - 1)) * (W - L - R), Y = (x) => T + (1 - (x - lo) / (hi - lo)) * (H - T - B);
  ctx.font = '10.5px Inter'; ctx.fillStyle = 'rgba(220,228,255,.4)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let k = 0; k <= 3; k++) { const x = lo + ((hi - lo) * k) / 3; ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(L, Y(x)); ctx.lineTo(W - R, Y(x)); ctx.stroke(); ctx.setLineDash([]); ctx.fillText(pc(x, 0), W - R + 6, Y(x)); }
  ctx.textBaseline = 'top'; ctx.fillText(ser[0][0].slice(5, 10), L, H - B + 6); ctx.textAlign = 'right'; ctx.fillText(ser[ser.length - 1][0].slice(5, 10), W - R, H - B + 6);
  const path = (ix) => { ctx.beginPath(); let m = false; ser.forEach((p, i) => { if (p[ix] == null) return; const x = X(i), y = Y(p[ix] / cap - 1); m ? ctx.lineTo(x, y) : ctx.moveTo(x, y); m = true; }); };
  const line = (ix, col, w) => { path(ix); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.stroke(); };
  line(2, 'rgba(141,151,189,.8)', 1.3); line(3, 'rgba(69,200,255,.85)', 1.3);
  path(1); ctx.lineTo(X(ser.length - 1), H - B); ctx.lineTo(X(0), H - B); ctx.closePath();
  const g = ctx.createLinearGradient(0, T, 0, H - B); g.addColorStop(0, 'rgba(255,215,106,.28)'); g.addColorStop(1, 'rgba(255,215,106,0)'); ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = 'rgba(255,215,106,.7)'; ctx.shadowBlur = 10; line(1, '#ffd76a', 2.2); ctx.shadowBlur = 0;
  const lx = X(ser.length - 1), ly = Y(ser[ser.length - 1][1] / cap - 1); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, 6.283); ctx.fill();
}

/* ── Sessions ────────────────────────────────────────────────────────── */
const chevron = '<svg class="chev" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>';
function renderSessions() {
  const list = OC.sessions();
  $('#ss-list').innerHTML = list.map((s) => { const d = new Date(s.startedAt);
    return `<div class="ss" data-id="${esc(s.id)}"><div class="ss-ic">${d.getDate()}<small>${d.toLocaleString('en', { month: 'short' }).toUpperCase()}</small></div>
      <div class="ss-body"><div class="ss-t"><b>${s.status === 'done' ? esc(S?.presets?.[s.preset]?.label || s.preset) + ' session' : 'Session ' + esc(s.status)}</b>${s.demo ? '<span class="tag demo">demo</span>' : ''}${s.status !== 'done' ? `<span class="tag ${s.status}">${esc(s.status)}</span>` : ''}</div>
      <p>${s.status === 'done' ? `${s.holdings} holdings · confidence ${s.confidence} · ${money(s.cost)}${s.device ? ' · ' + esc(s.device) : ''}` : esc(s.error || '')}</p></div>${chevron}</div>`; }).join('')
    || '<div class="fine">No meetings yet.</div>';
  $$('#ss-list .ss').forEach((el) => (el.onclick = () => detail(el.dataset.id)));
}
async function detail(id) {
  show('session'); $('#ss-detail').innerHTML = '<p class="fine">Loading…</p>';
  const s = await OC.session(id);
  if (!s) return ($('#ss-detail').innerHTML = '<p class="fine">Could not load it.</p>');
  const blk = (k, d, extra = '') => { const m = SEAT[k] || { name: k, role: '', color: '#999' }; return `<div class="glass tr" style="--c:${m.color}"><div class="m"><b style="color:${m.color}">${esc(m.name)}</b> · ${esc(m.role)}</div><p>${esc(d.statement || '')}</p>${extra}${d.picks ? `<div class="chips">${d.picks.slice().sort((a, b) => b.weight - a.weight).map((p) => chip(p.ticker, p.weight)).join('')}</div>` : ''}</div>`; };
  let h = `<div class="hero" style="padding-top:0"><div class="eyebrow">${esc(S?.presets?.[s.preset]?.label || s.preset)}${s.demo ? ' · demo' : ''} · ${money(s.cost)}${s.device ? ' · ' + esc(s.device) : ''}</div><h1 style="font-size:30px">${when(s.startedAt)}</h1></div>`;
  if (s.error) h += `<div class="note" style="border-color:rgba(255,112,136,.4);background:rgba(255,112,136,.1);color:#ffc6cf">${esc(s.error)}</div>`;
  if (s.final) h += '<div class="tr-r">Decision</div>' + blk('arbiter', s.final, `<p style="color:var(--tx)">${esc(s.final.summary)}</p><ul>${s.final.holdings.map((x) => `<li><b>${esc(x.ticker)} ${fw(x.weight)}</b>: ${esc(x.thesis)}</li>`).join('')}</ul>`);
  if (s.risk) h += '<div class="tr-r">Risk review</div>' + blk('sentinel', s.risk);
  if (s.redteam) h += '<div class="tr-r">Red team</div>' + blk('vex', s.redteam, `<ul>${s.redteam.attacks.map((a) => `<li><b>${esc(a.target)}</b>: ${esc(a.argument)}</li>`).join('')}</ul>`);
  for (const r of (s.rounds || []).slice().reverse()) h += `<div class="tr-r">${esc(r.key === 'round1' ? 'Round 1' : r.key === 'rebuttal' ? 'Rebuttals' : 'Debate ' + r.key.slice(6))}</div>` + Object.entries(r.proposals).map(([k, d]) => blk(k, d)).join('');
  $('#ss-detail').innerHTML = h;
}
$('#ss-back').onclick = () => show('sessions');

/* ── The stage ───────────────────────────────────────────────────────────
   Every name in the universe sits on an outer ring, grouped by sector. Analysts light them up as they read.
   When the seats propose, the names they pick leave the ring and gather in the middle as bubbles carrying
   the company's logo, sized by how much of the council backs them and ringed in the colours of their backers.
   At the decision, the portfolio settles in gold. */
const Ch = (() => {
  const VC = { strong_buy: '62,224,166', buy: '62,224,166', hold: '160,168,196', avoid: '255,112,136', strong_avoid: '255,112,136' };
  const TOP = 118;   // room for the headline over the canvas
  let cv, ctx, W = 0, H = 0, cx = 0, cy = 0, R = 0, nodes = [], by = {}, play = [], ctr = null, focusK = null, fin = false, burst = 0, last = 0, still = 0;
  const IMG = {};
  const img = (t) => { if (!LOGO.has(t)) return null; let i = IMG[t]; if (!i) { i = IMG[t] = new Image(); i.src = `logos/${t}.webp`; } return i.complete && i.naturalWidth ? i : null; };
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16)).join(',');
  const now = () => performance.now();

  function init(st) {
    cv = $('#cv'); ctx = cv.getContext('2d');
    const secs = []; st.universe.forEach((u) => secs.includes(u.s) || secs.push(u.s));
    const list = st.universe.slice().sort((a, b) => secs.indexOf(a.s) - secs.indexOf(b.s));
    list.forEach((u) => { const n = { t: u.t, s: u.s, x: 0, y: 0, vx: 0, vy: 0, r: 2.4, tr: 2.4, w: 0, by: [], v: null, rd: 0, fx: [], cut: false, veto: false, gold: false, a: 0 }; nodes.push(n); by[u.t] = n; });
    let a = -Math.PI / 2 + 0.1, prev = list[0].s; const step = (Math.PI * 2 - 0.2 - 0.05 * (secs.length - 1)) / (list.length - 1);
    nodes.forEach((n) => { if (n.s !== prev) { a += 0.05; prev = n.s; } n.a = a; a += step; });
    new ResizeObserver(() => layout()).observe(cv); layout(true);
    cv.addEventListener('click', tap);
    document.addEventListener('click', (e) => { if (e.target !== cv && !e.target.closest('#tip')) $('#tip').classList.add('hidden'); });
    Ch.ready = true; requestAnimationFrame(frame);
  }
  function layout(first) {
    const w = cv.clientWidth; if (!w) return;
    const dpr = Math.min(devicePixelRatio || 1, 3); W = w; H = Math.round(Math.min(W * 1.08, W + 60)); cv.style.height = H + 'px';
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const room = H - TOP; R = Math.min(W * 0.455, room / 2 - 8); cx = W / 2; cy = TOP + room / 2;
    nodes.forEach((n) => { n.hx = cx + Math.cos(n.a) * R; n.hy = cy + Math.sin(n.a) * R; if (first || !n.x) { n.x = n.hx; n.y = n.hy; } });
    sizes();
  }
  /* Bubble sizes: area follows weight, and together they fill a fixed share of the middle. */
  function sizes() {
    const tot = play.reduce((s, n) => s + n.w, 0) || 1, k = play.length > 22 ? 0.4 : 0.36;
    for (const n of nodes) n.tr = n.w > 0 ? Math.max(8, Math.min(R * 0.3, R * Math.sqrt((k * n.w) / tot))) : play.length ? 1.9 : 2.4;
  }
  function setPlay(list) { play = nodes.filter((n) => n.w > 0); play.forEach((n) => { if (!n.inPlay) { n.inPlay = true; n.vx = (cx - n.x) * 0.03; n.vy = (cy - n.y) * 0.03; } }); nodes.forEach((n) => { if (n.w <= 0) n.inPlay = false; }); sizes(); still = 0; }

  function step() {
    for (const n of play) { n.vx += (cx - n.x) * 0.01; n.vy += (cy - n.y) * 0.01; n.vx *= 0.8; n.vy *= 0.8; n.x += n.vx; n.y += n.vy; }
    for (let it = 0; it < 4; it++) for (let i = 0; i < play.length; i++) for (let j = i + 1; j < play.length; j++) {
      const a = play[i], b = play[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, m = a.r + b.r + 7;
      if (d < m) { const o = (m - d) / d, ma = b.r * b.r / (a.r * a.r + b.r * b.r), mb = 1 - ma; a.x -= dx * o * ma * 0.8; a.y -= dy * o * ma * 0.8; b.x += dx * o * mb * 0.8; b.y += dy * o * mb * 0.8; }
    }
    for (const n of play) { const dx = n.x - cx, dy = n.y - cy, d = Math.hypot(dx, dy), lim = R * 0.86 - n.r; if (d > lim && d > 0) { n.x = cx + dx / d * lim; n.y = cy + dy / d * lim; } }
    for (const n of nodes) { if (!n.inPlay) { n.x += (n.hx - n.x) * 0.07; n.y += (n.hy - n.y) * 0.07; } n.r += (n.tr - n.r) * 0.1; }
  }

  function frame(t) {
    requestAnimationFrame(frame);
    if (document.hidden || screen !== 'council' || !W) return;
    const busy = !!sess && !sess.ended; if (!busy && t - last < 32) return; last = t;   // a calmer frame rate when nothing is happening
    step();
    ctx.clearRect(0, 0, W, H);
    const gold = fin, gc = gold ? '255,215,106' : '104,140,255';
    // the floor: a soft pool of light and two faint guide rings
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.05); g.addColorStop(0, `rgba(${gc},${gold ? .16 : .12})`); g.addColorStop(.7, `rgba(${gc},.03)`); g.addColorStop(1, `rgba(${gc},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.05, 0, 6.283); ctx.fill();
    ctx.lineWidth = 1; ctx.setLineDash([1.5, 5]); ctx.strokeStyle = 'rgba(255,255,255,.07)';
    [0.42, 0.72].forEach((k) => { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, 6.283); ctx.stroke(); }); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.stroke();
    // the ring: every name in the universe
    const dim = play.length ? .55 : 1;
    for (const n of nodes) { if (n.inPlay && n.r > 4) continue;
      let c = '150,160,192', al = .38 * dim;
      if (n.v) { c = VC[n.v] || c; al = .85 * dim; }
      if (n.rd) { const k = .5 + .5 * Math.sin(t / 150 + n.a * 7); c = '120,160,255'; al = .45 + .55 * k; }
      ctx.fillStyle = `rgba(${c},${al})`; ctx.beginPath(); ctx.arc(n.x, n.y, n.rd ? n.r + 0.8 : n.r, 0, 6.283); ctx.fill();
    }
    // the count in the middle while the data comes in
    if (ctr && !play.length) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = 'rgba(244,246,251,.92)'; ctx.font = `200 ${Math.round(R * 0.36)}px Outfit, Inter`; ctx.fillText(ctr.big, cx, cy + R * 0.08);
      ctx.fillStyle = 'rgba(220,228,255,.5)'; ctx.font = '500 12.5px Inter'; ctx.fillText(ctr.small, cx, cy + R * 0.08 + 24);
    }
    // the bubbles, small first so the big ones sit on top
    const sorted = play.slice().sort((a, b) => a.r - b.r);
    for (const n of sorted) bubble(n, t);
    for (const n of nodes) if (n.fx.length) ripples(n, t);
    if (burst) { const k = (t - burst) / 1400; if (k > 1) burst = 0; else { ctx.strokeStyle = `rgba(255,215,106,${(1 - k) * .6})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R * (0.2 + k * 0.9), 0, 6.283); ctx.stroke(); } }
  }
  function bubble(n, t) {
    const { x, y } = n, r = n.r; if (r < 3) return;
    const lit = focusK && n.by.includes(focusK) && !fin;
    if (n.gold || lit) { const c = n.gold ? '255,215,106' : rgb(SEAT[focusK].color), h = ctx.createRadialGradient(x, y, r * .8, x, y, r + (n.gold ? 14 : 12)); h.addColorStop(0, `rgba(${c},${n.gold ? .4 : .45})`); h.addColorStop(1, `rgba(${c},0)`); ctx.fillStyle = h; ctx.beginPath(); ctx.arc(x, y, r + 14, 0, 6.283); ctx.fill(); }
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.closePath(); ctx.clip();
    const im = img(n.t);
    if (im) { ctx.fillStyle = '#161a2c'; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.drawImage(im, x - r * 1.06, y - r * 1.06, r * 2.12, r * 2.12); }
    else { const h = hueOf(n.t), gr = ctx.createRadialGradient(x - r * .4, y - r * .5, 0, x, y, r * 1.1); gr.addColorStop(0, `hsl(${h} 80% 68%)`); gr.addColorStop(1, `hsl(${h + 30} 62% 36%)`); ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      if (r > 9) { ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 ${Math.round(r * 2 * fitK(n.t) * 1.05)}px Inter`; ctx.fillText(n.t, x, y + 0.5); } }
    // glass sheen
    const sh = ctx.createLinearGradient(x, y - r, x, y + r); sh.addColorStop(0, 'rgba(255,255,255,.14)'); sh.addColorStop(.45, 'rgba(255,255,255,0)'); ctx.fillStyle = sh; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    if (n.veto) { ctx.fillStyle = 'rgba(8,10,20,.62)'; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    ctx.restore();
    // the ring: who backs it, or gold once decided
    const rr = r + 3;
    if (n.gold) { ctx.strokeStyle = 'rgba(255,215,106,.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.283); ctx.stroke(); }
    else if (n.by.length) { const seg = 6.283 / n.by.length, gap = n.by.length > 1 ? Math.min(.35, 5 / rr) : 0; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
      n.by.forEach((k, i) => { ctx.strokeStyle = SEAT[k]?.color || '#888'; ctx.globalAlpha = !focusK || k === focusK ? 1 : .55; ctx.beginPath(); ctx.arc(x, y, rr, -1.571 + i * seg + gap / 2, -1.571 + (i + 1) * seg - gap / 2); ctx.stroke(); });
      ctx.globalAlpha = 1; ctx.lineCap = 'butt'; }
    else { ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + .5, 0, 6.283); ctx.stroke(); }
    if (n.cut && !n.veto && !fin) { ctx.strokeStyle = 'rgba(255,77,109,.95)'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 4]); ctx.lineDashOffset = -t / 40; ctx.beginPath(); ctx.arc(x, y, rr + 4, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); }
    if (n.veto && !fin) { ctx.strokeStyle = 'rgba(255,112,136,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - r * .5, y + r * .5); ctx.lineTo(x + r * .5, y - r * .5); ctx.stroke(); }
  }
  function ripples(n, t) {
    n.fx = n.fx.filter((f) => t - f.t0 < 1100);
    for (const f of n.fx) { const k = (t - f.t0) / 1100; if (k < 0) continue; ctx.strokeStyle = `rgba(${f.c},${(1 - k) * .8})`; ctx.lineWidth = 1.5 * (1 - k) + .3; ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(n.r, 3) + 4 + k * 16, 0, 6.283); ctx.stroke(); }
  }
  function tap(e) {
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    let hit = null, best = 1e9;
    for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y), reach = n.inPlay ? n.r + 4 : 11; if (d < reach && d < best) { best = d; hit = n; } }
    const tip = $('#tip'); if (!hit) return tip.classList.add('hidden');
    const u = UNI[hit.t] || {}, V = { strong_buy: 'strong buy', buy: 'buy', hold: 'hold', avoid: 'avoid', strong_avoid: 'strong avoid' };
    let line;
    if (hit.gold) line = `<b>${fw(hit.w)}</b> of the portfolio${hit.by.length ? ', argued for by ' + hit.by.map((k) => `<b style="color:${SEAT[k]?.color}">${esc(SEAT[k]?.name)}</b>`).join(', ') : ''}.`;
    else if (hit.inPlay) line = `<b>${fw(hit.w)}</b> on average across the seats, backed by ${hit.by.map((k) => `<b style="color:${SEAT[k]?.color}">${esc(SEAT[k]?.name)}</b>`).join(', ')}.`;
    else line = hit.v ? `Analyst verdict: <b>${V[hit.v] || hit.v}</b>.` : `${esc(u.s || '')}. Not in play.`;
    if (hit.cut && !fin) line += ` <span style="color:#ff9aae">Vex wants it cut.</span>`;
    if (hit.veto && !fin) line += ` <span style="color:#ff9aae">Vetoed by Sentinel.</span>`;
    tip.innerHTML = `<div class="tip-h">${av(hit.t, 'md')}<div><b>${esc(hit.t)}</b><span>${esc(u.n || '')}</span></div></div><p>${line}</p>`;
    tip.classList.remove('hidden');
    const tw = 214, th = tip.offsetHeight; let lx = hit.x - tw / 2, ly = hit.y + Math.max(hit.r, 4) + 10;
    if (ly + th > H) ly = hit.y - Math.max(hit.r, 4) - 10 - th;
    tip.style.left = Math.max(12, Math.min(W - tw - 12, lx)) + 'px'; tip.style.top = Math.max(8, ly) + 'px';
  }

  return {
    ready: false, init,
    reset() { fin = false; burst = 0; ctr = null; focusK = null; for (const n of nodes) { n.w = 0; n.by = []; n.v = null; n.rd = 0; n.fx = []; n.cut = n.veto = n.gold = false; } setPlay(); },
    present() {}, allPresent() {}, seat() {},
    center(big, small) { ctr = big == null ? null : { big, small }; },
    reading(ts, on) { ts.forEach((t) => by[t] && (by[t].rd = on ? 1 : 0)); },
    verdict(t, v) { if (by[t]) { by[t].v = v; by[t].rd = 0; } },
    /* Only the 36 most backed names come into the middle; the long tail stays on the ring so the picture stays readable. */
    weights(rows) { const m = Object.fromEntries(rows.slice(0, 36).map((r) => [r.t, r])); for (const n of nodes) { const r = m[n.t]; n.w = r ? r.w : 0; n.by = r ? r.by : []; } setPlay(); },
    ripple(k, ts) { const c = rgb(SEAT[k]?.color || '#ffffff'), t0 = now(); ts.forEach((t, i) => by[t] && by[t].fx.push({ c, t0: t0 + 250 + i * 70 })); },
    flags(cut, veto) { for (const n of nodes) { n.cut = !!cut[n.t]; n.veto = !!veto[n.t]; } },
    focusSeat(k) { focusK = k; },
    final(hs, anim) {
      const m = Object.fromEntries(hs.map((h) => [h.ticker, h]));
      for (const n of nodes) { const h = m[n.t]; n.w = h ? +h.weight || 0 : 0; n.gold = !!h; n.by = h ? (h.champions || []).map(seatByName).filter(Boolean) : []; n.cut = n.veto = false; if (!anim) n.fx = []; }
      fin = true; ctr = null; focusK = null; setPlay();
      if (anim) { burst = now(); const t0 = now(); hs.forEach((h, i) => by[h.ticker]?.fx.push({ c: '255,215,106', t0: t0 + 300 + i * 60 })); }
    },
  };
})();

$$('[data-url]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); window.Native?.openUrl ? window.Native.openUrl(a.dataset.url) : window.open(a.dataset.url); }));

/* ── Ambient waves: slow flowing lines of light behind everything, in the current screen's colour ── */
(() => {
  const cv = $('#waves'), ctx = cv.getContext('2d'); let W, H, last = 0;
  const size = () => { const d = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
  addEventListener('resize', size); size();
  const accent = () => getComputedStyle(document.body).getPropertyValue('--accent').trim() || '104,140,255';
  function frame(t) {
    requestAnimationFrame(frame);
    if (document.hidden || t - last < 33) return; last = t;   // about 30 frames a second is plenty for ambience
    ctx.clearRect(0, 0, W, H); const c = accent(), s = t / 9000;
    for (let k = 0; k < 7; k++) {
      ctx.beginPath();
      for (let x = -10; x <= W + 10; x += 12) {
        const y = H * 0.62 + Math.sin(x / W * 3.2 + s * 2 + k * 0.35) * H * 0.07 + Math.sin(x / W * 7 - s * 3 + k) * H * 0.018 + (k - 3) * 9;
        x < 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${c},${0.05 + 0.025 * (3 - Math.abs(k - 3))})`; ctx.lineWidth = 1.1; ctx.stroke();
    }
    for (let i = 0; i < 26; i++) {   // drifting motes
      const x = ((i * 137.5 + s * 600 * (0.4 + (i % 5) / 6)) % (W + 40)) - 20, y = H * 0.55 + Math.sin(i * 1.7 + s * 4) * H * 0.12 + ((i * 53) % 90) - 45;
      ctx.fillStyle = `rgba(255,255,255,${0.12 + 0.18 * ((Math.sin(s * 6 + i) + 1) / 2)})`; ctx.beginPath(); ctx.arc(x, y, (i % 3) * 0.5 + 0.6, 0, 6.283); ctx.fill();
    }
  }
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) requestAnimationFrame(frame);
})();

/* Android back button: step back inside the app, or tell the shell to leave. */
window.ocBack = () => {
  if (screen === 'session') { show('sessions'); return true; }
  if (screen !== 'portfolio') { show('portfolio'); return true; }
  return false;
};
start();
