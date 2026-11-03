/* Oazy Research · Council. The second portfolio: a council of Claude agents that always holds what it judges the best
   portfolio, on paper, against the S&P 500 and the Nasdaq-100. The engine runs in the main process; this page shows it.
   Shared with Core (oazy-kit.js): $, $$, esc, num, fpx, calm, the sky (setAccent) and the chart (chart, hover, setCap). */

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const OC = window.council;
const fusd = (v, d = 2) => !num(v) ? '—' : (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fsgn = (v, d = 2) => !num(v) ? '—' : (v >= -(.5 / 10 ** d) ? '+$' : '−$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fpct = (v, d = 2) => !num(v) ? '—' : (v >= -(.5 / 10 ** d) ? '+' : '−') + Math.abs(v).toFixed(d) + '%';
const pc = (f, d = 2) => num(f) ? fpct(f * 100, d) : '—';               // a fraction, as a signed percent
const fw = (w) => (w == null ? '—' : (+w).toFixed(1) + '%');           // a weight already in percent
const cls = (v) => !num(v) ? 'mu' : v >= 0 ? 'up' : 'dn';
const money = (v) => fusd(v, 2);
const dayT = (d) => Date.parse(String(d).slice(0, 10) + 'T21:00:00Z');
const when = (ts) => new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const shortDate = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LS = { get(k, d) { try { const v = localStorage.getItem('oc:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('oc:' + k, JSON.stringify(v)); } catch {} } };
const svg = (p, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const IC = { bell: '<path d="M6 9.5a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4s2-1.5 2-6.5z"/><path d="M10 20a2 2 0 0 0 4 0"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>', min: '<path d="M6 12h12"/>', max: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>', x: '<path d="M7 7l10 10M17 7L7 17"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', chev: '<path d="M6 9l6 6 6-6"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', play: '<path d="M7 5l12 7-12 7z"/>', eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>' };
const arrowSm = svg(IC.arrow, 2.2).replace('<svg', '<svg width="16" height="16"');
function toast(m, err) { const e = $('#toast'); e.textContent = m; e.style.boxShadow = err ? 'inset 0 0 0 1px rgba(255,92,122,.5)' : ''; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), err ? 4200 : 2600); }

/* Sector colours: the lettered badges, the allocation ring and the sky when a fund is selected. */
const SECC = { Technology: '#5b8cff', Semiconductors: '#8b7bff', Communication: '#33bfff', Consumer: '#ff8a5c', Financials: '#3ddc97', 'Health Care': '#ff6aa2', Industrials: '#ffb547', Energy: '#ff7a45', Utilities: '#9ad94a', Materials: '#c9a26b', 'Real Estate': '#b58cff', 'Broad market': '#a9adbd', Bonds: '#6fa8dc', Commodities: '#ffd76a', Crypto: '#f7931a', International: '#2fd6a8', Cash: '#4a5068' };
const COUNCIL_ACCENT = '#8b7bff';
const hasLogo = (t) => typeof BRAND === 'object' && t in BRAND;
const colorOf = (t) => (hasLogo(t) && BRAND[t] !== '#3a4060' ? BRAND[t] : SECC[UNI[t]?.s] || '#5d6380');
const fitK = (t) => (t.length <= 2 ? 0.42 : t.length === 3 ? 0.34 : t.length === 4 ? 0.28 : 0.23);
function mark(t, s = 40) {
  t = String(t || '');
  if (hasLogo(t)) return `<span class="lg full" style="--s:${s}px"><img src="cx/logos/${esc(t)}.webp" alt="" draggable="false"></span>`;
  return `<span class="lg tx" style="--s:${s}px;--b:${SECC[UNI[t]?.s] || '#343a55'};font-size:${Math.round(s * fitK(t) * 1.05)}px">${esc(t)}</span>`;
}
function councilMark() {
  const c = ['#5b8cff', '#b06cff', '#2fd6a8', '#ffb547', '#ff6b81', '#33c3ff', '#8fd16a', '#ff4d6d'];
  return `<svg viewBox="0 0 48 48"><defs><radialGradient id="cmk${councilMark.n = (councilMark.n || 0) + 1}" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#2b2546"/><stop offset="1" stop-color="#0a0b12"/></radialGradient></defs><circle cx="24" cy="24" r="24" fill="url(#cmk${councilMark.n})"/><circle cx="24" cy="24" r="14" fill="none" stroke="rgba(255,255,255,.12)"/>${c.map((x, i) => { const a = -Math.PI / 2 + i * Math.PI / 4; return `<circle cx="${(24 + Math.cos(a) * 14).toFixed(2)}" cy="${(24 + Math.sin(a) * 14).toFixed(2)}" r="3.3" fill="${x}"/>`; }).join('')}<circle cx="24" cy="24" r="5.6" fill="#ffd76a"/></svg>`;
}
/* Each seat's emblem on a coloured glass orb. */
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
const stars = (n) => `<span class="stars">${'★'.repeat(n || 0)}<s>${'★'.repeat(Math.max(0, 5 - (n || 0)))}</s></span>`;
const tkc = (t, w) => `<span class="tkc">${mark(t, 24)}${esc(t)}${w == null ? '' : `<em>${fw(w)}</em>`}</span>`;

/* ── State ───────────────────────────────────────────────────────────────── */
let S = null, P = null, demo = LS.get('demo', false), page = 'home', sel = 'COUNCIL', range = '6M', sec = 'All', q = '';
let sess = null, replay = null, elsewhere = null, preset = null, ssSel = null;
const SEAT = {}, UNI = {}, HIST = {};
const holdings = () => (P?.final?.holdings || []).slice().sort((a, b) => b.weight - a.weight);
const posOf = (t) => (P?.positions || []).find((p) => p.t === t);
const navNow = () => (P?.series?.length ? P.series[P.series.length - 1][1] : P?.capital);

async function refresh() {
  [S, P] = await Promise.all([OC.state(), OC.portfolio(demo)]);
  if (!preset) preset = S.settings.preset;
  Object.assign(SEAT, S.seats, S.officers); S.universe.forEach((u) => (UNI[u.t] = u));
  if (!Ch.ready) Ch.init(S);
  setStatus(); renderBell();
  structure();
}
/* Rebuild whatever depends on what the portfolio holds. */
function structure() {
  if (sel !== 'COUNCIL' && !holdings().some((h) => h.ticker === sel)) sel = 'COUNCIL';
  if (page === 'home') renderHome(); else buildRail();
  if (page === 'hold') renderHold();
  if (page === 'perf') renderPerf();
  if (page === 'sess') renderSessions();
  renderIdle();
}

/* ── Top bar ─────────────────────────────────────────────────────────────── */
const PAGES = [['home', 'Home'], ['hold', 'Holdings'], ['perf', 'Performance'], ['council', 'Council'], ['sess', 'Sessions']];
$('#tabs').insertAdjacentHTML('beforeend', PAGES.map((p) => `<button data-p="${p[0]}">${p[1]}</button>`).join(''));
$('#bell').innerHTML = svg(IC.bell) + '<span class="count" id="count" hidden></span>'; $('#gear').innerHTML = svg(IC.gear);
$('#wMin').innerHTML = svg(IC.min); $('#wMax').innerHTML = svg(IC.max); $('#wClose').innerHTML = svg(IC.x);
if (window.oazyWin) { $('#wMin').onclick = () => oazyWin.min(); $('#wMax').onclick = () => oazyWin.max(); $('#wClose').onclick = () => oazyWin.close(); $('#top').ondblclick = (e) => { if (!e.target.closest('button')) oazyWin.max(); }; } else document.body.classList.add('nowin');
function movePill() { const b = $('#tabs button.on'); if (!b) return; const p = $('#pill'); p.style.left = b.offsetLeft + 'px'; p.style.width = b.offsetWidth + 'px'; }
function go(p) {
  if (!PAGES.some((x) => x[0] === p)) return;
  page = p; $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.p === p)); $$('.page').forEach((e) => e.classList.toggle('on', e.id === 'p-' + p));
  movePill(); closePop(); $('#tip').style.opacity = 0;
  ({ home: renderHome, hold: renderHold, perf: renderPerf, council: renderCouncil, sess: renderSessions })[p]();
  accentForPage();
}
function accentForPage() {
  if (page === 'home' && sel !== 'COUNCIL') return setAccent(colorOf(sel));
  if (page === 'council' && sess?.focus) return setAccent(SEAT[sess.focus]?.color);
  setAccent(COUNCIL_ACCENT);
}
$('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b?.dataset.p) go(b.dataset.p); };

/* The portfolio switcher, the same one Core has. */
const PF = [{ k: 'core', n: 'Core v1.0', d: 'Hyperliquid · live book', ic: () => '<span class="pfi core"><img src="icon.png" alt=""></span>' }, { k: 'council', n: 'Council', d: 'AI investment council · paper', ic: () => `<span class="pfi">${councilMark()}</span>` }];
{
  const me = 'council', cur = PF.find((p) => p.k === me);
  $('#pf').innerHTML = cur.ic() + `<span>${cur.n}</span>` + svg(IC.chev, 2.2).replace('<svg', '<svg class="chev"');
  $('#pfm').innerHTML = '<h5>Portfolios</h5>' + PF.map((p) => `<button class="pfo ${p.k === me ? 'on' : ''}" data-k="${p.k}" role="menuitem">${p.ic()}<div><b>${p.n}</b><small>${p.d}</small></div><span class="ck">${svg(IC.check, 2.6)}</span></button>`).join('');
  const close = () => { $('#pfm').classList.remove('on'); $('#pf').classList.remove('open'); };
  $('#pf').onclick = (e) => { e.stopPropagation(); const r = $('#pf').getBoundingClientRect(); $('#pfm').style.left = r.left + 'px'; const on = $('#pfm').classList.toggle('on'); $('#pf').classList.toggle('open', on); };
  $('#pfm').onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; close(); if (b.dataset.k !== me && window.oazy) oazy.go(b.dataset.k); };
  document.addEventListener('click', (e) => { if (!e.target.closest('#pfm,#pf')) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

/* Paper or demo: two separate records. Demo runs are free and use made-up debate. */
function setMode(d) {
  demo = d; LS.set('demo', d); document.body.classList.toggle('demo', d);
  $$('#mode button').forEach((b) => b.classList.toggle('on', (b.dataset.m === 'demo') === d));
  $('#demoRun').checked = d;
}
$('#mode').onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; const d = b.dataset.m === 'demo'; if (d === demo) return; setMode(d); ssSel = null; await refresh(); go(page); };

function setStatus() {
  const d = $('#dot'), t = $('#statusT'), y = S?.sync || {};
  if (S?.running || (sess && !sess.ended && !replay)) { d.className = 'busy'; t.textContent = 'In session'; return; }
  if (elsewhere) { d.className = 'busy'; t.textContent = 'In session on ' + elsewhere.device; return; }
  if (!y.on) { d.className = ''; t.textContent = 'This PC only'; return; }
  d.className = y.error ? 'warn' : 'live'; t.textContent = y.error ? 'Sync error' : 'Synced';
}
$('#status').onclick = () => openSettings();

/* ── Home: the same rail and hero as Core ────────────────────────────────── */
const TILE = () => Math.round(Math.min(92, innerHeight * 0.102)), FOCUS = () => Math.round(Math.min(118, innerHeight * 0.132)), GAP = 12;
function face(t) {
  if (t === 'COUNCIL') return `<span class="tface cxm">${councilMark()}</span>`;
  if (hasLogo(t)) return `<span class="tface" style="background:#121524"><img src="cx/logos/${esc(t)}.webp" alt="" draggable="false" style="width:100%;height:100%"></span>`;
  return `<span class="tface gl" style="--b:${SECC[UNI[t]?.s] || '#343a55'}"><b class="k${Math.min(5, t.length)}">${esc(t)}</b></span>`;
}
const railItems = () => ['COUNCIL', ...holdings().map((h) => h.ticker)];
const RL = { pos: 0, target: 0, raf: 0, last: 0, T: 112, F: 152, L: 64, els: [], items: [], wheelT: 0, settleT: 0, prev: 0, noClick: false, drag: null };
function applyRail() { const k = RL.T / RL.F, top = Math.round(RL.pos); RL.els.forEach((e, i) => { const d = i - RL.pos, x = RL.L + d * (RL.T + GAP) + (RL.F - RL.T) * Math.min(1, Math.max(0, d)), s = k + (1 - k) * Math.max(0, 1 - Math.abs(d)), gone = d <= -1 || x > innerWidth + 30; if (gone) { if (e.style.visibility !== 'hidden') e.style.visibility = 'hidden'; return; } if (e.style.visibility) e.style.visibility = ''; e.style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,0) scale(' + s.toFixed(4) + ')'; e.style.opacity = Math.min(d < 0 ? 1 + d : 1, Math.max(0, Math.min(1, (innerWidth - 20 - x) / (RL.T * 1.1)))).toFixed(3); e.style.pointerEvents = i < top ? 'none' : 'auto'; }); }
function railTick(now) { const dt = Math.min(0.05, Math.max(0, (now - RL.last) / 1000)); RL.last = now; RL.pos = calm ? RL.target : RL.pos + (RL.target - RL.pos) * (1 - Math.exp(-dt * 17)); if (Math.abs(RL.target - RL.pos) < 0.0008) RL.pos = RL.target; applyRail(); R.raf = RL.raf = RL.pos === RL.target ? 0 : requestAnimationFrame(railTick); }
function kick() { if (!RL.raf) { RL.last = performance.now(); R.raf = RL.raf = requestAnimationFrame(railTick); } }
function markOn() { RL.els.forEach((e) => { const on = e.dataset.t === sel; e.classList.toggle('on', on); e.setAttribute('aria-selected', on); if (!on) e.classList.remove('shine'); }); }
function choose(t) { if (t === sel) return; const now = performance.now(), rapid = now - RL.prev < 240; RL.prev = now; sel = t; markOn(); renderInfo(); if (rapid) $$('.fade', $('#info')).forEach((x) => x.classList.remove('fade')); $('#heroC').style.opacity = 0.2; clearTimeout(RL.settleT); RL.settleT = setTimeout(() => { accentForPage(); drawHero(); const e = RL.els.find((x) => x.dataset.t === sel); if (e) e.classList.add('shine'); }, 130); }
function setTarget(v) { const n = RL.items.length - 1; RL.target = Math.max(0, Math.min(n, v)); choose(RL.items[Math.round(RL.target)]); kick(); }
function buildRail() { const r = $('#rail'), items = railItems(); if (r.dataset.key !== items.join()) { r.dataset.key = items.join(); r.innerHTML = items.map((t) => `<button class="tile" data-t="${esc(t)}" aria-label="${t === 'COUNCIL' ? 'Council portfolio' : esc(UNI[t]?.n || t)}">${face(t)}<span class="tchg ${t === 'COUNCIL' ? cls(P?.stats?.ret) : cls(posOf(t)?.pnlPct)}">${t === 'COUNCIL' ? (P?.stats ? pc(P.stats.ret, 1) : '') : posOf(t)?.pnlPct != null ? pc(posOf(t).pnlPct, 1) : ''}</span></button>`).join(''); RL.els = $$('.tile', r); RL.items = items; } layoutRail(); }
function layoutRail() { let i = RL.items.indexOf(sel); if (i < 0) { sel = 'COUNCIL'; i = 0; } RL.T = TILE(); RL.F = FOCUS(); RL.L = parseFloat(getComputedStyle($('#info')).paddingLeft) || 64; $('#rail').style.setProperty('--f', RL.F + 'px'); const rh = RL.F + 16 + 44; $('#rail').style.height = rh + 'px'; $('#stage').style.top = 76 + rh + 'px'; RL.pos = RL.target = i; markOn(); applyRail(); }
const select = (t) => { const i = RL.items.indexOf(t); if (i >= 0) setTarget(i); };
const step = (d) => setTarget(Math.round(RL.target) + d);
function stat(label, v, klass = '') { return `<div class="st"><span>${label}</span><b class="${klass}">${v}</b></div>`; }
function renderInfo() {
  const el = $('#info'), rng = $('#ranges');
  if (!P) { el.innerHTML = `<div class="lead"><div class="kicker"><span class="tag">Council</span></div><h1 id="title" class="fade">Opening the record</h1></div>`; rng.innerHTML = ''; return; }
  const f = P.final, st = P.stats;
  if (sel === 'COUNCIL') {
    rng.innerHTML = '';
    if (!f) {
      el.innerHTML = `<div class="lead"><div class="kicker fade"><span class="tag">Council portfolio</span><small>${demo ? 'Demo record' : 'Paper'} · ${fusd(P.capital, 0)} starting capital</small></div><h1 id="title" class="fade">Not yet convened</h1><p class="lede fade" style="max-width:620px">${S.universe.length} names, ${Object.keys(S.seats).length} seats and a chair. Convene the council and it reads every name, debates and decides what to hold. It is judged only on what happens next.</p></div><div class="right fade"><button class="btn pri" id="infoGo">Convene the council ${arrowSm}</button></div>`;
      $('#infoGo').onclick = () => go('council'); return;
    }
    const nav = navNow(), pl = nav - P.capital;
    el.innerHTML = `<div class="lead"><div class="kicker fade"><span class="tag">Council portfolio</span><small>${f.holdings.length} holdings · ${fw(P.positions?.length ? P.cash : f.cash_pct)} cash · decided ${shortDate(P.decidedAt)}${P.decidedOn ? ' on ' + esc(P.decidedOn) : ''}</small></div><h1 id="title" class="fade">${fusd(nav)}</h1></div>
      <div class="right fade"><div id="stats">${stat('Total P&amp;L', st ? fsgn(pl) : '—', st ? cls(pl) : 'mu')}${stat('Return', pc(st?.ret), cls(st?.ret))}${stat('vs S&amp;P 500', st?.spy != null ? pc(st.ret - st.spy) : '—', st?.spy != null ? cls(st.ret - st.spy) : 'mu')}${stat('vs Nasdaq-100', st?.qqq != null ? pc(st.ret - st.qqq) : '—', st?.qqq != null ? cls(st.ret - st.qqq) : 'mu')}</div>
      <div class="acts"><button class="btn gh" id="infoC">Council</button><button class="btn pri" id="infoGo">Performance ${arrowSm}</button></div></div>`;
    $('#infoGo').onclick = () => go('perf'); $('#infoC').onclick = () => go('council'); return;
  }
  const h = holdings().find((x) => x.ticker === sel), u = UNI[sel] || {}, p = posOf(sel);
  el.innerHTML = `<div class="lead"><div class="kicker fade"><span class="tag">${esc(u.s || 'Holding')}</span><small>${esc(sel)} · ${u.k === 'E' ? 'Fund' : 'Stock'} · ${stars(h?.conviction)}</small></div><h1 id="title" class="fade${(u.n || '').length > 16 ? ' long' : ''}">${esc(u.n || sel)}</h1></div>
    <div class="right fade"><div id="stats">${stat('Price', p?.px ? fpx(p.px) : '—')}${stat('Position P&amp;L', p ? fsgn(p.pnl) : 'pending', p ? cls(p.pnl) : 'mu')}${stat('Since entry', p?.pnlPct != null ? pc(p.pnlPct) : '—', cls(p?.pnlPct))}${stat('Target', fw(h?.weight))}${stat('Value', p ? fusd(p.value, 0) : '—')}</div><button class="btn pri" id="infoD">Details</button></div>`;
  $('#infoD').onclick = () => details(sel);
  rng.innerHTML = ['1M', '3M', '6M', '1Y'].map((r) => `<button class="chip ${r === range ? 'on' : ''}" data-r="${r}">${r}</button>`).join('');
}
function renderHome() { buildRail(); renderInfo(); drawHero(); }
$('#rail').addEventListener('click', (e) => { if (RL.noClick) return; const t = e.target.closest('.tile'); if (!t) return; if (t.dataset.t === sel) { if (sel === 'COUNCIL') go(P?.final ? 'perf' : 'council'); else details(sel); } else select(t.dataset.t); });
$('#p-home').addEventListener('wheel', (e) => { e.preventDefault(); const u = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1, px = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * u; setTarget(RL.target + px / 110); clearTimeout(RL.wheelT); RL.wheelT = setTimeout(() => setTarget(Math.round(RL.target)), 130); }, { passive: false });
$('#rail').addEventListener('pointerdown', (e) => { if (e.button || !e.target.closest('.tile')) return; RL.drag = { x: e.clientX, t: RL.target, moved: false, lx: e.clientX, lt: performance.now(), v: 0 }; });
addEventListener('pointermove', (e) => { const D = RL.drag; if (!D) return; const dx = e.clientX - D.x; if (!D.moved && Math.abs(dx) < 6) return; D.moved = true; const now = performance.now(), dt = now - D.lt; if (dt > 0) D.v = (e.clientX - D.lx) / dt; D.lx = e.clientX; D.lt = now; setTarget(D.t - dx / (RL.T + GAP)); });
addEventListener('pointerup', () => { const D = RL.drag; RL.drag = null; if (!D || !D.moved) return; RL.noClick = true; setTimeout(() => (RL.noClick = false)); setTarget(Math.round(RL.target - (D.v * 180) / (RL.T + GAP))); });
$('#ranges').addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (!b) return; range = b.dataset.r; $$('#ranges .chip').forEach((x) => x.classList.toggle('on', x === b)); drawHero(); });
const RANGE_D = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366 };
/* The council's return against the two indexes, in percent from the starting capital. */
function perfSeries() {
  const ser = P?.series || []; if (ser.length < 2) return null;
  const k = (v) => (v == null ? null : (v / P.capital - 1) * 100), line = (i) => ser.filter((p) => p[i] != null).map((p) => [dayT(p[0]), k(p[i])]);
  return [{ name: 'Council', p: line(1) }, { name: 'S&P', p: line(2), c: '#ffb547' }, { name: 'Nasdaq', p: line(3), c: '#a99bff' }];
}
async function hist(t) { if (HIST[t] && Date.now() - HIST[t].at < 10 * 60e3) return HIST[t].p; const p = await OC.history(t).catch(() => []); HIST[t] = { at: Date.now(), p }; return p; }
async function drawHero() {
  const c = $('#heroC'); if (page !== 'home') return; const cap = $('#heroCap');
  if (sel === 'COUNCIL') {
    c.style.opacity = 1; const s = perfSeries();
    chart(c, s || [], { ref: 0, refL: 'Start', fy: (v) => fpct(v, 2), key: 'COUNCIL|' + demo + '|' + (P?.series?.length || 0), capFn: (b, empty) => { if (empty) { setCap(cap, '', P?.final ? (P.pending?.length ? 'The first fills land at the next market open' : 'The line starts after the first fill') : 'The line starts after the first decision'); return; } const p = s[0].p, v = b ? b[1] : p[p.length - 1][1]; setCap(cap, fpct(v, 2), b ? new Date(b[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Since the first fill, after trading costs', cls(v)); } });
    return;
  }
  const t = sel, all = await hist(t); if (t !== sel || page !== 'home') return;
  c.style.opacity = 1;
  const from = Date.now() - RANGE_D[range] * 864e5, pts = all.filter((p) => p[0] >= from), p = posOf(t);
  const entry = p?.pnlPct != null && p.px ? p.px / (1 + p.pnlPct) : null, since = p?.since ? Date.parse(String(p.since).slice(0, 10) + 'T14:30:00Z') : null;
  chart(c, pts.length > 1 ? [{ name: t, p: pts }] : [], { ref: entry, refL: entry ? 'Entry ' + fpx(entry) : null, key: t + '|' + range, marks: since ? [{ t: since, label: 'Bought' }] : [],
    capFn: (b, empty) => { if (empty) { setCap(cap, '', 'No price history cached yet'); return; } const first = pts[0][1], v = b ? b[1] : pts[pts.length - 1][1], ch = (v / first - 1) * 100; setCap(cap, fpct(ch, 2), b ? new Date(b[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Over ' + ({ '1M': 'one month', '3M': 'three months', '6M': 'six months', '1Y': 'one year' })[range], cls(ch)); } });
}
hover($('#heroC'));

/* ── Holdings ────────────────────────────────────────────────────────────── */
function spark(pts, w = 240, hh = 40) {
  const v = pts.slice(-30).map((x) => x[1]); if (v.length < 3) return '';
  const mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1, xs = v.map((_, i) => (i / (v.length - 1)) * w), ys = v.map((a) => hh - 3 - ((a - mn) / r) * (hh - 9)), col = v[v.length - 1] >= v[0] ? UPC : DNC, id = 'sg' + Math.random().toString(36).slice(2, 8), segs = monoSegs(xs, ys), line = 'M0 ' + ys[0].toFixed(1) + segs.map((s) => 'C' + s.map((n) => n.toFixed(1)).join(' ')).join('');
  return `<svg viewBox="0 0 ${w} ${hh}" preserveAspectRatio="none" width="100%" height="100%"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${col})" stop-opacity=".24"/><stop offset="1" stop-color="rgb(${col})" stop-opacity="0"/></linearGradient></defs><path d="${line}L${w} ${hh}L0 ${hh}Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="rgb(${col})" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function renderHold() {
  const f = P?.final, hs = holdings();
  $('#holdSub').textContent = f ? `${hs.length} names and ${fw(f.cash_pct)} cash, decided ${when(P.decidedAt)}` : 'Nothing held yet. Convene the council to build the first portfolio.';
  const secs = ['All', ...new Set(hs.map((h) => UNI[h.ticker]?.s).filter(Boolean))]; if (!secs.includes(sec)) sec = 'All';
  $('#secChips').innerHTML = hs.length ? secs.map((s) => `<button class="chip ${s === sec ? 'on' : ''}" data-s="${esc(s)}">${esc(s)}</button>`).join('') : '';
  const list = hs.filter((h) => (sec === 'All' || UNI[h.ticker]?.s === sec) && (h.ticker + ' ' + (UNI[h.ticker]?.n || '')).toLowerCase().includes(q));
  $('#grid').innerHTML = list.map((h) => { const p = posOf(h.ticker), u = UNI[h.ticker] || {};
    return `<button class="card" data-t="${esc(h.ticker)}" style="--b:${colorOf(h.ticker)}"><div class="h">${mark(h.ticker, 38)}<div><b>${esc(h.ticker)}</b><small>${esc(u.n || '')}</small></div><span class="pct ${cls(p?.pnlPct)}">${p?.pnlPct != null ? pc(p.pnlPct) : 'pending'}</span></div><span class="conv">${'★'.repeat(h.conviction || 0)}<s>${'★'.repeat(5 - (h.conviction || 0))}</s></span><div class="sp" data-spark="${esc(h.ticker)}">${HIST[h.ticker] ? spark(HIST[h.ticker].p) : ''}</div><div class="f"><span>${p ? fusd(p.value, 0) : esc(u.s || '')}</span><span>${fw(h.weight)} target</span></div></button>`; }).join('')
    + (f && sec === 'All' && !q ? `<div class="card cash"><div class="h"><span class="lg tx" style="--s:38px;--b:#4a5068;font-size:13px">$</span><div><b>Cash</b><small>Held back by the chair</small></div><span class="pct mu">${fw(f.cash_pct)}</span></div><div class="f"><span>${P.positions?.length ? fusd((navNow() * P.cash) / 100, 0) : ''}</span><span>${fw(f.cash_pct)} target</span></div></div>` : '')
    || `<p class="lede">${f ? 'Nothing matches.' : ''}</p>`;
  (async () => { for (const h of list) { if (HIST[h.ticker]) continue; await hist(h.ticker); const e = $(`[data-spark="${CSS.escape(h.ticker)}"]`); if (e) e.innerHTML = spark(HIST[h.ticker].p); } })();
}
$('#secChips').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) { sec = b.dataset.s; renderHold(); } };
$('#q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); renderHold(); };
$('#grid').onclick = (e) => { const c = e.target.closest('.card[data-t]'); if (c) details(c.dataset.t); };

/* ── Performance ─────────────────────────────────────────────────────────── */
function drawPerf() {
  const c = $('#perfC'); if (page !== 'perf') return; const s = perfSeries(), cap = $('#perfCap');
  chart(c, s || [], { ref: 0, refL: 'Start', fy: (v) => fpct(v, 2), key: 'PERF|' + demo + '|' + (P?.series?.length || 0), pt: 40, pb: 34, capFn: (b, empty) => { if (empty) { setCap(cap, '', 'The record starts at the first fill, the market open after the first decision'); return; } if (!b) { setCap(cap, '', 'Paper fills at the next open, 10 bps per trade, against SPY and QQQ from the same day'); return; } setCap(cap, fpct(b[1], 2), new Date(b[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), cls(b[1])); } });
}
async function renderPerf() {
  const st = P?.stats, nav = navNow(), set = (id, v, txt) => { const e = $(id); e.textContent = txt; e.className = cls(v); };
  $('#perfKick').textContent = st ? `Return over ${st.days} trading day${st.days === 1 ? '' : 's'}${demo ? ' · demo' : ''}` : 'Return';
  set('#perfRet', st?.ret, pc(st?.ret)); set('#perfPL', st ? nav - P.capital : null, st ? fsgn(nav - P.capital) : '—');
  set('#perfSP', st?.spy != null ? st.ret - st.spy : null, st?.spy != null ? pc(st.ret - st.spy) : '—'); set('#perfND', st?.qqq != null ? st.ret - st.qqq : null, st?.qqq != null ? pc(st.ret - st.qqq) : '—');
  const dd = $('#perfDD'); dd.textContent = st?.maxDD != null ? pc(st.maxDD) : '—'; dd.className = st?.maxDD ? 'dn' : 'mu';
  const sh = $('#perfSh'); sh.textContent = st?.sharpe != null ? st.sharpe.toFixed(2) : '—'; sh.className = '';
  const v = P?.verify; $('#ledger').className = 'chip ledger' + (v && !v.ok ? ' bad' : ''); $('#ledger').innerHTML = v?.ok ? `<i></i>Ledger intact · ${v.n} entries` : v ? `<i></i>Ledger broken at entry ${v.at}` : '<i></i>Ledger';
  renderRing(); renderMovers(); drawPerf();
}
$('#ledger').onclick = async () => { const v = await OC.verify(demo); P.verify = v; toast(v.ok ? `Every one of the ${v.n} ledger entries checks out. Nothing was edited after the fact.` : `The ledger is broken at entry ${v.at}.`, !v.ok); renderPerf(); };
function renderRing() {
  const f = P?.final; if (!f) { $('#ring').innerHTML = ''; $('#ringL').innerHTML = '<p class="mu" style="font-size:13px">No portfolio yet.</p>'; return; }
  const by = {}; f.holdings.forEach((h) => { const s = UNI[h.ticker]?.s || 'Other'; by[s] = (by[s] || 0) + +h.weight; });
  let parts = Object.entries(by).sort((a, b) => b[1] - a[1]); if (parts.length > 4) parts = [...parts.slice(0, 3), ['Other', parts.slice(3).reduce((a, p) => a + p[1], 0)]];
  if (f.cash_pct > 0) parts.push(['Cash', +f.cash_pct]);
  const tot = parts.reduce((a, p) => a + p[1], 0) || 1, C = 2 * Math.PI * 42; let acc = 0;
  const col = (s) => SECC[s] || '#7d84a3';
  $('#ring').innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="7"/>${parts.map((p) => { const fr = p[1] / tot, len = Math.max(0, fr * C - 3), off = -acc * C; acc += fr; return `<circle cx="50" cy="50" r="42" fill="none" stroke="${col(p[0])}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 50 50)" style="filter:drop-shadow(0 0 4px ${col(p[0])}88)"/>`; }).join('')}<text x="50" y="49" text-anchor="middle" fill="#fff" font-family="Outfit" font-weight="700" font-size="15">${f.holdings.length}</text><text x="50" y="62" text-anchor="middle" fill="#6d7286" font-size="8.5">holdings</text></svg>`;
  $('#ringL').innerHTML = parts.map((p) => `<div class="rw"><span class="dotc" style="background:${col(p[0])}"></span><b>${esc(p[0])}</b><em>${((p[1] / tot) * 100).toFixed(0)}%</em></div>`).join('');
}
function renderMovers() {
  const L = (P?.positions || []).filter((p) => p.pnlPct != null).sort((a, b) => b.pnlPct - a.pnlPct), lim = innerHeight < 860 ? 3 : 4;
  const row = (p) => `<button class="rw" data-t="${esc(p.t)}">${mark(p.t, 24)}<b>${esc(p.t)}</b><em class="${cls(p.pnlPct)}">${pc(p.pnlPct)}</em></button>`;
  $('#lead').innerHTML = L.slice(0, lim).map(row).join('') || '<p class="mu" style="font-size:13px">After the first fill.</p>';
  $('#lag').innerHTML = L.slice(-lim).reverse().filter((p) => !L.slice(0, lim).includes(p) || L.length <= lim).map(row).join('') || '<p class="mu" style="font-size:13px">After the first fill.</p>';
}
$$('#lead,#lag').forEach((e) => (e.onclick = (ev) => { const b = ev.target.closest('[data-t]'); if (b) details(b.dataset.t); }));
hover($('#perfC'));

/* ── Council: the chamber ────────────────────────────────────────────────── */
function headline(eyebrow, title, sub) {
  const set = (s, v) => { const el = $(s); if (v == null || el.textContent === v) return; el.textContent = v; el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); };
  set('#l-step', eyebrow); set('#c-phase', title); set('#c-sub', sub);
}
function renderCouncil() { renderIdle(); Ch.layout(); }
const TINT = { low: '#4f8dff', normal: '#a874ff', high: '#ffab4a' };
const seatsOf = (p) => [...new Set([...p.members, ...(p.scout ? ['scout'] : []), ...(p.redTeam ? ['vex'] : []), 'sentinel', 'arbiter'])];
const runDemo = () => demo;
function renderIdle() {
  if (!S) return;
  const live = !!sess;
  $('#live').classList.toggle('hidden', !live); $('#idle').classList.toggle('hidden', live);
  setStatus();
  if (live) return;
  $('#track').classList.add('hidden'); $('#l-cost').textContent = ''; $('#l-cancel').classList.add('hidden');
  renderPresets();
  const d = runDemo(), noKey = !d && !S.hasKey, busy = !!S.running || (!!elsewhere && !d);
  $('#go').disabled = busy; $('#go').innerHTML = noKey ? 'Add your API key' : `Convene${d ? ' a demo' : ''} ${arrowSm}`;
  $('#go').onclick = noKey ? () => openSettings() : () => convene(preset, d);
  $('#goNote').textContent = busy ? (elsewhere ? `In session on ${elsewhere.device}.` : 'The council is in session.') : d ? 'Free. Made-up debate, real data.' : `${S.universe.length} names, then the debate. Usually 4 to 15 minutes.`;
  const due = !d && S.due && S.hasKey && !elsewhere && !S.running;
  $('#due').classList.toggle('hidden', !due);
  renderNext();
  const f = P?.final;
  if (elsewhere && !d) headline('Live on ' + elsewhere.device, elsewhere.phase?.label || 'In session', elsewhere.last?.text ? elsewhere.last.text.slice(0, 140) + '…' : 'The council is meeting on your other device. It will be here when it adjourns.');
  else if (f) headline(`${demo ? 'Demo · ' : ''}The council · adjourned`, `Holding ${f.holdings.length} names`, `${fw(f.cash_pct)} cash · confidence ${f.confidence ?? '—'} · decided ${when(P.decidedAt)}${P.decidedOn ? ' on ' + P.decidedOn : ''}`);
  else headline(demo ? 'Demo · the council' : 'The council', 'Not yet convened', `${S.universe.length} names wait on the ring. The council reads them all, argues, and decides what to hold.`);
  $('#last').innerHTML = f ? `<span class="kick">${demo ? 'Demo · ' : ''}The last decision</span><h3>${f.holdings.length} holdings · ${fw(f.cash_pct)} cash</h3><p>${esc(f.summary)}</p><div class="tk">${f.holdings.slice().sort((a, b) => b.weight - a.weight).map((h) => tkc(h.ticker, h.weight)).join('')}</div><div class="row"><button class="btn gh" id="lastRe">${svg(IC.play, 2)} Replay the session</button><button class="btn gh" id="lastH">Holdings</button></div>`
    : `<span class="kick">No decision yet</span><h3>The council has not met${demo ? ' in demo mode' : ''}</h3><p>Pick a budget and convene it. ${demo ? 'Demo runs cost nothing.' : 'Each session is paid from your own Anthropic key.'}</p>`;
  if (f) { $('#lastRe').onclick = () => startReplay(P.lastId); $('#lastH').onclick = () => go('hold'); }
  if (!replay) { if (f && !(elsewhere && !d)) Ch.final(f.holdings, false); else Ch.reset(); }
}
function renderPresets() {
  const box = $('#presets'), d = runDemo();
  box.innerHTML = ['low', 'normal', 'high'].map((k, i) => { const p = S.presets[k]; return `<button class="bud ${k === preset ? 'on' : ''}" data-k="${k}" style="--c:${TINT[k]}"><span class="pips">${[0, 1, 2].map((j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('')}</span><b>${esc(p.label)}</b><small>${d ? 'Free demo' : '~' + money(p.est.mid)}</small></button>`; }).join('');
  const p = S.presets[preset], steps = [p.rounds ? `${p.rounds} debate round${p.rounds > 1 ? 's' : ''}` : 'no debate round', p.redTeam && 'a red team', p.rebuttal && 'rebuttals', p.scout && 'a web scout'].filter(Boolean);
  $('#presetInfo').innerHTML = `<span class="stack">${seatsOf(p).map((k) => orb(k, 30)).join('')}</span><p><b>${p.members.length} seats on ${esc(p.models.member)}</b>, ${steps.join(', ')}, chaired by ${esc(p.models.chair)}. About ${p.est.calls} calls${d ? '' : `, ${money(p.est.low)} to ${money(p.est.high)}`}.</p>`;
}
$('#presets').onclick = (e) => { const b = e.target.closest('.bud'); if (b) { preset = b.dataset.k; renderPresets(); } };
$('#demoRun').onchange = async (e) => { setMode(e.target.checked); ssSel = null; await refresh(); };
function renderNext() {
  const n = S.next?.session, w = S.settings;
  $('#nextCard').innerHTML = n ? `<div class="grow"><span class="kick">Next weekly session</span><h3>${when(n)}</h3><p class="lede">${esc(S.presets[w.preset]?.label || '')} budget, run by whichever of your devices is on.</p></div><div class="clockx" id="cd"></div>`
    : `<div class="grow"><span class="kick">Schedule</span><h3>Weekly session is off</h3><p class="lede">Turn it on in Settings and the council meets on its own every week.</p></div><button class="btn gh" id="schedOn">Settings</button>`;
  if (!n) $('#schedOn').onclick = () => openSettings(); tickCD();
}
function tickCD() { const e = $('#cd'); if (!e || !S?.next?.session) return; const s = Math.max(0, Math.floor((S.next.session - Date.now()) / 1000)), u = [[Math.floor(s / 86400), 'DAYS'], [Math.floor((s % 86400) / 3600), 'HRS'], [Math.floor((s % 3600) / 60), 'MIN']]; e.innerHTML = u.map((x) => `<div><b>${String(x[0]).padStart(2, '0')}</b><span>${x[1]}</span></div>`).join(''); }
async function convene(p, d) {
  if (replay) stopReplay();
  $('#go').disabled = true; $('#dueGo').disabled = true;
  const r = await OC.run(p, d);
  $('#dueGo').disabled = false;
  if (r?.error) { toast(r.error === 'Cancelled' ? 'Session adjourned.' : r.error, r.error !== 'Cancelled'); if (sess && !sess.ended) { sess = null; Ch.reset(); } }
  refresh();
}
$('#dueGo').onclick = () => convene(S.settings.preset, false);
$('#l-cancel').onclick = () => { if (replay) return stopReplay(); OC.cancel(); $('#l-cancel').disabled = true; toast('Adjourning after the current call.'); };
$('#lvTabs').onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b) return; $$('#lvTabs .chip').forEach((x) => x.classList.toggle('on', x === b)); $$('.lv-pane').forEach((x) => x.classList.toggle('on', x.id === 'pane-' + b.dataset.p)); };

/* A live (or replayed) session. */
const roundLabel = (e) => ({ redteam: 'Red team', risk: 'Risk review', chair: 'Decision', scout: 'Briefing' }[e.kind] || (e.round === 1 ? 'Round 1' : e.round === 9 ? 'Rebuttal' : 'Debate ' + (e.round - 1)));
const STEP = { data: 'Prices, filings, news and macro for every name.', analysts: 'Fast analysts read every name and give a verdict.', scout: 'The scout searches the web for what is coming.', round1: 'Each seat proposes a portfolio on its own.', redteam: 'Vex attacks where the council is heading.', rebuttal: 'The seats answer the red team.', risk: 'Sentinel sets the vetoes and caps.', chair: 'Arbiter weighs every seat and decides.', record: 'Written to the ledger.' };
function handle(e) {
  if (e.type === 'start') {
    const i = e.session;
    if (!replay && !!i.demo !== demo) { setMode(!!i.demo); OC.portfolio(demo).then((p) => { P = p; }); }
    sess = { info: i, seats: {}, focus: null, pin: null, cost: 0, est: i.demo ? 0 : S.presets[i.preset]?.est.mid, props: {}, cut: {}, veto: {}, reports: 0, step: -1, final: null, phases: i.phases.length };
    const keys = [...new Set([...i.members, ...(i.phases.some((p) => p.key === 'scout') ? ['scout'] : [])])];
    $('#seats').innerHTML = [...keys.map(seatEl), '<i class="seat-div"></i>', ...i.officers.map(seatEl)].join('');
    $$('#seats .seat').forEach((b) => (b.onclick = () => { sess.pin = sess.pin === b.dataset.k ? null : b.dataset.k; focus(b.dataset.k, true); }));
    Ch.reset(); $('#btip').classList.add('hidden');
    $('#feed').innerHTML = ''; $('#floor').classList.add('hidden'); $('#consRows').innerHTML = ''; $('#consRows').style.height = '0'; $('#cons').classList.remove('final');
    $('#cs-title').textContent = 'Where the council leans'; $('#cs-aside').textContent = '';
    $('#l-cost').textContent = replay ? 'Replay' : i.demo ? 'Demo' : money(0); $('#track').classList.remove('hidden'); track(i.phases.length, -1);
    headline(replay ? 'Replay' : i.demo ? 'Demo session' : 'In session', 'Convening', 'The council is taking its seats.');
    $('#l-cancel').classList.remove('hidden'); $('#l-cancel').disabled = false; $('#l-cancel').textContent = replay ? 'Stop replay' : 'Adjourn';
    renderIdle(); if (page !== 'council') go('council'); return;
  }
  if (!sess) return;
  switch (e.type) {
    case 'phase':
      sess.step = e.i; sess.phase = e.key; sess.phases = e.n; (window.__seen = window.__seen || []).push(e.key); track(e.n, e.i);
      headline(`${replay ? 'Replay · ' : ''}Step ${e.i + 1} of ${e.n}`, e.label, STEP[e.key] || (e.key.startsWith('debate') ? 'Every seat reads the others, challenges them, and revises.' : ''));
      if (e.key === 'round1') Ch.center(null);
      break;
    case 'progress':
      if (sess.phase === 'data' || e.key === 'analysts') $('#c-sub').textContent = e.total > 1 ? `${e.label} · ${e.done} of ${e.total}` : `${e.label}…`;
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
      if (sess.focus === e.seat) { paint(); setTimeout(() => { if (!sess || sess.pin) return; const nx = Object.entries(sess.seats).find(([, v]) => v.state === 'speaking') || Object.entries(sess.seats).find(([, v]) => v.state === 'thinking'); if (nx && sess.seats[sess.focus]?.state === 'done') focus(nx[0]); }, 1800 / (replay?.speed || 1)); }
      break;
    }
    case 'cost': sess.cost = e.total; if (!sess.info.demo && !replay) $('#l-cost').textContent = money(e.total) + (sess.est ? ' of ~' + money(sess.est) : ''); break;
    case 'final':
      sess.final = e.final; sess.pin = null; Ch.final(e.final.holdings, true); Ch.focusSeat(null);
      track(sess.phases, sess.phases);
      headline(replay ? 'Replay · decided' : 'Decided', 'The council has decided', `${e.final.holdings.length} holdings · ${fw(e.final.cash_pct)} cash · confidence ${e.final.confidence}`);
      Object.keys(sess.seats).forEach((k) => { if (sess.seats[k].state !== 'done') { sess.seats[k].state = 'done'; seatState(k); } });
      focus('arbiter'); leans();
      break;
    case 'done': sess.ended = true; $('#l-cancel').classList.add('hidden'); toast(sess.info.demo ? 'Demo session recorded.' : `Session recorded. It cost ${money(e.cost)}.`); setTimeout(() => { if (sess?.ended && !replay) { sess = null; refresh(); } }, 9000); break;
    case 'failed': toast(e.error === 'Cancelled' ? 'Session adjourned.' : 'Session failed: ' + e.error, e.error !== 'Cancelled'); sess = null; Ch.reset(); refresh(); break;
  }
}
function track(n, cur) { $('#track').innerHTML = Array.from({ length: n }, (_, j) => `<i class="${j < cur ? 'done' : j === cur ? 'now' : ''}"></i>`).join(''); }
const seatEl = (k) => `<button class="seat idle" data-k="${k}" style="--c:${SEAT[k]?.color || '#888'}" title="${esc(SEAT[k]?.name || k)} · ${esc(SEAT[k]?.role || '')}">${orb(k)}</button>`;
function seatState(k) { const el = $(`#seats .seat[data-k="${k}"]`); if (!el) return; el.classList.remove('idle', 'thinking', 'speaking', 'done'); el.classList.add(sess.seats[k]?.state || 'idle'); }
function focus(k, user) {
  if (!sess || !SEAT[k]) return;
  const changed = sess.focus !== k; sess.focus = k; const d = SEAT[k];
  $$('#seats .seat').forEach((b) => b.classList.toggle('focus', b.dataset.k === k));
  $('#floor').classList.remove('hidden'); $('#floor').style.setProperty('--c', d.color);
  $('#f-av').innerHTML = orb(k, 42); $('#f-who').textContent = d.name; $('#f-role').textContent = d.role;
  Ch.focusSeat(k); paint();
  if (changed && page === 'council') setAccent(d.color);
  if (user && !sess.seats[k]) $('#f-text').innerHTML = `<span class="mu">${esc(d.name)} has not spoken yet.</span>`;
}
function paint() {
  const st = sess.seats[sess.focus]; if (!st) return;
  $('#f-round').textContent = st.label || '';
  const box = $('#f-text'), stick = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  box.innerHTML = st.text ? esc(st.text) + (st.state === 'speaking' ? '<span class="caret"></span>' : '') : `<div class="thinking-lines"><i></i><i></i><i></i><small>${esc(SEAT[sess.focus]?.name || '')} is weighing the evidence…</small></div>`;
  if (stick) box.scrollTop = box.scrollHeight;
}
/* The consensus so far: each seat's latest proposal, averaged. After the decision, the decision itself. */
function consensus() {
  const ks = Object.keys(sess.props), m = {};
  for (const k of ks) for (const p of sess.props[k]) { const r = m[p.ticker] || (m[p.ticker] = { t: p.ticker, w: 0, by: [] }); r.w += (+p.weight || 0) / ks.length; r.by.push(k); }
  return Object.values(m).sort((a, b) => b.w - a.w || b.by.length - a.by.length);
}
const ROW = 52;
function leans() {
  const fin = sess.final, all = fin ? fin.holdings.map((h) => ({ t: h.ticker, w: h.weight, by: (h.champions || []).map(seatByName).filter(Boolean) })).sort((a, b) => b.w - a.w) : consensus();
  if (!fin) Ch.weights(all);
  const rows = fin ? all : all.slice(0, 12), box = $('#consRows'), max = Math.max(1, ...rows.map((r) => r.w));
  $('#cons').classList.toggle('final', !!fin);
  $('#cs-title').textContent = fin ? 'The decision' : 'Where the council leans';
  $('#cs-aside').textContent = fin ? `${fin.holdings.length} names · ${fw(fin.cash_pct)} cash` : `${Object.keys(sess.props).length} of ${sess.info.members.length} seats · ${all.length} names`;
  const keep = new Set(rows.map((r) => r.t));
  $$('.cr', box).forEach((el) => { if (!keep.has(el.dataset.t) && !el.classList.contains('out')) { el.classList.add('out'); setTimeout(() => el.remove(), 450); } });
  rows.forEach((r, i) => {
    let el = box.querySelector(`.cr[data-t="${CSS.escape(r.t)}"]:not(.out)`);
    if (!el) {
      el = document.createElement('div'); el.className = 'cr in'; el.dataset.t = r.t;
      el.innerHTML = `<span class="cr-i"></span>${mark(r.t, 34)}<div class="cr-n"><b><span>${esc(r.t)}</span><span class="fl"></span></b><span>${esc(UNI[r.t]?.n || '')}</span></div><span class="cr-by"></span><span class="cr-w"></span><span class="cr-bar"><i></i></span>`;
      el.style.transform = `translateY(${i * ROW + 14}px)`; box.appendChild(el); void el.offsetWidth; el.classList.remove('in');
    }
    el.style.transform = `translateY(${i * ROW}px)`;
    $('.cr-i', el).textContent = i + 1; $('.cr-w', el).textContent = fw(r.w);
    $('.cr-bar i', el).style.width = (r.w / max) * 100 + '%';
    $('.cr-by', el).innerHTML = r.by.map((k) => `<i style="background:${SEAT[k]?.color || '#888'}" title="${esc(SEAT[k]?.name || k)}"></i>`).join('');
    const cut = !fin && sess.cut[r.t], veto = !fin && sess.veto[r.t];
    $('.fl', el).innerHTML = veto ? '<span class="flag veto">Vetoed</span>' : cut ? '<span class="flag cut">Attacked</span>' : '';
    el.classList.toggle('veto', !!veto);
  });
  box.style.height = rows.length * ROW + 'px';
}
function sysLine(text) { $('#feed').insertAdjacentHTML('afterbegin', `<div class="fe sys"><span class="sorb info" style="--z:30px">i</span><div><p>${esc(text)}</p></div></div>`); }
function record(e, text, d) {
  const s = SEAT[e.seat] || { name: e.seat, role: '', color: '#999' };
  let extra = '';
  if (d.picks) extra = `<div class="tk">${d.picks.slice().sort((a, b) => b.weight - a.weight).map((p) => tkc(p.ticker, p.weight)).join('')}</div>`;
  if (e.kind === 'redteam') extra = `<ul>${(d.attacks || []).map((a) => `<li><b>${esc(a.target)}<span class="sev">${[1, 2, 3, 4, 5].map((j) => `<i class="${j <= a.severity ? 'on' : ''}"></i>`).join('')}</span></b>${esc(a.argument)}</li>`).join('')}</ul>`;
  if (e.kind === 'risk') extra = `<ul>${(d.vetoes || []).map((v) => `<li><b>Veto ${esc(v.ticker)}</b>${esc(v.reason)}</li>`).join('')}${(d.caps || []).map((c) => `<li><b>Cap ${esc(c.ticker)}</b>at most ${fw(c.max_weight)}</li>`).join('')}${d.min_cash_pct != null ? `<li><b>Cash</b>at least ${fw(d.min_cash_pct)}</li>` : ''}</ul>`;
  if (e.kind === 'chair' && d.holdings) extra = `<div class="tk">${d.holdings.slice().sort((a, b) => b.weight - a.weight).map((h) => tkc(h.ticker, h.weight)).join('')}</div>`;
  $('#feed').insertAdjacentHTML('afterbegin', `<div class="fe" style="--c:${s.color}">${orb(e.seat, 30)}<div><div class="fe-h"><b style="color:${s.color}">${esc(s.name)}</b><span>${esc(s.role)}</span><span class="tag">${esc(roundLabel(e))}</span></div><p class="clamp">${esc(text)}</p>${extra}</div></div>`);
  const p = $('#feed .fe p.clamp'); p.onclick = () => p.classList.toggle('clamp');
}

/* Replay: a finished session plays again from its recorded events, faster than it happened. */
async function startReplay(id) {
  S = await OC.state();
  if (S.running) return toast('The council is in session.');
  const s = await OC.session(id);
  if (!s?.events?.length) return toast('This session has no replay recorded.');
  if (replay) stopReplay();
  replay = { id, speed: 2, stopped: false }; const me = replay;
  go('council');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms / me.speed)), off = () => me.stopped;
  let last = 0;
  for (const e of s.events) {
    if (off()) return;
    const gap = Math.min(e.ms - last, e.type === 'said' ? 900 : 1400); last = e.ms;
    if (gap > 0) await sleep(gap);
    if (off()) return;
    if (e.type === 'said') {
      const text = e.data?.statement || e.text || '';
      if (e.kind !== 'scout' || text) {
        handle({ type: 'turn', seat: e.seat, round: e.round, kind: e.kind });
        for (let i = 0; i <= text.length; i += 9) { if (off()) return; handle({ type: 'speak', seat: e.seat, round: e.round, kind: e.kind, text: text.slice(0, i) }); await sleep(16); }
      }
      handle(e); continue;
    }
    if (e.type === 'cost' || e.type === 'done') continue;
    if (e.type === 'desk') { handle(e); await sleep(90); continue; }
    handle(e);
  }
  if (sess && !off()) { sess.ended = true; $('#l-cancel').textContent = 'Close replay'; }
}
function stopReplay() { if (!replay) return; replay.stopped = true; replay = null; sess = null; Ch.reset(); $('#btip').classList.add('hidden'); refresh(); }

/* ── The stage ───────────────────────────────────────────────────────────
   Every name in the universe sits on an outer ring, grouped by sector. Analysts light them up as they read.
   When the seats propose, the names they pick leave the ring and gather in the middle as bubbles carrying the
   company's logo, sized by how much of the council backs them and ringed in the colours of their backers.
   At the decision, the portfolio settles in gold. */
const Ch = (() => {
  const VC = { strong_buy: '62,224,166', buy: '62,224,166', hold: '160,168,196', avoid: '255,112,136', strong_avoid: '255,112,136' };
  let cv, ctx, W = 0, H = 0, cx = 0, cy = 0, Rr = 0, nodes = [], by = {}, play = [], ctr = null, focusK = null, fin = false, burst = 0, last = 0, secs = [], hoverN = null;
  const IMG = {};
  const img = (t) => { if (!hasLogo(t)) return null; let i = IMG[t]; if (!i) { i = IMG[t] = new Image(); i.src = `cx/logos/${t}.webp`; } return i.complete && i.naturalWidth ? i : null; };
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16)).join(',');
  const now = () => performance.now();
  function init(st) {
    cv = $('#cv'); ctx = cv.getContext('2d');
    st.universe.forEach((u) => secs.includes(u.s) || secs.push(u.s));
    const list = st.universe.slice().sort((a, b) => secs.indexOf(a.s) - secs.indexOf(b.s));
    list.forEach((u) => { const n = { t: u.t, s: u.s, x: 0, y: 0, vx: 0, vy: 0, r: 2.6, tr: 2.6, w: 0, by: [], v: null, rd: 0, fx: [], cut: false, veto: false, gold: false, a: 0 }; nodes.push(n); by[u.t] = n; });
    let a = -Math.PI / 2 + 0.08, prev = list[0].s; const gap = 0.045, stp = (Math.PI * 2 - 0.16 - gap * (secs.length - 1)) / (list.length - 1);
    nodes.forEach((n) => { if (n.s !== prev) { a += gap; prev = n.s; } n.a = a; a += stp; });
    secs = secs.map((s) => { const ns = nodes.filter((n) => n.s === s); return { s, a: (ns[0].a + ns[ns.length - 1].a) / 2, n: ns.length }; });
    new ResizeObserver(() => layout()).observe(cv); layout(true);
    cv.addEventListener('mousemove', move); cv.addEventListener('mouseleave', () => { hoverN = null; $('#btip').classList.add('hidden'); cv.style.cursor = ''; });
    cv.addEventListener('click', () => { if (hoverN && P?.final?.holdings.some((h) => h.ticker === hoverN.t) && !sess) details(hoverN.t); });
    Ch.ready = true; requestAnimationFrame(frame);
  }
  function layout(first) {
    if (!cv) return; const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2); W = w; H = h; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Rr = Math.max(60, Math.min(W - 190, H - 70) / 2); cx = W / 2; cy = H / 2;
    nodes.forEach((n) => { n.hx = cx + Math.cos(n.a) * Rr; n.hy = cy + Math.sin(n.a) * Rr; if (first || !n.x) { n.x = n.hx; n.y = n.hy; } });
    sizes();
  }
  function sizes() { const tot = play.reduce((s, n) => s + n.w, 0) || 1, k = play.length > 22 ? 0.4 : 0.36; for (const n of nodes) n.tr = n.w > 0 ? Math.max(9, Math.min(Rr * 0.28, Rr * Math.sqrt((k * n.w) / tot))) : play.length ? 2.1 : 2.6; }
  function setPlay() { play = nodes.filter((n) => n.w > 0); play.forEach((n) => { if (!n.inPlay) { n.inPlay = true; n.vx = (cx - n.x) * 0.03; n.vy = (cy - n.y) * 0.03; } }); nodes.forEach((n) => { if (n.w <= 0) n.inPlay = false; }); sizes(); }
  function step() {
    for (const n of play) { n.vx += (cx - n.x) * 0.01; n.vy += (cy - n.y) * 0.01; n.vx *= 0.8; n.vy *= 0.8; n.x += n.vx; n.y += n.vy; }
    for (let it = 0; it < 4; it++) for (let i = 0; i < play.length; i++) for (let j = i + 1; j < play.length; j++) {
      const a = play[i], b = play[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, m = a.r + b.r + (fin ? 14 : 8);
      if (d < m) { const o = (m - d) / d, ma = (b.r * b.r) / (a.r * a.r + b.r * b.r), mb = 1 - ma; a.x -= dx * o * ma * 0.8; a.y -= dy * o * ma * 0.8; b.x += dx * o * mb * 0.8; b.y += dy * o * mb * 0.8; }
    }
    for (const n of play) { const dx = n.x - cx, dy = n.y - cy, d = Math.hypot(dx, dy), lim = Rr * 0.86 - n.r; if (d > lim && d > 0) { n.x = cx + (dx / d) * lim; n.y = cy + (dy / d) * lim; } }
    for (const n of nodes) { if (!n.inPlay) { n.x += (n.hx - n.x) * 0.07; n.y += (n.hy - n.y) * 0.07; } n.r += (n.tr - n.r) * 0.1; }
  }
  function frame(t) {
    requestAnimationFrame(frame);
    if (document.hidden || page !== 'council' || !W) return;
    const busy = !!sess && !sess.ended; if (!busy && t - last < 32) return; last = t;
    step(); ctx.clearRect(0, 0, W, H);
    const gold = fin, gc = gold ? '255,215,106' : '139,123,255';
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Rr * 1.08); g.addColorStop(0, `rgba(${gc},${gold ? 0.14 : 0.11})`); g.addColorStop(0.7, `rgba(${gc},.03)`); g.addColorStop(1, `rgba(${gc},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, Rr * 1.08, 0, 6.283); ctx.fill();
    ctx.lineWidth = 1; ctx.setLineDash([1.5, 6]); ctx.strokeStyle = 'rgba(255,255,255,.07)';
    [0.42, 0.72].forEach((k) => { ctx.beginPath(); ctx.arc(cx, cy, Rr * k, 0, 6.283); ctx.stroke(); }); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.arc(cx, cy, Rr, 0, 6.283); ctx.stroke();
    // sector names just outside the ring
    ctx.font = '600 9.5px Inter,sans-serif'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,.28)';
    for (const s of secs) { if (s.n < 3) continue; const c = Math.cos(s.a), sn = Math.sin(s.a), x = cx + c * (Rr + 14), y = cy + sn * (Rr + 14 + Math.abs(sn) * 4); ctx.textAlign = c > 0.25 ? 'left' : c < -0.25 ? 'right' : 'center'; ctx.fillText(s.s.toUpperCase(), x, y); }
    const dim = play.length ? 0.55 : 1;
    for (const n of nodes) {
      if (n.inPlay && n.r > 4) continue;
      let c = '150,160,192', al = 0.4 * dim;
      if (n.v) { c = VC[n.v] || c; al = 0.85 * dim; }
      if (n.rd) { const k = 0.5 + 0.5 * Math.sin(t / 150 + n.a * 7); c = '150,140,255'; al = 0.45 + 0.55 * k; }
      if (n === hoverN) { c = '255,255,255'; al = 1; }
      ctx.fillStyle = `rgba(${c},${al})`; ctx.beginPath(); ctx.arc(n.x, n.y, n.rd || n === hoverN ? n.r + 1 : n.r, 0, 6.283); ctx.fill();
    }
    if (ctr && !play.length) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = 'rgba(244,246,251,.94)'; ctx.font = `800 ${Math.round(Rr * 0.3)}px Outfit, Inter`; ctx.fillText(ctr.big, cx, cy + Rr * 0.06);
      ctx.fillStyle = 'rgba(220,228,255,.5)'; ctx.font = '500 13px Inter'; ctx.fillText(ctr.small, cx, cy + Rr * 0.06 + 26);
    }
    for (const n of play.slice().sort((a, b) => a.r - b.r)) bubble(n, t);
    for (const n of nodes) if (n.fx.length) ripples(n, t);
    if (burst) { const k = (t - burst) / 1400; if (k > 1) burst = 0; else { ctx.strokeStyle = `rgba(255,215,106,${(1 - k) * 0.6})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, Rr * (0.2 + k * 0.9), 0, 6.283); ctx.stroke(); } }
  }
  function bubble(n, t) {
    const { x, y } = n, r = n.r; if (r < 3) return;
    const lit = focusK && n.by.includes(focusK) && !fin;
    if (n.gold || lit || n === hoverN) { const c = n === hoverN ? '255,255,255' : n.gold ? '255,215,106' : rgb(SEAT[focusK].color), h = ctx.createRadialGradient(x, y, r * 0.8, x, y, r + 14); h.addColorStop(0, `rgba(${c},${n === hoverN ? 0.3 : 0.42})`); h.addColorStop(1, `rgba(${c},0)`); ctx.fillStyle = h; ctx.beginPath(); ctx.arc(x, y, r + 14, 0, 6.283); ctx.fill(); }
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.closePath(); ctx.clip();
    const im = img(n.t);
    if (im) { ctx.fillStyle = '#121524'; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.drawImage(im, x - r * 1.04, y - r * 1.04, r * 2.08, r * 2.08); }
    else { const base = SECC[n.s] || '#5d6380', gr = ctx.createRadialGradient(x - r * 0.4, y - r * 0.5, 0, x, y, r * 1.1); gr.addColorStop(0, base); gr.addColorStop(1, '#151829'); ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      if (r > 9) { ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `800 ${Math.round(r * 2 * fitK(n.t) * 1.05)}px Outfit, Inter`; ctx.fillText(n.t, x, y + 0.5); } }
    const sh = ctx.createLinearGradient(x, y - r, x, y + r); sh.addColorStop(0, 'rgba(255,255,255,.14)'); sh.addColorStop(0.45, 'rgba(255,255,255,0)'); ctx.fillStyle = sh; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    if (n.veto) { ctx.fillStyle = 'rgba(8,10,20,.62)'; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    ctx.restore();
    const rr = r + 3;
    if (n.gold) { ctx.strokeStyle = 'rgba(255,215,106,.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.283); ctx.stroke(); }
    else if (n.by.length) { const seg = 6.283 / n.by.length, gp = n.by.length > 1 ? Math.min(0.35, 5 / rr) : 0; ctx.lineWidth = 2; ctx.lineCap = 'round';
      n.by.forEach((k, i) => { ctx.strokeStyle = SEAT[k]?.color || '#888'; ctx.globalAlpha = !focusK || k === focusK ? 1 : 0.5; ctx.beginPath(); ctx.arc(x, y, rr, -1.571 + i * seg + gp / 2, -1.571 + (i + 1) * seg - gp / 2); ctx.stroke(); });
      ctx.globalAlpha = 1; ctx.lineCap = 'butt'; }
    else { ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 0.5, 0, 6.283); ctx.stroke(); }
    if (n.cut && !n.veto && !fin) { ctx.strokeStyle = 'rgba(255,77,109,.95)'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 4]); ctx.lineDashOffset = -t / 40; ctx.beginPath(); ctx.arc(x, y, rr + 4, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); }
    if (n.veto && !fin) { ctx.strokeStyle = 'rgba(255,112,136,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - r * 0.5, y + r * 0.5); ctx.lineTo(x + r * 0.5, y - r * 0.5); ctx.stroke(); }
    if (fin && r > 22) { ctx.font = '700 11px Inter,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const lbl = fw(n.w), tw = ctx.measureText(lbl).width + 10; ctx.fillStyle = 'rgba(10,11,18,.85)'; ctx.beginPath(); ctx.roundRect(x - tw / 2, y + r - 4, tw, 17, 8.5); ctx.fill(); ctx.fillStyle = '#ffd76a'; ctx.fillText(lbl, x, y + r + 4.5); }
  }
  function ripples(n, t) {
    n.fx = n.fx.filter((f) => t - f.t0 < 1100);
    for (const f of n.fx) { const k = (t - f.t0) / 1100; if (k < 0) continue; ctx.strokeStyle = `rgba(${f.c},${(1 - k) * 0.8})`; ctx.lineWidth = 1.5 * (1 - k) + 0.3; ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(n.r, 3) + 4 + k * 16, 0, 6.283); ctx.stroke(); }
  }
  function move(e) {
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    let hit = null, best = 1e9;
    for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y), reach = n.inPlay ? n.r + 4 : 9; if (d < reach && d < best) { best = d; hit = n; } }
    const tip = $('#btip'); hoverN = hit;
    if (!hit) { tip.classList.add('hidden'); cv.style.cursor = ''; return; }
    cv.style.cursor = hit.gold && !sess ? 'pointer' : 'default';
    const u = UNI[hit.t] || {}, V = { strong_buy: 'strong buy', buy: 'buy', hold: 'hold', avoid: 'avoid', strong_avoid: 'strong avoid' }, who = hit.by.map((k) => `<b style="color:${SEAT[k]?.color}">${esc(SEAT[k]?.name)}</b>`).join(', ');
    let line;
    if (hit.gold) line = `<b>${fw(hit.w)}</b> of the portfolio${hit.by.length ? ', argued for by ' + who : ''}.${!sess ? ' Click for the thesis.' : ''}`;
    else if (hit.inPlay) line = `<b>${fw(hit.w)}</b> on average across the seats, backed by ${who}.`;
    else line = hit.v ? `Analyst verdict: <b>${V[hit.v] || hit.v}</b>.` : `${esc(u.s || '')}. Not in play.`;
    if (hit.cut && !fin) line += ' <span style="color:#ff9aae">Vex wants it cut.</span>';
    if (hit.veto && !fin) line += ' <span style="color:#ff9aae">Vetoed by Sentinel.</span>';
    tip.innerHTML = `<div class="bh">${mark(hit.t, 32)}<div><b>${esc(hit.t)}</b><small>${esc(u.n || '')}</small></div></div><p>${line}</p>`;
    tip.classList.remove('hidden');
    const tw = 240, th = tip.offsetHeight; let lx = hit.x + Math.max(hit.r, 4) + 14, ly = hit.y - th / 2;
    if (lx + tw > W) lx = hit.x - Math.max(hit.r, 4) - 14 - tw;
    tip.style.left = Math.max(0, lx) + 'px'; tip.style.top = Math.max(0, Math.min(H - th, ly)) + 'px';
  }
  return {
    ready: false, init, layout: () => layout(),
    reset() { fin = false; burst = 0; ctr = null; focusK = null; for (const n of nodes) { n.w = 0; n.by = []; n.v = null; n.rd = 0; n.fx = []; n.cut = n.veto = n.gold = false; } setPlay(); if (S) ctr = { big: String(S.universe.length), small: 'names on the ring' }; },
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
$('#legend').innerHTML = [['62,224,166', 'Buy'], ['160,168,196', 'Hold'], ['255,112,136', 'Avoid'], ['255,215,106', 'Held']].map((x) => `<span><i style="background:rgb(${x[0]})"></i>${x[1]}</span>`).join('');

/* ── Sessions ────────────────────────────────────────────────────────────── */
async function renderSessions() {
  const list = await OC.sessions(demo);
  $('#sessSub').textContent = list.length ? `${list.length} ${demo ? 'demo ' : ''}session${list.length === 1 ? '' : 's'} · ${money(list.reduce((a, s) => a + (s.cost || 0), 0))} in all` : `No ${demo ? 'demo ' : ''}sessions yet.`;
  if (!ssSel || !list.some((s) => s.id === ssSel)) ssSel = list[0]?.id || null;
  $('#ssList').innerHTML = list.map((s) => { const d = new Date(s.startedAt);
    return `<button class="ssr ${s.id === ssSel ? 'on' : ''}" data-id="${esc(s.id)}"><span class="ssd"><b>${d.getDate()}</b><small>${d.toLocaleString('en', { month: 'short' }).toUpperCase()}</small></span><div><b>${s.status === 'done' ? esc(S.presets[s.preset]?.label || s.preset) + ' session' : 'Session ' + esc(s.status)}</b>${s.demo ? '<span class="tag demo">demo</span>' : ''}${s.status !== 'done' ? `<span class="tag ${esc(s.status)}">${esc(s.status)}</span>` : ''}${s.trigger && s.trigger !== 'manual' ? `<span class="tag">${esc(s.trigger)}</span>` : ''}<span class="sub">${s.status === 'done' ? `${s.holdings} holdings · confidence ${s.confidence}${s.device ? ' · ' + esc(s.device) : ''}` : esc(s.error || '')}</span></div><em>${money(s.cost)}</em></button>`; }).join('')
    || '<p class="lede">Convene the council and every session lands here, with the whole debate.</p>';
  detail(ssSel);
}
$('#ssList').onclick = (e) => { const b = e.target.closest('[data-id]'); if (!b) return; ssSel = b.dataset.id; $$('#ssList .ssr').forEach((x) => x.classList.toggle('on', x === b)); detail(ssSel); };
async function detail(id) {
  const box = $('#ssDetail'); if (!id) { box.innerHTML = ''; return; }
  const s = await OC.session(id); if (!s) { box.innerHTML = '<p class="lede">Could not load it.</p>'; return; }
  const blk = (k, d, extra = '') => { const m = SEAT[k] || { name: k, role: '', color: '#999' }; return `<div class="tr">${orb(k, 30)}<div><div class="m"><b style="color:${m.color}">${esc(m.name)}</b>${esc(m.role)}</div><p>${esc(d.statement || '')}</p>${extra}${d.picks ? `<div class="tk">${d.picks.slice().sort((a, b) => b.weight - a.weight).map((p) => tkc(p.ticker, p.weight)).join('')}</div>` : ''}</div></div>`; };
  let h = `<div class="tr-head"><div class="grow"><span class="kick">${esc(S.presets[s.preset]?.label || s.preset)}${s.demo ? ' · demo' : ''} · ${money(s.cost)}${s.device ? ' · ' + esc(s.device) : ''}</span><h3>${when(s.startedAt)}</h3></div>${s.events?.length ? `<button class="btn gh" id="ssRe">${svg(IC.play, 2)} Replay</button>` : ''}</div>`;
  if (s.error) h += `<div class="warnbox">${esc(s.error)}</div>`;
  if (s.final) h += '<div class="tr-r">Decision</div>' + blk('arbiter', s.final, `<p style="color:#fff">${esc(s.final.summary)}</p><ul>${s.final.holdings.map((x) => `<li><b>${esc(x.ticker)} ${fw(x.weight)}</b> ${esc(x.thesis)}</li>`).join('')}</ul>`);
  if (s.risk) h += '<div class="tr-r">Risk review</div>' + blk('sentinel', s.risk);
  if (s.redteam) h += '<div class="tr-r">Red team</div>' + blk('vex', s.redteam, `<ul>${(s.redteam.attacks || []).map((a) => `<li><b>${esc(a.target)}</b> ${esc(a.argument)}</li>`).join('')}</ul>`);
  for (const r of (s.rounds || []).slice().reverse()) h += `<div class="tr-r">${esc(r.key === 'round1' ? 'Round 1' : r.key === 'rebuttal' ? 'Rebuttals' : 'Debate ' + r.key.slice(6))}</div>` + Object.entries(r.proposals).map(([k, d]) => blk(k, d)).join('');
  box.innerHTML = h; box.scrollTop = 0;
  const re = $('#ssRe'); if (re) re.onclick = () => startReplay(id);
}

/* ── Details sheet for one holding ───────────────────────────────────────── */
function openSheet(html, wide) { $('#sheet').className = 'sheet' + (wide ? ' wide' : ''); $('#sheet').innerHTML = html; $('#ov').classList.add('on'); const f = $('#sheet [data-close]'); if (f) f.focus(); }
function closeSheet() { const o = $('#ov'); if (!o.classList.contains('on')) return false; o.classList.remove('on'); document.activeElement?.blur?.(); return true; }
$('#ov').addEventListener('click', (e) => { if (e.target.id === 'ov' || e.target.closest('[data-close]')) closeSheet(); });
const xBtn = () => `<button class="icon" data-close aria-label="Close">${svg(IC.x)}</button>`;
function details(t) {
  const h = holdings().find((x) => x.ticker === t), u = UNI[t] || {}, p = posOf(t); if (!h && !p) return;
  const backers = (h?.champions || []).map((n) => seatByName(n)).filter(Boolean);
  const nums = [['Target weight', fw(h?.weight)], ['Actual weight', p ? fw(p.weight) : 'pending'], ['Value', p ? fusd(p.value) : '—'], ['P&L', p ? fsgn(p.pnl) : '—'], ['Since entry', p?.pnlPct != null ? pc(p.pnlPct) : '—'], ['Last close', p?.px ? fpx(p.px) : '—'], ['Held since', p?.since ? new Date(String(p.since).slice(0, 10)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'next open'], ['Sector', u.s || '—']];
  openSheet(`<div class="shead">${mark(t, 56)}<div><h3>${esc(u.n || t)}</h3><small>${esc(t)} · ${u.k === 'E' ? 'Fund' : 'Stock'} · ${esc(u.s || '')}</small></div>${xBtn()}</div>
    <div class="sgrid"><div>${h ? `<div class="sec"><h4>Why the council holds it · ${stars(h.conviction)}</h4><p>${esc(h.thesis)}</p></div><div class="sec"><h4>Sell if</h4><div class="warnbox">${esc(h.rotate_if)}</div></div>` : '<div class="sec"><h4>Leaving</h4><p>The latest decision sells this at the next open.</p></div>'}
    ${backers.length ? `<div class="sec" style="margin-bottom:0"><h4>Argued for by</h4><div class="backers">${backers.map((k) => `<span class="backer">${orb(k, 24)}${esc(SEAT[k].name)}</span>`).join('')}</div></div>` : ''}</div>
    <div class="nums">${nums.map((n) => `<div><span>${n[0]}</span><b>${esc(n[1])}</b></div>`).join('')}</div></div>`);
}

/* ── Settings ────────────────────────────────────────────────────────────── */
async function openSettings() {
  S = await OC.state(); const st = S.settings, y = S.sync || {};
  const pad = (n) => String(n).padStart(2, '0'), tog = (id, on) => `<label class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></label>`;
  openSheet(`<div class="shead"><div><h3>Council settings</h3><small>Oazy Research ${esc(S.version)} · the Council portfolio</small></div>${xBtn()}</div>
  <div class="setg">
    <div class="sbox"><h4>Anthropic API key<span class="grow"></span>${S.hasKey ? '<span class="pill2 ok">Saved on this PC</span>' : '<span class="pill2 bad">Not set</span>'}</h4>
      <input class="field" id="kIn" type="password" placeholder="${S.hasKey ? 'Paste a new key to replace it' : 'sk-ant-…'}" spellcheck="false" autocomplete="off">
      <div class="row"><button class="btn pri" id="kSave">Save key</button>${S.hasKey ? '<button class="btn gh" id="kClear">Remove</button>' : ''}</div>
      <p>Encrypted with Windows' own protection for your user. It never leaves this PC and is never synced. Each device holds its own key.</p></div>
    <div class="sbox"><h4>Account sync<span class="grow"></span>${!y.on ? '<span class="pill2">Off</span>' : y.error ? '<span class="pill2 bad">Error</span>' : '<span class="pill2 ok">Connected</span>'}</h4>
      <div class="fl2"><input class="field" id="yRepo" placeholder="owner/repository" value="${esc(st.syncRepo || '')}" spellcheck="false"><input class="field" id="yTok" type="password" placeholder="${S.hasToken ? 'Token saved. Paste to replace' : 'github_pat_…'}" spellcheck="false" autocomplete="off"><input class="field" id="yDev" placeholder="This device's name" value="${esc(st.device || '')}" spellcheck="false"></div>
      <div class="row"><button class="btn pri" id="ySave">Save</button><button class="btn gh" id="yNow">Sync now</button></div>
      <p>${!y.on ? 'Not connected. Your phone and this PC share one record through a GitHub repository.' : y.error ? `<span class="dn">${esc(y.error)}</span>` : `Last synced ${y.last ? when(y.last) : 'never'} as ${esc(y.device)}.`} Only the council's record syncs. Keys and the token stay on each device.</p></div>
    <div class="sbox"><h4>Default budget</h4><div class="seg" id="dPreset">${['low', 'normal', 'high'].map((k) => `<button data-k="${k}" class="${st.preset === k ? 'on' : ''}">${esc(S.presets[k].label)}<small>~${money(S.presets[k].est.mid)}</small></button>`).join('')}</div>
      <p>Used by the weekly session, emergency sessions and the "due" button. Spent this month: <b style="color:#fff">${money(S.spentThisMonth)}</b>.</p></div>
    <div class="sbox"><h4>Schedule</h4>
      <div class="trow"><span>Weekly session</span>${tog('sOn', st.schedule.enabled)}</div>
      <div class="trow"><span>Day and time</span><select class="field sm" id="sDay">${DAYS.map((d, i) => `<option value="${i}" ${i === st.schedule.day ? 'selected' : ''}>${d}</option>`).join('')}</select><input class="field sm" id="sTime" type="time" value="${pad(st.schedule.hour)}:${pad(st.schedule.minute)}"></div>
      <div class="trow"><span>Catch up if every device was off</span>${tog('sCatch', st.catchUp)}</div>
      <div class="trow"><span>Daily watch on weekdays</span>${tog('wOn', st.watch.enabled)}<input class="field sm" id="wTime" type="time" value="${pad(st.watch.hour)}:${pad(st.watch.minute)}"></div>
      <div class="trow"><span>Convene when the watch flags a broken thesis</span>${tog('sEm', st.autoEmergency)}</div></div>
    <div class="sbox"><h4>This PC</h4>
      <div class="trow"><span>Keep running in the tray so the schedule runs</span>${tog('tTray', st.tray)}</div>
      <div class="fl2" style="margin-top:8px"><label for="dSec">Contact for SEC filings (they ask for one; stays on this PC)</label><input class="field" id="dSec" value="${esc(st.secContact || '')}" placeholder="Your name and email" spellcheck="false"></div>
      <div class="row"><button class="btn gh" id="dData">Open the data folder</button></div></div>
    <div class="sbox"><h4>How it is judged</h4><p>Every decision is written to a hash-chained ledger before it fills, at the next market open, with 10 bps per trade. The record is compared with SPY and QQQ from the same day. No backtests, only what happens next.</p></div>
  </div>`, true);
  const save = async (patch, msg = 'Saved') => { const r = await OC.setSettings(patch); if (r?.error) return toast(r.error, true); S = r; if (patch.preset) preset = patch.preset; toast(msg); renderIdle(); };
  $('#kSave').onclick = async () => { const v = $('#kIn').value.trim(); if (!v) return toast('Paste the key first.', true); if (!/^sk-ant-/.test(v)) return toast('That does not look like an Anthropic API key (sk-ant-…).', true); const r = await OC.setSecret('anthropicKey', v); $('#kIn').value = ''; if (r?.error) return toast(r.error, true); toast('Key saved, encrypted on this PC.'); await refresh(); openSettings(); };
  if ($('#kClear')) $('#kClear').onclick = async () => { await OC.setSecret('anthropicKey', ''); toast('Key removed from this PC.'); await refresh(); openSettings(); };
  $('#ySave').onclick = async () => { const tok = $('#yTok').value.trim(); await save({ syncRepo: $('#yRepo').value.trim(), device: $('#yDev').value.trim().slice(0, 40) }); if (tok) await OC.setSecret('syncToken', tok); syncNowUI(); };
  $('#yNow').onclick = () => syncNowUI();
  $('#dPreset').onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; $$('#dPreset button').forEach((x) => x.classList.toggle('on', x === b)); save({ preset: b.dataset.k }); };
  const hm = (v) => { const [h, m] = String(v || '00:00').split(':').map(Number); return { hour: h || 0, minute: m || 0 }; };
  $('#sOn').onchange = (e) => save({ schedule: { enabled: e.target.checked } });
  $('#sDay').onchange = (e) => save({ schedule: { day: +e.target.value } });
  $('#sTime').onchange = (e) => save({ schedule: hm(e.target.value) });
  $('#sCatch').onchange = (e) => save({ catchUp: e.target.checked });
  $('#wOn').onchange = (e) => save({ watch: { enabled: e.target.checked } });
  $('#wTime').onchange = (e) => save({ watch: hm(e.target.value) });
  $('#sEm').onchange = (e) => save({ autoEmergency: e.target.checked });
  $('#tTray').onchange = (e) => save({ tray: e.target.checked });
  $('#dSec').onchange = (e) => save({ secContact: e.target.value.trim().slice(0, 120) });
  $('#dData').onclick = () => OC.openData();
}
async function syncNowUI() { toast('Syncing…'); const r = await OC.syncNow(); await refresh(); toast(r?.off ? 'Fill in the repository and token first.' : r?.error ? 'Sync failed: ' + r.error : 'Synced', !!r?.error); if ($('#ov').classList.contains('on') && $('#yNow')) openSettings(); }
$('#gear').onclick = () => openSettings();

/* ── The watch, behind the bell: the cheap daily check that each thesis still holds ── */
function closePop() { $('#pop').classList.remove('on'); }
function renderBell() {
  const wl = (P?.watch || []).slice(0, 8), pend = P?.pending?.length, flagged = wl.filter((w) => w.convene && Date.now() - Date.parse(w.at) < 3 * 864e5).length;
  const cnt = $('#count'); cnt.hidden = !(flagged || pend); cnt.textContent = flagged + (pend ? 1 : 0);
  $('#pop').innerHTML = (pend ? `<div class="sg warn"><i></i><div><b>A decision waits for the open</b><span>It fills at the next market open, 9:30 New York time.</span></div></div>` : '')
    + (wl.length ? '<h5 style="font-size:10.5px;font-weight:700;letter-spacing:.18em;color:rgba(255,255,255,.45);padding:8px 12px 2px">THE WATCH</h5>' + wl.map((w) => `<div class="wl ${w.convene ? 'bad' : ''}"><small>${when(w.at)}${w.convene ? ' · called for a session' : ''}</small>${esc(w.statement)}</div>`).join('') : `<div class="sg ok"><i></i><div><b>Nothing flagged</b><span>${P?.final ? 'The watch has not run yet.' : 'The watch starts after the first decision.'}</span></div></div>`)
    + (P?.final && (demo || S?.hasKey) ? '<div class="row"><button class="btn gh" id="watchNow">Run the watch now</button></div>' : '');
  const b = $('#watchNow'); if (b) b.onclick = async (e) => { e.stopPropagation(); b.disabled = true; b.textContent = 'Watching…'; const r = await OC.watch(demo); if (r?.error) toast(r.error, true); else toast(r?.statement || 'Watch complete'); await refresh(); $('#pop').classList.add('on'); };
}
$('#bell').onclick = (e) => { e.stopPropagation(); renderBell(); $('#pop').classList.toggle('on'); };
document.addEventListener('click', (e) => { if (!e.target.closest('#pop') && !e.target.closest('#bell')) closePop(); });

/* ── Keyboard, resize, boot ──────────────────────────────────────────────── */
addEventListener('keydown', (e) => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (e.key === 'Escape') { if (closeSheet()) return; closePop(); if (typing) document.activeElement.blur(); return; }
  if ($('#ov').classList.contains('on') || typing) return;
  if (e.key === 'Tab') { e.preventDefault(); const i = PAGES.findIndex((p) => p[0] === page); go(PAGES[(i + (e.shiftKey ? -1 : 1) + PAGES.length) % PAGES.length][0]); return; }
  if (/^[1-5]$/.test(e.key)) { go(PAGES[+e.key - 1][0]); return; }
  if (page === 'hold' && e.key === '/') { e.preventDefault(); $('#q').focus(); return; }
  if (page === 'home') { if (e.key === 'ArrowRight') { e.preventDefault(); step(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } else if (e.key === 'Enter' && document.activeElement === document.body) { e.preventDefault(); if (sel === 'COUNCIL') go(P?.final ? 'perf' : 'council'); else details(sel); } }
});
document.addEventListener('pointerup', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) setTimeout(() => { if (document.activeElement === b) b.blur(); }); });
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { movePill(); layoutRail(); drawHero(); drawPerf(); Ch.layout(); }, 100); });
if (document.fonts?.ready) document.fonts.ready.then(movePill);
function bootDone() { setTimeout(() => { document.body.classList.add('ready'); setTimeout(() => $('#boot')?.remove(), 1100); }, Math.max(0, 850 - performance.now())); }
setTimeout(bootDone, 2600);

/* Is the council meeting on another device? Checked while sync is on, so this PC never convenes over it. */
async function checkElsewhere() {
  if (!S?.sync?.on || S.running || (sess && !replay)) { if (elsewhere) { elsewhere = null; renderIdle(); } return; }
  const was = !!elsewhere; elsewhere = await OC.remoteLive().catch(() => null);
  if (was !== !!elsewhere) { if (!elsewhere) refresh(); else renderIdle(); } else if (elsewhere && page === 'council') renderIdle();
}

(async () => {
  if (!OC) { document.body.innerHTML = '<p style="padding:40px">The Council needs the Oazy Research app.</p>'; return; }
  setMode(demo);
  OC.onEvents((list) => { if (replay) return; list.forEach(handle); });
  OC.onChanged(async (why) => { if (why === 'running') { S = await OC.state(); setStatus(); return; } await refresh(); });
  await refresh();
  const h = location.hash.slice(1);
  go(PAGES.some((p) => p[0] === h) ? h : S.running ? 'council' : 'home');
  // Opened while a session is already running: catch up on what has been said so far.
  if (S.running) { const past = await OC.live(); past.forEach(handle); }
  bootDone();
  setInterval(() => { if (!document.hidden) tickCD(); }, 1000);
  checkElsewhere(); setInterval(checkElsewhere, 30e3);
  setInterval(() => { if (!sess && !document.hidden) refresh(); }, 5 * 60e3);
})();
