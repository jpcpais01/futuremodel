/* Oazy Council: the window. Everything here is display; the engine runs in the main process. */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v, d = 2) => (v == null || !isFinite(v) ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pc = (v, d = 1) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
const cls = (v) => (v == null ? '' : v >= 0 ? 'up' : 'down');
const fmtW = (w) => (w == null ? '—' : (+w).toFixed(1) + '%');
const ago = (ts) => { const s = (Date.now() - new Date(ts)) / 1000; return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const when = (ts) => new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const VLABEL = { strong_buy: 'Strong buy', buy: 'Buy', hold: 'Hold', avoid: 'Avoid', strong_avoid: 'Strong avoid' };

let S = null, P = null, mode = 'paper', view = 'chamber', presetSel = null;
let sess = null;            // the session on screen, live or replayed
let replay = null;          // { stop, speed }
const SEAT = {}, UNI = {};

function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'on' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 4200); }

/* ── Boot ─────────────────────────────────────────────────────────────── */
async function boot() {
  S = await council.state();
  Object.assign(SEAT, S.seats, S.officers);
  S.universe.forEach((u) => (UNI[u.t] = u));
  presetSel = S.settings.preset;
  Chamber.init({ stageEl: $('#stage'), canvas: $('#ring'), seatsBox: $('#seats'), seatDefs: S.seats, officerDefs: S.officers, universe: S.universe, hover: tickerTip });
  Chamber.allPresent();
  wireChrome(); renderConvene(); renderSettings();
  council.onEvents((list) => { if (replay) return; list.forEach((e) => handle(e, false)); });
  council.onChanged(async (why) => {
    S = await council.state();
    renderSettings();
    if (why === 'idle' || why === 'marks' || why === 'watch') { if (view !== 'chamber') show(view); }
    if (why === 'idle' && sess && !sess.ended) endSession();
    if (why === 'running' && !sess && S.running) { /* started elsewhere (schedule): the start event will follow */ }
    renderConvene();
  });
  if (S.running) { beginSession({ id: S.running.id, preset: S.running.preset, demo: S.running.demo, members: Object.keys(S.seats), officers: Object.keys(S.officers), phases: [] }); $('#core-phase').textContent = 'The council is in session'; }
  idleCore();
  watchElsewhere(); setInterval(watchElsewhere, 30e3);
}

function wireChrome() {
  $('#wmin').onclick = () => oazyWin.min(); $('#wmax').onclick = () => oazyWin.max(); $('#wclose').onclick = () => oazyWin.close();
  $$('#tabs button').forEach((b) => (b.onclick = () => show(b.dataset.view)));
  $$('#mode button').forEach((b) => (b.onclick = () => { mode = b.dataset.mode; $$('#mode button').forEach((x) => x.classList.toggle('on', x === b)); $('#demoRun').checked = mode === 'demo'; renderConvene(); if (view !== 'chamber') show(view); }));
  $('#demoRun').onchange = renderConvene;
  $('#go').onclick = convene;
  $('#cancel').onclick = () => { if (replay) return stopReplay(); council.cancel(); $('#cancel').disabled = true; $('#core-sub').textContent = 'Adjourning after the current call…'; };
  $('#replayLast').onclick = async () => { const list = await council.sessions($('#demoRun').checked); const s = list.find((x) => x.status === 'done'); if (s) startReplay(s.id); else toast('No finished session to replay yet.'); };
  $$('#sidetabs button').forEach((b) => (b.onclick = () => { $$('#sidetabs button').forEach((x) => x.classList.toggle('on', x === b)); $$('.log-card .pane').forEach((p) => p.classList.toggle('on', p.id === 'p-' + b.dataset.p)); }));
  $$('#replay-speed button').forEach((b) => (b.onclick = () => { $$('#replay-speed button').forEach((x) => x.classList.toggle('on', x === b)); if (replay) replay.speed = +b.dataset.s; }));
  $('#replay-stop').onclick = stopReplay;
  $('#pf-watch').onclick = async () => { $('#pf-watch').disabled = true; const r = await council.watch(mode === 'demo'); $('#pf-watch').disabled = false; if (r?.error) toast(r.error, true); else { toast(r.statement || 'Watch complete'); show('portfolio'); } };
  $('#pr-verify').onclick = () => show('performance');
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-url]'); if (a) { e.preventDefault(); council.openUrl(a.dataset.url); } });
  // ticker tooltip
  const tt = document.createElement('div'); tt.id = 'ttip'; tt.className = 'tip hidden'; $('#stage').appendChild(tt);
}

