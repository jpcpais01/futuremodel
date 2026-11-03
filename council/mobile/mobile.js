/* Oazy Council for the phone. It follows the council running on the PC over the home network. */
'use strict';
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v, d = 2) => (v == null || !isFinite(v) ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pc = (v, d = 1) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
const cls = (v) => (v == null ? '' : v >= 0 ? 'up' : 'down');
const fw = (w) => (w == null ? '—' : (+w).toFixed(1) + '%');
const when = (ts) => new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const LS = { get: (k, d) => { try { const v = localStorage.getItem('oc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('oc.' + k, JSON.stringify(v)); } catch {} } };

let host = LS.get('host', ''), code = LS.get('code', ''), demo = LS.get('demo', false), preset = 'normal';
let S = LS.get('state', null), P = null, allowRun = true, es = null, sess = null, screen = 'council';
const SEAT = {}, UNI = {};

function toast(m, err) { const t = $('#toast'); t.textContent = m; t.className = 'on' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 3800); }
async function api(path, { method = 'GET', body, timeout = 12000 } = {}) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(host + path, { method, signal: ac.signal, headers: { 'x-council-code': code, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { status: r.status });
    return j;
  } finally { clearTimeout(t); }
}
const q = () => (demo ? '?demo=1' : '');

/* ── Pairing ─────────────────────────────────────────────────────────── */
function showPair(msg) {
  $('#app').classList.add('hidden'); $('#pair').classList.remove('hidden');
  $('#p-host').value = host || (location.protocol.startsWith('http') ? location.origin : '');
  $('#p-code').value = code; $('#p-err').textContent = msg || '';
}
$('#p-go').onclick = async () => {
  let h = $('#p-host').value.trim().replace(/\/+$/, '');
  if (h && !/^https?:\/\//.test(h)) h = 'http://' + h;
  if (h && !/:\d+$/.test(h)) h += ':7717';
  const c = $('#p-code').value.trim().toUpperCase();
  $('#p-err').textContent = ''; $('#p-go').disabled = true; $('#p-go').textContent = 'Connecting…';
  const old = [host, code]; host = h; code = c;
  try { const r = await api('/api/hello', { timeout: 6000 }); LS.set('host', h); LS.set('code', c); allowRun = r.allowRun; start(); }
  catch (e) { [host, code] = old; $('#p-err').textContent = e.status === 401 ? 'That code is not right. Check the desktop Settings.' : e.status === 429 ? e.message : 'Could not reach the PC. Check the address, that both are on the same Wi-Fi, and that Phone link is on.'; }
  finally { $('#p-go').disabled = false; $('#p-go').textContent = 'Connect'; }
};

/* ── Boot ────────────────────────────────────────────────────────────── */
async function start() {
  $('#pair').classList.add('hidden'); $('#app').classList.remove('hidden');
  setMode(demo);
  if (S) setup(S);
  try { const h = await api('/api/hello'); allowRun = h.allowRun; await refresh(); conn(true); }
  catch (e) { conn(false); if (e.status === 401) return showPair('The pairing code changed. Enter the new one.'); toast(S ? 'Offline. Showing what was last seen.' : 'Could not reach the PC.', true); }
  listen();
}
function conn(ok) { $('#conn').className = 'conn ' + (ok ? 'ok' : 'bad'); }
function setup(st) {
  Object.assign(SEAT, st.seats, st.officers); st.universe.forEach((u) => (UNI[u.t] = u));
  if (!Ch.ready) Ch.init(st);
}
async function refresh() {
  S = await api('/api/state'); LS.set('state', S); setup(S);
  if (S.running && !sess) { const ev = await api('/api/live'); ev.forEach((e) => handle(e)); }
  renderIdle();
  if (screen !== 'council') show(screen);
}
function listen() {
  if (es) es.close();
  es = new EventSource(`${host}/api/events?code=${encodeURIComponent(code)}`);
  es.onopen = () => conn(true);
  es.onerror = () => conn(false);
  es.onmessage = (m) => { try { JSON.parse(m.data).forEach((e) => handle(e)); } catch {} };
  es.addEventListener('changed', () => refresh().catch(() => {}));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && host) refresh().then(() => conn(true), () => conn(false)); });

function setMode(d) { demo = d; LS.set('demo', d); const b = $('#mode'); b.textContent = d ? 'Demo' : 'Paper'; b.classList.toggle('demo', d); $('#demo').checked = d; }
$('#mode').onclick = () => { setMode(!demo); renderIdle(); if (screen !== 'council') show(screen); };
$$('#tabs button').forEach((b) => (b.onclick = () => (b.dataset.s === 'pair' ? showPair() : show(b.dataset.s))));
function show(s) {
  screen = s; window.scrollTo(0, 0);
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.s === s || (s === 'session' && b.dataset.s === 'sessions')));
  $$('.screen').forEach((x) => x.classList.toggle('on', x.id === 's-' + s));
  if (s === 'portfolio') renderPortfolio(); if (s === 'record') renderRecord(); if (s === 'sessions') renderSessions();
}

/* ── Council ─────────────────────────────────────────────────────────── */
async function renderIdle() {
  if (!S) return;
  const live = !!sess && !sess.ended;
  $('#live').classList.toggle('hidden', !sess); $('#idle').classList.toggle('hidden', live);
  $('#next').textContent = S.next?.session ? 'Next weekly session ' + when(S.next.session) : '';
  $('#conv').classList.toggle('hidden', !allowRun || !!S.running);
  $('#presets').innerHTML = ['low', 'normal', 'high'].map((k) => `<button class="preset ${k === preset ? 'on' : ''}" data-k="${k}"><b>${S.presets[k].label}</b><span>${demo ? 'free' : '~' + money(S.presets[k].est.mid)}</span></button>`).join('');
  $$('#presets .preset').forEach((b) => (b.onclick = () => { preset = b.dataset.k; renderIdle(); }));
  $('#go').disabled = !demo && !S.hasKey; $('#go').textContent = !demo && !S.hasKey ? 'No API key on the PC' : demo ? 'Convene (demo)' : 'Convene';
  if (!live) {
    $('#c-phase').textContent = S.running ? 'In session' : 'Adjourned'; $('#c-sub').textContent = '';
    try { P = await api('/api/portfolio' + q()); LS.set('pf' + demo, P); } catch { P = LS.get('pf' + demo, null); }
    const f = P?.final;
    $('#last').innerHTML = f ? `<div class="eyebrow">${demo ? 'Demo · ' : ''}Latest decision · ${when(P.decidedAt)}</div><h3>${f.holdings.length} holdings, ${fw(f.cash_pct)} cash</h3><p>${esc(f.summary)}</p><div class="chips">${f.holdings.slice().sort((a, b) => b.weight - a.weight).map((h) => `<span class="chip"><b>${esc(h.ticker)}</b> ${fw(h.weight)}</span>`).join('')}</div>` : `<div class="eyebrow">No decision yet</div><p style="margin-top:6px">The council has not met${demo ? ' in demo mode' : ''}. Convene it here or on the PC.</p>`;
    if (f && !sess) Ch.final(f.holdings, false);
  }
}
$('#demo').onchange = (e) => { setMode(e.target.checked); renderIdle(); };
$('#go').onclick = async () => {
  $('#go').disabled = true;
  try { await api('/api/run', { method: 'POST', body: { preset, demo } }); toast('The council is convening.'); }
  catch (e) { toast(e.message, true); } finally { $('#go').disabled = false; }
};
$('#l-cancel').onclick = async () => { try { await api('/api/cancel', { method: 'POST', body: {} }); toast('Adjourning after the current call.'); } catch (e) { toast(e.message, true); } };

const roundLabel = (e) => ({ redteam: 'Red team', risk: 'Risk review', chair: 'Decision', scout: 'Briefing' }[e.kind] || (e.round === 1 ? 'Round 1' : e.round === 9 ? 'Rebuttal' : 'Debate ' + (e.round - 1)));
function handle(e) {
  if (e.type === 'start') {
    const i = e.session;
    sess = { info: i, seats: {}, focus: null, cost: 0, est: i.demo ? 0 : S.presets[i.preset]?.est.mid, props: {}, n: i.phases.length, reports: 0 };
    Ch.reset(); Ch.present([...i.members, ...i.officers, ...(i.phases.some((p) => p.key === 'scout') ? ['scout'] : [])]);
    $('#feed').innerHTML = ''; $('#floor').classList.add('hidden'); $('#l-cost').textContent = i.demo ? 'demo' : money(0); $('#l-bar').style.width = '0';
    $('#l-cancel').classList.toggle('hidden', !allowRun);
    if (screen !== 'council') show('council');
    renderIdle(); return;
  }
  if (!sess) return;
  switch (e.type) {
    case 'phase': $('#c-phase').textContent = e.label; $('#l-step').textContent = `Step ${e.i + 1} of ${e.n}`; $('#l-bar').style.width = ((e.i + 1) / e.n) * 100 + '%'; break;
    case 'progress': if (e.key === 'prices' || e.key === 'analysts') $('#c-sub').textContent = `${e.label} ${e.done} / ${e.total}`; break;
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
    case 'done': sess.ended = true; $('#l-cancel').classList.add('hidden'); toast(sess.info.demo ? 'Demo session recorded.' : `Session recorded. It cost ${money(e.cost)}.`); setTimeout(() => { sess = null; refresh().catch(() => {}); }, 6000); break;
    case 'failed': toast(e.error === 'Cancelled' ? 'Session adjourned.' : 'Session failed: ' + e.error, e.error !== 'Cancelled'); sess = null; Ch.reset(); Ch.allPresent(); refresh().catch(() => {}); break;
  }
}
function focus(k) {
  sess.focus = k; const d = SEAT[k]; if (!d) return;
  $('#floor').classList.remove('hidden'); $('#floor').style.setProperty('--c', d.color);
  $('#f-who').textContent = d.name; $('#f-role').textContent = d.role; paint();
}
function paint() { const st = sess.seats[sess.focus] || {}; $('#f-round').textContent = st.label || ''; $('#f-text').innerHTML = st.text ? esc(st.text) + (st.state === 'speaking' ? '<span class="caret"></span>' : '') : '<span style="color:var(--tx3)">Thinking…</span>'; }
function feed(e, text, d) {
  const s = SEAT[e.seat] || { name: e.seat, color: '#999' };
  const chips = (d.picks || d.holdings || []).slice().sort((a, b) => b.weight - a.weight).slice(0, 8).map((p) => `<span class="chip"><b>${esc(p.ticker)}</b> ${fw(p.weight)}</span>`).join('');
  $('#feed').insertAdjacentHTML('afterbegin', `<div class="st"><div class="st-h"><b style="color:${s.color}">${esc(s.name)}</b><span>${esc(roundLabel(e))}</span></div><p>${esc(text)}</p>${chips ? `<div class="chips">${chips}</div>` : ''}</div>`);
}

/* ── Portfolio ───────────────────────────────────────────────────────── */
async function renderPortfolio() {
  try { P = await api('/api/portfolio' + q()); LS.set('pf' + demo, P); } catch { P = LS.get('pf' + demo, null); if (!P) return; }
  const f = P.final, st = P.stats, nav = P.series.length ? P.series[P.series.length - 1][1] : P.capital;
  $('#pf-asof').textContent = f ? `${demo ? 'Demo · ' : ''}decided ${when(P.decidedAt)}` : demo ? 'Demo record' : 'Paper record';
  if (!f) { $('#pf-kpis').innerHTML = ''; $('#pf-sum').textContent = 'No decision yet.'; $('#pf-list').innerHTML = ''; $('#pf-note').classList.add('hidden'); return; }
  $('#pf-kpis').innerHTML = [['Paper value', money(nav, 0), st ? `<span class="${cls(st.ret)}">${pc(st.ret)}</span> since start` : 'starting capital'],
    ['vs Nasdaq 100', st?.qqq != null ? `<span class="${cls(st.ret - st.qqq)}">${pc(st.ret - st.qqq)}</span>` : '—', st?.qqq != null ? `QQQ ${pc(st.qqq)}` : 'once filled'],
    ['vs S&P 500', st?.spy != null ? `<span class="${cls(st.ret - st.spy)}">${pc(st.ret - st.spy)}</span>` : '—', st?.spy != null ? `SPY ${pc(st.spy)}` : 'once filled'],
    ['Confidence', (f.confidence ?? '—') + '<small style="display:inline">/100</small>', `${f.holdings.length} holdings, ${fw(f.cash_pct)} cash`]]
    .map(([a, b, c]) => `<div class="kpi"><div class="eyebrow">${a}</div><div class="num">${b}</div><small>${c}</small></div>`).join('');
  $('#pf-note').classList.toggle('hidden', !P.pending?.length); $('#pf-note').textContent = 'The latest decision fills at the next market open (9:30 ET).';
  $('#pf-sum').textContent = f.summary;
  const pos = Object.fromEntries((P.positions || []).map((p) => [p.t, p])), max = Math.max(...f.holdings.map((h) => h.weight));
  $('#pf-list').innerHTML = f.holdings.slice().sort((a, b) => b.weight - a.weight).map((h) => { const p = pos[h.ticker];
    return `<div class="hold"><div class="hold-top"><span class="t">${esc(h.ticker)}</span>${P.hl?.[h.ticker] ? '<span class="hl">HL</span>' : ''}<span class="n">${esc(UNI[h.ticker]?.n || '')}</span><span class="w">${fw(h.weight)}</span></div>
      <div class="wbar"><i style="width:${(h.weight / max) * 100}%"></i></div>
      <div class="hold-meta"><span class="stars">${'★'.repeat(h.conviction || 0)}<s>${'★'.repeat(5 - (h.conviction || 0))}</s></span><span class="grow"></span>${p ? `<span class="${cls(p.pnlPct)}">${pc(p.pnlPct)}</span>` : '<span>pending</span>'}</div>
      <div class="why">${esc(h.thesis)}<em><b>Sell if</b> ${esc(h.rotate_if)}</em><em>Backed by ${esc((h.champions || []).join(', ') || '—')}</em></div></div>`; }).join('');
  $$('#pf-list .hold').forEach((el) => (el.onclick = () => el.classList.toggle('open')));
  $('#pf-watch').classList.toggle('hidden', !allowRun);
  $('#pf-watchlog').innerHTML = (P.watch || []).slice(0, 6).map((w) => `<div class="wl"><small>${when(w.at)}${w.convene ? ' · called for a session' : ''}</small>${esc(w.statement)}</div>`).join('');
}
$('#pf-watch').onclick = async () => { $('#pf-watch').disabled = true; try { const r = await api('/api/watch', { method: 'POST', body: { demo }, timeout: 180000 }); if (r.error) throw new Error(r.error); toast(r.statement || 'Watch complete'); renderPortfolio(); } catch (e) { toast(e.message, true); } finally { $('#pf-watch').disabled = false; } };

/* ── Record ──────────────────────────────────────────────────────────── */
async function renderRecord() {
  try { P = await api('/api/portfolio' + q()); } catch { P = LS.get('pf' + demo, null); if (!P) return; }
  const st = P.stats, ser = P.series;
  $('#rc-kpis').innerHTML = st && ser.length > 1 ? [['Council', pc(st.ret), `${st.days} trading days`], ['Nasdaq 100', pc(st.qqq), `council ${pc(st.ret - st.qqq)} vs it`], ['S&P 500', pc(st.spy), `council ${pc(st.ret - st.spy)} vs it`], ['Max drawdown', pc(st.maxDD), `Sharpe ${st.sharpe == null ? '—' : st.sharpe.toFixed(2)}`]]
    .map(([a, b, c]) => `<div class="kpi"><div class="eyebrow">${a}</div><div class="num">${b}</div><small>${c}</small></div>`).join('') : '<div class="kpi" style="grid-column:1/-1"><div class="eyebrow">No record yet</div><small>It starts at the first open after the first decision.</small></div>';
  $('#rc-ledger').innerHTML = P.verify?.ok ? `<span class="up">Ledger intact</span>, ${P.verify.n} entries.` : `<span class="down">Ledger broken at entry ${P.verify?.at}.</span>`;
  chart(ser, P.capital);
}
function chart(ser, cap) {
  const cv = $('#chart'), ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  if (ser.length < 2) { ctx.fillStyle = '#6c728a'; ctx.font = '13px Inter'; ctx.textAlign = 'center'; ctx.fillText('Fills in after the first decision.', W / 2, H / 2); return; }
  const L = 40, R = 6, T = 8, B = 18, v = ser.flatMap((p) => [p[1], p[2], p[3]]).filter((x) => x != null).map((x) => x / cap - 1);
  let lo = Math.min(0, ...v), hi = Math.max(0, ...v); const pad = (hi - lo) * 0.1 || 0.01; lo -= pad; hi += pad;
  const X = (i) => L + (i / (ser.length - 1)) * (W - L - R), Y = (x) => T + (1 - (x - lo) / (hi - lo)) * (H - T - B);
  ctx.font = '10px Inter'; ctx.fillStyle = '#6c728a'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let k = 0; k <= 3; k++) { const x = lo + ((hi - lo) * k) / 3; ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.moveTo(L, Y(x)); ctx.lineTo(W - R, Y(x)); ctx.stroke(); ctx.fillText(pc(x, 0), L - 5, Y(x)); }
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(ser[0][0].slice(5), L, H - B + 5); ctx.textAlign = 'right'; ctx.fillText(ser[ser.length - 1][0].slice(5), W - R, H - B + 5);
  const line = (ix, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); let m = false; ser.forEach((p, i) => { if (p[ix] == null) return; const x = X(i), y = Y(p[ix] / cap - 1); m ? ctx.lineTo(x, y) : ctx.moveTo(x, y); m = true; }); ctx.stroke(); };
  line(2, '#7f8bb0', 1.2); line(3, '#33c3ff', 1.2); line(1, '#ffd76a', 2);
}

