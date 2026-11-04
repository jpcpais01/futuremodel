/* Oazy Research: the app. Four pages (Overview, Holdings, Council, Meetings), the Convene sheet, Settings, and the
   live meeting flow. Everything it shows comes from the futuremodel repository on GitHub; the only thing it writes
   is a finished meeting, as one commit, with the GitHub token. The Anthropic key lives in memory and is never saved. */
'use strict';
(() => {
  const E = OazyEngine, C = E.C, council = E.council, gh = E.github, ledger = E.ledger, SEAT = AV.SEAT;
  const MEMBERS = C.PRESETS.normal.members, OFFICERS = ['vex', 'sentinel', 'arbiter'];
  const UNI = Object.fromEntries(C.UNIVERSE.map((u) => [u[0], { t: u[0], n: u[1], s: u[2], k: u[3], c: u[4] }]));
  const mark = SHOW.mark, tkc = SHOW.tkc;
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const PAL = ['#8b7bff', '#33c3ff', '#2fd6a8', '#ffd76a', '#ff8a5c', '#ff6aa2', '#5b8cff', '#9ad94a', '#b58cff', '#ffb547', '#3ddc97', '#ff5c7a', '#6fa8dc', '#c9a26b', '#a9adbd'];
  const I = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 12h12"/></svg>',
    max: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
    crown: AV.svgOf('crown', 'currentColor', 1.9).replace(/<svg /, '<svg style="width:18px;height:18px" '),
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 17.5l5-5.5 4 3.5 8-9"/><path d="M15 6.5h5.5V12"/></svg>',
    hold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    meet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  };
  const PAGES = [
    { id: 'home', label: 'Overview', icon: I.home },
    { id: 'hold', label: 'Holdings', icon: I.hold },
    { id: 'council', label: 'Council', icon: I.crown },
    { id: 'meet', label: 'Meetings', icon: I.meet },
  ];

  /* ── Small helpers ─────────────────────────────────────────────────────── */
  const pc = (v, d = 2) => (num(v) ? (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(d) + '%' : '—');
  const cls = (v) => (num(v) ? (v >= 0 ? 'up' : 'dn') : '');
  const usd = (v) => (num(v) ? '$' + Math.round(v).toLocaleString('en-US') : '—');
  const day = (d, o = { month: 'short', day: 'numeric' }) => new Date(typeof d === 'string' && d.length === 10 ? d + 'T12:00:00Z' : d).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });
  const ts = (d) => Date.parse(String(d).length === 10 ? d + 'T21:00:00Z' : d);
  const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  const levelName = (k) => C.PRESETS[k]?.label || k;
  const meetingTitle = (m) => `${levelName(m.preset)} · ${m.rounds ? m.rounds + (m.rounds === 1 ? ' round' : ' rounds') : 'meeting'}`;
  function toast(t, ms = 2600) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), ms); }
  const friendly = (e) => {
    const m = String(e?.message || e || 'Something went wrong');
    if (e?.status === 401 || /invalid x-api-key|authentication/i.test(m)) return 'Anthropic did not accept the key. Check it and try again.';
    if (/credit balance|billing/i.test(m)) return 'The Anthropic account has no credit left. Add credit, then try again.';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No connection. Check the internet and try again.';
    return m;
  };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('oz:' + k)); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem('oz:' + k) : localStorage.setItem('oz:' + k, JSON.stringify(v)); } catch {} },
  };

  /* ── State ─────────────────────────────────────────────────────────────── */
  let S = null, loadedAt = 0, loadErr = null, page = 'home', range = 'all', sessKey = null, meetSel = null, idleHall = null, running = null;
  let CUR = store.get('council') || 'council', CO = { id: CUR, name: CUR === 'council' ? 'Oazy Council' : '', awareness: '', color: '#ffd76a' }, LIST = store.get('councils') || [];
  const full = new Map();   // council/meeting id → whole meeting (for replays)
  const lastKey = () => 'last:' + CUR;
  const has = () => !!S && ((S.positions || []).length > 0 || (S.pending || []).length > 0);

  /* ── Shell: top bar, tabs, dock, window ────────────────────────────────── */
  function shell() {
    if (HOST.platform === 'pc') document.body.classList.add('pc');
    $('#ver').textContent = 'v' + (HOST.version || '');
    $('#gear').innerHTML = I.gear; $('#gear').onclick = () => settings();
    $('#wMin').innerHTML = I.min; $('#wMax').innerHTML = I.max; $('#wClose').innerHTML = I.x;
    if (HOST.win) { $('#wMin').onclick = () => HOST.win.min(); $('#wMax').onclick = () => HOST.win.max(); $('#wClose').onclick = () => HOST.win.close(); }
    $('#status').onclick = () => HOST.openUrl(gh.url + '/' + CUR);
    $('#cpick').onclick = () => councilsSheet();
    const tabs = $('#tabs'), dock = $('#dock');
    for (const p of PAGES) {
      const b = document.createElement('button'); b.textContent = p.label; b.dataset.p = p.id; b.onclick = () => go(p.id); tabs.appendChild(b);
      const d = document.createElement('button'); d.innerHTML = p.icon + `<span>${p.label}</span>`; d.dataset.p = p.id; d.onclick = () => go(p.id); dock.appendChild(d);
    }
    addEventListener('resize', () => { movePill(); if (page === 'home') drawChart(true); if (page === 'hold') drawSparks(); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#ov').classList.contains('on')) closeSheet(); });
    $('#ov').addEventListener('mousedown', (e) => { if (e.target.id === 'ov' && !sheetLocked) closeSheet(); });
    if (HOST.onBeforeClose) HOST.onBeforeClose(() => (running && !SHOW.hasEnded() ? 'A meeting is running. Close anyway?' : null));
  }
  function movePill() {
    const b = $(`#tabs button[data-p="${page}"]`), pill = $('#pill'); if (!b) return;
    pill.style.left = b.offsetLeft + 'px'; pill.style.width = b.offsetWidth + 'px';
  }
  function go(p) {
    page = p;
    $$('.page').forEach((s) => s.classList.toggle('on', s.id === 'p-' + p));
    $$('#tabs button, #dock button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
    movePill();
    setAccent(p === 'council' ? '#8b7bff' : p === 'meet' ? '#ffd76a' : p === 'hold' ? '#33c3ff' : null);
    render(p);
  }
  function status() {
    const dot = $('#dot'), t = $('#statusT');
    if (loadErr && !S) { dot.className = 'warn'; t.textContent = 'Offline'; return; }
    if (!S) { dot.className = loadedAt ? 'live' : ''; t.textContent = loadedAt ? 'No meetings yet' : 'Loading'; return; }
    dot.className = loadErr ? 'warn' : 'live';
    t.textContent = (loadErr ? 'Offline · ' : '') + 'Updated ' + ago(S.updatedAt);
  }

  /* ── Loading from GitHub ───────────────────────────────────────────────── */
  async function load(quiet) {
    if (running) return;
    try {
      const want = CUR, r = await council.load(want);
      if (want !== CUR) return;   // switched again meanwhile
      S = r.state; LIST = r.councils; CO = r.council; loadErr = null; loadedAt = Date.now();
      if (CO.id !== CUR) { CUR = CO.id; store.set('council', CUR); }   // the saved council no longer exists
      store.set('councils', LIST);
    } catch (e) { loadErr = e; if (!quiet) toast('Could not reach GitHub. Showing what was here before.'); if (!S) S = store.get(lastKey()); }
    if (S) store.set(lastKey(), S);
    picker(); status(); render(page);
  }
  /* The council in the top bar. */
  function picker() {
    const c = LIST.find((x) => x.id === CUR) || CO;
    $('#cpName').textContent = c.name || 'Council'; $('#cpDot').style.background = c.color || '#ffd76a';
    document.documentElement.style.setProperty('--cc', c.color || '#ffd76a');
  }
  /* Switches to another council: its own portfolio, record and meetings. */
  function switchTo(id) {
    if (running) { toast('Finish the meeting first.'); return; }
    if (id === CUR) return;
    CUR = id; store.set('council', id); meetSel = null;
    CO = LIST.find((x) => x.id === id) || { id, name: '', awareness: '' };
    S = store.get(lastKey()); loadedAt = 0; loadErr = null;
    picker(); go('home'); load();
  }

  function render(p = page) {
    status();
    if (p === 'home') home(); else if (p === 'hold') holdings(); else if (p === 'council') hallPage(); else if (p === 'meet') meetings();
  }

  /* ── Overview ──────────────────────────────────────────────────────────── */
  function home() {
    const el = $('#p-home');
    const unsaved = store.get('unsaved'), other = unsaved && (unsaved.s.council?.id || 'council') !== CUR ? LIST.find((c) => c.id === (unsaved.s.council?.id || 'council')) : null;
    const banner = unsaved ? `<div class="banner" style="grid-column:1"><span>${other ? esc(other.name) + '\'s meeting' : 'The meeting'} of ${esc(day(unsaved.s.startedAt, { month: 'long', day: 'numeric' }))} is not saved yet.</span><button class="btn pri" id="saveLater">Save it</button><button class="link" id="dropLater">Discard</button></div>` : '';
    if (!S && !loadErr && !loadedAt) { el.innerHTML = `<div class="ov-grid"><div class="empty-hero"><div class="kick">Oazy Research</div><div class="big" style="opacity:.35">Loading…</div></div></div>`; return; }
    if (!has()) {
      el.innerHTML = `<div class="ov-grid">${banner}<div class="empty-hero">
        <div class="kicker"><span class="tag">Paper portfolio</span><small>Starts at ${usd(S?.capital || C.LIMITS.startCapital)}</small></div>
        <div class="big">${CO.awareness ? esc(CO.name) : 'The council'}<br>is ready.</div>
        ${CO.awareness ? `<p class="aw">${esc(CO.awareness)}</p>` : ''}
        <p>Eight seats argue over the ${C.UNIVERSE.length} largest companies in the world, a red team attacks their plan, the risk manager sets limits and the chair decides. The portfolio starts the moment you apply its first decision.</p>
        <div class="chips" style="gap:12px"><button class="btn gold" data-go="convene">${I.crown}Convene the council</button><button class="btn gh" data-go="rehearse">Rehearse for free</button></div>
      </div><div class="side">${seatsCard()}${councilsCard()}</div></div>`;
      wireHome(el); return;
    }
    const st = S.stats || {}, nav = S.series?.length ? S.series[S.series.length - 1][1] : S.capital;
    const pend = (S.pending || [])[0];
    el.innerHTML = `<div class="ov-grid">
      <div class="hero"><div class="lead">
        <div class="kicker"><span class="tag">Paper portfolio</span>${S.verify?.ok === false ? '<span class="tag warn">Ledger check failed</span>' : '<span class="tag ok">Ledger intact</span>'}<small>${S.series?.length ? 'Since ' + esc(day(S.series[0][0], { month: 'long', day: 'numeric', year: 'numeric' })) : 'Waiting for its first open'}</small></div>
        <div class="big ${cls(st.ret)}">${pc(st.ret)}</div>
        <div class="sub"><b>${usd(nav)}</b>from ${usd(S.capital)}</div>
      </div>
      <div class="stats">
        <div class="st"><span>S&amp;P 500</span><b class="${cls(st.spy)}">${pc(st.spy)}</b></div>
        <div class="st"><span>Nasdaq 100</span><b class="${cls(st.qqq)}">${pc(st.qqq)}</b></div>
        <div class="st"><span>Worst drop</span><b>${num(st.maxDD) ? pc(st.maxDD, 1) : '—'}</b></div>
        <div class="st"><span>Days</span><b>${st.days || 0}</b></div>
      </div></div>
      ${banner}
      <div class="chartBox"><canvas id="homeC"></canvas><div class="cap" id="homeCap"></div><div class="pulse"></div>
        <div class="chips ranges">${['1W', '1M', '3M', 'All'].map((r) => `<button class="chip ${range === r.toLowerCase() ? 'on' : ''}" data-r="${r.toLowerCase()}">${r}</button>`).join('')}</div></div>
      <div class="chips" style="grid-column:1;gap:16px;font-size:13px;color:var(--dim)"><span class="drift"><i class="dotc" style="background:#fff"></i>${esc(CO.name || 'Council')}</span><span class="drift"><i class="dotc" style="background:#33c3ff"></i>S&amp;P 500</span><span class="drift"><i class="dotc" style="background:#ffb547"></i>Nasdaq 100</span></div>
      <div class="side">
        ${pend ? `<div class="card glass next"><h4>Waiting to enter</h4><div class="when">${pend.mode === 'now' ? 'Entering now' : 'At the open on ' + esc(day(pend.on, { weekday: 'short', month: 'short', day: 'numeric' }))}</div><p>${Object.keys(pend.target || {}).length} holdings, decided ${esc(day(pend.at))}. Until then the current portfolio stays.</p><div class="tkwrap" style="margin-top:12px">${Object.entries(pend.target || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, w]) => tkc(t, w)).join('')}</div></div>` : ''}
        ${CO.awareness ? `<div class="card glass"><h4>Awareness</h4><p class="aw sm">${esc(CO.awareness)}</p></div>` : ''}
        <div class="card glass"><h4>Allocation</h4>${allocRing()}</div>
        ${S.final?.summary ? `<div class="card glass"><h4>The chair's thesis</h4><p>${esc(S.final.summary)}</p>${S.decidedAt ? `<p class="hint">Decided ${esc(day(S.decidedAt, { month: 'long', day: 'numeric' }))}${S.final.confidence != null ? ` · confidence ${S.final.confidence}` : ''}</p>` : ''}</div>` : ''}
        ${councilsCard()}
        <div class="card glass next"><h4>Next meeting</h4><div class="when">Whenever you call it</div><p>The weights drift with prices until the council meets again.</p><button class="btn gold" data-go="convene">${I.crown}Convene the council</button></div>
      </div></div>`;
    wireHome(el);
    $$('[data-r]', el).forEach((b) => (b.onclick = () => { range = b.dataset.r; $$('[data-r]', el).forEach((x) => x.classList.toggle('on', x === b)); drawChart(); }));
    const c = $('#homeC'); if (!c._hov) { hover(c); c._hov = 1; }
    requestAnimationFrame(() => { drawChart(); animateRing(el); });
  }
  function wireHome(el) {
    $$('[data-go]', el).forEach((b) => (b.onclick = () => (b.dataset.go === 'rehearse' ? convene({ rehearsal: true }) : convene())));
    const sl = $('#saveLater', el); if (sl) sl.onclick = () => saveLaterSheet();
    $$('[data-cc]', el).forEach((b) => (b.onclick = () => (b.dataset.cc === '+' ? newCouncilSheet() : switchTo(b.dataset.cc))));
    $$('[data-seat]', el).forEach((b) => (b.onclick = () => seatSheet(b.dataset.seat)));
    const dl = $('#dropLater', el); if (dl) dl.onclick = () => confirmSheet('Discard this meeting?', 'Its decision will not enter the portfolio and it will not be kept. What it cost is already spent.', 'Discard', () => { store.set('unsaved', null); render(); });
  }
  function drawChart(again) {
    const c = $('#homeC'); if (!c || !S?.series?.length) return;
    const cut = { '1w': 7, '1m': 31, '3m': 92 }[range];
    let rows = S.series.map((r) => [ts(r[0]), r[1], r[2], r[3]]);
    if (cut) { const from = rows[rows.length - 1][0] - cut * 864e5; const r2 = rows.filter((r) => r[0] >= from); if (r2.length > 1) rows = r2; }
    const base = rows[0], rel = (i) => rows.filter((r) => num(r[i]) && num(base[i])).map((r) => [r[0], (r[i] / base[i] - 1) * 100]);
    const fy = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';
    const capFn = (b) => { if (!b) setCap($('#homeCap'), fy(rel(1).slice(-1)[0]?.[1] ?? 0), range === 'all' ? 'since it started' : 'over ' + { '1w': 'the week', '1m': 'the month', '3m': 'three months' }[range], ''); else setCap($('#homeCap'), fy(b[1]), day(b[0], { month: 'short', day: 'numeric', year: 'numeric' })); };
    chart(c, [{ p: rel(1), name: CO.name || 'Council' }, { p: rel(2), c: '#33c3ff', name: 'S&P' }, { p: rel(3), c: '#ffb547', name: 'NDX' }], { ref: 0, refL: '0%', fy, capFn, key: again ? c._key : range + S.updatedAt, pl: innerWidth < 900 ? 18 : 64, pr: innerWidth < 900 ? 96 : 140, pt: innerWidth < 900 ? 96 : 58 });
    capFn(null);
  }
  function allocRing() {
    const rows = [...(S.positions || []).map((p) => ({ t: p.t, w: p.weight })), ...(num(S.cash) && S.cash > .05 ? [{ t: 'Cash', w: S.cash }] : [])];
    const tot = rows.reduce((a, r) => a + r.w, 0) || 1, R = 50, L = 2 * Math.PI * R;
    let acc = 0;
    const segs = rows.map((r, i) => { const len = (r.w / tot) * L, gap = rows.length > 1 ? 2.2 : 0, s = `<circle cx="59" cy="59" r="${R}" fill="none" stroke="${r.t === 'Cash' ? '#4a5068' : PAL[i % PAL.length]}" stroke-width="11" stroke-linecap="butt" stroke-dasharray="${Math.max(.1, len - gap)} ${L}" stroke-dashoffset="${-acc}" transform="rotate(-90 59 59)" data-len="${len}"/>`; acc += len; return s; }).join('');
    const top = rows.slice(0, 7);
    return `<div class="alloc"><div class="ring"><svg viewBox="0 0 118 118"><circle cx="59" cy="59" r="${R}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="11"/><g class="segs" style="opacity:0;transition:opacity 1s">${segs}</g></svg><div class="mid"><b>${(S.positions || []).length}</b><span>holdings</span></div></div>
      <div class="lgnd">${top.map((r, i) => `<div class="rw"><i class="dotc" style="background:${r.t === 'Cash' ? '#4a5068' : PAL[i % PAL.length]}"></i><b>${esc(C.label(r.t))}</b><em>${r.w.toFixed(1)}%</em></div>`).join('')}${rows.length > top.length ? `<div class="rw"><small style="margin:0">and ${rows.length - top.length} more</small></div>` : ''}</div></div>`;
  }
  const animateRing = (el) => { const g = $('.segs', el); if (g) g.style.opacity = 1; };
  function seatsCard() {
    return `<div class="card glass"><h4>The council</h4><div class="seatlist">${[...MEMBERS, ...OFFICERS].map((k) => `<button class="rw" data-seat="${k}">${AV.orb(k, 30)}<div><b>${esc(SEAT[k].name)}</b><small>${esc(SEAT[k].role)}</small></div></button>`).join('')}</div></div>`;
  }
  /* The other councils, a tap away. */
  function councilsCard() {
    const others = LIST.filter((c) => c.id !== CUR);
    return `<div class="card glass"><h4>Councils</h4><div class="clist">${others.map((c) => `<button class="crow" data-cc="${esc(c.id)}" style="--c:${esc(c.color || '#ffd76a')}"><i></i><div><b>${esc(c.name)}</b><small>${c.stats ? pc(c.stats.ret) + ' · ' + c.holdings + ' holdings' : c.meetings ? c.meetings + ' meetings' : 'No meetings yet'}</small></div></button>`).join('')}
      <button class="crow add" data-cc="+"><i>${I.plus}</i><div><b>New council</b><small>Same meeting, its own Awareness and portfolio</small></div></button></div></div>`;
  }
  /* One seat: its mandate and its personality. */
  function seatSheet(k) {
    const st = SEAT[k], c = C.SEATS[k] || C.OFFICERS[k] || {};
    sheet(`<div class="shead">${AV.orb(k, 56)}<div><h3>${esc(st.name)}</h3><small>${esc(st.role)}</small></div><button class="icon" data-close>${I.x}</button></div>
      ${c.mandate ? `<div class="sec"><h4>Its mandate</h4><p>${esc(c.mandate)}</p></div>` : ''}
      ${c.persona ? `<div class="sec"><h4>Its personality</h4><p>${esc(c.persona)}</p></div><p class="hint">This is what ${esc(st.name)} is told before every turn.</p>` : ''}
      ${CO.awareness ? `<p class="hint">In ${esc(CO.name)}, every seat also carries the council's Awareness.</p>` : ''}`);
  }

  /* ── Holdings ──────────────────────────────────────────────────────────── */
  function holdings() {
    const el = $('#p-hold');
    const pos = S?.positions || [], pend = (S?.pending || [])[0], info = Object.fromEntries((S?.final?.holdings || []).map((h) => [h.ticker, h]));
    if (!pos.length) {
      el.innerHTML = `<div class="wrap"><div class="tools"><div><h2>Holdings</h2><p class="lede">${pend ? 'The first portfolio enters at the open on ' + esc(day(pend.on, { weekday: 'long', month: 'long', day: 'numeric' })) + '.' : 'Nothing is held yet. The first meeting decides what the council buys.'}</p></div></div>
        ${pend ? `<div class="tkwrap">${Object.entries(pend.target).sort((a, b) => b[1] - a[1]).map(([t, w]) => tkc(t, w)).join('')}</div>` : `<div><button class="btn gold" id="hcv">${I.crown}Convene the council</button></div>`}</div>`;
      const b = $('#hcv', el); if (b) b.onclick = () => convene();
      return;
    }
    el.innerHTML = `<div class="wrap"><div class="tools"><div><h2>Holdings</h2><p class="lede">${pos.length} positions${num(S.cash) && S.cash > .05 ? ` and ${S.cash.toFixed(1)}% cash` : ''}. Weights move with prices after they enter.</p></div></div>
      ${pend ? `<div class="banner" style="margin-bottom:16px;flex:none"><span>A new decision enters at ${pend.mode === 'now' ? 'once' : 'the open on ' + esc(day(pend.on, { weekday: 'short', month: 'short', day: 'numeric' }))}.</span></div>` : ''}
      <div class="grid">${pos.map((p, i) => {
        const u = UNI[p.t] || { n: p.t }, w0 = p.entryWeight, col = (typeof BRAND === 'object' && BRAND[p.t]) || PAL[i % PAL.length];
        return `<button class="hcard" data-t="${esc(p.t)}" style="--b:${col};animation-delay:${Math.min(i, 14) * 45}ms"><div class="h">${mark(p.t, 44)}<div><b>${esc(C.label(p.t))}</b><small>${esc(u.n)}</small></div><span class="pct">${p.weight.toFixed(1)}%</span></div>
          <canvas data-s="${esc(p.t)}"></canvas>
          <div class="f"><span class="drift">${num(w0) ? `<i>entered</i> ${w0.toFixed(1)}% <i>→ now</i> ${p.weight.toFixed(1)}%` : esc(info[p.t]?.thesis?.slice(0, 40) || u.s || '')}</span><b class="${cls(p.pnlPct)}">${pc(p.pnlPct, 1)}</b></div></button>`;
      }).join('')}</div></div>`;
    $$('.hcard', el).forEach((b) => (b.onclick = () => holdingSheet(b.dataset.t)));
    requestAnimationFrame(drawSparks);
  }
  function drawSparks() {
    $$('#p-hold canvas[data-s]').forEach((c) => {
      const p = S.positions.find((x) => x.t === c.dataset.s), h = (S.history?.[c.dataset.s] || []).filter((q) => !p?.since || q[0] >= ts(p.since) - 864e5 * 2);
      const pts = h.length > 1 ? h : (S.history?.[c.dataset.s] || []).slice(-30);
      const r = c.getBoundingClientRect(), dp = devicePixelRatio || 1; c.width = r.width * dp; c.height = r.height * dp;
      const x = c.getContext('2d'); x.scale(dp, dp); if (pts.length < 2) return;
      const vs = pts.map((q) => q[1]), mn = Math.min(...vs), mx = Math.max(...vs), W = r.width, H = r.height;
      const X = (i) => (i / (pts.length - 1)) * W, Y = (v) => H - 3 - ((v - mn) / ((mx - mn) || 1)) * (H - 6);
      const up = vs[vs.length - 1] >= vs[0], col = up ? '61,220,151' : '255,92,122';
      const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgba(${col},.28)`); g.addColorStop(1, `rgba(${col},0)`);
      x.beginPath(); pts.forEach((q, i) => (i ? x.lineTo(X(i), Y(q[1])) : x.moveTo(0, Y(q[1])))); x.lineTo(W, H); x.lineTo(0, H); x.closePath(); x.fillStyle = g; x.fill();
      x.beginPath(); pts.forEach((q, i) => (i ? x.lineTo(X(i), Y(q[1])) : x.moveTo(0, Y(q[1])))); x.strokeStyle = `rgba(${col},.95)`; x.lineWidth = 1.6; x.stroke();
    });
  }
  function holdingSheet(t) {
    const p = S.positions.find((x) => x.t === t), h = (S.final?.holdings || []).find((x) => x.ticker === t), u = UNI[t] || { n: t, s: '' };
    sheet(`<div class="shead">${mark(t, 56)}<div><h3>${esc(u.n || t)}</h3><small>${esc(t)} · ${esc(u.s)}${u.c ? ' · ' + esc(u.c) : ''}</small></div><button class="icon" data-close>${I.x}</button></div>
      <div class="stats" style="margin-bottom:6px"><div class="st"><span>Weight now</span><b>${p.weight.toFixed(1)}%</b></div><div class="st"><span>When it entered</span><b>${num(p.entryWeight) ? p.entryWeight.toFixed(1) + '%' : '—'}</b></div><div class="st"><span>Gain</span><b class="${cls(p.pnlPct)}">${pc(p.pnlPct, 1)}</b></div><div class="st"><span>Value</span><b>${usd(p.value)}</b></div></div>
      ${h ? `<div class="sec" style="margin-top:20px"><h4>Why the council holds it</h4><p>${esc(h.thesis)}</p></div>
      <div class="sec"><h4>It sells if</h4><p>${esc(h.rotate_if)}</p></div>
      <div class="sec"><h4>Argued for by</h4><div class="tkwrap">${(h.champions || []).map((n) => { const k = Object.keys(SEAT).find((k) => SEAT[k].name.toLowerCase() === String(n).toLowerCase()); return k ? `<span class="tkc">${AV.orb(k, 24)}${esc(SEAT[k].name)}</span>` : `<span class="tkc">${esc(n)}</span>`; }).join('') || '<span class="hint">Not recorded</span>'}</div></div>
      <div class="sec"><h4>Conviction</h4><p>${'●'.repeat(h.conviction || 0)}<span class="mu">${'●'.repeat(5 - (h.conviction || 0))}</span></p></div>` : '<p class="hint" style="margin-top:18px">This holding is from an earlier decision.</p>'}`);
  }

  /* ── Council (idle) ────────────────────────────────────────────────────── */
  function hallPage() {
    const el = $('#p-council');
    if (!el.dataset.built) {
      el.dataset.built = 1;
      el.innerHTML = `<div class="hall"><canvas id="idleC"></canvas></div>
        <div class="hall-ui"><div class="kick" id="hallK">The council</div><h2>Eleven minds.<br>One portfolio.</h2>
          <p class="lede">Eight seats with their own mandates propose, question and attack each other's portfolios over as many rounds as you choose. Then Vex attacks, Sentinel sets the limits and Arbiter decides.</p>
          <div class="acts"><button class="btn gold" id="cvGo">${I.crown}Convene the council</button><button class="btn gh" id="cvRh">Rehearse for free</button></div></div>
        <div class="hall-right" id="hallR"></div>`;
      $('#cvGo').onclick = () => convene(); $('#cvRh').onclick = () => convene({ rehearsal: true });
      idleHall = new SHOW.Hall($('#idleC'), { area: (W, H) => (W < 900 ? { x0: 0, x1: W, y0: 10, y1: H - 10 } : { x0: W * .2, x1: W * .8, y0: H * .4, y1: H - 6 }) });
      idleHall.setMode('hall');
      let i = 0; setInterval(() => { if (page !== 'council' || SHOW.isOpen()) return; const ks = [...MEMBERS, ...OFFICERS]; for (const k of ks) idleHall.seats[k].tTalk = 0; idleHall.seats[ks[i++ % ks.length]].tTalk = .7; }, 2200);
    }
    $('#hallK').textContent = CO.name || 'The council';
    const last = (S?.sessions || []).find((m) => m.status === 'done' || m.status === 'skipped');
    $('#hallR').innerHTML = `${CO.awareness ? `<div class="card glass"><h4>Awareness</h4><p class="aw sm">${esc(CO.awareness)}</p></div>` : ''}${last ? `<div class="card glass"><h4>Last meeting</h4><div class="next"><div class="when">${esc(day(last.startedAt, { weekday: 'long', month: 'long', day: 'numeric' }))}</div></div><p>${esc(last.summary || '')}</p><p class="hint">${esc(meetingTitle(last))}${last.confidence != null ? ' · confidence ' + last.confidence : ''}${last.cost ? ' · $' + last.cost.toFixed(2) : ''}</p>${last.replay ? `<button class="btn gh" style="margin-top:14px;width:100%" data-rp="${esc(last.id)}">${I.play}Watch it again</button>` : ''}</div>` : ''}
      <div class="card glass"><h4>How a meeting runs</h4><ol class="steps">${[`Two years of prices, SEC filings, news and macro for ${C.UNIVERSE.length} companies`, 'The research desk writes a dossier on every name', 'Scout searches the web for what is moving markets', 'Each seat proposes a portfolio on its own', 'Debate rounds, in the formats you choose', 'Vex attacks, every seat answers', 'Sentinel sets binding limits', 'Arbiter decides, and you choose when it enters'].map((t) => `<li>${t}</li>`).join('')}</ol></div>`;
    $$('[data-rp]', $('#hallR')).forEach((b) => (b.onclick = () => watch(b.dataset.rp)));
  }

  /* ── Meetings ──────────────────────────────────────────────────────────── */
  function meetings() {
    const el = $('#p-meet'), list = (S?.sessions || []);
    if (!list.length) {
      el.innerHTML = `<div class="wrap"><h2>Meetings</h2><p class="lede">Every meeting is kept with its whole debate, so you can watch it again.</p><div style="margin-top:28px"><button class="btn gold" id="mcv">${I.crown}Convene the first meeting</button></div></div>`;
      $('#mcv').onclick = () => convene(); return;
    }
    if (!meetSel || !list.some((m) => m.id === meetSel)) meetSel = list[0].id;
    const STATUS = { done: 'Applied', skipped: 'Record only', failed: 'Stopped', cancelled: 'Stopped', decided: 'Not saved' };
    el.innerHTML = `<div class="wrap"><h2>Meetings</h2><p class="lede">${list.length} ${list.length === 1 ? 'meeting' : 'meetings'}. Each one is kept with its whole debate.</p>
      <div class="two"><div class="col"><div class="list">${list.map((m) => { const d = new Date(m.startedAt); return `<button class="mrow ${m.id === meetSel ? 'on' : ''}" data-m="${esc(m.id)}"><div class="dt"><b>${d.getDate()}</b><span>${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span></div><div><div class="t">${esc(meetingTitle(m))}</div><small>${esc(m.summary || m.error || '')}</small></div><span class="tag ${m.status === 'done' ? 'ok' : m.status === 'skipped' ? '' : 'warn'}">${STATUS[m.status] || m.status}</span></button>`; }).join('')}</div></div>
      <div class="col"><div class="detail glass" id="mDet"></div></div></div></div>`;
    $$('.mrow', el).forEach((b) => (b.onclick = () => { meetSel = b.dataset.m; $$('.mrow', el).forEach((x) => x.classList.toggle('on', x === b)); detail(); }));
    detail();
  }
  async function detail() {
    const m = (S.sessions || []).find((x) => x.id === meetSel), box = $('#mDet'); if (!m || !box) return;
    const applied = m.applied ? (m.applied.mode === 'now' ? 'Applied at the prices of ' + day(m.applied.at, { month: 'short', day: 'numeric' }) : 'Entered at the open on ' + day(m.applied.on, { month: 'short', day: 'numeric' })) : m.status === 'skipped' ? 'Kept as a record. The portfolio did not change.' : '';
    box.innerHTML = `<div class="kick">${esc(day(m.startedAt, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</div><h3 style="margin:6px 0 14px">${esc(meetingTitle(m))}</h3>
      <div class="stats" style="margin-bottom:18px"><div class="st"><span>Holdings</span><b>${m.holdings || '—'}</b></div><div class="st"><span>Confidence</span><b>${m.confidence ?? '—'}</b></div><div class="st"><span>Cost</span><b>${m.cost ? '$' + m.cost.toFixed(2) : '—'}</b></div></div>
      ${applied ? `<div class="okline" style="margin-bottom:18px">${I.ok}${esc(applied)}</div>` : ''}
      ${m.summary ? `<div class="sec"><h4>The decision</h4><p>${esc(m.summary)}</p></div>` : ''}${m.error ? `<div class="badline">${esc(m.error)}</div>` : ''}
      <div id="mMore"></div>
      ${m.replay ? `<button class="btn pri" style="margin-top:8px" id="mPlay">${I.play}Watch the meeting</button>` : ''}`;
    const pl = $('#mPlay'); if (pl) pl.onclick = () => watch(m.id);
    const s = await fetchMeeting(m.id).catch(() => null);
    if (!s || meetSel !== m.id || !$('#mMore')) return;
    const f = s.final;
    $('#mMore').innerHTML = f ? `<div class="sec"><h4>The portfolio</h4><div class="tkwrap">${f.holdings.map((h) => tkc(h.ticker, h.weight)).join('')}${f.cash_pct ? tkc('CASH', f.cash_pct, '', 'style="opacity:.8"').replace(/<span class="lg[^]*?<\/span>/, '<span class="lg cash" style="--s:24px">$</span>') : ''}</div></div>
      ${f.changes ? `<div class="sec"><h4>What changed</h4><p>${esc(f.changes)}</p></div>` : ''}
      ${(f.dissent || []).length ? `<div class="sec"><h4>Dissent the chair overruled</h4>${f.dissent.map((d) => `<p style="margin-bottom:6px"><b>${esc(d.seat)}:</b> ${esc(d.view)}</p>`).join('')}</div>` : ''}` : '';
  }
  async function fetchMeeting(id) {
    const k = CUR + '/' + id; if (full.has(k)) return full.get(k);
    const t = await gh.read(`${CUR}/sessions/${id}.json`); if (!t) throw new Error('This meeting could not be found on GitHub.');
    const s = JSON.parse(t); full.set(k, s); return s;
  }
  async function watch(id) {
    toast('Opening the meeting…', 1200);
    try { const s = await fetchMeeting(id); SHOW.replay(s, { onClose: () => render() }); }
    catch (e) { toast(friendly(e)); }
  }

  /* ── Sheets ────────────────────────────────────────────────────────────── */
  let sheetLocked = false, onSheetClose = null;
  function sheet(html, { locked = false, onClose = null } = {}) {
    const sh = $('#sheet'); sh.innerHTML = html; sheetLocked = locked; onSheetClose = onClose;
    $('#ov').classList.add('on'); sh.scrollTop = 0;
    $$('[data-close]', sh).forEach((b) => (b.onclick = closeSheet));
    return sh;
  }
  function closeSheet() { $('#ov').classList.remove('on'); const f = onSheetClose; onSheetClose = null; if (f) f(); }
  function confirmSheet(title, text, yes, onYes, no = 'Keep going') {
    const sh = sheet(`<div class="shead"><div><h3>${esc(title)}</h3></div></div><p class="lede" style="margin:0">${esc(text)}</p><div class="row"><button class="btn gh" data-close>${esc(no)}</button><button class="btn pri" id="cfYes">${esc(yes)}</button></div>`);
    $('#cfYes', sh).onclick = () => { closeSheet(); onYes(); };
  }

  /* Settings: the GitHub token (to save meetings), and the version. */
  async function settings({ then } = {}) {
    const tok = await HOST.getToken();
    const sh = sheet(`<div class="shead"><div><h3>Settings</h3><small>Oazy Research v${esc(HOST.version)}</small></div><button class="icon" data-close>${I.x}</button></div>
      <label class="lbl">GitHub (only needed to save meetings)</label>
      ${tok ? `<div class="okline">${I.ok}Connected. Meetings save to futuremodel.</div><div class="row" style="justify-content:flex-start;margin-top:12px"><button class="btn gh" id="tkChange">Change token</button><button class="link" id="tkForget">Forget it</button></div>` : ''}
      <div id="tkNew" class="${tok ? 'hidden' : ''}">
        <ol class="steps"><li>Open the <a class="link" href="#" id="tkPage">GitHub token page</a>.</li><li>Under "Repository access" choose <b>Only select repositories</b> and pick <b>futuremodel</b>.</li><li>Under "Permissions", set <b>Contents</b> to <b>Read and write</b>. Create it, copy it, and paste it here.</li></ol>
        <input class="field" id="tkIn" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false" style="margin-top:14px">
        <div id="tkMsg"></div>
        <div class="row"><button class="btn pri" id="tkSave">Save token</button></div>
      </div>
      <p class="hint" style="margin-top:22px">The token is kept on this device only, locked by the system. Your Anthropic key is never saved anywhere: you paste it when you convene the council.</p>`);
    $('#tkPage', sh).onclick = (e) => { e.preventDefault(); HOST.openUrl(gh.TOKEN_PAGE); };
    const ch = $('#tkChange', sh); if (ch) ch.onclick = () => { $('#tkNew', sh).classList.remove('hidden'); ch.parentNode.remove(); $('#tkIn', sh).focus(); };
    const fg = $('#tkForget', sh); if (fg) fg.onclick = async () => { await HOST.setToken(null); toast('Token removed from this device.'); settings({ then }); };
    $('#tkSave', sh).onclick = async () => {
      const v = $('#tkIn', sh).value.trim(), msg = $('#tkMsg', sh), b = $('#tkSave', sh);
      b.disabled = true; msg.innerHTML = '<p class="hint"><span class="spin" style="display:inline-block;vertical-align:-3px;margin-right:8px"></span>Checking with GitHub…</p>';
      const r = await gh.check(v); b.disabled = false;
      if (!r.ok) { msg.innerHTML = `<div class="badline">${esc(r.why)}</div>`; return; }
      if ((await HOST.setToken(v)) === false) { msg.innerHTML = '<div class="badline">This device could not lock the token away safely, so it was not kept.</div>'; return; }
      closeSheet(); toast('GitHub connected.');
      if (then) then();
    };
  }

  /* ── Councils ──────────────────────────────────────────────────────────── */
  function councilsSheet() {
    const sh = sheet(`<div class="shead"><div><h3>Councils</h3><small>Every council runs the same meeting. Its Awareness is its soul, and it keeps its own portfolio.</small></div><button class="icon" data-close>${I.x}</button></div>
      <div class="cgrid">${(LIST.length ? LIST : [CO]).map((c) => `<button class="ccard ${c.id === CUR ? 'on' : ''}" data-cc="${esc(c.id)}" style="--c:${esc(c.color || '#ffd76a')}">
        <div class="ch"><i></i><b>${esc(c.name)}</b>${c.id === CUR ? '<span class="tag ok">Open</span>' : ''}</div>
        <p>${c.awareness ? esc(c.awareness.length > 180 ? c.awareness.slice(0, 180).trim() + '…' : c.awareness) : 'The original council. No Awareness: it argues from the mandates alone.'}</p>
        <div class="cs"><span class="${cls(c.stats?.ret)}">${c.stats ? pc(c.stats.ret) : 'No record yet'}</span><span>${c.holdings || 0} holdings</span><span>${c.meetings || 0} meetings</span></div></button>`).join('')}
        <button class="ccard add" data-cc="+"><div class="ch"><i>${I.plus}</i><b>New council</b></div><p>Give it a name and an Awareness. It starts with its own empty portfolio.</p></button></div>`);
    $$('[data-cc]', sh).forEach((b) => (b.onclick = () => { if (b.dataset.cc === '+') newCouncilSheet(); else { closeSheet(); switchTo(b.dataset.cc); } }));
  }
  async function newCouncilSheet() {
    const L = council.LIMITS;
    const sh = sheet(`<div class="shead"><span class="sorb" style="--c:#8b7bff;--z:48px">${I.plus.replace('<svg ', '<svg style="width:22px;height:22px;color:#fff" ')}</span><div><h3>New council</h3><small>Same seats, same meeting. The Awareness is what makes it different.</small></div><button class="icon" data-close>${I.x}</button></div>
      <label class="lbl">Name</label><input class="field" id="ncName" maxlength="${L.name}" placeholder="For example: The Long Game" autocomplete="off">
      <label class="lbl">Awareness</label><textarea class="field area" id="ncAw" maxlength="${L.awareness}" placeholder="Who this council is and how it sees markets. For example: We invest like patient owners. We hold few names for years, buy great businesses when they are out of favour, and care more about not losing than about winning big."></textarea>
      <div class="hint" id="ncCount"></div>
      <p class="hint">Every seat reads it as the council's soul, under its own mandate and personality. It cannot be changed later, so the record always means the same thing.</p>
      <div id="ncMsg"></div>
      <div class="row"><button class="btn gh" data-close>Not now</button><button class="btn pri" id="ncGo">Create the council</button></div>`);
    const aw = $('#ncAw', sh), cnt = () => ($('#ncCount', sh).textContent = `${aw.value.length} / ${L.awareness}`); aw.oninput = cnt; cnt();
    setTimeout(() => $('#ncName', sh)?.focus(), 200);
    $('#ncGo', sh).onclick = async () => {
      const msg = $('#ncMsg', sh), b = $('#ncGo', sh), token = await HOST.getToken();
      if (!token) { msg.innerHTML = '<div class="badline">Connect GitHub first. The council is kept there.</div><div class="row" style="justify-content:flex-start"><button class="btn gh" id="ncTk">Connect GitHub</button></div>'; $('#ncTk', sh).onclick = () => settings({ then: () => newCouncilSheet() }); return; }
      b.disabled = true; msg.innerHTML = '<p class="hint"><span class="spin" style="display:inline-block;vertical-align:-3px;margin-right:8px"></span>Creating it on GitHub…</p>';
      try {
        const c = await council.create({ name: $('#ncName', sh).value, awareness: aw.value, token });
        LIST = [...LIST.filter((x) => x.id !== c.id), c]; store.set('councils', LIST);
        closeSheet(); toast(c.name + ' is ready.'); switchTo(c.id);
      } catch (e) { b.disabled = false; msg.innerHTML = `<div class="badline">${esc(friendly(e))}</div>`; }
    };
  }

  /* ── Convene ───────────────────────────────────────────────────────────── */
  function convene({ rehearsal = false } = {}) {
    if (running) { toast('A meeting is already running.'); return; }
    let lv = store.get('level') || 'normal', rd = store.get('rounds') || C.ROUNDS.default;
    if (!C.PRESETS[lv]) lv = 'normal';
    const sh = sheet(`<div class="shead"><span class="sorb" style="--c:#ffd76a;--z:48px">${AV.svgOf('crown', '#fff', 1.9).replace(/^<svg[^>]*>/, '<svg viewBox="0 0 24 24">')}</span><div><h3>${rehearsal ? 'Rehearse the meeting' : 'Convene ' + (CO.id === 'council' ? 'the council' : esc(CO.name))}</h3><small>${rehearsal ? 'The whole show with stand-in answers. No AI, no cost, nothing saved.' : 'Every level runs the same meeting. The level picks the models and how hard they think.'}</small></div><button class="icon" data-close>${I.x}</button></div>
      <label class="lbl">Level</label><div class="seg" id="cvLv">${Object.entries(C.PRESETS).map(([k, p]) => `<button data-k="${k}"><b>${esc(p.label)}</b><small>${esc(p.blurb)}</small><em data-cost="${k}"></em></button>`).join('')}</div>
      <label class="lbl">Debate rounds</label><div class="rounds"><input type="range" id="cvRd" min="${C.ROUNDS.min}" max="${C.ROUNDS.max}" step="1" value="${rd}"><b id="cvRdN">${rd}</b></div>
      <div class="fmts" id="cvF"></div>
      ${rehearsal ? '' : `<div class="costline"><b id="cvCost"></b><span id="cvCostT"></span></div>
      <label class="lbl">Anthropic API key</label>
      ${sessKey ? `<div class="okline" id="kyOk">${I.ok}Using the key you pasted earlier. It stays in memory until the app closes. <button class="link" id="kyNew" style="margin-left:auto">Use another</button></div>` : ''}
      <input class="field ${sessKey ? 'hidden' : ''}" id="cvKey" type="password" placeholder="sk-ant-…" autocomplete="off" spellcheck="false">
      <p class="hint">Used for this meeting only. It is never saved, not on this device and not on GitHub.</p>
      <div id="cvTok"></div><div id="cvMsg"></div>`}
      <div class="row">${rehearsal ? '' : '<button class="link" id="cvRh2" style="margin-right:auto">Rehearse for free instead</button>'}<button class="btn gh" data-close>Not now</button><button class="btn gold" id="cvStart">${rehearsal ? 'Start the rehearsal' : 'Start the meeting'}</button></div>`);
    const upd = () => {
      $$('#cvLv button', sh).forEach((b) => b.classList.toggle('on', b.dataset.k === lv));
      $('#cvRdN', sh).textContent = rd;
      $('#cvF', sh).innerHTML = C.roundPlan(rd).map((f, i) => `<span class="fmt" style="animation-delay:${i * 40}ms"><i>${ROMAN[i + 1]}</i>${esc(C.FORMATS[f].label)}</span>`).join('') + `<span class="fmt" style="animation-delay:${rd * 40}ms"><i>+</i>Red team, risk, chair</span>`;
      if (!rehearsal) {
        for (const k of Object.keys(C.PRESETS)) $(`[data-cost="${k}"]`, sh).textContent = '≈ $' + council.estimate(k, rd).mid.toFixed(2);
        const e = council.estimate(lv, rd);
        $('#cvCost', sh).textContent = '≈ $' + e.mid.toFixed(2);
        $('#cvCostT', sh).textContent = `for ${levelName(lv)} with ${rd} ${rd === 1 ? 'round' : 'rounds'}. Usually between $${e.low.toFixed(2)} and $${e.high.toFixed(2)}. About ${Math.round(e.calls)} AI calls.`;
      }
    };
    $$('#cvLv button', sh).forEach((b) => (b.onclick = () => { lv = b.dataset.k; store.set('level', lv); upd(); }));
    $('#cvRd', sh).oninput = (e) => { rd = +e.target.value; store.set('rounds', rd); upd(); };
    upd();
    if (rehearsal) { $('#cvStart', sh).onclick = () => { closeSheet(); start({ preset: lv, rounds: rd, rehearsal: true }); }; return; }
    $('#cvRh2', sh).onclick = () => convene({ rehearsal: true });
    const kn = $('#kyNew', sh); if (kn) kn.onclick = () => { $('#kyOk', sh).remove(); $('#cvKey', sh).classList.remove('hidden'); $('#cvKey', sh).focus(); };
    HOST.getToken().then((t) => { if (!t && $('#cvTok', sh)) { $('#cvTok', sh).innerHTML = `<div class="banner" style="margin-top:14px"><span>GitHub is not connected, so the result could not be saved. Connect it now or at the end.</span><button class="btn gh" id="cvTk">Connect</button></div>`; $('#cvTk', sh).onclick = () => settings({ then: () => convene() }); } });
    $('#cvStart', sh).onclick = () => {
      const typed = $('#cvKey', sh).classList.contains('hidden') ? '' : $('#cvKey', sh).value.trim(), key = typed || sessKey;
      if (!key) { $('#cvMsg', sh).innerHTML = '<div class="badline">Paste your Anthropic API key to start. Or rehearse for free.</div>'; $('#cvKey', sh).focus(); return; }
      if (!/^sk-ant-/.test(key)) { $('#cvMsg', sh).innerHTML = '<div class="badline">That does not look like an Anthropic key. It starts with sk-ant-.</div>'; return; }
      sessKey = key; closeSheet(); start({ preset: lv, rounds: rd, key });
    };
  }

  /* The live meeting: the engine runs it, the show tells it, and at the end João chooses how it enters. */
  async function start({ preset, rounds, key, rehearsal = false }) {
    const ac = new AbortController();
    let resolveS; const done = new Promise((r) => (resolveS = r));
    running = { ac, rehearsal };
    HOST.keepAwake(true);
    SHOW.open({
      live: true, title: (rehearsal ? 'Rehearsal' : 'Meeting') + (CO.name ? ' · ' + CO.name : ''),
      onDecided: (panel) => panel({
        nextOpen: day(ledger.nextOpenDate(), { weekday: 'short', month: 'short', day: 'numeric' }),
        onApply: async (how, setSaving) => {
          if (rehearsal) { setSaving('saved', 'That was a rehearsal. Nothing was spent or saved.'); return; }
          const s = await done; if (!s) return;
          await saveMeeting(s, how, setSaving);
        },
      }),
      onStop: () => confirmSheet('Stop the meeting?', rehearsal ? 'The rehearsal ends here.' : 'Nothing is saved. What the AI has used so far is already spent.', 'Stop it', () => { ac.abort(); SHOW.close(); finish(); }),
      onEarlyClose: async () => {
        if (rehearsal) { SHOW.close(); finish(); return; }
        const s = await done;
        confirmSheet('Close without saving?', 'The decision stays on this device. You can save it later from the Overview.', 'Close', () => { if (s && !store.get('unsaved')) store.set('unsaved', { s, how: null }); SHOW.close(); finish(); }, 'Stay');
      },
      onClose: () => finish(),
    });
    try {
      const s = await council.convene({ preset, rounds, key, rehearsal, emit: SHOW.feed, signal: ac.signal, device: HOST.platform === 'android' ? 'Phone' : 'PC' });
      resolveS(s);
    } catch (e) {
      resolveS(null);
      if (e?.code === 'NO_KEY' || e?.status === 401) sessKey = null;
      if (!ac.signal.aborted) console.warn(e);
    } finally { HOST.keepAwake(false); }
  }
  function finish() { running = null; HOST.keepAwake(false); load(true); }

  async function saveMeeting(s, how, setSaving) {
    const token = await HOST.getToken();
    if (!token) {
      store.set('unsaved', { s, how });
      setSaving('error', 'GitHub is not connected yet. Connect it, then press Try again.');
      settings();
      return;
    }
    try {
      setSaving('saving', 'Recording the decision');
      const st = await council.save(s, how, { token, onStep: (t) => setSaving('saving', t) });
      S = st; store.set(lastKey(), S); store.set('unsaved', null); full.set(CUR + '/' + s.id, s);
      setSaving('saved', how === 'skip' ? 'Saved as a record. The portfolio did not change.' : how === 'now' ? 'Saved. The portfolio changed at this moment\'s prices.' : `Saved. It enters at the open on ${day(s.applied?.on || how, { weekday: 'long', month: 'long', day: 'numeric' })}.`);
      render();
    } catch (e) {
      store.set('unsaved', { s, how });
      setSaving('error', friendly(e) + ' The meeting is kept on this device.');
    }
  }
  /* A meeting that was decided but not saved (closed early, offline, no token): choose how it enters, then save. */
  function saveLaterSheet() {
    const u = store.get('unsaved'); if (!u) return;
    const of = u.s.council?.id || 'council';
    if (of !== CUR) { switchTo(of); toast('Switched to ' + (LIST.find((c) => c.id === of)?.name || 'its council') + '. Press Save it again.'); return; }
    const next = ledger.nextOpenDate(), min = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const sh = sheet(`<div class="shead"><div><h3>Save the meeting</h3><small>${esc(day(u.s.startedAt, { weekday: 'long', month: 'long', day: 'numeric' }))} · ${esc(meetingTitle({ preset: u.s.preset, rounds: u.s.plan?.length }))}</small></div><button class="icon" data-close>${I.x}</button></div>
      ${u.s.final?.summary ? `<p class="lede" style="margin:0 0 18px">${esc(u.s.final.summary)}</p>` : ''}
      <div class="seg" id="slH"><button data-h="now"><b>Apply now</b><small>Enters at this moment's prices.</small></button><button data-h="open" class="on"><b>At the next open</b><small>09:30 New York on ${esc(day(next, { weekday: 'short', month: 'short', day: 'numeric' }))}.</small></button><button data-h="date"><b>On a date</b><small>That day's open.</small><input type="date" class="field" id="slD" min="${min}" value="${min}" style="height:36px;margin-top:8px"></button></div>
      <div id="slMsg"></div>
      <div class="row"><button class="link" id="slSkip" style="margin-right:auto">Keep as a record only</button><button class="btn gh" data-close>Not now</button><button class="btn pri" id="slGo">Save</button></div>`);
    let how = u.how && u.how !== 'skip' ? (u.how.length === 10 ? 'date' : u.how) : 'open';
    const mark2 = () => $$('#slH button', sh).forEach((b) => b.classList.toggle('on', b.dataset.h === how)); mark2();
    $$('#slH button', sh).forEach((b) => (b.onclick = (e) => { if (e.target.tagName === 'INPUT') return; how = b.dataset.h; mark2(); }));
    const go2 = (h) => {
      const st = (state, msg) => {
        const box = $('#slMsg', sh); if (!box) return;
        if (state === 'saving') box.innerHTML = `<p class="hint"><span class="spin" style="display:inline-block;vertical-align:-3px;margin-right:8px"></span>${esc(msg)}…</p>`;
        else if (state === 'saved') { closeSheet(); toast(msg, 3600); }
        else box.innerHTML = `<div class="badline">${esc(msg)}</div>`;
      };
      saveMeeting(u.s, h, st);
    };
    $('#slGo', sh).onclick = () => go2(how === 'date' ? $('#slD', sh).value : how);
    $('#slSkip', sh).onclick = () => go2('skip');
  }

  /* ── Start ─────────────────────────────────────────────────────────────── */
  /* The phone's back gesture: close what is on top, then go home, then leave the app. */
  window.ozBack = () => {
    if ($('#ov').classList.contains('on')) { closeSheet(); return true; }
    if (SHOW.isOpen()) { $('#shClose').click(); return true; }
    if (page !== 'home') { go('home'); return true; }
    return false;
  };
  function boot() {
    shell();
    S = store.get(lastKey()) || (CUR === 'council' ? store.get('last') : null);
    picker(); go('home');
    requestAnimationFrame(() => setTimeout(() => document.body.classList.add('ready'), 350));
    load();
    setInterval(() => { status(); if (Date.now() - loadedAt > 10 * 6e4 && !SHOW.isOpen() && !$('#ov').classList.contains('on')) load(true); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - loadedAt > 5 * 6e4 && !SHOW.isOpen()) load(true); });
  }
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', boot) : boot();
})();