function show(v) {
  view = v;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $$('.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
  if (v === 'portfolio') renderPortfolio();
  if (v === 'performance') renderPerformance();
  if (v === 'sessions') renderSessions();
  if (v === 'settings') renderSettings();
}

/* ── Convene panel ────────────────────────────────────────────────────── */
function renderConvene() {
  const demo = $('#demoRun').checked;
  $('#presets').innerHTML = ['low', 'normal', 'high'].map((k) => {
    const p = S.presets[k], est = p.est;
    const dots = [...p.members.map((m) => SEAT[m].color), ...(p.redTeam ? [SEAT.vex.color] : []), SEAT.sentinel.color, SEAT.arbiter.color];
    return `<button class="preset ${k === presetSel ? 'on' : ''}" data-k="${k}">
      <div class="p-name">${esc(p.label)}</div>
      <div class="p-cost">${demo ? 'Free' : '~' + money(est.mid)}<small>${demo ? ' demo' : ' per session'}</small></div>
      <ul><li>${p.members.length} seats on ${esc(p.models.member)}, ${esc(p.effort)} effort</li>
      <li>${p.rounds ? p.rounds + ' debate round' + (p.rounds > 1 ? 's' : '') : 'No debate round'}${p.redTeam ? ', red team' : ''}${p.rebuttal ? ', rebuttals' : ''}</li>
      <li>${esc(p.models.analyst)} analysts, ${esc(p.models.chair)} chair${p.scout ? ', web scout' : ''}</li>
      <li>About ${est.calls} calls${demo ? '' : `, ${money(est.low)} to ${money(est.high)}`}</li></ul>
      <div class="p-dots">${dots.map((c) => `<i style="background:${c}"></i>`).join('')}</div></button>`;
  }).join('');
  $$('#presets .preset').forEach((b) => (b.onclick = () => { presetSel = b.dataset.k; renderConvene(); }));
  const w = $('#keywarn');
  if (!demo && elsewhere) { w.classList.remove('hidden'); w.innerHTML = `The council is in session on <b>${esc(elsewhere.device)}</b> (${esc(elsewhere.phase?.label || 'convening')}). Its decision syncs here when it ends. Demo runs still work.`; }
  else if (!demo && !S.hasKey) { w.classList.remove('hidden'); w.innerHTML = 'No API key found. Set the <code>ANTHROPIC_API_KEY</code> environment variable and restart the app (see Settings), or tick Demo run to watch the council work for free.'; }
  else w.classList.add('hidden');
  $('#go').disabled = (!demo && (!S.hasKey || !!elsewhere)) || !!S.running;
  $('#go').textContent = demo ? 'Convene (demo)' : 'Convene';
  const show = !sess && !replay;
  $('#convene').classList.toggle('hidden', !show || !$('#verdict').classList.contains('hidden'));
}

async function convene() {
  const demo = $('#demoRun').checked;
  if (demo !== (mode === 'demo')) { mode = demo ? 'demo' : 'paper'; $$('#mode button').forEach((x) => x.classList.toggle('on', x.dataset.mode === mode)); }
  $('#go').disabled = true;
  const r = await council.run(presetSel, demo);
  if (r?.error) { toast(r.error, true); if (sess && !sess.ended) endSession(true); renderConvene(); }
}

let elsewhere = null;
function idleCore() {
  const n = S.next?.session;
  if (elsewhere) {
    $('#core-phase').textContent = `In session on ${elsewhere.device}`;
    $('#core-sub').textContent = (elsewhere.phase?.label || 'Convening') + (elsewhere.last?.text ? ' · ' + elsewhere.last.text.slice(0, 120) : '');
    return;
  }
  $('#core-phase').textContent = 'The council is adjourned';
  $('#core-sub').textContent = n ? 'Next session ' + when(n) : 'No session scheduled';
}
/* While another device holds the session, show where it is up to, and pick up its result when it ends. */
async function watchElsewhere() {
  if (!S?.sync?.on || sess || S.running) return;
  const l = await council.remoteLive().catch(() => null), was = elsewhere;
  elsewhere = l;
  if (was && !l) { await council.syncNow(); S = await council.state(); if (view !== 'chamber') show(view); }
  if (!sess) idleCore();
  renderConvene();
}

/* ── Session display ──────────────────────────────────────────────────── */
function beginSession(info) {
  $('#verdict').classList.add('hidden');
  Chamber.reset();
  Chamber.present([...info.members, ...info.officers, ...(info.phases.some((p) => p.key === 'scout') ? ['scout'] : [])]);
  sess = { info, phase: -1, cost: 0, t0: Date.now(), seats: {}, focus: null, props: {}, reports: {}, progress: {}, ended: false, rounds: {} };
  const est = S.presets[info.preset]?.est;
  sess.est = info.demo ? 0 : est?.mid || 0;
  $('#costEst').textContent = info.demo ? 'Free' : '~' + money(est?.mid);
  $('#cost').textContent = money(0); $('#costBar').style.width = '0';
  $('#sessId').textContent = info.id || '';
  $('#agenda').innerHTML = info.phases.map((p) => `<li data-k="${p.key}"><i></i>${esc(p.label)}</li>`).join('');
  $('#progress').innerHTML = '';
  $('#transcript').innerHTML = ''; $('#matrix').innerHTML = '<div class="empty">Each seat\'s weights appear once proposals arrive.</div>';
  renderDesk();
  $('#convene').classList.add('hidden');
  $('#floor').classList.add('hidden');
  $('#cancel').classList.remove('hidden'); $('#cancel').disabled = false; $('#cancel').textContent = replay ? 'Stop replay' : 'Adjourn';
  clearInterval(sess.clock);
  sess.clock = setInterval(() => { const s = Math.floor(((replay ? sess.vt : Date.now()) - sess.t0) / 1000); $('#elapsed').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 500);
  $('#core-phase').textContent = info.demo ? 'Demo session' : 'In session';
  $('#core-sub').textContent = `${S.presets[info.preset]?.label || ''} budget · ${info.trigger === 'scheduled' ? 'weekly session' : info.trigger === 'emergency' ? 'emergency session' : info.id || ''}`;
}

function endSession(failed) {
  if (!sess) return;
  sess.ended = true; clearInterval(sess.clock);
  $('#cancel').classList.add('hidden');
  if (failed) { Chamber.reset(); Chamber.allPresent(); sess = null; idleCore(); renderConvene(); }
}

const nameOf = (k) => SEAT[k]?.name || k;
function roundLabel(e) {
  if (e.kind === 'redteam') return 'Red team';
  if (e.kind === 'risk') return 'Risk review';
  if (e.kind === 'chair') return 'Decision';
  if (e.kind === 'scout') return 'Briefing';
  return e.round === 1 ? 'Round 1' : e.round === 9 ? 'Rebuttal' : 'Debate ' + (e.round - 1);
}

function setFocus(k) {
  if (!sess) return;
  sess.focus = k; Chamber.bubble(k, '');
  const d = SEAT[k], st = sess.seats[k] || {};
  const f = $('#floor');
  f.classList.remove('hidden'); f.style.setProperty('--c', d.color);
  $('#floor-who').textContent = d.name; $('#floor-role').textContent = d.role; $('#floor-round').textContent = st.label || '';
  paintFloor();
}
function paintFloor() {
  const k = sess?.focus; if (!k) return;
  const st = sess.seats[k] || {};
  const txt = st.text || '';
  $('#floor-text').innerHTML = `<div>${esc(txt)}${st.state === 'speaking' ? '<span class="caret"></span>' : ''}</div>`;
  $('#floor-think').textContent = st.state === 'thinking' && st.think ? '… ' + st.think.slice(-170).replace(/\s+/g, ' ') : st.state === 'thinking' ? 'Thinking…' : '';
}
function nextFocus() {
  const live = Object.entries(sess.seats).filter(([, v]) => v.state === 'speaking').sort((a, b) => b[1].at - a[1].at)[0]
    || Object.entries(sess.seats).filter(([, v]) => v.state === 'thinking').sort((a, b) => b[1].at - a[1].at)[0];
  if (live) setFocus(live[0]);
}

function handle(e, isReplay) {
  if (e.type === 'watch') { toast('Watch: ' + (e.watch.statement || 'done')); return; }
  if (e.type === 'start') return beginSession(e.session);
  if (!sess) { if (['phase', 'turn', 'speak', 'think', 'said', 'desk'].includes(e.type) && S.running) beginSession({ id: S.running.id, preset: S.running.preset, demo: S.running.demo, members: Object.keys(S.seats), officers: Object.keys(S.officers), phases: [] }); else return; }
  switch (e.type) {
    case 'phase': {
      sess.phase = e.i;
      $$('#agenda li').forEach((li, i) => { li.classList.toggle('done', i < e.i); li.classList.toggle('now', i === e.i); });
      $('#core-phase').textContent = e.label;
      if (['round1', 'scout'].includes(e.key)) $('#progress').innerHTML = '';
      if (e.key === 'risk' || e.key === 'chair' || e.key.startsWith('debate') || e.key === 'rebuttal') for (const k of Object.keys(sess.seats)) if (sess.seats[k].state === 'done') Chamber.seat(k, 'idle');
      if (e.key === 'record') { $('#floor').classList.add('hidden'); }
      break;
    }
    case 'progress': {
      sess.progress[e.key] = e;
      $('#progress').innerHTML = Object.values(sess.progress).filter((p) => !(p.done >= p.total && p.key !== 'analysts' && p.key !== 'prices')).map((p) =>
        `<div class="pg"><div><b>${esc(p.label)}</b><span class="grow"></span>${p.total > 1 ? `${p.done} / ${p.total}` : p.done ? 'done' : '…'}</div><div class="meter"><i style="width:${Math.round((p.done / Math.max(1, p.total)) * 100)}%"></i></div></div>`).join('');
      break;
    }
    case 'log': addLog(e.text); break;
    case 'desk': {
      if (e.state === 'reading') Chamber.reading(e.tickers, true);
      else if (e.state === 'failed') { Chamber.reading(e.tickers, false); addLog(`A desk could not read ${e.tickers.length} names; they will be retried.`); }
      else { (e.reports || []).forEach((r) => { sess.reports[r.t] = r.v; Chamber.verdict(r.t, r.v); }); }
      const n = Object.values(sess.reports).filter(Boolean).length;
      $('#core-sub').textContent = n ? `${n} of ${S.universe.length} names read` : $('#core-sub').textContent;
      renderDesk();
      break;
    }
    case 'turn': {
      sess.seats[e.seat] = { state: 'thinking', text: '', think: '', label: roundLabel(e), at: Date.now() };
      Chamber.seat(e.seat, 'thinking', roundLabel(e));
      if (!sess.focus || sess.seats[sess.focus]?.state === 'done' || sess.seats[sess.focus]?.state === 'idle') setFocus(e.seat);
      break;
    }
    case 'think': {
      const st = sess.seats[e.seat]; if (!st) break;
      st.think = (st.think + e.text).slice(-600);
      if (st.state !== 'speaking' && sess.focus !== e.seat) Chamber.bubble(e.seat, '… ' + st.think.slice(-160));
      if (sess.focus === e.seat) paintFloor();
      break;
    }
    case 'speak': {
      const st = sess.seats[e.seat] || (sess.seats[e.seat] = { label: '' });
      if (st.state !== 'speaking') { st.state = 'speaking'; st.at = Date.now(); Chamber.seat(e.seat, 'speaking', st.label); }
      st.text = e.text;
      Chamber.bubble(e.seat, sess.focus === e.seat ? '' : e.text);
      if (!sess.focus || sess.seats[sess.focus]?.state !== 'speaking') setFocus(e.seat);
      if (sess.focus === e.seat) paintFloor();
      break;
    }
    case 'said': said(e); break;
    case 'cost': {
      sess.cost = e.total; $('#cost').textContent = money(e.total);
      if (sess.est) { const r = e.total / sess.est; $('#costBar').style.width = Math.min(100, r * 100) + '%'; $('#costBar').classList.toggle('over', r > 1); }
      break;
    }
    case 'final': finalShow(e); break;
    case 'done': {
      $$('#agenda li').forEach((li) => { li.classList.remove('now'); li.classList.add('done'); });
      if (!isReplay) { $('#cost').textContent = money(e.cost); toast(`Session recorded. It cost ${money(e.cost)}.`); }
      endSession(false); council.state().then((s) => { S = s; });
      break;
    }
    case 'failed': {
      toast(e.error === 'Cancelled' ? 'Session adjourned. Nothing was recorded.' : 'Session failed: ' + e.error, e.error !== 'Cancelled');
      addLog('Stopped: ' + e.error);
      endSession(true);
      break;
    }
  }
}

function said(e) {
  const st = sess.seats[e.seat] || (sess.seats[e.seat] = { label: roundLabel(e) });
  const d = e.data || {};
  st.state = 'done'; st.text = d.statement || e.text || st.text; st.label = roundLabel(e);
  Chamber.seat(e.seat, 'done', st.label);
  Chamber.bubble(e.seat, '');
  if (e.kind === 'member' && d.picks) { sess.props[e.seat] = d; Chamber.beams(e.seat, d.picks); renderMatrix(); }
  if (e.kind === 'redteam' && d.cut) Chamber.beams('vex', d.cut.map((c) => ({ ticker: c.ticker, weight: 6 })));
  if (e.kind === 'risk' && d.vetoes) Chamber.beams('sentinel', d.vetoes.map((v) => ({ ticker: v.ticker, weight: 6 })));
  addStatement(e, st.text, d);
  if (sess.focus === e.seat) { paintFloor(); setTimeout(() => { if (sess && sess.seats[e.seat]?.state === 'done' && sess.focus === e.seat) nextFocus(); }, 1600); }
}

function addLog(text) {
  const t = $('#transcript'); if ($('.empty', t)) t.innerHTML = '';
  t.insertAdjacentHTML('beforeend', `<div class="st log"><p>${esc(text)}</p></div>`); t.scrollTop = t.scrollHeight;
}
function addStatement(e, text, d) {
  const t = $('#transcript'); if ($('.empty', t)) t.innerHTML = '';
  const seat = SEAT[e.seat] || { name: e.seat, color: '#999' };
  let extra = '';
  if (d.picks) extra = `<div class="picks">${d.picks.slice().sort((a, b) => b.weight - a.weight).map((p) => `<span class="chip"><b>${esc(p.ticker)}</b> ${fmtW(p.weight)}</span>`).join('')}${d.cash_pct ? `<span class="chip">cash ${fmtW(d.cash_pct)}</span>` : ''}</div>`;
  if (d.attacks) extra = `<div class="picks">${d.attacks.map((a) => `<span class="chip" title="${esc(a.argument)}"><b>${esc(a.target)}</b> ${'!'.repeat(a.severity)}</span>`).join('')}</div>`;
  if (d.vetoes) extra = `<div class="picks">${d.vetoes.map((v) => `<span class="chip" title="${esc(v.reason)}">veto <b>${esc(v.ticker)}</b></span>`).join('')}${(d.caps || []).map((c) => `<span class="chip">${esc(c.ticker)} ≤ ${c.max_weight}%</span>`).join('')}<span class="chip">cash ≥ ${d.min_cash_pct}%</span></div>`;
  if (d.holdings) extra = `<div class="picks">${d.holdings.map((h) => `<span class="chip"><b>${esc(h.ticker)}</b> ${fmtW(h.weight)}</span>`).join('')}</div>`;
  t.insertAdjacentHTML('beforeend', `<div class="st"><div class="st-head"><b style="color:${seat.color}">${esc(seat.name)}</b><span>${esc(roundLabel(e))}</span><span class="grow"></span>${e.cost ? `<span>${money(e.cost, 3)}</span>` : ''}</div><p>${esc(text)}</p>${extra}</div>`);
  t.scrollTop = t.scrollHeight;
}

function renderMatrix() {
  const seats = Object.keys(sess.props);
  if (!seats.length) return;
  const agg = {};
  for (const k of seats) for (const p of sess.props[k].picks) (agg[p.ticker] = agg[p.ticker] || { w: 0, n: 0 }), (agg[p.ticker].w += p.weight / seats.length), agg[p.ticker].n++;
  const rows = Object.entries(agg).sort((a, b) => b[1].w - a[1].w).slice(0, 22);
  $('#matrix').innerHTML = `<table><tr><th></th>${seats.map((k) => `<th class="v" style="color:${SEAT[k].color}">${esc(SEAT[k].name)}</th>`).join('')}<th class="v" style="color:var(--gold)">Average</th></tr>${rows.map(([t, a]) => `<tr><td class="t">${esc(t)}</td>${seats.map((k) => {
    const p = sess.props[k].picks.find((x) => x.ticker === t); const w = p ? p.weight : 0;
    return `<td style="background:${w ? hexA(SEAT[k].color, Math.min(.85, .15 + w / 18)) : 'rgba(255,255,255,.025)'}" title="${esc(SEAT[k].name)}: ${w ? fmtW(w) + (p.thesis ? ' · ' + p.thesis : '') : 'not held'}">${w ? Math.round(w) : ''}</td>`;
  }).join('')}<td class="cons">${a.w.toFixed(1)}</td></tr>`).join('')}</table>`;
}
const hexA = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;

function renderDesk() {
  const by = {};
  S.universe.forEach((u) => (by[u.s] = by[u.s] || []).push(u));
  const rep = sess?.reports || {};
  const counts = {}; Object.values(rep).forEach((v) => v && (counts[v] = (counts[v] || 0) + 1));
  $('#desk').innerHTML = (Object.keys(counts).length ? `<div class="desk-sec"><div class="desk-grid">${Object.keys(VLABEL).map((v) => `<span class="vt ${v}">${VLABEL[v]} ${counts[v] || 0}</span>`).join('')}</div></div>` : '')
    + Object.entries(by).map(([s, list]) => `<div class="desk-sec"><h4>${esc(s)}</h4><div class="desk-grid">${list.map((u) => `<span class="vt ${rep[u.t] || ''}" title="${esc(u.n)}${rep[u.t] ? ': ' + VLABEL[rep[u.t]] : ''}">${esc(u.t)}</span>`).join('')}</div></div>`).join('');
}

function tickerTip(d, pos) {
  const tt = $('#ttip'); if (!d) return tt.classList.add('hidden');
  const v = sess?.reports?.[d.t];
  const held = (sess?.final || P?.final)?.holdings?.find((h) => h.ticker === d.t);
  const backers = sess ? Object.entries(sess.props).filter(([, p]) => p.picks.some((x) => x.ticker === d.t)).map(([k]) => SEAT[k].name) : [];
  tt.innerHTML = `<b style="font-family:var(--display);font-size:13px">${esc(d.t)}</b> <span class="dim">${esc(d.s)}</span><br>${esc(d.n)}${v ? `<br>Analyst: <b>${VLABEL[v]}</b>` : ''}${backers.length ? `<br>Backed by ${esc(backers.join(', '))}` : ''}${held ? `<br><span style="color:var(--gold)">Held at ${fmtW(held.weight)}</span>` : ''}`;
  tt.classList.remove('hidden');
  const W = $('#stage').clientWidth;
  tt.style.left = Math.min(W - 200, pos.x + 14) + 'px'; tt.style.top = pos.y + 14 + 'px';
}

function finalShow(e) {
  const f = e.final; sess.final = f;
  Chamber.final(f.holdings);
  for (const k of Object.keys(sess.seats)) if (k !== 'arbiter') Chamber.seat(k, 'idle');
  const prev = Object.fromEntries((e.previous || []).map((p) => [p.ticker, p.weight]));
  const rows = f.holdings.slice().sort((a, b) => b.weight - a.weight);
  const max = Math.max(...rows.map((h) => h.weight), 1);
  const sold = Object.keys(prev).filter((t) => !rows.some((h) => h.ticker === t));
  const conf = Math.max(0, Math.min(100, f.confidence || 0)), C = 2 * Math.PI * 30;
  setTimeout(() => {
    if (!sess || sess.final !== f) return;
    $('#floor').classList.add('hidden');
    const v = $('#verdict');
    v.innerHTML = `<div class="v-top"><div style="flex:1"><div class="eyebrow">The council has decided${replay ? ' · replay' : ''}</div><h1>${rows.length} holdings, ${fmtW(f.cash_pct)} cash</h1><p class="lede">${esc(f.summary)}</p></div>
      <div class="conf"><svg class="ring" viewBox="0 0 74 74"><circle cx="37" cy="37" r="30" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="6"/><circle cx="37" cy="37" r="30" fill="none" stroke="var(--gold)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(C * conf) / 100} ${C}" transform="rotate(-90 37 37)"/><text x="37" y="42" text-anchor="middle" fill="#fff" font-family="Outfit" font-size="17">${conf}</text></svg><div class="eyebrow">confidence</div></div></div>
      <div class="hold-rows">${rows.map((h, i) => { const p = prev[h.ticker]; const ch = p == null ? '<span class="chg up">new</span>' : Math.abs(h.weight - p) >= 0.5 ? `<span class="chg ${h.weight > p ? 'up' : 'down'}">${h.weight > p ? '+' : ''}${(h.weight - p).toFixed(1)}</span>` : '';
        return `<div class="hold"><div class="t">${esc(h.ticker)}</div><div class="bar"><i style="width:${(h.weight / max) * 100}%;animation-delay:${i * 60}ms"></i><span>${esc(h.thesis)}</span></div><div class="w">${fmtW(h.weight)}${ch}</div></div>`; }).join('')}</div>
      ${sold.length ? `<p class="dim">Sold: ${sold.map(esc).join(', ')}</p>` : ''}
      ${f.changes ? `<p style="color:var(--tx2)">${esc(f.changes)}</p>` : ''}
      ${(f.notes || []).length ? `<p class="dim" style="font-size:11.5px">Limits applied: ${f.notes.map(esc).join(' · ')}</p>` : ''}
      <div class="v-foot"><span class="dim mono">${e.ledgerHash ? 'ledger ' + esc(String(e.ledgerHash).slice(0, 16)) : ''}</span><span class="grow"></span><button class="ghost" id="v-close">Back to the chamber</button><button class="primary" id="v-pf">Open portfolio</button></div>`;
    v.classList.remove('hidden');
    $('#v-close').onclick = closeVerdict;
    $('#v-pf').onclick = () => { if (replay?.demo != null) { mode = replay.demo ? 'demo' : 'paper'; $$('#mode button').forEach((x) => x.classList.toggle('on', x.dataset.mode === mode)); } closeVerdict(); show('portfolio'); };
  }, replay ? 1200 / replay.speed : 2200);
}
function closeVerdict() {
  $('#verdict').classList.add('hidden');
  if (replay) stopReplay();
  Chamber.clearFinal(); Chamber.reset(); Chamber.allPresent();
  $('#floor').classList.add('hidden');
  sess = null; idleCore(); renderConvene();
}

/* ── Replay ───────────────────────────────────────────────────────────── */
async function startReplay(id) {
  S = await council.state();
  if (S.running) return toast('The council is in session.');
  const s = await council.session(id);
  if (!s?.events?.length) return toast('This session has no replay recorded.');
  show('chamber');
  $('#verdict').classList.add('hidden');
  replay = { id, speed: 1, stopped: false, demo: !!s.demo };
  $('#replaybar').classList.remove('hidden'); $('#replay-id').textContent = `${s.id} · ${S.presets[s.preset]?.label || ''}`;
  $$('#replay-speed button').forEach((x) => x.classList.toggle('on', x.dataset.s === '1'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms / replay.speed));
  let last = 0;
  for (const e of s.events) {
    if (replay?.stopped !== false) return;
    const gap = Math.min(e.ms - last, e.type === 'said' ? 900 : 1600); last = e.ms;
    if (gap > 0) await sleep(gap);
    if (replay?.stopped !== false) return;
    if (e.type === 'start') { handle(e, true); sess.vt = sess.t0; continue; }
    if (sess) sess.vt = sess.t0 + e.ms;
    if (e.type === 'said') {
      // Speak the statement as it was said, quickly.
      const text = e.data?.statement || e.text || '';
      if (e.kind !== 'scout' || text) {
        handle({ type: 'turn', seat: e.seat, round: e.round, kind: e.kind }, true);
        for (let i = 0; i <= text.length; i += 6) { if (replay?.stopped !== false) return; handle({ type: 'speak', seat: e.seat, round: e.round, text: text.slice(0, i) }, true); await sleep(14); }
      }
      handle(e, true);
      if (e.cost != null) { sess.cost += e.cost; handle({ type: 'cost', total: sess.cost }, true); }
      continue;
    }
    if (e.type === 'desk') Chamber.reading(e.tickers, true), await sleep(120);
    handle(e, true);
  }
  if (sess) { $$('#agenda li').forEach((li) => { li.classList.remove('now'); li.classList.add('done'); }); sess.ended = true; clearInterval(sess.clock); }
  $('#cancel').classList.add('hidden');
}
function stopReplay() {
  if (!replay) return;
  replay.stopped = true; replay = null;
  $('#replaybar').classList.add('hidden');
  if ($('#verdict').classList.contains('hidden')) { if (sess) { clearInterval(sess.clock); } Chamber.clearFinal(); Chamber.reset(); Chamber.allPresent(); $('#floor').classList.add('hidden'); sess = null; idleCore(); renderConvene(); }
}

/* ── Portfolio ───────────────────────────────────────────────────────── */
async function renderPortfolio() {
  P = await council.portfolio(mode === 'demo');
  const f = P.final, st = P.stats, nav = P.series.length ? P.series[P.series.length - 1][1] : P.capital;
  $('#pf-asof').textContent = f ? `${mode === 'demo' ? 'Demo · ' : ''}Decided ${when(P.decidedAt)} · ${P.lastId}` : mode === 'demo' ? 'Demo record' : 'Paper record';
  if (!f) {
    $('#pf-kpis').innerHTML = ''; $('#pf-pending').classList.add('hidden'); $('#pf-donut').innerHTML = ''; $('#pf-summary').textContent = 'The council has not decided yet. Convene it from the Chamber.'; $('#pf-meta').innerHTML = '';
    $('#pf-table').innerHTML = ''; $('#pf-dissent').innerHTML = '<div class="empty">Nothing yet.</div>'; $('#pf-watchlog').innerHTML = '<div class="empty">Nothing yet.</div>'; return;
  }
  const pos = Object.fromEntries((P.positions || []).map((p) => [p.t, p]));
  $('#pf-kpis').innerHTML = [
    ['Paper value', money(nav, 0), st ? `<span class="${cls(st.ret)}">${pc(st.ret)}</span> since start` : 'starting capital'],
    ['vs S&P 500', st?.spy != null ? `<span class="${cls(st.ret - st.spy)}">${pc(st.ret - st.spy)}</span>` : '—', st?.spy != null ? `SPY ${pc(st.spy)}` : 'once filled'],
    ['vs Nasdaq 100', st?.qqq != null ? `<span class="${cls(st.ret - st.qqq)}">${pc(st.ret - st.qqq)}</span>` : '—', st?.qqq != null ? `QQQ ${pc(st.qqq)}` : 'once filled'],
    ['Holdings', f.holdings.length, `${fmtW(f.cash_pct)} cash target`],
    ['Confidence', (f.confidence ?? '—') + '<small>/100</small>', 'the chair\'s own'],
  ].map(([a, b, c]) => `<div class="kpi"><div class="eyebrow">${a}</div><div class="num">${b}</div><small>${c}</small></div>`).join('');
  const pend = $('#pf-pending');
  if (P.pending?.length) { pend.classList.remove('hidden'); pend.textContent = `The latest decision fills at the next regular-session open (9:30 ET). Until then the record shows the previous holdings.`; } else pend.classList.add('hidden');
  donut(f);
  $('#pf-summary').textContent = f.summary;
  $('#pf-meta').innerHTML = (f.watch || []).map((w) => `<span class="chip">watch: ${esc(w)}</span>`).join('');
  const all = f.holdings.slice().sort((a, b) => b.weight - a.weight);
  const extra = (P.positions || []).filter((p) => !all.some((h) => h.ticker === p.t));
  $('#pf-table').innerHTML = `<tr><th>Holding</th><th class="r">Target</th><th class="r">Now</th><th class="r">P&amp;L</th><th>Conviction</th><th>Why, and when we sell</th></tr>`
    + all.map((h) => { const p = pos[h.ticker], u = UNI[h.ticker] || {};
      return `<tr><td><div class="tk">${esc(h.ticker)}${P.hl?.[h.ticker] ? `<span class="hl" title="Tradable on Hyperliquid as ${esc(P.hl[h.ticker])}">HL</span>` : ''}</div><div class="nm">${esc(u.n || '')}</div><div class="nm">${esc(u.s || '')}</div></td>
        <td class="r num">${fmtW(h.weight)}</td><td class="r num">${p ? fmtW(p.weight) : '<span class="dim">pending</span>'}</td>
        <td class="r num ${cls(p?.pnlPct)}">${p ? pc(p.pnlPct) : '—'}<div class="nm">${p ? money(p.pnl, 0) : ''}</div></td>
        <td><span class="stars">${'★'.repeat(h.conviction || 0)}<s>${'★'.repeat(5 - (h.conviction || 0))}</s></span><div class="nm">${esc((h.champions || []).join(', '))}</div></td>
        <td class="why">${esc(h.thesis)}<em><b>Sell if</b> ${esc(h.rotate_if)}</em></td></tr>`; }).join('')
    + extra.map((p) => `<tr><td><div class="tk">${esc(p.t)}</div><div class="nm">being sold at the next open</div></td><td class="r num">0%</td><td class="r num">${fmtW(p.weight)}</td><td class="r num ${cls(p.pnlPct)}">${pc(p.pnlPct)}</td><td></td><td class="why dim">Rotated out by the latest decision.</td></tr>`).join('');
  $('#pf-dissent').innerHTML = (f.dissent || []).map((d) => `<div class="dis"><b>${esc(d.seat)}</b>${esc(d.view)}</div>`).join('') || '<div class="empty">No recorded dissent.</div>';
  $('#pf-watchlog').innerHTML = (P.watch || []).map((w) => { const hit = (w.alerts || []).filter((a) => a.triggered);
    return `<div class="wl"><div class="when">${when(w.at)}${w.convene ? ' · <span class="flag">called for a session</span>' : ''}</div>${esc(w.statement)}${hit.length ? `<div class="flag">${hit.map((a) => `${esc(a.ticker)}: ${esc(a.reason)}`).join('<br>')}</div>` : ''}</div>`; }).join('') || '<div class="empty">The watch runs on weekdays after the close.</div>';
}

function donut(f) {
  const items = f.holdings.slice().sort((a, b) => b.weight - a.weight);
  const secCol = {}; const pal = ['#5b8cff', '#b06cff', '#2fd6a8', '#ffb547', '#ff6b81', '#33c3ff', '#8fd16a', '#ff9f5a', '#ffd76a', '#9aa3c7', '#e67ad6', '#6ee7e7'];
  let i = 0; items.forEach((h) => { const s = UNI[h.ticker]?.s || 'Other'; if (!secCol[s]) secCol[s] = pal[i++ % pal.length]; });
  const R = 74, r = 52, C = 100; let a = -Math.PI / 2;
  const arc = (w, col, title) => { const da = (w / C) * Math.PI * 2; const a1 = a + da; const big = da > Math.PI ? 1 : 0;
    const p = `M${R * Math.cos(a)},${R * Math.sin(a)} A${R},${R} 0 ${big} 1 ${R * Math.cos(a1)},${R * Math.sin(a1)} L${r * Math.cos(a1)},${r * Math.sin(a1)} A${r},${r} 0 ${big} 0 ${r * Math.cos(a)},${r * Math.sin(a)}Z`; a = a1;
    return `<path d="${p}" fill="${col}" stroke="#0b0d16" stroke-width="1.5"><title>${esc(title)}</title></path>`; };
  const paths = items.map((h) => arc(h.weight, secCol[UNI[h.ticker]?.s || 'Other'], `${h.ticker} ${fmtW(h.weight)}`)).join('') + (f.cash_pct > 0 ? arc(f.cash_pct, 'rgba(255,255,255,.12)', `Cash ${fmtW(f.cash_pct)}`) : '');
  $('#pf-donut').innerHTML = `<div style="display:flex;gap:16px;align-items:center"><svg viewBox="-80 -80 160 160" width="160" height="160">${paths}<text y="-2" text-anchor="middle" fill="#fff" font-family="Outfit" font-size="20">${items.length}</text><text y="15" text-anchor="middle" fill="#6c728a" font-size="9" letter-spacing="1.5">HOLDINGS</text></svg>
    <div style="display:grid;gap:4px;font-size:11.5px;white-space:nowrap">${Object.entries(secCol).map(([s, c]) => `<div><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c};margin-right:7px"></i>${esc(s)} <span class="dim">${fmtW(items.filter((h) => (UNI[h.ticker]?.s || 'Other') === s).reduce((x, h) => x + h.weight, 0))}</span></div>`).join('')}<div><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:rgba(255,255,255,.2);margin-right:7px"></i>Cash <span class="dim">${fmtW(f.cash_pct)}</span></div></div></div>`;
}

/* ── Performance ─────────────────────────────────────────────────────── */
async function renderPerformance() {
  P = await council.portfolio(mode === 'demo');
  const st = P.stats, ser = P.series;
  const k = (a, b, c) => `<div class="kpi"><div class="eyebrow">${a}</div><div class="num">${b}</div><small>${c}</small></div>`;
  $('#pr-kpis').innerHTML = st && ser.length > 1 ? [
    k('Council', `<span class="${cls(st.ret)}">${pc(st.ret)}</span>`, `${st.days} trading days`),
    k('S&P 500', pc(st.spy), `council ${pc(st.ret - st.spy)} vs it`),
    k('Nasdaq 100', pc(st.qqq), `council ${pc(st.ret - st.qqq)} vs it`),
    k('Sharpe', st.sharpe == null ? '—' : st.sharpe.toFixed(2), `volatility ${pc(st.vol, 0).replace('+', '')}`),
    k('Max drawdown', `<span class="down">${pc(st.maxDD)}</span>`, 'peak to trough'),
    k('Weeks beating SPY', st.weeklyHit == null ? '—' : Math.round(st.weeklyHit * 100) + '%', `${st.weeks} weeks`),
  ].join('') : `<div class="kpi" style="grid-column:1/-1"><div class="eyebrow">No record yet</div><div class="num" style="font-size:17px">The record starts at the first market open after the council's first decision.</div><small>${P.pending?.length ? 'A decision is waiting to fill at the next open.' : 'Convene the council from the Chamber.'}</small></div>`;
  $('#pr-range').textContent = ser.length ? `${ser[0][0]} to ${ser[ser.length - 1][0]}` : '';
  drawChart(ser, P.capital);
  const v = P.verify;
  $('#pr-verify-out').innerHTML = v?.ok ? `<span class="pill ok">Intact</span> <span class="dim">${v.n} entries, every hash links to the one before.</span>` : `<span class="pill bad">Broken at entry ${v?.at}</span> <span class="dim">The ledger was edited after it was written.</span>`;
  $('#pr-fills').innerHTML = (P.fills || []).slice(-8).reverse().map((x) => `<div class="fill">Filled ${esc(x.date)} at the open · ${esc(x.session)} · ${x.trades.length} trades · cost ${money(x.fee)}</div>`).join('') + ((P.pending || []).map((x) => `<div class="fill">Waiting for the next open · ${esc(x.session)}</div>`).join(''));
}

function drawChart(ser, capital) {
  const cv = $('#chart'), ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  if (ser.length < 2) { ctx.fillStyle = '#6c728a'; ctx.font = '13px Inter'; ctx.textAlign = 'center'; ctx.fillText('The chart fills in from the first open after the first decision.', W / 2, H / 2); cv.onmousemove = null; return; }
  const L = 56, R = 16, T = 14, B = 26;
  const vals = ser.flatMap((p) => [p[1], p[2], p[3]]).filter((x) => x != null).map((x) => x / capital - 1);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); const pad = (hi - lo) * 0.12 || 0.01; lo -= pad; hi += pad;
  const X = (i) => L + (i / (ser.length - 1)) * (W - L - R), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  ctx.font = '11px Inter'; ctx.fillStyle = '#6c728a'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4, y = Y(v); ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke(); ctx.fillText(pc(v), L - 8, y); }
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(W - R, Y(0)); ctx.stroke(); ctx.setLineDash([]);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const nt = Math.min(6, ser.length); for (let k = 0; k < nt; k++) { const i = Math.round((k / Math.max(1, nt - 1)) * (ser.length - 1)); ctx.fillText(ser[i][0].slice(5), X(i), H - B + 8); }
  const line = (ix, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); let m = false; ser.forEach((p, i) => { if (p[ix] == null) return; const x = X(i), y = Y(p[ix] / capital - 1); m ? ctx.lineTo(x, y) : ctx.moveTo(x, y); m = true; }); ctx.stroke(); };
  // area under the council
  const g = ctx.createLinearGradient(0, T, 0, H - B); g.addColorStop(0, 'rgba(255,215,106,.18)'); g.addColorStop(1, 'rgba(255,215,106,0)');
  ctx.fillStyle = g; ctx.beginPath(); ser.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p[1] / capital - 1)) : ctx.moveTo(X(i), Y(p[1] / capital - 1)))); ctx.lineTo(X(ser.length - 1), Y(lo)); ctx.lineTo(X(0), Y(lo)); ctx.fill();
  line(2, '#7f8bb0', 1.4); line(3, '#33c3ff', 1.4); line(1, '#ffd76a', 2.2);
  const tip = $('#chart-tip');
  cv.onmousemove = (e) => { const r = cv.getBoundingClientRect(), i = Math.max(0, Math.min(ser.length - 1, Math.round(((e.clientX - r.left - L) / (W - L - R)) * (ser.length - 1)))), p = ser[i];
    tip.classList.remove('hidden'); tip.style.left = Math.min(W - 170, X(i) + 14) + 'px'; tip.style.top = '40px';
    tip.innerHTML = `<b>${p[0]}</b><br><span style="color:var(--gold)">Council ${pc(p[1] / capital - 1)}</span> ${money(p[1], 0)}<br><span style="color:#9aa3c7">SPY ${pc(p[2] / capital - 1)}</span><br><span style="color:#33c3ff">QQQ ${pc(p[3] / capital - 1)}</span>`; };
  cv.onmouseleave = () => tip.classList.add('hidden');
}

