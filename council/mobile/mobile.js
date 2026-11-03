/* Oazy Council for the phone. The council runs here, on the phone's own key, and shares one account with the PC app. */
'use strict';
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v, d = 2) => (v == null || !isFinite(v) ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pc = (v, d = 1) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
const cls = (v) => (v == null ? '' : v >= 0 ? 'up' : 'down');
const fw = (w) => (w == null ? '—' : (+w).toFixed(1) + '%');
const when = (ts) => new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const LS = { get: (k, d) => { try { const v = localStorage.getItem('oc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('oc.' + k, JSON.stringify(v)); } catch {} } };

let demo = LS.get('demo', false), preset = null;
let S = null, P = null, sess = null, screen = 'council', elsewhere = null;
const SEAT = {}, UNI = {};

function toast(m, err) { const t = $('#toast'); t.textContent = m; t.className = 'on' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 3800); }

if (window.Native) document.documentElement.classList.add('native');

/* The engine: the same council core the PC app runs. */
const OC = window.OazyCore.create({
  onEvents: (list) => list.forEach((e) => (e.type === 'log' && !sess ? toast(e.text) : handle(e))),
  onChanged: (why) => { if (why === 'running') return; refresh(); },
});

/* ── Boot ────────────────────────────────────────────────────────────── */
function start() {
  setMode(demo);
  refresh();
  if (!S.hasKey) { show('settings'); toast('Paste your Anthropic API key to start.'); }
  OC.refreshMarks().catch(() => {});
  syncAndCheck();
  setInterval(syncAndCheck, 60e3);
}
function conn(state) { $('#conn').className = 'conn ' + state; }
function setup(st) {
  Object.assign(SEAT, st.seats, st.officers); st.universe.forEach((u) => (UNI[u.t] = u));
  if (!Ch.ready) Ch.init(st);
}
function refresh() {
  S = OC.state(); setup(S);
  if (!preset) preset = S.settings.preset;
  renderIdle();
  if (screen !== 'council' && screen !== 'session') show(screen);
}
/* Every minute while open: catch up with the account, see whether the PC is in session, and run the cheap daily watch when it is owed. */
let checking = false;
async function syncAndCheck() {
  if (checking || document.hidden) return; checking = true;
  try {
    if (!S.sync.on) { conn('off'); return; }
    const r = await OC.syncNow(); conn(r.error ? 'bad' : 'ok');
    const was = elsewhere; elsewhere = OC.isRunning() ? null : await OC.remoteLive().catch(() => null);
    if (r.changed || was || elsewhere) refresh(); else renderIdle();
    if (!elsewhere && !OC.isRunning() && S.hasKey && OC.watchDue()) { const w = await OC.watch(false); if (w?.convene) toast('The watch flagged a broken thesis: ' + w.statement, true); refresh(); }
  } catch { conn('bad'); } finally { checking = false; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncAndCheck(); });

function setMode(d) {
  demo = d; LS.set('demo', d); $('#demo').checked = d;
  $('#mode').classList.toggle('demo', d); $$('#mode button').forEach((b) => b.classList.toggle('on', (b.dataset.m === 'demo') === d));
}
$$('#mode button').forEach((b) => (b.onclick = () => { const d = b.dataset.m === 'demo'; if (d === demo) return; setMode(d); renderIdle(); if (screen !== 'council') show(screen); }));
$$('#tabs button').forEach((b) => (b.onclick = () => show(b.dataset.s)));
const TABS = ['council', 'portfolio', 'record', 'sessions', 'settings'];
function show(s) {
  const same = s === screen; screen = s; if (!same) window.scrollTo(0, 0);
  document.body.dataset.screen = s;
  const tab = s === 'session' ? 'sessions' : s;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.s === tab));
  $('.tab-glow').style.transform = `translateX(${TABS.indexOf(tab) * 100}%)`;
  $$('.screen').forEach((x) => x.classList.toggle('on', x.id === 's-' + s));
  if (s === 'portfolio') renderPortfolio(); if (s === 'record') renderRecord(); if (s === 'sessions') renderSessions(); if (s === 'settings') renderSettings();
}
/* A steady colour for each sector, used by the ticker badges. */
const hueOf = (t) => { const sec = UNI[t]?.s || t; let h = 0; for (const c of sec) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const av = (t, lg) => `<span class="av${lg ? ' lg' : ''}" style="--h:${hueOf(t)}">${esc(String(t).slice(0, 4))}</span>`;
const chip = (t, w) => `<span class="chip">${av(t)}<b>${esc(t)}</b>${fw(w)}</span>`;

/* ── Council ─────────────────────────────────────────────────────────── */
function renderIdle() {
  if (!S) return;
  const live = !!sess && !sess.ended;
  $('#live').classList.toggle('hidden', !sess); $('#idle').classList.toggle('hidden', live);
  $('#next').textContent = S.next?.session ? 'Next weekly session ' + when(S.next.session) : '';
  $('#conv').classList.toggle('hidden', !!S.running || (!!elsewhere && !demo));
  const due = !demo && S.due && S.hasKey && !elsewhere && !S.running;
  $('#due').classList.toggle('hidden', !due);
  renderPresets();
  const noKey = !demo && !S.hasKey;
  $('#go').disabled = false; $('#go').textContent = noKey ? 'Add API key' : 'Convene';
  $('#go').onclick = noKey ? () => show('settings') : () => convene(preset, demo);
  if (!live) {
    if (elsewhere && !demo) { $('#c-phase').textContent = 'In session on ' + elsewhere.device; $('#c-sub').textContent = (elsewhere.phase?.label || 'Convening') + (elsewhere.last?.text ? ' · ' + elsewhere.last.text.slice(0, 90) + '…' : ''); }
    else { $('#c-phase').textContent = S.running ? 'In session' : 'Adjourned'; $('#c-sub').textContent = ''; }
    P = OC.portfolio(demo);
    const f = P?.final;
    $('#last').innerHTML = f ? `<div class="l-top"><span class="eyebrow">${demo ? 'Demo · ' : ''}${when(P.decidedAt)}</span><span class="grow"></span>${P.decidedOn ? `<span class="tag">${esc(P.decidedOn)}</span>` : ''}</div>
      <h3>${f.holdings.length} holdings · ${fw(f.cash_pct)} cash</h3><p>${esc(f.summary)}</p>
      <div class="chips">${f.holdings.slice().sort((a, b) => b.weight - a.weight).map((h) => chip(h.ticker, h.weight)).join('')}</div>`
      : `<span class="eyebrow">No decision yet</span><h3>The council has not met${demo ? ' in demo mode' : ''}</h3><p>Pick a budget above and convene it. ${demo ? 'Demo runs are free.' : 'It reads all 155 names, debates, and decides what to hold.'}</p>`;
    $('#last').onclick = f ? () => show('portfolio') : null;
    if (f && !sess) Ch.final(f.holdings, false);
  }
}
$('#demo').onchange = (e) => { setMode(e.target.checked); renderIdle(); };
function convene(p, d) {
  $('#go').disabled = true; $('#due-go').disabled = true;
  OC.run(p, d).catch((e) => { toast(e.message, true); if (sess && !sess.ended) { sess = null; Ch.reset(); Ch.allPresent(); } }).finally(() => { $('#due-go').disabled = false; refresh(); });
}
$('#due-go').onclick = () => convene(S.settings.preset, false);
$('#l-cancel').onclick = () => { OC.cancel(); $('#l-cancel').disabled = true; toast('Adjourning after the current call.'); };

/* Budget presets as console-style tiles: swipe or tap; the selected one lifts and glows. */
const ART = { low: ['#2b6cff', '#1fd1c1', '43,108,255'], normal: ['#8a5cff', '#ff6fae', '138,92,255'], high: ['#ffb547', '#ff5d6c', '255,150,70'] };
function constel(k) {
  const p = S.presets[k], keys = [...p.members, ...(p.redTeam ? ['vex'] : []), 'sentinel', 'arbiter'];
  return `<svg class="constel" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${keys.map((m, i) => { const a = (i / keys.length) * 6.283 - 1.57, r = m === 'arbiter' ? 0 : 26, x = 62 + Math.cos(a) * r, y = 38 + Math.sin(a) * r;
    return `<line x1="62" y1="38" x2="${x}" y2="${y}" stroke="rgba(255,255,255,.18)" stroke-width=".5"/><circle cx="${x}" cy="${y}" r="${m === 'arbiter' ? 5 : 3}" fill="${SEAT[m]?.color || '#fff'}"/>`; }).join('')}</svg>`;
}
function renderPresets() {
  const box = $('#presets');
  if (box.dataset.demo !== String(demo) || !box.children.length) {
    box.dataset.demo = String(demo);
    box.innerHTML = ['low', 'normal', 'high'].map((k) => { const a = ART[k], p = S.presets[k];
      return `<button class="tile" data-k="${k}" style="--art:radial-gradient(120% 90% at 85% 10%, ${a[0]}cc, transparent 60%), linear-gradient(160deg, ${a[0]}55, ${a[1]}66 70%, #0b0e1a);--glow:${a[2]}">${constel(k)}<span class="t-name">${esc(p.label)}</span><span class="t-cost">${demo ? 'Free demo' : '~' + money(p.est.mid) + ' a session'}</span></button>`; }).join('') + '<span style="flex:none;width:1px"></span>';
    $$('#presets .tile').forEach((b) => (b.onclick = () => { preset = b.dataset.k; renderPresets(); b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); }));
  }
  $$('#presets .tile').forEach((b) => b.classList.toggle('on', b.dataset.k === preset));
  const p = S.presets[preset];
  $('#preset-info').innerHTML = `<b>${p.members.length} seats on ${esc(p.models.member)}</b><p>${p.rounds ? p.rounds + ' debate round' + (p.rounds > 1 ? 's' : '') : 'No debate round'}${p.redTeam ? ', a red team' : ''}${p.rebuttal ? ', rebuttals' : ''}${p.scout ? ', a web scout' : ''}. About ${p.est.calls} calls${demo ? '' : `, ${money(p.est.low)} to ${money(p.est.high)}`}.</p>`;
}

const roundLabel = (e) => ({ redteam: 'Red team', risk: 'Risk review', chair: 'Decision', scout: 'Briefing' }[e.kind] || (e.round === 1 ? 'Round 1' : e.round === 9 ? 'Rebuttal' : 'Debate ' + (e.round - 1)));
function handle(e) {
  if (e.type === 'start') {
    const i = e.session;
    sess = { info: i, seats: {}, focus: null, cost: 0, est: i.demo ? 0 : S.presets[i.preset]?.est.mid, props: {}, n: i.phases.length, reports: 0 };
    Ch.reset(); Ch.present([...i.members, ...i.officers, ...(i.phases.some((p) => p.key === 'scout') ? ['scout'] : [])]);
    $('#feed').innerHTML = ''; $('#floor').classList.add('hidden'); $('#l-cost').textContent = i.demo ? 'demo' : money(0); $('#l-bar').style.width = '0';
    $('#l-cancel').classList.remove('hidden'); $('#l-cancel').disabled = false;
    if (screen !== 'council') show('council');
    renderIdle(); return;
  }
  if (!sess) return;
  switch (e.type) {
    case 'phase': $('#c-phase').textContent = e.label; $('#l-step').textContent = `Step ${e.i + 1} of ${e.n}`; $('#l-bar').style.width = ((e.i + 1) / e.n) * 100 + '%'; break;
    case 'progress': $('#c-sub').textContent = e.total > 1 ? `${e.label} ${e.done} / ${e.total}` : `${e.label}…`; break;
    case 'log': sysLine(e.text); break;
    case 'desk': if (e.state === 'reading') Ch.reading(e.tickers, true); else if (e.reports) { e.reports.forEach((r) => Ch.verdict(r.t, r.v)); sess.reports += e.reports.filter((r) => r.v).length; $('#c-sub').textContent = `${sess.reports} of ${S.universe.length} names read`; } break;
    case 'turn': sess.seats[e.seat] = { state: 'thinking', text: '', label: roundLabel(e) }; Ch.seat(e.seat, 'thinking'); if (!sess.focus || sess.seats[sess.focus]?.state === 'done') focus(e.seat); break;
    case 'speak': { const st = sess.seats[e.seat] || (sess.seats[e.seat] = { label: '' }); st.state = 'speaking'; st.text = e.text; Ch.seat(e.seat, 'speaking'); if (!sess.focus || sess.seats[sess.focus]?.state !== 'speaking') focus(e.seat); if (sess.focus === e.seat) paint(); break; }
    case 'said': {
      const d = e.data || {}, st = sess.seats[e.seat] || (sess.seats[e.seat] = {}); st.state = 'done'; st.text = d.statement || e.text || ''; st.label = roundLabel(e);
      Ch.seat(e.seat, 'done');
      if (d.picks) Ch.beams(e.seat, d.picks);
      feed(e, st.text, d);
      if (sess.focus === e.seat) { paint(); setTimeout(() => { const nx = Object.entries(sess.seats).find(([, v]) => v.state === 'speaking' || v.state === 'thinking'); if (nx && sess.seats[sess.focus]?.state === 'done') focus(nx[0]); }, 1400); }
      break;
    }
    case 'cost': sess.cost = e.total; if (!sess.info.demo) $('#l-cost').textContent = money(e.total) + (sess.est ? ' of ~' + money(sess.est) : ''); break;
    case 'final': Ch.final(e.final.holdings, true); $('#c-phase').textContent = 'The council has decided'; $('#c-sub').textContent = `${e.final.holdings.length} holdings · confidence ${e.final.confidence}`; $('#floor').classList.add('hidden'); break;
    case 'done': sess.ended = true; $('#l-cancel').classList.add('hidden'); toast(sess.info.demo ? 'Demo session recorded.' : `Session recorded. It cost ${money(e.cost)}.`); setTimeout(() => { sess = null; refresh(); }, 6000); break;
    case 'failed': toast(e.error === 'Cancelled' ? 'Session adjourned.' : 'Session failed: ' + e.error, e.error !== 'Cancelled'); sess = null; Ch.reset(); Ch.allPresent(); refresh(); break;
  }
}
function sysLine(text) { $('#feed').insertAdjacentHTML('afterbegin', `<div class="st sys"><p>${esc(text)}</p></div>`); }
function focus(k) {
  sess.focus = k; const d = SEAT[k]; if (!d) return;
  $('#floor').classList.remove('hidden'); $('#floor').style.setProperty('--c', d.color);
  $('#f-who').textContent = d.name; $('#f-role').textContent = d.role; paint();
}
function paint() { const st = sess.seats[sess.focus] || {}; $('#f-round').textContent = st.label || ''; $('#f-text').innerHTML = st.text ? esc(st.text) + (st.state === 'speaking' ? '<span class="caret"></span>' : '') : '<span style="color:var(--tx3)">Thinking…</span>'; }
function feed(e, text, d) {
  const s = SEAT[e.seat] || { name: e.seat, color: '#999' };
  const chips = (d.picks || d.holdings || []).slice().sort((a, b) => b.weight - a.weight).slice(0, 8).map((p) => chip(p.ticker, p.weight)).join('');
  $('#feed').insertAdjacentHTML('afterbegin', `<div class="st"><div class="st-h"><b style="color:${s.color}">${esc(s.name)}</b><span class="grow"></span><span class="tag">${esc(roundLabel(e))}</span></div><p>${esc(text)}</p>${chips ? `<div class="chips">${chips}</div>` : ''}</div>`);
}

/* ── Portfolio ───────────────────────────────────────────────────────── */
const kpi = (a, b, c) => `<div class="glass kpi"><div class="eyebrow">${a}</div><span class="num">${b}</span><small>${c}</small></div>`;
function renderPortfolio() {
  P = OC.portfolio(demo);
  const f = P.final, st = P.stats, nav = P.series.length ? P.series[P.series.length - 1][1] : P.capital;
  $('#pf-asof').textContent = f ? `${demo ? 'Demo · ' : ''}Paper value · decided ${when(P.decidedAt)}` : demo ? 'Demo record' : 'Paper value';
  const [whole, cents] = money(nav, 2).split('.');
  $('#pf-value').innerHTML = `${whole}<small>.${cents}</small>`;
  $('#pf-change').innerHTML = st ? `<b class="${cls(st.ret)}">${pc(st.ret)}</b> since the first decision` : 'Starting capital, fills at the next open after a decision';
  ['#pf-sumcard', '#pf-watch', '#pf-watchwrap'].forEach((x) => $(x).classList.toggle('hidden', !f));
  if (!f) { $('#pf-kpis').innerHTML = ''; $('#pf-list').innerHTML = '<div class="fine">No decision yet. Convene the council to build the first portfolio.</div>'; $('#pf-count').textContent = ''; $('#pf-note').classList.add('hidden'); return; }
  $('#pf-kpis').innerHTML = kpi('vs Nasdaq 100', st?.qqq != null ? `<span class="${cls(st.ret - st.qqq)}">${pc(st.ret - st.qqq)}</span>` : '—', st?.qqq != null ? `QQQ ${pc(st.qqq)}` : 'once filled')
    + kpi('vs S&P 500', st?.spy != null ? `<span class="${cls(st.ret - st.spy)}">${pc(st.ret - st.spy)}</span>` : '—', st?.spy != null ? `SPY ${pc(st.spy)}` : 'once filled')
    + kpi('Confidence', `${f.confidence ?? '—'}<small style="display:inline;font-size:13px">/100</small>`, 'from the chair')
    + kpi('Cash', fw(f.cash_pct), `${f.holdings.length} holdings`);
  $('#pf-note').classList.toggle('hidden', !P.pending?.length); $('#pf-note').textContent = 'The latest decision fills at the next market open (9:30 ET).';
  $('#pf-sum').textContent = f.summary;
  $('#pf-count').textContent = `${f.holdings.length} names`;
  const pos = Object.fromEntries((P.positions || []).map((p) => [p.t, p])), max = Math.max(...f.holdings.map((h) => h.weight));
  $('#pf-list').innerHTML = f.holdings.slice().sort((a, b) => b.weight - a.weight).map((h) => { const p = pos[h.ticker];
    return `<div class="hold" style="--h:${hueOf(h.ticker)}"><div class="hold-top">${av(h.ticker, true)}
        <div class="hold-name"><b>${esc(h.ticker)}${P.hl?.[h.ticker] ? '<span class="hl">HL</span>' : ''}</b><span>${esc(UNI[h.ticker]?.n || '')}</span></div>
        <div class="hold-w"><b>${fw(h.weight)}</b>${p ? `<span class="${cls(p.pnlPct)}">${pc(p.pnlPct)}</span>` : '<span>pending</span>'}</div></div>
      <div class="wbar"><i style="width:${(h.weight / max) * 100}%"></i></div>
      <div class="why"><div><span class="stars">${'★'.repeat(h.conviction || 0)}<s>${'★'.repeat(5 - (h.conviction || 0))}</s></span><br>${esc(h.thesis)}<em><b>Sell if</b> ${esc(h.rotate_if)}</em><em>Backed by ${esc((h.champions || []).join(', ') || '—')}</em></div></div></div>`; }).join('');
  $$('#pf-list .hold').forEach((el) => (el.onclick = () => el.classList.toggle('open')));
  $('#pf-watch').classList.toggle('hidden', !demo && !S.hasKey);
  const wl = (P.watch || []).slice(0, 6);
  $('#pf-watchwrap').classList.toggle('hidden', !wl.length);
  $('#pf-watchlog').innerHTML = wl.map((w) => `<div class="wl"><small>${when(w.at)}${w.convene ? ' · called for a session' : ''}</small>${esc(w.statement)}</div>`).join('');
}
$('#pf-watch').onclick = async () => { $('#pf-watch').disabled = true; $('#pf-watch').textContent = 'Watching…'; try { const r = await OC.watch(demo); if (r.error) throw new Error(r.error); toast(r.statement || 'Watch complete'); renderPortfolio(); } catch (e) { toast(e.message, true); } finally { $('#pf-watch').disabled = false; $('#pf-watch').textContent = 'Run the watch now'; } };

/* ── Record ──────────────────────────────────────────────────────────── */
function renderRecord() {
  P = OC.portfolio(demo); P.verify = OC.verify(demo);
  const st = P.stats, ser = P.series, has = st && ser.length > 1;
  $('#rc-value').innerHTML = has ? `<span class="${cls(st.ret)}">${pc(st.ret)}</span>` : '<span style="color:var(--tx3)">—</span>';
  $('#rc-sub').innerHTML = has ? `over ${st.days} trading days · <b class="${cls(st.ret - st.qqq)}">${pc(st.ret - st.qqq)}</b> vs QQQ` : 'Starts at the first open after the first decision';
  $('#rc-kpis').innerHTML = has ? kpi('Nasdaq 100', pc(st.qqq), 'QQQ, same days') + kpi('S&P 500', pc(st.spy), 'SPY, same days') + kpi('Max drawdown', pc(st.maxDD), 'worst fall from a peak') + kpi('Sharpe', st.sharpe == null ? '—' : st.sharpe.toFixed(2), 'annualised') : '';
  $('#rc-ledger').innerHTML = P.verify?.ok ? `<span class="up">● Ledger intact</span>, ${P.verify.n} entries.` : `<span class="down">● Ledger broken at entry ${P.verify?.at}.</span>`;
  chart(ser, P.capital);
}
function chart(ser, cap) {
  const cv = $('#chart'), ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  if (ser.length < 2) { ctx.fillStyle = 'rgba(220,228,255,.4)'; ctx.font = '13px Inter'; ctx.textAlign = 'center'; ctx.fillText('The line starts after the first fill.', W / 2, H / 2); return; }
  const L = 6, R = 40, T = 10, B = 20, v = ser.flatMap((p) => [p[1], p[2], p[3]]).filter((x) => x != null).map((x) => x / cap - 1);
  let lo = Math.min(0, ...v), hi = Math.max(0, ...v); const pad = (hi - lo) * 0.12 || 0.01; lo -= pad; hi += pad;
  const X = (i) => L + (i / (ser.length - 1)) * (W - L - R), Y = (x) => T + (1 - (x - lo) / (hi - lo)) * (H - T - B);
  ctx.font = '10.5px Inter'; ctx.fillStyle = 'rgba(220,228,255,.4)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let k = 0; k <= 3; k++) { const x = lo + ((hi - lo) * k) / 3; ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(L, Y(x)); ctx.lineTo(W - R, Y(x)); ctx.stroke(); ctx.setLineDash([]); ctx.fillText(pc(x, 0), W - R + 6, Y(x)); }
  ctx.textBaseline = 'top'; ctx.fillText(ser[0][0].slice(5), L, H - B + 6); ctx.textAlign = 'right'; ctx.fillText(ser[ser.length - 1][0].slice(5), W - R, H - B + 6);
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
  const list = OC.sessions(demo);
  $('#ss-list').innerHTML = list.map((s) => { const d = new Date(s.startedAt);
    return `<div class="ss" data-id="${esc(s.id)}"><div class="ss-ic">${d.getDate()}<small>${d.toLocaleString('en', { month: 'short' }).toUpperCase()}</small></div>
      <div class="ss-body"><div class="ss-t"><b>${s.status === 'done' ? esc(S.presets[s.preset]?.label || s.preset) + ' session' : 'Session ' + esc(s.status)}</b>${s.demo ? '<span class="tag demo">demo</span>' : ''}${s.status !== 'done' ? `<span class="tag ${s.status}">${esc(s.status)}</span>` : ''}</div>
      <p>${s.status === 'done' ? `${s.holdings} holdings · confidence ${s.confidence} · ${money(s.cost)}${s.device ? ' · ' + esc(s.device) : ''}` : esc(s.error || '')}</p></div>${chevron}</div>`; }).join('')
    || `<div class="fine">No ${demo ? 'demo ' : ''}sessions yet.</div>`;
  $$('#ss-list .ss').forEach((el) => (el.onclick = () => detail(el.dataset.id)));
}
function detail(id) {
  show('session');
  const s = OC.session(id);
  if (!s) return ($('#ss-detail').innerHTML = '<p class="fine">Could not load it.</p>');
  const blk = (k, d, extra = '') => { const m = SEAT[k] || { name: k, role: '', color: '#999' }; return `<div class="glass tr" style="--c:${m.color}"><div class="m"><b style="color:${m.color}">${esc(m.name)}</b> · ${esc(m.role)}</div><p>${esc(d.statement || '')}</p>${extra}${d.picks ? `<div class="chips">${d.picks.slice().sort((a, b) => b.weight - a.weight).map((p) => chip(p.ticker, p.weight)).join('')}</div>` : ''}</div>`; };
  let h = `<div class="hero" style="padding-top:0"><div class="eyebrow">${esc(S.presets[s.preset]?.label || s.preset)}${s.demo ? ' · demo' : ''} · ${money(s.cost)}${s.device ? ' · ' + esc(s.device) : ''}</div><h1 style="font-size:30px">${when(s.startedAt)}</h1></div>`;
  if (s.error) h += `<div class="note" style="border-color:rgba(255,112,136,.4);background:rgba(255,112,136,.1);color:#ffc6cf">${esc(s.error)}</div>`;
  if (s.final) h += '<div class="tr-r">Decision</div>' + blk('arbiter', s.final, `<p style="color:var(--tx)">${esc(s.final.summary)}</p><ul>${s.final.holdings.map((x) => `<li><b>${esc(x.ticker)} ${fw(x.weight)}</b>: ${esc(x.thesis)}</li>`).join('')}</ul>`);
  if (s.risk) h += '<div class="tr-r">Risk review</div>' + blk('sentinel', s.risk);
  if (s.redteam) h += '<div class="tr-r">Red team</div>' + blk('vex', s.redteam, `<ul>${s.redteam.attacks.map((a) => `<li><b>${esc(a.target)}</b>: ${esc(a.argument)}</li>`).join('')}</ul>`);
  for (const r of (s.rounds || []).slice().reverse()) h += `<div class="tr-r">${esc(r.key === 'round1' ? 'Round 1' : r.key === 'rebuttal' ? 'Rebuttals' : 'Debate ' + r.key.slice(6))}</div>` + Object.entries(r.proposals).map(([k, d]) => blk(k, d)).join('');
  $('#ss-detail').innerHTML = h;
}
$('#ss-back').onclick = () => show('sessions');

/* ── The chamber, drawn small ────────────────────────────────────────── */
const Ch = (() => {
  const VC = { strong_buy: '51,214,159', buy: '51,214,159', hold: '170,176,200', avoid: '255,107,129', strong_avoid: '255,107,129' }, VA = { strong_buy: 1, buy: .6, hold: .35, avoid: .6, strong_avoid: 1 };
  const ORDER = ['vex', 'atlas', 'nova', 'anchor', 'pulse', 'raven', 'forge', 'harbor', 'scout', 'sentinel'];
  let cv, ctx, W, H, seats = {}, dots = [], by = {}, beams = [], fin = null, t0 = 0;
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
  function init(st) {
    cv = $('#cv'); ctx = cv.getContext('2d');
    [...ORDER, 'arbiter'].forEach((k) => { const d = st.seats[k] || st.officers[k]; if (d) seats[k] = { k, d, c: rgb(d.color), state: 'idle', on: true }; });
    st.universe.forEach((u) => { const d = { t: u.t, s: u.s, v: null, r: 0, w: 0, f: 0 }; dots.push(d); by[u.t] = d; });
    new ResizeObserver(layout).observe(cv); layout(); Ch.ready = true; requestAnimationFrame(frame);
  }
  function layout() {
    const dpr = devicePixelRatio || 1; W = cv.clientWidth; H = Math.round(W * 0.92); cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = W / 2, cy = H * 0.47, R = W * 0.45, Ry = H * 0.45, gap = 0.9, a0 = Math.PI / 2 + gap / 2, span = Math.PI * 2 - gap;
    let secs = [], a = a0; dots.forEach((d) => { if (!secs.includes(d.s)) secs.push(d.s); });
    const step = (span - 0.03 * (secs.length - 1)) / (dots.length - 1); let prev = dots[0].s;
    dots.forEach((d) => { if (d.s !== prev) { a += 0.03; prev = d.s; } d.a = a; d.x = cx + Math.cos(a) * R; d.y = cy + Math.sin(a) * Ry; a += step; });
    const g0 = Math.PI / 2 + 0.7, g1 = Math.PI / 2 + Math.PI * 2 - 0.7;
    ORDER.forEach((k, j) => { const s = seats[k]; if (!s) return; const t = g0 + (g1 - g0) * (j / (ORDER.length - 1)); s.x = cx + Math.cos(t) * R * 0.7; s.y = cy + Math.sin(t) * Ry * 0.7; });
    Object.assign(seats.arbiter, { x: cx, y: cy - 4 }); Object.assign(layout, { cx, cy });
  }
  function frame(t) {
    ctx.clearRect(0, 0, W, H); const sc = W / 400;
    const g = ctx.createRadialGradient(layout.cx, layout.cy, 4, layout.cx, layout.cy, 90 * sc); g.addColorStop(0, 'rgba(255,215,106,.13)'); g.addColorStop(1, 'rgba(255,215,106,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const b of beams) { const s = seats[b.k], d = by[b.t]; if (!s || !d) continue; const p = Math.min(1, Math.max(0, (t - b.b) / 800)), a = b.die ? Math.max(0, 1 - (t - b.die) / 600) : 1; if (!a) continue;
      const mx = (s.x + d.x) / 2 + (layout.cx - (s.x + d.x) / 2) * .35, my = (s.y + d.y) / 2 + (layout.cy - (s.y + d.y) / 2) * .35;
      ctx.strokeStyle = `rgba(${s.c},${(b.gold ? .55 : .12 + Math.min(.3, b.w / 40)) * a})`; ctx.lineWidth = b.gold ? 1 + b.w / 10 : .6 + b.w / 16; ctx.beginPath(); ctx.moveTo(s.x, s.y);
      if (p >= 1) ctx.quadraticCurveTo(mx, my, d.x, d.y); else for (let i = 1; i <= 14 * p; i++) { const u = i / 14; ctx.lineTo((1 - u) ** 2 * s.x + 2 * (1 - u) * u * mx + u * u * d.x, (1 - u) ** 2 * s.y + 2 * (1 - u) * u * my + u * u * d.y); }
      ctx.stroke(); }
    beams = beams.filter((b) => !b.die || t - b.die < 600);
    for (const d of dots) { let c = '120,128,156', a = .3, r = 1.8 * sc;
      if (d.v) { c = VC[d.v]; a = VA[d.v]; r = 2.2 * sc; }
      if (d.r) { const k = .5 + .5 * Math.sin(t / 160 + d.a * 9); c = '91,140,255'; a = .4 + .5 * k; r = 2.2 * sc + k; }
      if (fin) { if (d.w > 0) { c = '255,215,106'; a = 1; r = (2.6 + Math.min(4, d.w / 4)) * sc; } else a *= .4; }
      ctx.fillStyle = `rgba(${c},${a})`; ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, 6.283); ctx.fill();
      if (fin && d.w > 0) { ctx.font = `600 ${9 * sc}px Outfit, Inter`; ctx.fillStyle = 'rgba(255,229,160,.95)'; const ox = Math.cos(d.a), oy = Math.sin(d.a); ctx.textAlign = ox > .3 ? 'right' : ox < -.3 ? 'left' : 'center'; ctx.textBaseline = 'middle'; ctx.fillText(d.t, d.x - ox * 12 * sc, d.y - oy * 10 * sc); } }
    for (const s of Object.values(seats)) {
      const chair = s.k === 'arbiter', R = (chair ? 22 : 15) * sc, al = s.on ? 1 : .18;
      if (s.state === 'speaking' || s.state === 'thinking') { const k = (t / (s.state === 'speaking' ? 700 : 1400)) % 1; ctx.strokeStyle = `rgba(${s.c},${(1 - k) * .8 * al})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(s.x, s.y, R + 3 + k * 12 * sc, 0, 6.283); ctx.stroke(); }
      const gr = ctx.createRadialGradient(s.x - R * .3, s.y - R * .35, 1, s.x, s.y, R); gr.addColorStop(0, `rgba(${s.c},${.95 * al})`); gr.addColorStop(1, `rgba(${s.c},${.35 * al})`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(s.x, s.y, s.state === 'speaking' ? R * 1.12 : R, 0, 6.283); ctx.fill();
      if (s.state === 'done') { ctx.strokeStyle = `rgba(${s.c},.7)`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(s.x, s.y, R + 3, 0, 6.283); ctx.stroke(); }
      ctx.font = `600 ${(chair ? 11 : 9.5) * sc}px Outfit, Inter`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = `rgba(233,235,243,${.9 * al})`; ctx.fillText(s.d.name, s.x, s.y + R + 4);
    }
    requestAnimationFrame(frame);
  }
  const now = () => performance.now();
  return {
    ready: false, init,
    reset() { for (const s of Object.values(seats)) s.state = 'idle'; for (const d of dots) { d.v = null; d.r = 0; d.w = 0; } beams = []; fin = null; },
    present(keys) { for (const s of Object.values(seats)) s.on = keys.includes(s.k); },
    allPresent() { for (const s of Object.values(seats)) s.on = true; },
    seat(k, st) { if (seats[k]) seats[k].state = st; },
    reading(ts, on) { ts.forEach((t) => by[t] && (by[t].r = on ? 1 : 0)); },
    verdict(t, v) { if (by[t]) { by[t].v = v; by[t].r = 0; } },
    beams(k, picks) { beams.forEach((b) => b.k === k && !b.die && (b.die = now())); picks.forEach((p, i) => beams.push({ k, t: p.ticker, w: +p.weight || 0, b: now() + i * 50 })); },
    final(hs, anim) { beams.forEach((b) => !b.die && (b.die = now())); fin = true; dots.forEach((d) => (d.w = 0)); for (const s of Object.values(seats)) if (s.k !== 'arbiter') s.state = 'idle';
      hs.forEach((h, i) => { if (by[h.ticker]) { by[h.ticker].w = h.weight; beams.push({ k: 'arbiter', t: h.ticker, w: h.weight, b: anim ? now() + 200 + i * 80 : 0, gold: true }); } }); },
  };
})();

/* ── Settings ────────────────────────────────────────────────────────── */
function renderSettings() {
  S = OC.state(); const st = S.settings, y = S.sync || {};
  $('#k-state').innerHTML = S.hasKey ? '<span class="pill ok">Saved on this phone</span>' : '<span class="pill bad">Not set</span>';
  $('#k-in').placeholder = S.hasKey ? 'Saved. Paste a new key to replace it' : 'sk-ant-...';
  $('#k-clear').classList.toggle('hidden', !S.hasKey);
  if (document.activeElement !== $('#y-repo')) $('#y-repo').value = st.syncRepo || '';
  if (document.activeElement !== $('#y-dev')) $('#y-dev').value = st.device || '';
  $('#y-tok').placeholder = S.hasToken ? 'Saved. Paste to replace' : 'github_pat_...';
  $('#y-state').innerHTML = !y.on ? '<span class="pill">Off</span>' : y.error ? '<span class="pill bad">Error</span>' : '<span class="pill ok">Connected</span>';
  $('#y-info').innerHTML = !y.on ? 'Not connected.' : y.error ? `<span class="down">${esc(y.error)}</span>` : `Last synced ${y.last ? when(y.last) : 'never'} as ${esc(y.device)}.`;
  $('#d-preset').innerHTML = ['low', 'normal', 'high'].map((k) => `<button data-k="${k}" class="${st.preset === k ? 'on' : ''}">${S.presets[k].label}<small>~${money(S.presets[k].est.mid)}</small></button>`).join('');
  $$('#d-preset button').forEach((b) => (b.onclick = () => saveS({ preset: b.dataset.k })));
  if (document.activeElement !== $('#d-sec')) $('#d-sec').value = st.secContact || '';
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  $('#d-sched').textContent = st.schedule.enabled ? `Weekly session ${DAYS[st.schedule.day]} ${String(st.schedule.hour).padStart(2, '0')}:${String(st.schedule.minute).padStart(2, '0')}, run by whichever device is on. Change it on the PC.` : 'The weekly session is off. Turn it on in the PC app.';
  $('#d-spent').textContent = money(S.spentThisMonth);
  $('#d-ver').textContent = `Oazy Council ${S.version} for Android`;
}
function saveS(patch) { OC.setSettings(patch); if (patch.preset) preset = patch.preset; renderSettings(); renderIdle(); toast('Saved'); }
$('#k-save').onclick = () => {
  const v = $('#k-in').value.trim(); if (!v) return toast('Paste the key first.', true);
  if (!/^sk-ant-/.test(v)) return toast('That does not look like an Anthropic API key (sk-ant-…).', true);
  OC.setSecret('anthropicKey', v); $('#k-in').value = ''; refresh(); renderSettings(); toast('Key saved, encrypted on this phone.');
};
$('#k-clear').onclick = () => { OC.setSecret('anthropicKey', ''); refresh(); renderSettings(); toast('Key removed from this phone.'); };
$('#y-repo').onchange = (e) => { saveS({ syncRepo: e.target.value.trim() }); syncNowUI(); };
$('#y-dev').onchange = (e) => saveS({ device: e.target.value.trim().slice(0, 40) });
$('#y-save').onclick = () => { const v = $('#y-tok').value.trim(); if (!v) return toast('Paste the token first.', true); OC.setSecret('syncToken', v); $('#y-tok').value = ''; renderSettings(); syncNowUI(); };
$('#y-now').onclick = () => syncNowUI();
$('#d-sec').onchange = (e) => saveS({ secContact: e.target.value.trim().slice(0, 120) });
$$('[data-url]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); window.Native?.openUrl ? window.Native.openUrl(a.dataset.url) : window.open(a.dataset.url); }));
async function syncNowUI() {
  $('#y-info').textContent = 'Syncing…';
  const r = await OC.syncNow(); refresh(); renderSettings();
  toast(r.off ? 'Fill in the repository and token first.' : r.error ? 'Sync failed: ' + r.error : 'Synced', !!r.error);
}

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
  if (screen !== 'council') { show('council'); return true; }
  return false;
};
start();
