/* The council chamber: seats around the chair, and the whole universe as a ring of lights around them. */
'use strict';
(function () {
  const GLYPH = {
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.6 3.6 5.6 3.6 8.5s-1 5.9-3.6 8.5c-2.6-2.6-3.6-5.6-3.6-8.5s1-5.9 3.6-8.5z"/>',
    spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6.2 6.2l2.6 2.6M15.2 15.2l2.6 2.6M17.8 6.2l-2.6 2.6M8.8 15.2l-2.6 2.6"/>',
    anchor: '<circle cx="12" cy="5.5" r="2"/><path d="M12 7.5V20M7.5 11h9M4.5 13.5c0 4 3.4 6.5 7.5 6.5s7.5-2.5 7.5-6.5"/>',
    pulse: '<path d="M3 12h4l2.2-5.5L13 18l2.6-6H21"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    chip: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/><rect x="10" y="10" width="4" height="4" rx=".6"/>',
    shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.3-4.4"/>',
    flag: '<path d="M5.5 21V4M5.5 4.5h11.5l-2.4 4 2.4 4H5.5"/>',
    blade: '<path d="M14.5 3.5l6 6-9.5 9.5-6-6zM5 13l-1.5 7.5L11 19M11.5 7l5.5 5.5"/>',
    gauge: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/><circle cx="12" cy="16" r="1.4"/>',
    crown: '<path d="M3.5 8l4.3 3.8L12 5l4.2 6.8L20.5 8l-1.8 10.5H5.3z"/><path d="M5.5 21h13"/>',
  };
  const VCOL = { strong_buy: [51, 214, 159], buy: [51, 214, 159], hold: [170, 176, 200], avoid: [255, 107, 129], strong_avoid: [255, 107, 129] };
  const VA = { strong_buy: 1, buy: .62, hold: .38, avoid: .62, strong_avoid: 1 };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

  let stage, cv, ctx, seatsEl, tip, W = 0, H = 0, dpr = 1;
  let seats = {}, order = [], dots = [], byT = {}, sectors = [], beams = [], flows = [], stars = [];
  let finalSet = null, hover = null, now = 0, onHover = null;

  function init({ stageEl, canvas, seatsBox, seatDefs, officerDefs, universe, hover: hoverFn }) {
    stage = stageEl; cv = canvas; ctx = cv.getContext('2d'); seatsEl = seatsBox; onHover = hoverFn;
    // Fixed places: red team bottom left, the seats over the top, risk bottom right, the chair in the middle.
    order = ['vex', 'atlas', 'nova', 'anchor', 'pulse', 'raven', 'forge', 'harbor', 'scout', 'sentinel'];
    const defs = { ...seatDefs, ...officerDefs };
    for (const k of [...order, 'arbiter']) {
      const d = defs[k]; if (!d) continue;
      const el = document.createElement('div');
      el.className = 'seat absent' + (k === 'arbiter' ? ' chair' : '');
      el.style.setProperty('--c', d.color);
      el.innerHTML = `<div class="seat-status"></div><div class="bubble"></div><div class="orb"><svg viewBox="0 0 24 24">${GLYPH[d.glyph] || ''}</svg></div><div class="seat-label"><b>${d.name}</b><span>${d.role}</span></div>`;
      el.title = `${d.name}, ${d.role}\n\n${d.mandate || ''}`;
      seatsEl.appendChild(el);
      seats[k] = { k, d, el, rgb: hex(d.color), x: 0, y: 0, state: 'idle', present: false, bubbleT: null };
    }
    // Universe, in sector order, as it is listed.
    const secs = [];
    universe.forEach((u) => { let s = secs.find((x) => x.name === u.s); if (!s) secs.push(s = { name: u.s, list: [] }); s.list.push(u); });
    sectors = secs;
    secs.forEach((s) => s.list.forEach((u) => { const d = { t: u.t, n: u.n, s: u.s, k: u.k, v: null, reading: 0, w: 0, x: 0, y: 0, a: 0, flash: 0 }; dots.push(d); byT[u.t] = d; }));
    for (let i = 0; i < 90; i++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.1 + .2, p: Math.random() * 6.28, s: .2 + Math.random() * .8 });
    new ResizeObserver(layout).observe(stage);
    cv.addEventListener('mousemove', move); cv.addEventListener('mouseleave', () => { hover = null; onHover?.(null); });
    layout(); requestAnimationFrame(frame);
  }

  function layout() {
    const r = stage.getBoundingClientRect(); W = r.width; H = r.height; dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = W / 2, cy = H * 0.47;
    const RX = Math.min(W * 0.425, H * 0.8), RY = Math.min(H * 0.425, RX * 0.74);
    // Ring: a gap at the bottom where the floor sits.
    const gap = 1.0, a0 = Math.PI / 2 + gap / 2, span = Math.PI * 2 - gap, secGap = 0.035;
    const n = dots.length, step = (span - secGap * (sectors.length - 1)) / (n - 1);
    let a = a0, i = 0;
    sectors.forEach((s, si) => {
      s.a0 = a;
      s.list.forEach((u) => { const d = byT[u.t]; d.a = a; d.x = cx + Math.cos(a) * RX; d.y = cy + Math.sin(a) * RY; a += step; i++; });
      s.a1 = a - step; a += secGap;
    });
    Object.assign(layout, { cx, cy, RX, RY });
    // Seats on an inner ellipse, leaving the bottom open.
    const sx = RX * 0.7, sy = RY * 0.7, g0 = Math.PI / 2 + 0.78, g1 = Math.PI / 2 + Math.PI * 2 - 0.78;
    order.forEach((k, j) => {
      const s = seats[k]; if (!s) return;
      const t = g0 + (g1 - g0) * (j / (order.length - 1));
      s.x = cx + Math.cos(t) * sx; s.y = cy + Math.sin(t) * sy;
      place(s, Math.cos(t), Math.sin(t));
    });
    const c = seats.arbiter; c.x = cx; c.y = cy - 6; place(c, 0, -1);
  }
  function place(s, dx, dy) {
    s.el.style.left = s.x + 'px'; s.el.style.top = s.y + 'px';
    s.el.classList.remove('left', 'right', 'top', 'bottom');
    s.el.classList.add(s.k === 'arbiter' ? 'top' : Math.abs(dx) > 0.35 ? (dx < 0 ? 'right' : 'left') : dy < 0 ? 'bottom' : 'top');
  }

  function move(e) {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 12 * 12;
    for (const d of dots) { const q = (d.x - x) ** 2 + (d.y - y) ** 2; if (q < bd) { bd = q; best = d; } }
    if (best !== hover) { hover = best; onHover?.(best, best && { x: best.x, y: best.y }); }
    cv.style.cursor = best ? 'pointer' : '';
  }

  /* ── Drawing ── */
  function frame(t) {
    now = t;
    ctx.clearRect(0, 0, W, H);
    const { cx, cy, RX, RY } = layout;
    // stars
    for (const s of stars) { const a = .12 + .12 * Math.sin(t / 1000 * s.s + s.p); ctx.fillStyle = `rgba(200,210,255,${a})`; ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 6.283); ctx.fill(); }
    // floor ellipses
    ctx.save(); ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, RX * 0.7, RY * 0.7, 0, 0, 6.283); ctx.stroke();
    ctx.setLineDash([2, 6]); ctx.beginPath(); ctx.ellipse(0, 0, RX * 0.9, RY * 0.9, 0, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
    // chair halo
    const live = Object.values(seats).some((s) => s.state === 'speaking' || s.state === 'thinking');
    const hr = 130 + 6 * Math.sin(t / 900);
    const g = ctx.createRadialGradient(0, -6, 10, 0, -6, hr);
    g.addColorStop(0, `rgba(255,215,106,${live ? .16 : .08})`); g.addColorStop(1, 'rgba(255,215,106,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -6, hr, 0, 6.283); ctx.fill();
    ctx.rotate(t / 9000); ctx.strokeStyle = 'rgba(255,215,106,.18)'; ctx.setLineDash([1, 9]); ctx.beginPath(); ctx.arc(0, -6, 78, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();

    // sector labels
    ctx.font = '600 9.5px Inter, Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const s of sectors) {
      const a = (s.a0 + s.a1) / 2, x = cx + Math.cos(a) * (RX + 26), y = cy + Math.sin(a) * (RY + 20);
      const lab = s.name.toUpperCase(), hw = ctx.measureText(lab).width / 2 + 6;
      ctx.fillStyle = 'rgba(160,168,196,.45)'; ctx.fillText(lab, Math.max(hw, Math.min(W - hw, x)), y);
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.ellipse(cx, cy, RX + 10, RY + 9, 0, s.a0 - .006, s.a1 + .006); ctx.stroke();
    }

    // beams from seats to the names they back
    ctx.lineCap = 'round';
    for (const b of beams) {
      const s = seats[b.seat], d = byT[b.t]; if (!s || !d) continue;
      const p = ease((t - b.born) / 900), fade = b.dying ? Math.max(0, 1 - (t - b.dying) / 700) : 1;
      if (fade <= 0) continue;
      const mx = (s.x + d.x) / 2 + (cx - (s.x + d.x) / 2) * 0.35, my = (s.y + d.y) / 2 + (cy - (s.y + d.y) / 2) * 0.35;
      const [r, gg, bb] = s.rgb, a = (b.gold ? .5 : .1 + Math.min(.32, b.w / 40)) * fade;
      ctx.strokeStyle = `rgba(${r},${gg},${bb},${a})`; ctx.lineWidth = b.gold ? 1.2 + b.w / 8 : .7 + b.w / 12;
      ctx.beginPath(); ctx.moveTo(s.x, s.y);
      if (p >= 1) ctx.quadraticCurveTo(mx, my, d.x, d.y);
      else { const N = 18; for (let i = 1; i <= Math.ceil(N * p); i++) { const u = Math.min(p, i / N); ctx.lineTo((1 - u) ** 2 * s.x + 2 * (1 - u) * u * mx + u * u * d.x, (1 - u) ** 2 * s.y + 2 * (1 - u) * u * my + u * u * d.y); } }
      ctx.stroke();
      if (p < 1) { const u = p; ctx.fillStyle = `rgba(${r},${gg},${bb},.9)`; ctx.beginPath(); ctx.arc((1 - u) ** 2 * s.x + 2 * (1 - u) * u * mx + u * u * d.x, (1 - u) ** 2 * s.y + 2 * (1 - u) * u * my + u * u * d.y, 2.2, 0, 6.283); ctx.fill(); }
    }
    beams = beams.filter((b) => !b.dying || t - b.dying < 700);

    // speech flowing to the chair
    for (const s of Object.values(seats)) if (s.state === 'speaking' && s.k !== 'arbiter' && Math.random() < .35) flows.push({ s, born: t, j: (Math.random() - .5) * 40 });
    const c = seats.arbiter;
    flows = flows.filter((f) => t - f.born < 1400);
    for (const f of flows) {
      const u = (t - f.born) / 1400, [r, gg, bb] = f.s.rgb;
      const x = f.s.x + (c.x - f.s.x) * u + Math.sin(u * 3.14) * f.j, y = f.s.y + (c.y - f.s.y) * u + Math.cos(u * 3.14) * f.j * .4;
      ctx.fillStyle = `rgba(${r},${gg},${bb},${.6 * Math.sin(u * 3.14)})`; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 6.283); ctx.fill();
    }

    // the universe
    for (const d of dots) {
      let col = [120, 128, 156], a = .32, rad = 2.6;
      if (d.v) { col = VCOL[d.v]; a = VA[d.v]; rad = d.v.startsWith('strong') ? 3.6 : 3; }
      if (d.reading) { const k = .5 + .5 * Math.sin(t / 160 + d.a * 9); col = [91, 140, 255]; a = .45 + .5 * k; rad = 3 + k; }
      if (finalSet) { if (d.w > 0) { col = [255, 215, 106]; a = 1; rad = 4 + Math.min(5, d.w / 3); } else a *= .45; }
      if (d.flash) { const k = Math.max(0, 1 - (t - d.flash) / 900); if (k > 0 && k <= 1) { ctx.fillStyle = `rgba(${col},${.35 * k})`; ctx.beginPath(); ctx.arc(d.x, d.y, rad + 9 * (1 - k) + 2, 0, 6.283); ctx.fill(); } }
      if (finalSet && d.w > 0) { const gl = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, rad * 3.2); gl.addColorStop(0, 'rgba(255,215,106,.45)'); gl.addColorStop(1, 'rgba(255,215,106,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(d.x, d.y, rad * 3.2, 0, 6.283); ctx.fill(); }
      ctx.fillStyle = `rgba(${col},${a})`; ctx.beginPath(); ctx.arc(d.x, d.y, d === hover ? rad + 2 : rad, 0, 6.283); ctx.fill();
      if (finalSet && d.w > 0) {
        const ox = Math.cos(d.a), oy = Math.sin(d.a);
        ctx.font = '600 10.5px Outfit, Inter, sans-serif'; ctx.fillStyle = 'rgba(255,229,160,.95)';
        ctx.textAlign = ox > .3 ? 'left' : ox < -.3 ? 'right' : 'center';
        ctx.fillText(d.t, d.x - ox * (rad + 16), d.y - oy * (rad + 12));
      }
    }
    if (hover) {
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hover.x, hover.y, 8, 0, 6.283); ctx.stroke();
    }
    requestAnimationFrame(frame);
  }

  /* ── Public ── */
  const API = {
    init,
    reset() {
      for (const s of Object.values(seats)) API.seat(s.k, 'idle');
      for (const d of dots) { d.v = null; d.reading = 0; d.w = 0; }
      beams = []; finalSet = null;
    },
    present(keys) { for (const s of Object.values(seats)) { s.present = keys.includes(s.k); s.el.classList.toggle('absent', !s.present); } },
    allPresent() { for (const s of Object.values(seats)) { s.present = true; s.el.classList.remove('absent'); } },
    seat(k, state, status) {
      const s = seats[k]; if (!s) return;
      s.state = state;
      s.el.classList.remove('thinking', 'speaking', 'done', 'failed');
      if (state !== 'idle') s.el.classList.add(state);
      s.el.querySelector('.seat-status').textContent = status || { thinking: 'thinking', speaking: 'speaking', done: 'done', failed: 'no answer' }[state] || '';
      if (state === 'idle') API.bubble(k, '');
    },
    bubble(k, text, hold = 0) {
      const s = seats[k]; if (!s) return;
      const b = s.el.querySelector('.bubble');
      clearTimeout(s.bubbleT);
      if (!text) { b.classList.remove('on'); return; }
      b.textContent = text.length > 230 ? '…' + text.slice(-230) : text; b.classList.add('on');
      if (hold) s.bubbleT = setTimeout(() => b.classList.remove('on'), hold);
    },
    reading(tickers, on) { for (const t of tickers) if (byT[t]) byT[t].reading = on ? 1 : 0; },
    verdict(t, v) { const d = byT[t]; if (!d) return; d.v = v || null; d.reading = 0; d.flash = now; },
    beams(seat, picks) {
      for (const b of beams) if (b.seat === seat && !b.dying) b.dying = now;
      picks.forEach((p, i) => { if (byT[p.ticker]) { beams.push({ seat, t: p.ticker, w: +p.weight || 0, born: now + i * 60 }); byT[p.ticker].flash = now + i * 60; } });
    },
    final(holdings) {
      for (const b of beams) if (!b.dying) b.dying = now;
      finalSet = new Set(holdings.map((h) => h.ticker));
      for (const d of dots) d.w = 0;
      holdings.forEach((h, i) => { const d = byT[h.ticker]; if (!d) return; d.w = h.weight; d.flash = now + i * 90; beams.push({ seat: 'arbiter', t: h.ticker, w: h.weight, born: now + 300 + i * 90, gold: true }); });
    },
    clearFinal() { finalSet = null; for (const b of beams) if (!b.dying) b.dying = now; },
    seatPos(k) { const s = seats[k]; return s && { x: s.x, y: s.y }; },
    glyph: (g) => GLYPH[g] || '',
  };
  window.Chamber = API;
})();