/* ── Sessions ────────────────────────────────────────────────────────── */
async function renderSessions() {
  const list = await council.sessions(mode === 'demo');
  $('#ss-list').innerHTML = list.map((s) => `<div class="ss" data-id="${esc(s.id)}"><div class="ss-top"><b>${when(s.startedAt)}</b><span class="grow"></span><span class="tag ${s.status}">${s.status === 'done' ? (S.presets[s.preset]?.label || s.preset) : s.status}</span>${s.demo ? '<span class="tag demo">demo</span>' : ''}</div>
    <p>${s.status === 'done' ? `${s.holdings} holdings · confidence ${s.confidence} · ${money(s.cost)} · ${esc(s.trigger)}` : esc(s.error || '')}</p>${s.summary ? `<p>${esc(s.summary)}</p>` : ''}</div>`).join('') || `<div class="empty">No ${mode === 'demo' ? 'demo ' : ''}sessions yet.</div>`;
  $$('#ss-list .ss').forEach((el) => (el.onclick = () => { $$('#ss-list .ss').forEach((x) => x.classList.toggle('on', x === el)); sessionDetail(el.dataset.id); }));
}
async function sessionDetail(id) {
  const s = await council.session(id), box = $('#ss-detail');
  if (!s) return (box.innerHTML = '<div class="empty">Not found.</div>');
  const seatBlock = (k, d, extra = '') => { const m = SEAT[k] || { name: k, role: '', color: '#999' };
    return `<div class="tr-seat" style="--c:${m.color}"><div class="meta"><b style="color:${m.color}">${esc(m.name)}</b> · ${esc(m.role)}${d.risk_appetite != null ? ` · risk appetite ${d.risk_appetite}, cash ${fmtW(d.cash_pct)}` : ''}</div><p>${esc(d.statement || '')}</p>${d.regime ? `<div class="meta">Regime: ${esc(d.regime)}</div>` : ''}${extra}
    ${d.picks ? `<ul>${d.picks.slice().sort((a, b) => b.weight - a.weight).map((p) => `<li><b>${esc(p.ticker)} ${fmtW(p.weight)}</b> (conviction ${p.conviction}): ${esc(p.thesis)} <span class="dim">Risk: ${esc(p.key_risk)}</span></li>`).join('')}</ul>` : ''}
    ${d.responses?.length ? `<ul>${d.responses.map((r) => `<li class="dim">to ${esc(r.to)}: ${esc(r.point)}</li>`).join('')}</ul>` : ''}</div>`; };
  const LBL = { round1: 'Round 1, independent', rebuttal: 'Rebuttals to the red team' };
  let h = `<div class="page-head" style="margin-bottom:6px"><div><div class="eyebrow">${esc(s.id)} · ${esc(S.presets[s.preset]?.label || s.preset)} · ${esc(s.trigger)}${s.demo ? ' · demo' : ''}</div><h2 style="font-size:21px">${when(s.startedAt)}</h2></div><span class="grow"></span>${s.events?.length ? '<button class="ghost" id="ss-replay">Replay in the chamber</button>' : ''}</div>
    <p class="dim">Cost ${money(s.cost)} · ${s.calls?.length || 0} calls · data as of ${esc(s.dataAsOf || '—')}${s.briefHash ? ` · book ${esc(s.briefHash.slice(0, 12))}` : ''}${s.ledgerHash ? ` · ledger ${esc(String(s.ledgerHash).slice(0, 12))}` : ''}</p>`;
  if (s.error) h += `<div class="warn">${esc(s.error)}</div>`;
  if (s.final) h += `<div class="tr-round">Decision</div>` + seatBlock('arbiter', s.final, `<p style="color:var(--tx)">${esc(s.final.summary)}</p><ul>${s.final.holdings.map((x) => `<li><b>${esc(x.ticker)} ${fmtW(x.weight)}</b>: ${esc(x.thesis)} <span class="dim">Sell if ${esc(x.rotate_if)}</span></li>`).join('')}</ul>${s.final.changes ? `<p class="meta">${esc(s.final.changes)}</p>` : ''}${(s.final.dissent || []).map((d) => `<p class="meta">Dissent, ${esc(d.seat)}: ${esc(d.view)}</p>`).join('')}`);
  if (s.risk) h += `<div class="tr-round">Risk review</div>` + seatBlock('sentinel', s.risk, `<ul>${s.risk.vetoes.map((v) => `<li>Veto <b>${esc(v.ticker)}</b>: ${esc(v.reason)}</li>`).join('')}${s.risk.caps.map((c) => `<li>Cap ${esc(c.ticker)} at ${c.max_weight}%: ${esc(c.reason || '')}</li>`).join('')}${s.risk.concerns.map((c) => `<li class="dim">${esc(c)}</li>`).join('')}</ul>`);
  if (s.redteam) h += `<div class="tr-round">Red team</div>` + seatBlock('vex', s.redteam, `<ul>${s.redteam.attacks.map((a) => `<li><b>${esc(a.target)}</b> [${a.severity}/5]: ${esc(a.argument)}</li>`).join('')}</ul>${s.redteam.killer_scenario ? `<p class="meta">Killer scenario: ${esc(s.redteam.killer_scenario)}</p>` : ''}`);
  for (const r of (s.rounds || []).slice().reverse()) h += `<div class="tr-round">${esc(LBL[r.key] || (r.key.startsWith('debate') ? 'Debate, round ' + r.key.slice(6) : r.key))}</div>` + Object.entries(r.proposals).map(([k, d]) => seatBlock(k, d)).join('');
  if (s.scout) h += `<div class="tr-round">Scout briefing</div><div class="tr-seat" style="--c:${SEAT.scout.color}"><p style="white-space:pre-wrap">${esc(typeof s.scout === 'string' ? s.scout : JSON.stringify(s.scout))}</p></div>`;
  if (s.errors?.length) h += `<div class="tr-round">Problems</div>${s.errors.map((e) => `<p class="dim">${esc(e)}</p>`).join('')}`;
  box.innerHTML = h;
  $('#ss-replay')?.addEventListener('click', () => startReplay(s.id));
}