/* ── Sessions ────────────────────────────────────────────────────────── */
async function renderSessions() {
  let list; try { list = await api('/api/sessions' + q()); } catch (e) { $('#ss-list').innerHTML = `<p class="fine">${esc(e.message)}</p>`; return; }
  $('#ss-list').innerHTML = list.map((s) => `<div class="ss" data-id="${esc(s.id)}"><div class="ss-t"><b>${when(s.startedAt)}</b><span class="tag ${s.status}">${s.status === 'done' ? esc(S.presets[s.preset]?.label || s.preset) : esc(s.status)}</span>${s.demo ? '<span class="tag demo">demo</span>' : ''}</div><p>${s.status === 'done' ? `${s.holdings} holdings · confidence ${s.confidence} · ${money(s.cost)}` : esc(s.error || '')}</p>${s.summary ? `<p>${esc(s.summary)}</p>` : ''}</div>`).join('') || '<p class="fine center">No sessions yet.</p>';
  $$('#ss-list .ss').forEach((el) => (el.onclick = () => detail(el.dataset.id)));
}
async function detail(id) {
  show('session'); $('#ss-detail').innerHTML = '<p class="fine">Loading…</p>';
  const s = await api('/api/session?id=' + encodeURIComponent(id)).catch(() => null);
  if (!s) return ($('#ss-detail').innerHTML = '<p class="fine">Could not load it.</p>');
  const blk = (k, d, extra = '') => { const m = SEAT[k] || { name: k, role: '', color: '#999' }; return `<div class="tr" style="--c:${m.color}"><div class="m"><b style="color:${m.color}">${esc(m.name)}</b> · ${esc(m.role)}</div><p>${esc(d.statement || '')}</p>${extra}${d.picks ? `<div class="chips">${d.picks.slice().sort((a, b) => b.weight - a.weight).map((p) => `<span class="chip"><b>${esc(p.ticker)}</b> ${fw(p.weight)}</span>`).join('')}</div>` : ''}</div>`; };
  let h = `<div class="head"><div class="eyebrow">${esc(S.presets[s.preset]?.label || s.preset)}${s.demo ? ' · demo' : ''} · ${money(s.cost)}</div><h2 style="font-size:22px">${when(s.startedAt)}</h2></div>`;
  if (s.error) h += `<p class="down">${esc(s.error)}</p>`;
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

/* Android back button: step back inside the app, or tell the shell to leave. */
window.ocBack = () => {
  if (!$('#pair').classList.contains('hidden') && host && code) { start(); return true; }
  if (screen === 'session') { show('sessions'); return true; }
  if (screen !== 'council') { show('council'); return true; }
  return false;
};
if (host && code) start(); else showPair();
