/* The council's presentation. A meeting is told as a show in acts: a title card for every act, the wall of every name
   lighting up as the evidence arrives, the desk's verdicts flipping in, then the seats taking the stage one by one,
   each with its own living orb, its words revealed like a keynote, its picks flying in, beams to the seats it answers,
   the consensus board re-sorting itself, the red team slashing, the risk manager stamping, and the chair's ring.
   Live meetings and replays run through the same director: events go into a queue of beats, played in order. */
'use strict';
const SHOW = (() => {
  const C = OazyEngine.C, rules = OazyEngine.rules, SEAT = AV.SEAT;
  const MEMBERS = C.PRESETS.normal.members, OFFICERS = ['vex', 'sentinel', 'arbiter'], ALL = [...MEMBERS, ...OFFICERS];
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TAU = Math.PI * 2, now = () => performance.now() / 1000;
  const ACT_COLOR = { data: '#33a8ff', analysts: '#2fd6a8', scout: '#ff9f5a', round1: '#a99bff', floor: '#8b7bff', hunt: '#9ad94a', shoes: '#ff8ad8', cross: '#33c3ff', devil: '#ff6b81', duel: '#ffb547', premortem: '#ff5c7a', steelman: '#2fd6a8', closing: '#ffd76a', redteam: '#ff4d6d', rebuttal: '#ff8fa3', risk: '#dfe3f0', chair: '#ffd76a', record: '#ffd76a' };
  const ACT_SUB = {
    data: `Two years of prices for ${C.UNIVERSE.length} companies and ETFs, SEC filings, company news, rates, credit and volatility.`,
    analysts: 'The research desk writes a dossier on every single name. Nothing is filtered out.',
    scout: 'Scout searches the live web for what moved markets this week and what is coming next.',
    round1: 'Every seat votes in secret. No one sees another ballot until all are in, then they are revealed together.',
    redteam: 'Vex has one job: find what is wrong with where the council is heading.',
    rebuttal: 'Every seat answers the attack. Defend with evidence, or concede and change.',
    risk: 'Sentinel protects the capital. Vetoes and caps are binding on the chair.',
    chair: 'Arbiter weighs every argument by its evidence, not by headcount, and decides.',
  };
  const VCOL = { strong_buy: '#3ddc97', buy: '#9bf0c8', hold: '#a9adbd', avoid: '#ff9fb0', strong_avoid: '#ff5c7a' };
  const VLAB = { strong_buy: 'Strong buy', buy: 'Buy', hold: 'Hold', avoid: 'Avoid', strong_avoid: 'Strong avoid' };
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII'];
  const hasLogo = (t) => typeof BRAND === 'object' && t in BRAND;
  const UNI = Object.fromEntries(C.UNIVERSE.map((u) => [u[0], { t: u[0], n: u[1], s: u[2], k: u[3] }]));
  const SECC = { Technology: '#5b8cff', Semiconductors: '#8b7bff', Communication: '#33bfff', Consumer: '#ff8a5c', Financials: '#3ddc97', 'Health Care': '#ff6aa2', Industrials: '#ffb547', Energy: '#ff7a45', Utilities: '#9ad94a', Materials: '#c9a26b', 'Real Estate': '#b58cff', 'Broad market': '#a9adbd', Bonds: '#6fa8dc', Commodities: '#ffd76a', Crypto: '#f7931a', International: '#2fd6a8', 'Sector ETFs': '#7fd1ff' };
  function mark(t, s = 24) {
    t = String(t || '').toUpperCase();
    if (hasLogo(t)) return `<span class="lg" style="--s:${s}px"><img src="logos/${esc(t)}.webp" alt="" draggable="false"></span>`;
    const l = C.label(t), k = l.length <= 2 ? .42 : l.length === 3 ? .34 : l.length === 4 ? .28 : .23;
    return `<span class="lg tx" style="--s:${s}px;--b:${SECC[UNI[t]?.s] || '#343a55'};font-size:${Math.round(s * k * 1.05)}px">${esc(l)}</span>`;
  }
  const tkc = (t, w, cls = '', extra = '') => `<span class="tkc ${cls}" ${extra} title="${esc(UNI[t]?.n || t)}">${mark(t, 24)}${esc(C.label(t))}${w == null ? '' : `<em>${(+w).toFixed(1)}%</em>`}</span>`;
  const seatName = (k) => SEAT[k]?.name || k;
  const byName = (n) => Object.keys(SEAT).find((k) => SEAT[k].name.toLowerCase() === String(n || '').trim().toLowerCase());
  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

  /* ── The hall: everything drawn on canvas ─────────────────────────────────── */
  class Hall {
    constructor(canvas, opts = {}) {
      this.c = canvas; this.x = canvas.getContext('2d'); this.o = opts; this.mode = 'hall'; this.speaker = null; this.beams = [];
      this.seats = {}; for (const k of ALL) this.seats[k] = { x: 0, y: 0, r: 0, tx: 0, ty: 0, tr: 0, talk: 0, think: 0, dim: 0, tTalk: 0, tThink: 0, tDim: 0, ripples: [], failed: false, set: false };
      this.tint = [139, 123, 255]; this.tintT = [139, 123, 255]; this.flashA = 0;
      this.dust = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.4 + .3, v: Math.random() * .012 + .004, a: Math.random() * .5 + .1 }));
      this.last = now(); this.run = true; this.hover = null;
      const loop = () => { if (!this.run) return; if (!document.hidden && this.c.offsetParent !== null) { try { this.frame(); } catch (e) { console.warn(e); } } requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      addEventListener('resize', () => this.layout());
    }
    stop() { this.run = false; }
    setTint(hex) { this.tintT = hexRgb(hex); }
    flash() { this.flashA = 1; }
    size() {
      const r = this.c.getBoundingClientRect(), dp = Math.min(devicePixelRatio || 1, 2), W = Math.max(1, r.width), H = Math.max(1, r.height);
      if (this.c.width !== Math.round(W * dp) || this.c.height !== Math.round(H * dp)) { this.c.width = Math.round(W * dp); this.c.height = Math.round(H * dp); this.W = W; this.H = H; this.layout(); }
      this.W = W; this.H = H; this.dp = dp;
    }
    layout() {
      const W = this.W || 1, H = this.H || 1, P = W < 900, S = this.seats, area = this.o.area ? this.o.area(W, H) : { x0: 0, x1: W, y0: 0, y1: H };
      const cxA = (area.x0 + area.x1) / 2, wA = area.x1 - area.x0, hA = area.y1 - area.y0;
      const put = (k, x, y, r, dim = 0) => { const s = S[k]; s.tx = x; s.ty = y; s.tr = r; s.tDim = dim; if (!s.set) { s.x = x; s.y = y; s.r = r; s.dim = dim; s.set = true; } };
      const bench = (y, r, skip) => { const ks = ALL.filter((k) => k !== skip), x0 = P ? 22 : W * .1, x1 = P ? W - 22 : W * .9; ks.forEach((k, i) => put(k, x0 + (x1 - x0) * (ks.length > 1 ? i / (ks.length - 1) : .5), y, r, .45)); };
      if (this.mode === 'hall') {
        const u = Math.min(wA / 1.6, hA), cy = area.y0 + hA * (P ? .3 : .34), rx = Math.min(wA * .42, u * .78), ry = hA * (P ? .34 : .4), rm = Math.max(14, u * (P ? .075 : .058));
        put('arbiter', cxA, area.y0 + hA * (P ? .2 : .2), rm * 1.3);
        put('vex', cxA - rx * .42, area.y0 + hA * (P ? .3 : .3), rm * 1.02); put('sentinel', cxA + rx * .42, area.y0 + hA * (P ? .3 : .3), rm * 1.02);
        if (P && wA < 600) { MEMBERS.forEach((k, i) => { const row = i < 4 ? 0 : 1, j = i % 4; put(k, area.x0 + wA * (.14 + .24 * j + (row ? .0 : 0)), area.y0 + hA * (row ? .8 : .52), rm * 1.15); }); }   // a narrow phone: two rows of four
        else MEMBERS.forEach((k, i) => { const u = -1 + 2 * i / (MEMBERS.length - 1); put(k, cxA + u * rx, cy + hA * .06 + ry * Math.sqrt(Math.max(0, 1 - u * u * .9)), rm); });   // evenly spaced across, so the ends never crowd
      } else if (this.mode === 'stage' && this.speaker) {
        if (P) { put(this.speaker, W * .5, H * .26, Math.min(W * .14, H * .1)); bench(90, 10, this.speaker); }
        else { put(this.speaker, W * .25, H * .46, Math.min(H * .15, W * .1)); bench(H - 80, 17, this.speaker); }
      } else {
        bench(P ? H - 26 : H - 80, P ? 10 : 17, null);
        if (this.mode === 'final') { const s = S.arbiter; s.tDim = 0; }
      }
    }
    setMode(m, speaker = null) { this.mode = m; this.speaker = speaker; this.layout(); }
    beam(a, b, ms = 5000, label) { this.beams.push({ a, b, t0: now(), d: ms / 1000, label }); }
    seatAt(px, py) { for (const k of ALL) { const s = this.seats[k]; if ((px - s.x) ** 2 + (py - s.y) ** 2 < (s.r * 1.3) ** 2) return k; } return null; }
    frame() {
      this.size();
      const x = this.x, W = this.W, H = this.H, t = now(), dt = Math.min(.1, t - this.last); this.last = t;
      const k6 = 1 - Math.exp(-dt * 5), k3 = 1 - Math.exp(-dt * 3);
      for (let i = 0; i < 3; i++) this.tint[i] += (this.tintT[i] - this.tint[i]) * k3;
      x.setTransform(this.dp, 0, 0, this.dp, 0, 0);
      // background: deep field, a tinted glow, a floor of light under the hall
      x.fillStyle = '#05060a'; x.fillRect(0, 0, W, H);
      const [tr, tg, tb] = this.tint.map(Math.round), tc = (a) => `rgba(${tr},${tg},${tb},${a})`;
      let g = x.createRadialGradient(W * .5, -H * .1, 0, W * .5, -H * .1, Math.max(W, H) * .9); g.addColorStop(0, tc(.2)); g.addColorStop(1, tc(0)); x.fillStyle = g; x.fillRect(0, 0, W, H);
      g = x.createRadialGradient(W * .5, H * 1.05, 0, W * .5, H * 1.05, W * .6); g.addColorStop(0, tc(.12)); g.addColorStop(1, tc(0)); x.fillStyle = g; x.fillRect(0, 0, W, H);
      if (this.flashA > .01) { g = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * .7); g.addColorStop(0, tc(.35 * this.flashA)); g.addColorStop(1, tc(0)); x.fillStyle = g; x.fillRect(0, 0, W, H); this.flashA *= Math.exp(-dt * 2.2); }
      // drifting dust
      for (const d of this.dust) { d.y -= d.v * dt; if (d.y < -.02) { d.y = 1.02; d.x = Math.random(); } x.fillStyle = `rgba(255,255,255,${d.a * (.5 + .5 * Math.sin(t * .8 + d.x * 20)) * .35})`; x.beginPath(); x.arc(d.x * W, d.y * H, d.s, 0, TAU); x.fill(); }
      // seats move toward their places
      for (const k of ALL) { const s = this.seats[k]; s.x += (s.tx - s.x) * k6; s.y += (s.ty - s.y) * k6; s.r += (s.tr - s.r) * k6; s.dim += (s.tDim - s.dim) * k3; s.talk += (s.tTalk - s.talk) * k6; s.think += (s.tThink - s.think) * k3; s.ripples = s.ripples.filter((r0) => t - r0 < 1.7); }
      // spotlight on the speaker
      if (this.mode === 'stage' && this.speaker) {
        const s = this.seats[this.speaker], c = AV.col(this.speaker, 1).replace(/[\d.]+\)$/, '');
        x.save(); const cone = x.createLinearGradient(0, 0, 0, s.y + s.r); cone.addColorStop(0, c + '.16)'); cone.addColorStop(1, c + '0)');
        x.fillStyle = cone; x.beginPath(); x.moveTo(s.x - s.r * .5, -10); x.lineTo(s.x + s.r * .5, -10); x.lineTo(s.x + s.r * 2.6, s.y + s.r * 1.2); x.lineTo(s.x - s.r * 2.6, s.y + s.r * 1.2); x.closePath(); x.fill();
        const pool = x.createRadialGradient(s.x, s.y + s.r * 1.9, 0, s.x, s.y + s.r * 1.9, s.r * 3); pool.addColorStop(0, c + '.14)'); pool.addColorStop(1, c + '0)'); x.fillStyle = pool; x.beginPath(); x.ellipse(s.x, s.y + s.r * 1.9, s.r * 3, s.r * .7, 0, 0, TAU); x.fill(); x.restore();
      }
      // the hall's floor ring
      if (this.mode === 'hall') { const a = this.seats.arbiter, b = this.seats[MEMBERS[0]], cy = (a.y + b.y) / 2 + (this.H < 600 ? 10 : 30); x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = 1; x.setLineDash([2, 7]); x.beginPath(); x.ellipse(a.x, cy + 12, Math.abs(b.x - a.x) * 1.02 + .1, Math.abs(b.y - a.y) * .9 + .1, 0, 0, TAU); x.stroke(); x.setLineDash([]); }
      // beams between seats
      this.beams = this.beams.filter((b) => t - b.t0 < b.d);
      for (const b of this.beams) {
        const A = this.seats[b.a], B = this.seats[b.b]; if (!A || !B) continue;
        const f = (t - b.t0) / b.d, alpha = Math.min(1, f * 6) * Math.min(1, (1 - f) * 4);
        const mx = (A.x + B.x) / 2, my = Math.min(A.y, B.y) - Math.abs(A.x - B.x) * .22 - 30;
        const gr = x.createLinearGradient(A.x, A.y, B.x, B.y); gr.addColorStop(0, AV.col(b.a, .85 * alpha)); gr.addColorStop(1, AV.col(b.b, .85 * alpha));
        x.strokeStyle = gr; x.lineWidth = 2.2; x.shadowColor = AV.col(b.a, .8 * alpha); x.shadowBlur = 14;
        const grow = Math.min(1, f * 3.2); x.beginPath(); x.moveTo(A.x, A.y);
        for (let i = 1; i <= 30 * grow; i++) { const u = i / 30, qx = (1 - u) ** 2 * A.x + 2 * (1 - u) * u * mx + u * u * B.x, qy = (1 - u) ** 2 * A.y + 2 * (1 - u) * u * my + u * u * B.y; x.lineTo(qx, qy); }
        x.stroke(); x.shadowBlur = 0;
        for (let j = 0; j < 3; j++) { const u = ((t * .7 + j / 3) % 1) * grow, qx = (1 - u) ** 2 * A.x + 2 * (1 - u) * u * mx + u * u * B.x, qy = (1 - u) ** 2 * A.y + 2 * (1 - u) * u * my + u * u * B.y; x.fillStyle = `rgba(255,255,255,${.9 * alpha})`; x.beginPath(); x.arc(qx, qy, 2.6, 0, TAU); x.fill(); }
      }
      // the seats, smallest first so the speaker is on top
      const order = ALL.slice().sort((a, b) => this.seats[a].r - this.seats[b].r);
      for (const k of order) { const s = this.seats[k]; AV.draw(x, k, s.x, s.y, s.r, t, s); }
      // names under the seats in the hall
      if (this.mode === 'hall' && !this.o.noNames) {
        x.textAlign = 'center'; x.textBaseline = 'top';
        for (const k of ALL) { const s = this.seats[k]; if (s.r < 12) continue; x.font = `700 ${Math.max(11, Math.min(15, s.r * .34))}px Outfit, sans-serif`; x.fillStyle = `rgba(255,255,255,${.85 - s.dim * .5})`; x.fillText(SEAT[k].name, s.x, s.y + s.r * 2.05); x.font = `600 ${Math.max(9.5, Math.min(11.5, s.r * .26))}px Inter, sans-serif`; x.fillStyle = `rgba(255,255,255,${.42 - s.dim * .25})`; if (this.W >= 600) x.fillText(SEAT[k].role.toUpperCase(), s.x, s.y + s.r * 2.05 + Math.max(14, Math.min(19, s.r * .44))); }
      }
    }
  }

  /* ── The director ─────────────────────────────────────────────────────────── */
  let hall = null, Q = [], busy = false, speed = 1, live = false, ended = false, meta = null, cb = {}, acts = [], actIdx = -1, curAct = null;
  let ballots = null, huntHeld = null, props = {}, prevProps = {}, thoughts = {}, wallBuilt = false, verdicts = {}, counts = {}, skipping = false, timers = [], beatToken = 0, finalShown = false;
  const wait = (ms) => new Promise((r) => { const tok = beatToken; const id = setTimeout(() => r(tok === beatToken), Math.max(0, ms) / effSpeed()); timers.push({ id, r }); });
  const cancelWaits = () => { const ts = timers; timers = []; for (const t of ts) { clearTimeout(t.id); t.r(false); } };   // a cancelled wait answers false, so its beat stops
  const effSpeed = () => (skipping ? 40 : speed * (live && Q.length > 5 ? Math.min(3, 1 + (Q.length - 5) * .2) : 1));

  function open(opts = {}) {
    cb = opts; live = !!opts.live; ended = false; Q = []; ballots = null; huntHeld = null; busy = false; props = {}; prevProps = {}; thoughts = {}; verdicts = {}; counts = {}; wmMode = null; wmShown = {}; wallBuilt = false; acts = []; actIdx = -1; curAct = null; skipping = false; finalShown = false; beatToken++; pumpId++;
    cancelWaits();
    const sh = $('#show'); sh.classList.add('on'); sh.setAttribute('aria-hidden', 'false'); document.body.classList.add('showing');
    if (!hall) hall = new Hall($('#showC'), { area: (W, H) => (W < 900 ? { x0: 0, x1: W, y0: 70, y1: H * .62 } : { x0: 0, x1: W - 330, y0: 70, y1: H - 40 }) }); else hall.run || (hall = new Hall($('#showC')));
    for (const k of ALL) Object.assign(hall.seats[k], { tTalk: 0, tThink: 0, tDim: 0, failed: false });
    hall.setMode('hall'); hall.setTint('#8b7bff');
    ['#shWall', '#shCap', '#shSide', '#shFinal', '#shCard', '#shBox'].forEach((s) => { $(s).classList.remove('on'); $(s).innerHTML = ''; });
    document.querySelectorAll('.wall-meta').forEach((n) => n.remove());
    $('#shThink').innerHTML = ''; $('#shCost').textContent = ''; $('#shKick').textContent = live ? 'LIVE' : 'REPLAY'; $('#shTitle').textContent = opts.title || 'The council'; $('#shProg').innerHTML = '';
    $('#shSpeed').textContent = speed + '×';
    // Live, the council works at full speed and the show plays its words as they arrive, so it can fall behind.
    // The speed sets how fast the words are read out; "Catch up" jumps to where the council actually is.
    $('#shSpeed').title = live ? 'How fast the words are played. The council itself always works at full speed.' : 'Replay speed';
    $('#shSkip').textContent = live ? 'Catch up' : 'Skip ahead';
    $('#shSkip').title = live ? 'Jump to what the council is doing right now' : 'Jump to the next act';
    $('#shSkip').classList.toggle('dim', live);
    if (live) startTicker();
  }
  function close() {
    beatToken++; pumpId++; cancelWaits(); Q = []; busy = false; stopTicker(); $('#show').classList.remove('deciding'); document.querySelectorAll('#show > .apply').forEach((n) => n.remove());
    $('#show').classList.remove('on'); $('#show').setAttribute('aria-hidden', 'true'); document.body.classList.remove('showing');
  }
  const isOpen = () => $('#show').classList.contains('on');

  /* Engine events in. Live visuals (thinking, costs) apply now; everything with a story goes through the queue. */
  function feed(e) {
    switch (e.type) {
      case 'start': meta = e.session; acts = meta.phases.filter((p) => p.key !== 'record'); renderProg(); break;
      case 'phase':
        if (ballots && !ballots.open) reveal();          // a meeting saved before the reveal was recorded
        if (e.key !== 'record') push({ type: 'title', key: e.key, label: e.label, format: e.format });
        if (e.key === 'round1') { ballots = { seats: meta?.members || MEMBERS, said: {}, open: false }; push({ type: 'ballots' }); }
        break;
      case 'progress': if (live) onProgress(e); break;
      case 'desk': push({ type: 'desk', e }); break;
      case 'turn': if (live) { const s = hall.seats[e.seat]; if (s) s.tThink = 1; } break;
      case 'think': if (live) thoughts[e.seat] = ((thoughts[e.seat] || '') + e.text).slice(-260); break;
      case 'speak': if (live && hall.seats[e.seat]) hall.seats[e.seat].tThink = .6; break;
      case 'said':
        // the blind vote: ballots stay sealed until every seat has voted
        if (ballots && !ballots.open && e.round === 1 && e.kind === 'member') { ballots.said[e.seat] = e; if (live) sealBallot(e.seat); break; }
        push({ type: 'speech', seat: e.seat, kind: e.kind, round: e.round, data: e.data, text: e.text }); break;
      case 'pairs': push({ type: 'pairs', pairs: e.pairs, format: e.format }); break;
      case 'reveal': if (ballots && !ballots.open) reveal(); break;
      case 'hunt': push({ type: 'hunt', held: e.held || [] }); break;
      case 'cost': $('#shCost').textContent = '$' + (+e.total).toFixed(2); break;
      case 'final': push({ type: 'final', final: e.final, previous: e.previous || [], waiting: !!e.waiting }); break;
      case 'decided': case 'done': ended = true; break;
      case 'failed': ended = true; push({ type: 'failed', error: e.error }); break;
      case 'log': if (live && /unavailable|took too long|could not/i.test(e.text)) thoughts._log = e.text; break;
    }
  }
  function push(b) { Q.push(b); pump(); }
  /* All ballots open at once: the reveal, then each seat explains its vote. */
  function reveal() {
    ballots.open = true;
    const order = ballots.seats.filter((k) => ballots.said[k]);
    push({ type: 'reveal', order, said: { ...ballots.said } });
    for (const k of order) { const e = ballots.said[k]; push({ type: 'speech', seat: e.seat, kind: e.kind, round: e.round, data: e.data, text: e.text }); }
  }
  let pumpId = 0;
  async function pump() {
    if (busy) return; busy = true; const my = ++pumpId;
    while (Q.length && my === pumpId) { const b = Q.shift(); try { await play(b); } catch (err) { console.warn(err); } }
    if (my === pumpId) { busy = false; skipping = false; }
  }

  function renderProg() {
    $('#shProg').innerHTML = acts.map((a, i) => `<i data-i="${i}" style="--c:${ACT_COLOR[a.format || a.key] || '#fff'}" title="${esc(a.label)}"></i>`).join('');
  }
  function markProg(i) { document.querySelectorAll('#shProg i').forEach((n, j) => { n.classList.toggle('done', j < i); n.classList.toggle('now', j === i); }); }

  async function play(b) {
    if (b.type === 'title') return playTitle(b);
    if (b.type === 'desk') return playDesk(b.e);
    if (b.type === 'speech') return playSpeech(b);
    if (b.type === 'pairs') return playPairs(b);
    if (b.type === 'ballots') return playBallots(b);
    if (b.type === 'reveal') return playReveal(b);
    if (b.type === 'hunt') return playHunt(b);
    if (b.type === 'final') return playFinal(b);
    if (b.type === 'failed') return playFailed(b);
  }

  async function playTitle(b) {
    actIdx = acts.findIndex((a) => a.key === b.key); curAct = { ...b, i: actIdx };
    const color = ACT_COLOR[b.format || b.key] || '#ffffff', fm = b.format ? C.FORMATS[b.format] : null;
    markProg(actIdx); hall.setTint(color); hall.flash();
    $('#shKick').textContent = `${live ? 'LIVE · ' : ''}ACT ${ROMAN[actIdx + 1] || actIdx + 1}`; $('#shTitle').textContent = b.label;
    // the wall belongs to the first two acts
    const wallAct = b.key === 'data' || b.key === 'analysts';
    $('#shCap').classList.remove('on'); hall.speaker = null;
    if (wallAct) { buildWall(); hall.setMode('wall'); $('#shSide').classList.remove('on'); }
    else { $('#shWall').classList.remove('on'); document.querySelectorAll('.wall-meta').forEach((n) => n.classList.remove('on')); hall.setMode('hall'); if (Object.keys(props).length || b.key === 'round1') renderBoard(); }
    for (const k of ALL) hall.seats[k].tTalk = 0;
    if (skipping) return;
    const card = $('#shCard'), d = 2.6;
    card.style.setProperty('--c', color); card.style.setProperty('--d', d / effSpeed() + 's');
    card.innerHTML = `<div class="k">Act ${ROMAN[actIdx + 1] || actIdx + 1}${fm ? ' · Debate' : ''}</div><div class="t">${esc(b.label)}</div><div class="s">${esc(fm ? fm.blurb : ACT_SUB[b.key] || '')}</div><div class="bar"></div>`;
    card.classList.remove('on'); void card.offsetWidth; card.classList.add('on');
    const fl = $('#shFlash'); fl.style.setProperty('--c', color); fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
    if (!(await wait(d * 1000 * .86))) return;
    if (b.key === 'data' && !live) await replayData();
    if (b.key === 'round1' || b.key.startsWith('debate') || b.key === 'rebuttal') for (const k of MEMBERS) if (live) hall.seats[k].tThink = Math.max(hall.seats[k].tThink, .5);
  }

  /* The wall of the universe. */
  function buildWall() {
    const w = $('#shWall');
    if (!wallBuilt) {
      w.innerHTML = C.UNIVERSE.map((u) => `<div class="wt" data-t="${esc(u[0])}" title="${esc(u[0] + ' · ' + u[1])}">${mark(u[0], 44)}</div>`).join('');
      const m = document.createElement('div'); m.className = 'wall-meta'; m.id = 'wallMeta'; $('#show').appendChild(m);
      wallBuilt = true;
    }
    w.classList.add('on'); fitWall(); $('#wallMeta').classList.add('on'); renderWallMeta();
  }
  function fitWall() {
    const w = $('#shWall'), r = w.getBoundingClientRect(), n = C.UNIVERSE.length;
    const g = r.width < 600 ? 5 : 8; let best = 18; for (let s = 80; s >= 18; s -= 1) { const cols = Math.floor((r.width + g) / (s + g)), rows = Math.ceil(n / Math.max(1, cols)); if (rows * (s + g) <= r.height) { best = s; break; } }
    w.style.setProperty('--tile', best + 'px');
  }
  function lightTiles(frac) { const tiles = document.querySelectorAll('.wt'); const n = Math.round(tiles.length * frac); tiles.forEach((t, i) => { if (i < n && !t.classList.contains('lit')) t.classList.add('lit'); }); }
  function onProgress(e) {
    if (e.key === 'prices') { counts.prices = Math.max(counts.prices || 0, e.done); lightTiles(counts.prices / e.total); }
    else if (e.key === 'sec') counts.sec = e.label === 'SEC fundamentals' ? e.done : counts.sec || 0;
    else if (e.key === 'news') counts.news = Math.max(counts.news || 0, e.done);
    else if (e.key === 'macro') counts.macro = e.done ? 'Ready' : '…';
    else if (e.key === 'analysts') counts.dossiers = Math.max(counts.dossiers || 0, e.done);
    renderWallMeta();
  }
  async function replayData() {
    const tiles = [...document.querySelectorAll('.wt')];
    for (let i = 0; i < tiles.length; i += 6) { tiles.slice(i, i + 6).forEach((t) => t.classList.add('lit')); counts.prices = Math.min(tiles.length, i + 6); renderWallMeta(); if (!(await wait(32))) return; }
    counts.sec = '✓'; counts.news = '✓'; counts.macro = 'Ready'; renderWallMeta(); if (!(await wait(900))) return;
  }
  /* The counters under the wall. The boxes are built once per mode and only their numbers change, so they never
     re-animate or flash; a number glides up to its new value instead of jumping. */
  let wmMode = null, wmShown = {}, wmRaf = 0;
  function renderWallMeta() {
    const m = $('#wallMeta'); if (!m) return;
    const mode = curAct?.key === 'analysts' ? 'desk' : 'data';
    const v = Object.values(verdicts), n = (k) => v.filter((x) => x === k).length;
    const rows = mode === 'desk'
      ? ['strong_buy', 'buy', 'hold', 'avoid', 'strong_avoid'].map((k) => [k, VLAB[k], n(k), VCOL[k]])
      : [['prices', 'Price histories', counts.prices ?? 0], ['sec', 'SEC fundamentals', counts.sec ?? '…'], ['news', 'News feeds', counts.news ?? '…'], ['macro', 'Rates and macro', counts.macro ?? '…']];
    if (wmMode !== mode || !m.querySelector('.wm')) {
      wmMode = mode; wmShown = {};
      m.innerHTML = rows.map(([k, label, , col]) => `<div class="wm" data-k="${k}"><b${col ? ` style="color:${col}"` : ''}></b><span>${label}</span></div>`).join('');
    }
    rows.forEach(([k, , val]) => {
      const b = m.querySelector(`.wm[data-k="${k}"] b`); if (!b) return;
      b.dataset.to = val;
      if (typeof val !== 'number') { b.textContent = val; wmShown[k] = null; }
      else if (wmShown[k] == null || val < wmShown[k]) { wmShown[k] = val; b.textContent = val; }
    });
    if (!wmRaf) wmRaf = requestAnimationFrame(tickWallMeta);
  }
  function tickWallMeta() {
    wmRaf = 0; const m = $('#wallMeta'); if (!m) return; let more = false;
    m.querySelectorAll('.wm').forEach((w) => {
      const k = w.dataset.k, b = w.querySelector('b'), to = +b.dataset.to;
      if (!Number.isFinite(to) || wmShown[k] == null || wmShown[k] >= to) return;
      wmShown[k] = Math.min(to, wmShown[k] + Math.max(1, Math.ceil((to - wmShown[k]) * 0.18)));
      b.textContent = wmShown[k]; if (wmShown[k] < to) more = true;
    });
    if (more) wmRaf = requestAnimationFrame(tickWallMeta);
  }
  async function playDesk(e) {
    if (!wallBuilt) buildWall();
    lightTiles(1);
    for (const r of e.reports || []) {
      const t = document.querySelector(`.wt[data-t="${CSS.escape(r.t)}"]`); if (!t) continue;
      if (r.v) { verdicts[r.t] = r.v; t.style.setProperty('--v', VCOL[r.v]); t.classList.remove('v'); void t.offsetWidth; t.classList.add('v'); t.title = `${r.t} · ${VLAB[r.v]}`; }
    }
    renderWallMeta();
    if (!live) await wait(180);
  }

  /* A seat takes the stage. */
  function diffLine(k, d) {
    const prev = prevProps[k]; if (!prev || !d?.picks) return '';
    const a = Object.fromEntries(prev.picks.map((p) => [p.ticker, +p.weight])), b = Object.fromEntries(d.picks.map((p) => [p.ticker, +p.weight])), out = [];
    for (const t in b) if (!(t in a)) out.push(`<span class="up">+${esc(C.label(t))} ${b[t].toFixed(0)}%</span>`);
    for (const t in a) if (!(t in b)) out.push(`<span class="dn">−${esc(C.label(t))}</span>`);
    for (const t in b) if (t in a && Math.abs(b[t] - a[t]) >= 2) out.push(`<span class="chg">${esc(C.label(t))} ${a[t].toFixed(0)}→${b[t].toFixed(0)}%</span>`);
    return out.length ? `<span>Changed its mind:</span> ${out.slice(0, 6).join(' · ')}` : '<span>Held its position</span>';
  }
  /* A statement laid out to read: the first sentence is the key line, the rest short paragraphs of two sentences. */
  function speechParas(text) {
    const blocks = String(text || '').split(/\n\s*\n|\n(?=[-•*] )/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean), out = [];
    blocks.forEach((bl, bi) => {
      const sent = bl.split(/(?<=[.!?]["')\]]*)\s+(?=["'(]?[A-Z0-9])/).filter(Boolean).map((x) => x + ' ');
      if (bi === 0 && sent.length > 1) { out.push(sent.shift()); }
      for (let i = 0; i < sent.length; i += 2) out.push(sent.slice(i, i + 2).join(''));
    });
    return out.map((p) => p.split(/\s+/).filter(Boolean)).filter((p) => p.length);
  }
  const shortWord = (w) => w.replace(/[A-Z0-9][A-Z0-9.-]*\.[A-Z]{1,3}|BRK-B/g, (t) => (UNI[t] ? C.label(t) : t));
  const isTicker = (w) => { const t = w.replace(/^[("'$]+|[)"',.;:!?%]+$/g, '').replace(/'s$/, ''); return t in UNI; };
  /* Keeps what is being said in view: scrolls the card gently once the text runs past its bottom edge. */
  function follow(box, el, end) {
    if (!box || box.scrollHeight <= box.clientHeight + 2) return;
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (end || r.bottom > b.bottom - b.height * .18) box.scrollTo({ top: Math.min(box.scrollHeight, box.scrollTop + (end ? r.bottom - b.bottom + 24 : r.bottom - b.bottom + b.height * .4)), behavior: 'smooth' });
    box.classList.toggle('more', box.scrollTop + box.clientHeight < box.scrollHeight - 4);
  }
  async function playSpeech(b) {
    const k = b.seat, S = SEAT[k] || { name: k, role: '', color: '#fff' }, d = b.data || {}, seatSt = hall.seats[k];
    if (!seatSt) return;
    const isMember = b.kind === 'member';
    if (isMember && d.picks) { if (props[k] && props[k] !== d) prevProps[k] = props[k]; props[k] = d; }
    const pitched = isMember && huntHeld && curAct?.format === 'hunt' ? (d.picks || []).filter((p) => !huntHeld.has(p.ticker)).map((p) => p.ticker) : [];
    seatSt.tThink = 0;
    if (skipping) { if (isMember) renderBoard(); return; }
    hall.setMode('stage', k);
    for (const q of ALL) { hall.seats[q].tTalk = q === k ? 1 : 0; }
    const roundLbl = b.kind === 'question' ? 'Cross-examination' : b.kind === 'scout' ? 'Web research' : b.kind === 'redteam' ? 'Red team' : b.kind === 'risk' ? 'Risk ruling' : b.kind === 'chair' ? 'The decision' : curAct?.label || '';
    let text = b.kind === 'scout' ? (b.text || d.digest || '') : (d.statement || '');
    if (b.kind === 'scout') { const ws = text.replace(/[#*_>`]/g, '').replace(/[ \t]+/g, ' ').trim().split(' '); text = ws.slice(0, 130).join(' ') + (ws.length > 130 ? '…' : ''); }
    const paras = speechParas(text), words = paras.flat();
    const extras = [];
    if (b.kind === 'question') (d.questions || []).slice(0, 3).forEach((q) => { const to = byName(q.to); extras.push(`<div class="qc">${AV.orb(to || 'arbiter', 26)}<div><b>${esc(q.to)}</b>, ${esc(q.question)}</div></div>`); if (to) hall.beam(k, to, 9000); });
    const toLbl = (r) => (curAct?.format === 'shoes' && byName(r.to) ? `In ${esc(r.to)}'s shoes` : curAct?.format === 'hunt' && !byName(r.to) ? 'The pitch' : 'To ' + esc(r.to));
    if (isMember) (d.responses || []).slice(0, 2).forEach((r) => { const to = byName(r.to); extras.push(`<div class="qc${curAct?.format === 'shoes' && to ? ' shoes' : ''}">${AV.orb(to || 'arbiter', 26)}<div><b>${toLbl(r)}</b>, ${esc(r.point)}</div></div>`); if (to && to !== k) hall.beam(k, to, 9000); });
    if (b.kind === 'redteam') (d.attacks || []).slice(0, 4).forEach((a) => extras.push(`<div class="qc atk">${AV.orb('vex', 26)}<div><b>${esc(a.target)}</b> <div class="sev">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= a.severity ? 'on' : ''}"></i>`).join('')}</div>${esc(a.argument)}</div></div>`));
    let chips = '';
    if (isMember && d.picks) chips = d.picks.slice().sort((p, q) => (pitched.includes(q.ticker) - pitched.includes(p.ticker)) || q.weight - p.weight).slice(0, 10).map((p, i) => tkc(p.ticker, p.weight, pitched.includes(p.ticker) ? 'add stamp pitch' : '', `${pitched.includes(p.ticker) ? 'data-s="PITCH" ' : ''}style="animation-delay:${i * 70}ms"`)).join('') + (d.picks.length > 10 ? `<span class="tkc" title="${esc(d.picks.slice().sort((p, q) => q.weight - p.weight).slice(10).map((p) => `${p.ticker} ${(+p.weight).toFixed(1)}%`).join(', '))}">+${d.picks.length - 10} more</span>` : '');
    if (b.kind === 'redteam') chips = (d.cut || []).map((c, i) => tkc(c.ticker, null, 'cut stamp', `data-s="CUT" style="animation-delay:${i * 90}ms"`)).join('');
    if (b.kind === 'risk') chips = [...(d.vetoes || []).map((v) => tkc(v.ticker, null, 'cut stamp', 'data-s="VETO"')), ...(d.caps || []).map((c) => `<span class="tkc">${mark(c.ticker, 24)}${esc(C.label(c.ticker))}<em>≤ ${(+c.max_weight).toFixed(0)}%</em></span>`), `<span class="tkc"><span class="lg cash" style="--s:24px">$</span>Cash ≥ ${(+d.min_cash_pct || 0).toFixed(0)}%</span>`, `<span class="tkc">Sector ≤ ${(+d.max_sector_pct || 0).toFixed(0)}%</span>`].join('');
    const meta = isMember ? (pitched.length ? `<span>Pitched:</span> ${pitched.map((t) => `<span class="up">${esc(C.label(t))}</span>`).join(' · ')} <span>· nobody held ${pitched.length > 1 ? 'these' : 'it'}</span>` : diffLine(k, d)) : b.kind === 'scout' ? '<span>Briefing shared with every seat</span>' : b.kind === 'chair' && d.confidence != null ? `<span>Confidence ${d.confidence}/100</span>` : '';
    const cap = $('#shCap');
    cap.classList.remove('on'); cap.classList.toggle('wide', !$('#shSide').classList.contains('on'));
    cap.style.setProperty('--c', S.color);
    cap.innerHTML = `<div class="cw"><b>${esc(S.name)}</b><span>${esc(S.role)} · ${esc(roundLbl)}</span></div><div class="cbody" style="--ts:${words.length < 45 ? 1 : words.length < 80 ? .88 : words.length < 120 ? .8 : .74}"><div class="ct">${paras.map((p, i) => `<p class="${i ? '' : 'lead'}">${p.map((w) => `<span class="w${isTicker(w) ? ' key' : ''}">${esc(shortWord(w))} </span>`).join('')}</p>`).join('')}</div>${extras.length ? `<div class="cq hidden">${extras.join('')}</div>` : ''}${chips ? `<div class="cp hidden">${chips}</div>` : ''}${meta ? `<div class="cmeta hidden">${meta}</div>` : ''}</div>`;
    void cap.offsetWidth; cap.classList.add('on');
    seatSt.ripples.push(now());
    if (!(await wait(500))) { seatSt.tTalk = 0; return; }
    const spans = cap.querySelectorAll('.w'), per = Math.max(70, Math.min(190, 9000 / Math.max(1, words.length))), body = cap.querySelector('.cbody');
    for (let i = 0; i < spans.length; i++) {
      spans[i].classList.add('in');
      if (i % 6 === 0) follow(body, spans[i]);
      if (i % 4 === 0) seatSt.ripples.push(now());
      if (!(await wait(per))) { seatSt.tTalk = 0; return; }
    }
    for (const sel of ['.cq', '.cp', '.cmeta']) { const n = cap.querySelector(sel); if (n) { n.classList.remove('hidden'); follow(body, n, true); if (!(await wait(sel === '.cq' ? 700 * Math.min(3, extras.length) : 500))) { seatSt.tTalk = 0; return; } } }
    if (isMember) renderBoard();
    await wait(1600 + Math.min(2400, words.length * 18));
    seatSt.tTalk = 0;
  }

  const PAIR_WORD = { cross: 'questions', duel: 'duels', steelman: 'argues for', shoes: 'wears the shoes of' };
  async function playPairs(b) {
    if (skipping) return;
    hall.setMode('hall'); $('#shCap').classList.remove('on');
    for (const [a, c] of b.pairs) if (a !== c) hall.beam(a, c, 4200 / effSpeed());
    // who faces whom, listed once (a duel is one pair, not two)
    const seen = new Set(), rows = b.pairs.filter(([a, c]) => { if (b.format === 'duel') { const id = [a, c].sort().join(); if (seen.has(id)) return false; seen.add(id); } return a !== c; });
    const box = $('#shBox'), col = ACT_COLOR[b.format] || '#fff';
    box.className = 'sh-box pairs'; box.style.setProperty('--c', col);
    box.innerHTML = `<h6>${esc(C.FORMATS[b.format]?.label || '')}</h6><div class="pl">${rows.map(([a, c], i) => `<div class="pr" style="animation-delay:${i * 90}ms">${AV.orb(a, 28)}<b>${esc(seatName(a))}</b><span>${PAIR_WORD[b.format] || (b.format === 'duel' ? '⇄' : '→')}</span><b>${esc(seatName(c))}</b>${AV.orb(c, 28)}</div>`).join('')}</div>`;
    void box.offsetWidth; box.classList.add('on');
    await wait(3000 + rows.length * 220);
    box.classList.remove('on');
    await wait(400);
  }

  /* The blind vote. Eight sealed ballots; each seals as its seat votes. Nothing is shown until every one is in. */
  function ballotHTML(seats) {
    return `<h6>The blind vote</h6><div class="bn"><b id="bxN">0</b> of ${seats.length} ballots in</div><div class="bl">${seats.map((k, i) => `<div class="ba" data-k="${k}" style="--c:${SEAT[k]?.color || '#fff'};animation-delay:${i * 60}ms"><div class="env"><div class="flap"></div><div class="seal">${AV.orb(k, 30)}</div><div class="lines"><i></i><i></i><i></i></div></div><b>${esc(seatName(k))}</b><span class="bst">Deciding</span></div>`).join('')}</div>`;
  }
  function sealBallot(k) {
    const n = document.querySelector(`#shBox .ba[data-k="${k}"]`); if (!n || n.classList.contains('sealed')) return;
    n.classList.add('sealed'); n.querySelector('.bst').textContent = 'Sealed';
    const c = $('#bxN'); if (c) c.textContent = document.querySelectorAll('#shBox .ba.sealed').length;
  }
  async function playBallots() {
    if (skipping || !ballots) return;
    hall.setMode('hall'); $('#shCap').classList.remove('on');
    const box = $('#shBox'); box.className = 'sh-box ballots'; box.style.setProperty('--c', ACT_COLOR.round1);
    box.innerHTML = ballotHTML(ballots.seats); void box.offsetWidth; box.classList.add('on');
    // already in (a replay, or the show fell behind): seal them one by one, then wait for the rest
    for (const k of ballots.seats) if (ballots.said[k]) { sealBallot(k); if (!(await wait(260))) return; }
    while (!ballots.open && live && !ended) { if (!(await wait(400))) return; }
    for (const k of ballots.seats) if (ballots.said[k]) sealBallot(k);
  }
  async function playReveal(b) {
    for (const k of b.order) { const d = b.said[k].data; if (d?.picks) props[k] = d; }
    if (skipping) { renderBoard(); return; }
    const box = $('#shBox');
    if (!box.classList.contains('ballots')) { box.className = 'sh-box ballots'; box.style.setProperty('--c', ACT_COLOR.round1); box.innerHTML = ballotHTML(b.order); b.order.forEach(sealBallot); void box.offsetWidth; box.classList.add('on'); }
    if (!(await wait(500))) return;
    box.querySelector('h6').textContent = 'The ballots are open'; box.querySelector('.bn').innerHTML = 'Revealed together';
    hall.flash();
    b.order.forEach((k, i) => {
      const n = box.querySelector(`.ba[data-k="${k}"]`); if (!n) return;
      const d = b.said[k].data || {}, top = (d.picks || []).slice().sort((p, q) => q.weight - p.weight).slice(0, 3);
      n.insertAdjacentHTML('beforeend', `<div class="vote">${top.map((p) => `<span>${mark(p.ticker, 20)}${esc(C.label(p.ticker))}<em>${(+p.weight).toFixed(0)}%</em></span>`).join('')}<small>${(d.picks || []).length} names · ${(+d.cash_pct || 0).toFixed(0)}% cash</small></div>`);
      setTimeout(() => n.classList.add('open'), i * 120 / effSpeed());
    });
    renderBoard();
    if (!(await wait(2200 + b.order.length * 380))) return;
    box.classList.remove('on');
    await wait(500);
  }

  /* The hunt: the whole universe, with what the council already holds lit. The rest is where the seats go looking. */
  async function playHunt(b) {
    huntHeld = new Set(b.held);
    if (skipping) return;
    hall.setMode('hall'); $('#shCap').classList.remove('on');
    const box = $('#shBox'); box.className = 'sh-box hunt'; box.style.setProperty('--c', ACT_COLOR.hunt);
    const all = C.UNIVERSE.map((u) => u[0]).filter((t) => !C.BENCH.includes(t)), held = all.filter((t) => huntHeld.has(t)).length;
    box.innerHTML = `<h6>The hunt</h6><div class="bn"><b>${held}</b> held · <b>${all.length - held}</b> nobody owns</div><div class="hm">${all.map((t, i) => `<span class="${huntHeld.has(t) ? 'h' : ''}" title="${esc(UNI[t]?.n || t)}" style="animation-delay:${(i % 40) * 12}ms">${mark(t, 22)}</span>`).join('')}</div><p>Each seat brings one name from the dark back to the table.</p>`;
    void box.offsetWidth; box.classList.add('on');
    if (!(await wait(4200))) return;
    box.classList.remove('on');
    await wait(400);
  }

  /* Where the council leans: the average of every seat's latest proposal, re-sorted as it changes. */
  function renderBoard() {
    const side = $('#shSide'); if (innerWidth < 900) return;
    if (!side.querySelector('.cb')) side.innerHTML = '<h5><span>Where the council leans</span><span id="cbN"></span></h5><div class="cb" id="cb"></div><div class="cbm" id="cbM"></div>';
    side.classList.add('on'); $('#shCap').classList.remove('wide');
    const cb = $('#cb'), seen = new Set(), all = rules.consensus(props);
    // Every name any seat backs is on the board; rows shrink to fit, and only a long tail is folded into "+N more".
    const fit = Math.max(8, Math.floor((cb.clientHeight || 520) / 22)), cons = all.slice(0, fit), step = Math.max(22, Math.min(36, Math.floor((cb.clientHeight || 520) / Math.max(1, cons.length))));
    const max = Math.max(1, ...cons.map((c) => c.weight));
    $('#cbN').textContent = Object.keys(props).length ? `${all.length} names` : 'waiting';
    $('#cbM').textContent = all.length > cons.length ? `+${all.length - cons.length} more, smaller weights` : '';
    cb.style.setProperty('--rh', Math.min(32, step - 4) + 'px');
    cons.forEach((c, i) => {
      let r = cb.querySelector(`[data-t="${CSS.escape(c.ticker)}"]`);
      if (!r) { r = document.createElement('div'); r.className = 'cbr new'; r.dataset.t = c.ticker; r.innerHTML = `${mark(c.ticker, 24)}<b>${esc(C.label(c.ticker))}</b><span class="bar"><i style="width:0"></i></span><em></em>`; r.style.transform = `translateY(${i * step + 40}px)`; cb.appendChild(r); }
      seen.add(c.ticker); r.style.opacity = 1; r.style.transform = `translateY(${i * step}px)`;
      r.querySelector('i').style.width = (c.weight / max * 100).toFixed(1) + '%'; r.querySelector('em').textContent = c.weight.toFixed(1) + '%';
      r.title = `${c.ticker}: backed by ${c.votes} seat${c.votes === 1 ? '' : 's'}`;
    });
    cb.querySelectorAll('.cbr').forEach((r) => { if (!seen.has(r.dataset.t)) { r.style.opacity = 0; setTimeout(() => { if (r.style.opacity === '0') r.remove(); }, 700); } });
  }

  /* The decision: the ring assembles, the list writes itself, then João chooses how it enters. */
  async function playFinal(b) {
    skipping = false; finalShown = true; stopTicker(); $('#shThink').innerHTML = '';
    const f = b.final, H = (f.holdings || []).slice().sort((p, q) => q.weight - p.weight);
    hall.setMode('final'); hall.setTint('#ffd76a'); hall.flash();
    $('#shCap').classList.remove('on'); $('#shSide').classList.remove('on'); $('#shWall').classList.remove('on');
    markProg(acts.length); $('#shKick').textContent = live ? 'LIVE · THE DECISION' : 'THE DECISION'; $('#shTitle').textContent = `${H.length} holdings · ${(+f.cash_pct).toFixed(1)}% cash`;
    const prev = Object.fromEntries((b.previous || []).map((p) => [p.ticker, p.weight]));
    const R = 42, CIRC = TAU * R; let acc = 0;
    const segs = [...H.map((h) => ({ t: h.ticker, w: h.weight, c: (hasLogo(h.ticker) && BRAND[h.ticker] !== '#3a4060' ? BRAND[h.ticker] : SECC[UNI[h.ticker]?.s] || '#8b7bff') })), ...(f.cash_pct > 0 ? [{ t: 'Cash', w: +f.cash_pct, c: '#4a5068' }] : [])];
    const tot = segs.reduce((a, s) => a + s.w, 0) || 100;
    const svgSegs = segs.map((s, i) => { const len = s.w / tot * CIRC, gap = Math.min(1.2, len * .25), off = acc; acc += len; return `<circle class="seg" cx="50" cy="50" r="${R}" fill="none" stroke="${s.c}" stroke-width="9" stroke-linecap="butt" stroke-dasharray="${Math.max(.1, len - gap)} ${CIRC}" stroke-dashoffset="${-off}" transform="rotate(-90 50 50)" style="opacity:0;transition:opacity .6s ${i * 90}ms"/>`; }).join('');
    let a0 = 0; const logos = segs.filter((s) => s.t !== 'Cash').map((s, i) => { const mid = (a0 + s.w / 2) / tot * TAU - Math.PI / 2; a0 += s.w; const rr = 47; return `<div class="lgp" style="left:${50 + Math.cos(mid) * rr}%;top:${50 + Math.sin(mid) * rr}%;animation-delay:${600 + i * 110}ms">${mark(s.t, 40)}<small>${s.w.toFixed(1)}%</small></div>`; }).join('');
    const rows = H.map((h, i) => { const p = prev[h.ticker], tag = p == null ? '<span class="chgtag n">NEW</span>' : Math.abs(p - h.weight) >= 1 ? `<span class="chgtag u">${p.toFixed(0)}→${h.weight.toFixed(0)}%</span>` : ''; return `<div class="rw" style="animation-delay:${900 + i * 80}ms">${mark(h.ticker, 30)}<div><b>${esc(C.label(h.ticker))}</b>${tag}<small style="display:block;margin:0">${esc((h.thesis || '').slice(0, 90))}</small></div><em>${h.weight.toFixed(1)}%</em></div>`; }).join('')
      + Object.keys(prev).filter((t) => !H.some((h) => h.ticker === t)).map((t) => `<div class="rw" style="opacity:.6">${mark(t, 30)}<div><b>${esc(C.label(t))}</b><span class="chgtag x">SOLD</span></div><em>0%</em></div>`).join('');
    const fin = $('#shFinal');
    fin.innerHTML = `<div class="fin-l"><span class="kick">The chair has decided</span><h2>${H.length} holdings</h2><p>${esc(f.summary || '')}</p>${f.confidence != null ? `<div class="conf"><b id="confN">0</b><span>Confidence<br>out of 100</span></div>` : ''}</div>
      <div class="fin-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${R}" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="9"/>${svgSegs}</svg>${logos}<div class="mid"><b>${(100 - (+f.cash_pct || 0)).toFixed(0)}%</b><span>Invested</span></div></div>
      <div class="fin-r">${rows}</div>`;
    fin.classList.add('on');
    requestAnimationFrame(() => fin.querySelectorAll('.seg').forEach((s) => { s.style.opacity = 1; }));
    if (f.confidence != null) { const n = $('#confN'), t0 = performance.now(); const tick = (ts) => { const k = Math.min(1, (ts - t0) / 1600); n.textContent = Math.round(f.confidence * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
    hall.seats.arbiter.tTalk = 1;
    await wait(2200);
    if (live && b.waiting && cb.onDecided) { $('#show').classList.add('deciding'); cb.onDecided(applyPanel); }
    else if (!live) { $('#show').classList.add('deciding'); replayFooter(); }
  }
  function applyPanel({ nextOpen, onApply }) {
    const p = document.createElement('div'); p.className = 'apply'; p.id = 'applyP';
    const min = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    p.innerHTML = `<h4>How should this enter the portfolio?</h4><div class="opts">
      <button class="opt" data-h="now"><b>Apply now</b><small>Enters at this moment's prices.</small></button>
      <button class="opt" data-h="open"><b>At the next open</b><small>Enters at 09:30 New York on ${esc(nextOpen)}.</small></button>
      <div class="opt" data-h="date"><b>On a date</b><small>Enters at that day's 09:30 open.</small><input type="date" id="applyD" min="${min}" value="${min}"><button class="btn gh" style="height:36px;margin-top:8px;width:100%" data-h="date">Schedule</button></div></div>
      <button class="link" data-h="skip">Don't apply. Keep the meeting as a record only.</button>`;
    p.addEventListener('click', (e) => {
      const el = e.target.closest('[data-h]'); if (!el || el.tagName === 'DIV') return;
      let how = el.dataset.h; if (how === 'date') how = $('#applyD').value; if (!how) return;
      onApply(how, setSaving);
    });
    $('#show').appendChild(p);
    function setSaving(state, msg) {
      if (state === 'saving') p.innerHTML = `<div class="saving glass" style="padding:16px 22px;border-radius:999px"><span class="spin"></span>${esc(msg || 'Saving to GitHub')}</div>`;
      else if (state === 'saved') { p.innerHTML = `<div class="okline" style="font-size:15px">${'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'}${esc(msg || 'Saved.')}</div><button class="btn pri" id="finDone">Done</button>`; $('#finDone').onclick = () => { close(); cb.onClose && cb.onClose(); }; }
      else if (state === 'error') { const old = p.innerHTML; p.innerHTML = `<div class="badline">${esc(msg)}</div><button class="btn pri" id="finRetry">Try again</button>`; $('#finRetry').onclick = () => { p.remove(); applyPanel({ nextOpen, onApply }); }; void old; }
    }
  }
  function replayFooter() {
    const p = document.createElement('div'); p.className = 'apply';
    p.innerHTML = `<div class="row" style="margin:0;justify-content:center"><button class="btn gh" id="rpAgain">Watch again</button><button class="btn pri" id="rpClose">Close</button></div>`;
    $('#show').appendChild(p);
    $('#rpClose').onclick = () => { close(); cb.onClose && cb.onClose(); };
    $('#rpAgain').onclick = () => { const s = cb.session; close(); replay(s, cb); };
  }
  async function playFailed(b) {
    $('#shCap').classList.remove('on'); hall.setMode('hall'); hall.setTint('#ff5c7a');
    const p = document.createElement('div'); p.className = 'apply';
    p.innerHTML = `<div class="badline" style="font-size:15px">The meeting stopped: ${esc(b.error)}</div><button class="btn pri" id="failClose">Close</button>`;
    $('#show').appendChild(p); $('#failClose').onclick = () => { close(); cb.onClose && cb.onClose(); };
  }

  /* While seats think, their thinking scrolls past at the bottom of the stage. */
  let tick = null;
  function startTicker() {
    stopTicker(); let i = 0;
    tick = setInterval(() => {
      $('#shSkip').classList.toggle('dim', !Q.length);   // nothing to catch up on: the show is at the live edge
      const ks = Object.keys(thoughts).filter((k) => k !== '_log' && hall.seats[k]?.tThink > .1);
      const el = $('#shThink');
      if (thoughts._log) { el.innerHTML = `<b style="--c:#ffb547">Note</b>${esc(thoughts._log)}`; delete thoughts._log; return; }
      if (!ks.length) { el.innerHTML = ''; return; }
      if (ballots && !ballots.open) { el.innerHTML = '<b style="--c:#a99bff">Sealed</b>The ballots stay secret until every seat has voted.'; return; }
      const k = ks[i++ % ks.length], t = thoughts[k].replace(/\s+/g, ' ').trim(), cut = t.slice(-150).replace(/^\S*\s/, '');
      el.style.setProperty('--c', SEAT[k].color); el.innerHTML = `<b>${esc(SEAT[k].name)} is thinking</b>…${esc(cut)}`;
    }, 2600);
  }
  function stopTicker() { if (tick) clearInterval(tick); tick = null; }

  /* A saved meeting, told again. */
  function replay(s, opts = {}) {
    open({ ...opts, live: false, session: s, title: 'Meeting of ' + new Date(s.startedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) });
    for (const e of s.events || []) feed(e);
    if (!(s.events || []).some((e) => e.type === 'final') && s.final) feed({ type: 'final', final: s.final, previous: s.previous || [] });
    $('#shCost').textContent = s.cost ? '$' + s.cost.toFixed(2) : '';
  }

  function skip() {
    if (!busy || finalShown) return;
    pumpId++; beatToken++; cancelWaits();
    // drop ahead to the next act, keeping what the skipped seats said
    skipping = true;
    const nextTitle = Q.findIndex((b) => b.type === 'title' || b.type === 'final');
    const dropped = nextTitle < 0 ? Q.splice(0) : Q.splice(0, nextTitle);
    for (const b of dropped) { if (b.type === 'speech' && b.kind === 'member' && b.data?.picks) { if (props[b.seat]) prevProps[b.seat] = props[b.seat]; props[b.seat] = b.data; } if (b.type === 'desk') playDesk(b.e); }
    for (const b of dropped) { if (b.type === 'reveal') for (const k of b.order) if (b.said[k].data?.picks) props[k] = b.said[k].data; if (b.type === 'hunt') huntHeld = new Set(b.held); }
    renderBoard(); skipping = false;
    $('#shCap').classList.remove('on'); $('#shBox').classList.remove('on'); hall.setMode('hall');
    busy = false; pump();
  }

  function wire() {
    $('#shClose').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';
    $('#shClose').onclick = () => { if (live && !ended && cb.onStop) cb.onStop(); else if (live && finalShown && cb.onEarlyClose) cb.onEarlyClose(); else { close(); cb.onClose && cb.onClose(); } };
    $('#shSkip').onclick = skip;
    $('#shSpeed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; $('#shSpeed').textContent = speed + '×'; };
    addEventListener('resize', () => { if (wallBuilt && $('#shWall').classList.contains('on')) fitWall(); });
    addEventListener('keydown', (e) => { if (!isOpen()) return; if (e.key === 'ArrowRight') skip(); });
  }
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', wire) : wire();

  return { open, close, feed, replay, isOpen, Hall, mark, tkc, isLive: () => live && !ended, hasEnded: () => ended };
})();