/* ── Settings ────────────────────────────────────────────────────────── */
function renderSync() {
  const y = S.sync || {}, st = S.settings;
  $('#st-sy-state').innerHTML = y.on ? (y.error ? '<span class="pill bad">Error</span>' : '<span class="pill ok">Connected</span>') : '<span class="pill">Off</span>';
  if (document.activeElement !== $('#st-sy-repo')) $('#st-sy-repo').value = st.syncRepo || '';
  if (document.activeElement !== $('#st-sy-dev')) $('#st-sy-dev').value = st.device || '';
  $('#st-sy-token').placeholder = S.hasToken ? 'saved (paste to replace)' : 'github_pat_...';
  $('#st-sy-info').innerHTML = !y.on ? 'Not set up. Fill in the repository and token, on both the PC and the phone.'
    : y.error ? `<span class="bad">${esc(y.error)}</span>` : `Last synced ${y.last ? when(y.last) : 'never'} as ${esc(y.device)}.`;
}
function renderSettings() {
  if (!S) return; const st = S.settings;
  $('#st-key').innerHTML = S.hasKey ? '<span class="pill ok">Found</span>' : '<span class="pill bad">Not set</span>';
  $('#st-keyhelp').classList.toggle('hidden', S.hasKey);
  $('#st-preset').innerHTML = ['low', 'normal', 'high'].map((k) => `<button data-k="${k}" class="${st.preset === k ? 'on' : ''}">${S.presets[k].label} · ${money(S.presets[k].est.mid)}</button>`).join('');
  $$('#st-preset button').forEach((b) => (b.onclick = () => save({ preset: b.dataset.k })));
  const day = $('#st-sch-day'); if (!day.options.length) day.innerHTML = DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('');
  day.value = st.schedule.day;
  const hm = (o) => `${String(o.hour).padStart(2, '0')}:${String(o.minute).padStart(2, '0')}`, pt = (v) => { const [h, m] = v.split(':').map(Number); return { hour: h || 0, minute: m || 0 }; };
  $('#st-sch-on').checked = st.schedule.enabled; $('#st-sch-time').value = hm(st.schedule);
  $('#st-w-on').checked = st.watch.enabled; $('#st-w-time').value = hm(st.watch);
  $('#st-catch').checked = st.catchUp; $('#st-emerg').checked = st.autoEmergency; $('#st-tray').checked = st.tray;
  if (document.activeElement !== $('#st-sec')) $('#st-sec').value = st.secContact || '';
  $('#st-dir').textContent = S.dataDir; $('#st-spent').textContent = money(S.spentThisMonth);
  $('#st-presets').innerHTML = ['low', 'normal', 'high'].map((k) => { const p = S.presets[k];
    return `<div class="ps-row"><b>${p.label}</b><div>${esc(p.blurb)}<br><span class="dim">${p.members.map((m) => SEAT[m].name).join(', ')}${p.redTeam ? ' + Vex' : ''} + Sentinel + Arbiter · about ${p.est.calls} calls</span></div><div class="num r" style="text-align:right">${money(p.est.mid)}<div class="dim" style="font-size:11px">${money(p.est.low)} to ${money(p.est.high)}</div></div></div>`; }).join('');
  $('#st-ver').textContent = `Oazy Council ${S.version || ''} · next session ${S.next.session ? when(S.next.session) : 'not scheduled'} · next watch ${S.next.watch ? when(S.next.watch) : 'off'}`;
  renderSync();
  if (!renderSettings.wired) {
    renderSettings.wired = true;
    $('#st-sch-on').onchange = (e) => save({ schedule: { enabled: e.target.checked } });
    $('#st-sch-day').onchange = (e) => save({ schedule: { day: +e.target.value } });
    $('#st-sch-time').onchange = (e) => save({ schedule: pt(e.target.value) });
    $('#st-w-on').onchange = (e) => save({ watch: { enabled: e.target.checked } });
    $('#st-w-time').onchange = (e) => save({ watch: pt(e.target.value) });
    $('#st-catch').onchange = (e) => save({ catchUp: e.target.checked });
    $('#st-emerg').onchange = (e) => save({ autoEmergency: e.target.checked });
    $('#st-tray').onchange = (e) => save({ tray: e.target.checked });
    $('#st-sec').onchange = (e) => save({ secContact: e.target.value.trim().slice(0, 120) });
    $('#st-open').onclick = () => council.openData();
    $('#st-sy-repo').onchange = (e) => save({ syncRepo: e.target.value.trim() }).then(syncNow);
    $('#st-sy-dev').onchange = (e) => save({ device: e.target.value.trim().slice(0, 40) });
    $('#st-sy-save').onclick = async () => { const v = $('#st-sy-token').value.trim(); if (!v) return; const r = await council.setSecret('syncToken', v); if (r?.error) return toast(r.error, true); S = r; $('#st-sy-token').value = ''; renderSettings(); syncNow(); };
    $('#st-sy-now').onclick = syncNow;
  }
}
async function syncNow() {
  $('#st-sy-info').textContent = 'Syncing…';
  const r = await council.syncNow(); S = await council.state(); renderSettings();
  toast(r.off ? 'Sync is not set up' : r.error ? 'Sync failed' : 'Synced');
}
async function save(patch) { const r = await council.setSettings(patch); if (r?.error) return toast(r.error, true); S = r; if (patch.preset) presetSel = patch.preset; renderSettings(); renderConvene(); if (!sess) idleCore(); toast('Saved'); }

boot().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<div class="warn" style="position:fixed;top:60px;left:20px">${esc(e.stack || e.message)}</div>`); });
