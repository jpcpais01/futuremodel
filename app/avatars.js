/* The council's faces. Every seat is a glass orb with its emblem and its own living signature:
   Atlas's orbits, Nova's starburst, Anchor's heavy ring, Pulse's waveform, Raven's iris, Forge's circuits,
   Harbor's shields, Scout's radar, Vex's blades, Sentinel's gauge and Arbiter's crown. Drawn on canvas every frame. */
'use strict';
const AV = (() => {
  const C = OazyEngine.C;
  const SEAT = { ...C.SEATS, ...C.OFFICERS };
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
  const svgOf = (g, stroke = '#fff', w = 1.7) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${GLYPH[g] || ''}</svg>`;
  const IMG = {};
  for (const k in SEAT) { const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgOf(SEAT[k].glyph)); IMG[k] = im; }
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const RGB = Object.fromEntries(Object.entries(SEAT).map(([k, s]) => [k, rgb(s.color)]));
  const col = (k, a) => { const c = RGB[k] || [255, 255, 255]; return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  const mix = (k, w, a) => { const c = RGB[k] || [255, 255, 255]; return `rgba(${Math.round(c[0] + (255 - c[0]) * w)},${Math.round(c[1] + (255 - c[1]) * w)},${Math.round(c[2] + (255 - c[2]) * w)},${a})`; };
  const TAU = Math.PI * 2;

  /* The signature motion of each seat, drawn around the orb. e: how alive (0 idle .. 1 speaking). */
  const SIG = {
    atlas(x, cx, cy, r, t, e, k) {
      x.lineWidth = Math.max(1, r * .035);
      for (let i = 0; i < 3; i++) {
        const ry = r * 1.5 * Math.abs(Math.cos(t * .55 + i * 1.05)) + r * .08;
        x.strokeStyle = col(k, .18 + .45 * e - i * .04);
        x.beginPath(); x.ellipse(cx, cy, r * 1.5, ry, i * Math.PI / 3 + t * .08, 0, TAU); x.stroke();
        const a = t * (1.1 + i * .3) + i * 2, px = cx + Math.cos(a) * r * 1.5, py = cy + Math.sin(a) * ry;
        const rot = i * Math.PI / 3 + t * .08, dx = px - cx, dy = py - cy;
        x.fillStyle = mix(k, .6, .5 + .5 * e); x.beginPath(); x.arc(cx + dx * Math.cos(rot) - dy * Math.sin(rot), cy + dx * Math.sin(rot) + dy * Math.cos(rot), r * .06, 0, TAU); x.fill();
      }
    },
    nova(x, cx, cy, r, t, e, k) {
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * TAU + t * .25, l = r * (1.22 + (.18 + .32 * e) * (.5 + .5 * Math.sin(t * 3.1 + i * 1.7)));
        x.strokeStyle = col(k, .2 + .55 * e * (i % 2 ? .6 : 1)); x.lineWidth = i % 2 ? r * .025 : r * .045;
        x.beginPath(); x.moveTo(cx + Math.cos(a) * r * 1.18, cy + Math.sin(a) * r * 1.18); x.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); x.stroke();
      }
      for (let i = 0; i < 5; i++) { const a = t * .7 + i * 1.256, d = r * (1.75 + .15 * Math.sin(t * 2 + i)), s = r * .05 * (.6 + .6 * Math.abs(Math.sin(t * 4 + i))); star(x, cx + Math.cos(a) * d, cy + Math.sin(a) * d, s, mix(k, .7, .4 + .5 * e)); }
    },
    anchor(x, cx, cy, r, t, e, k) {
      x.lineWidth = r * .11; x.lineCap = 'round';
      for (let i = 0; i < 4; i++) { const a0 = i * TAU / 4 + t * .12 + .18, a1 = a0 + TAU / 4 - .36; x.strokeStyle = col(k, .3 + .5 * e); x.beginPath(); x.arc(cx, cy, r * 1.38, a0, a1); x.stroke(); }
      x.lineWidth = r * .02; x.strokeStyle = col(k, .18 + .2 * e); x.beginPath(); x.arc(cx, cy, r * 1.6 + Math.sin(t * .8) * r * .03, 0, TAU); x.stroke(); x.lineCap = 'butt';
    },
    pulse(x, cx, cy, r, t, e, k) {
      for (let L = 0; L < 2; L++) {
        x.beginPath();
        for (let i = 0; i <= 120; i++) {
          const a = i / 120 * TAU, amp = r * (.05 + .16 * e) * (L ? .6 : 1);
          const rr = r * (1.38 + L * .14) + amp * Math.sin(a * 9 + t * (4 + L)) * Math.sin(a * 3 - t * 2.2);
          const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; i ? x.lineTo(px, py) : x.moveTo(px, py);
        }
        x.strokeStyle = col(k, (.25 + .55 * e) * (L ? .55 : 1)); x.lineWidth = r * (L ? .02 : .035); x.stroke();
      }
    },
    raven(x, cx, cy, r, t, e, k) {
      const ap = .55 + .45 * Math.sin(t * 1.2) ** 2;
      for (let i = 0; i < 28; i++) { const a = i / 28 * TAU - t * .1, l0 = r * 1.2, l1 = r * (1.3 + .28 * ap * (.6 + .4 * Math.sin(i * 2.3 + t))); x.strokeStyle = col(k, .18 + .5 * e); x.lineWidth = r * .022; x.beginPath(); x.moveTo(cx + Math.cos(a) * l0, cy + Math.sin(a) * l0); x.lineTo(cx + Math.cos(a) * l1, cy + Math.sin(a) * l1); x.stroke(); }
      x.strokeStyle = mix(k, .3, .45 + .45 * e); x.lineWidth = r * .05; x.lineCap = 'round';
      x.beginPath(); x.arc(cx, cy, r * 1.72, t * .5, t * .5 + 1.1); x.stroke(); x.beginPath(); x.arc(cx, cy, r * 1.72, t * .5 + Math.PI, t * .5 + Math.PI + .6); x.stroke(); x.lineCap = 'butt';
    },
    forge(x, cx, cy, r, t, e, k) {
      x.lineWidth = r * .03; x.lineJoin = 'round';
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU + Math.PI / 8, ca = Math.cos(a), sa = Math.sin(a), s1 = r * 1.2, s2 = r * 1.5;
        const p1 = [cx + ca * s1, cy + sa * s1], p2 = [cx + ca * s2, cy + sa * s2], p3 = [p2[0] + (i % 2 ? -sa : sa) * r * .35, p2[1] + (i % 2 ? ca : -ca) * r * .35];
        x.strokeStyle = col(k, .2 + .45 * e); x.beginPath(); x.moveTo(...p1); x.lineTo(...p2); x.lineTo(...p3); x.stroke();
        x.fillStyle = col(k, .5 + .5 * e); x.beginPath(); x.arc(p3[0], p3[1], r * .055, 0, TAU); x.fill();
        const f = (t * (.6 + e) + i * .37) % 1, q = f < .5 ? lerp2(p1, p2, f * 2) : lerp2(p2, p3, (f - .5) * 2);
        x.fillStyle = mix(k, .8, .4 + .6 * e); x.beginPath(); x.arc(q[0], q[1], r * .045, 0, TAU); x.fill();
      }
    },
    harbor(x, cx, cy, r, t, e, k) {
      for (let L = 0; L < 3; L++) { const R = r * (1.35 + L * .17), rot = (L % 2 ? -1 : 1) * t * (.18 + L * .05); x.strokeStyle = col(k, (.35 - L * .08) + .4 * e); x.lineWidth = r * (.045 - L * .01); x.beginPath(); for (let i = 0; i <= 6; i++) { const a = rot + i / 6 * TAU; i ? x.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R) : x.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); } x.stroke(); }
    },
    scout(x, cx, cy, r, t, e, k) {
      const a = t * 1.6, R = r * 1.75;
      for (let i = 0; i < 18; i++) { const b = a - i * .045; x.fillStyle = col(k, (.3 + .4 * e) * (1 - i / 18) * .5); x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, R, b - .05, b); x.closePath(); x.fill(); }
      x.strokeStyle = col(k, .25 + .35 * e); x.lineWidth = r * .025; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.stroke();
      x.beginPath(); x.arc(cx, cy, R * .78, 0, TAU); x.strokeStyle = col(k, .12 + .2 * e); x.stroke();
      for (let i = 0; i < 4; i++) { const ba = i * 1.9 + 1, br = R * (.85 + .1 * Math.sin(i * 7)), age = ((a - ba) % TAU + TAU) % TAU, f = Math.max(0, 1 - age / 2.4); if (f > 0) { x.fillStyle = mix(k, .6, f * (.5 + .5 * e)); x.beginPath(); x.arc(cx + Math.cos(ba) * br, cy + Math.sin(ba) * br, r * .07 * (1 + f), 0, TAU); x.fill(); } }
    },
    vex(x, cx, cy, r, t, e, k) {
      x.lineCap = 'round';
      for (let i = 0; i < 3; i++) { const a = t * (1.4 + e * 1.6) + i * TAU / 3; const g = x.createLinearGradient(cx + Math.cos(a) * r * 1.6, cy + Math.sin(a) * r * 1.6, cx + Math.cos(a + 1.2) * r * 1.6, cy + Math.sin(a + 1.2) * r * 1.6); g.addColorStop(0, col(k, 0)); g.addColorStop(1, col(k, .55 + .45 * e)); x.strokeStyle = g; x.lineWidth = r * .09; x.beginPath(); x.arc(cx, cy, r * 1.55, a, a + 1.2); x.stroke(); }
      for (let i = 0; i < 6; i++) { const a = t * 3 + i * 1.3, d = r * (1.75 + .25 * ((t * 1.5 + i * .3) % 1)); x.fillStyle = mix(k, .4, .6 * e * (1 - ((t * 1.5 + i * .3) % 1))); x.beginPath(); x.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * .04, 0, TAU); x.fill(); }
      x.lineCap = 'butt';
    },
    sentinel(x, cx, cy, r, t, e, k) {
      const a0 = Math.PI * .8, a1 = Math.PI * 2.2, R = r * 1.5;
      x.lineWidth = r * .05; x.strokeStyle = col(k, .14 + .1 * e); x.beginPath(); x.arc(cx, cy, R, a0, a1); x.stroke();
      for (let i = 0; i <= 24; i++) { const a = a0 + (a1 - a0) * i / 24, l = i % 4 ? .08 : .16; x.strokeStyle = col(k, (i % 4 ? .25 : .5) + .3 * e); x.lineWidth = r * .022; x.beginPath(); x.moveTo(cx + Math.cos(a) * (R + r * .06), cy + Math.sin(a) * (R + r * .06)); x.lineTo(cx + Math.cos(a) * (R + r * (.06 + l)), cy + Math.sin(a) * (R + r * (.06 + l))); x.stroke(); }
      const v = .5 + .32 * Math.sin(t * .9) + .08 * Math.sin(t * 3.7) * e, an = a0 + (a1 - a0) * v;
      x.strokeStyle = 'rgba(255,92,122,' + (.6 + .4 * e) + ')'; x.lineWidth = r * .045; x.beginPath(); x.arc(cx, cy, R, a0, an); x.stroke();
      x.fillStyle = '#fff'; x.beginPath(); x.arc(cx + Math.cos(an) * R, cy + Math.sin(an) * R, r * .07, 0, TAU); x.fill();
    },
    arbiter(x, cx, cy, r, t, e, k) {
      for (let i = 0; i < 24; i++) { const a = i / 24 * TAU + t * .05, l = r * (1.65 + .25 * (.5 + .5 * Math.sin(t * 1.3 + i))); const g = x.createLinearGradient(cx + Math.cos(a) * r * 1.2, cy + Math.sin(a) * r * 1.2, cx + Math.cos(a) * l, cy + Math.sin(a) * l); g.addColorStop(0, col(k, .32 * (.4 + e))); g.addColorStop(1, col(k, 0)); x.strokeStyle = g; x.lineWidth = r * .05; x.beginPath(); x.moveTo(cx + Math.cos(a) * r * 1.2, cy + Math.sin(a) * r * 1.2); x.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); x.stroke(); }
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU - t * .2; x.fillStyle = mix(k, .3, .45 + .5 * e); x.beginPath(); x.arc(cx + Math.cos(a) * r * 1.42, cy + Math.sin(a) * r * 1.42, r * (i % 3 ? .04 : .075), 0, TAU); x.fill(); }
    },
  };
  const lerp2 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  function star(x, px, py, s, c) { x.fillStyle = c; x.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, d = i % 2 ? s * .35 : s * 1.6; i ? x.lineTo(px + Math.cos(a) * d, py + Math.sin(a) * d) : x.moveTo(px + Math.cos(a) * d, py + Math.sin(a) * d); } x.closePath(); x.fill(); }

  /* st: { talk 0..1 (speaking), think 0..1, dim 0..1, ripples: [start times], done, failed } */
  function draw(x, k, cx, cy, r, t, st = {}) {
    if (r < 2) return;
    const talk = st.talk || 0, think = st.think || 0, dim = st.dim || 0, e = Math.min(1, .25 + talk * .75 + think * .45);
    x.save();
    x.globalAlpha = 1 - dim * .7;
    // aura
    const ga = x.createRadialGradient(cx, cy, r * .5, cx, cy, r * (2.4 + talk * .8));
    ga.addColorStop(0, col(k, .26 * e + .06)); ga.addColorStop(1, col(k, 0));
    x.fillStyle = ga; x.beginPath(); x.arc(cx, cy, r * (2.4 + talk * .8), 0, TAU); x.fill();
    // ripples while speaking
    for (const s0 of st.ripples || []) { const f = (t - s0) / 1.6; if (f < 0 || f > 1) continue; x.strokeStyle = col(k, .5 * (1 - f)); x.lineWidth = r * .03 * (1 - f) + .5; x.beginPath(); x.arc(cx, cy, r * (1.1 + f * 1.6), 0, TAU); x.stroke(); }
    // signature
    if (r > 9) (SIG[k] || SIG.anchor)(x, cx, cy, r, t + (k.charCodeAt(0) % 7), e, k);
    // thinking: a ring of travelling dots
    if (think > .01) { for (let i = 0; i < 3; i++) { const a = t * 2.4 + i * TAU / 3; x.fillStyle = `rgba(255,255,255,${.75 * think})`; x.beginPath(); x.arc(cx + Math.cos(a) * r * 1.98, cy + Math.sin(a) * r * 1.98, Math.max(1.2, r * .055), 0, TAU); x.fill(); } x.setLineDash([r * .08, r * .14]); x.lineDashOffset = -t * r * .6; x.strokeStyle = `rgba(255,255,255,${.22 * think})`; x.lineWidth = Math.max(.7, r * .015); x.beginPath(); x.arc(cx, cy, r * 1.98, 0, TAU); x.stroke(); x.setLineDash([]); }
    // the orb: dark glass with a lit edge
    const breathe = 1 + Math.sin(t * 1.6 + k.length) * .012 + talk * .04 * Math.sin(t * 9);
    const R = r * breathe;
    const g = x.createRadialGradient(cx - R * .35, cy - R * .45, R * .05, cx, cy, R);
    g.addColorStop(0, mix(k, .55, 1)); g.addColorStop(.32, col(k, .95)); g.addColorStop(.78, mix(k, -.0, .55)); g.addColorStop(1, 'rgba(8,9,16,.95)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fill();
    const inner = x.createRadialGradient(cx, cy + R * .55, R * .1, cx, cy + R * .3, R * 1.05); inner.addColorStop(0, 'rgba(5,6,12,0)'); inner.addColorStop(1, 'rgba(5,6,12,.55)');
    x.fillStyle = inner; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fill();
    x.strokeStyle = `rgba(255,255,255,${.22 + .3 * e})`; x.lineWidth = Math.max(1, R * .03); x.beginPath(); x.arc(cx, cy, R - x.lineWidth / 2, 0, TAU); x.stroke();
    // specular highlight
    const sp = x.createRadialGradient(cx - R * .38, cy - R * .5, 0, cx - R * .38, cy - R * .5, R * .55); sp.addColorStop(0, 'rgba(255,255,255,.55)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = sp; x.beginPath(); x.ellipse(cx - R * .3, cy - R * .45, R * .5, R * .32, -.5, 0, TAU); x.fill();
    // emblem
    const im = IMG[k]; if (im && im.complete) { const s = R * 1.02; x.globalAlpha = (1 - dim * .7) * (.85 + .15 * e); x.drawImage(im, cx - s / 2, cy - s / 2, s, s); }
    if (st.failed) { x.globalAlpha = .8; x.fillStyle = 'rgba(5,6,10,.6)'; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fill(); }
    x.restore();
  }

  const orb = (k, z) => { const d = SEAT[k] || { color: '#888', glyph: '' }; return `<span class="sorb" style="--c:${d.color}${z ? ';--z:' + z + 'px' : ''}"><svg viewBox="0 0 24 24">${GLYPH[d.glyph] || ''}</svg></span>`; };
  return { SEAT, GLYPH, draw, orb, col, svgOf };
})();
