// Renders Oazy Research's Library art into art/: cover.png, hero.png and logo.png.
// Follows Oazy's brand art: a glass orb on a dark tinted field with one thin line.
const fs = require('fs');
const path = require('path');
const { openEdge } = require('./browser');
const root = path.join(__dirname, '..');
const out = path.join(root, 'art');
fs.mkdirSync(out, { recursive: true });
const font = (w) => `@font-face{font-family:Outfit;font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(path.join(root, 'app', 'fonts', `Outfit-${w}.woff2`)).toString('base64')}) format("woff2")}`;
const CSS = `${font(500)}${font(700)}${font(800)}html,body{margin:0;background:transparent}`;

// The logo orb itself. Its file has a little margin for the halo, so it is drawn slightly oversize.
const orbUri = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'build', 'orb.png')).toString('base64');
const orb = (cx, cy, r) => `<image href="${orbUri}" x="${cx - r / 0.9}" y="${cy - r / 0.9}" width="${(r / 0.9) * 2}" height="${(r / 0.9) * 2}"/>`;

// Dark tinted field, soft glow behind the orb, dithered to keep gradients from banding.
const field = (w, h, x, y, reach) => `<defs>
  <radialGradient id="f1" gradientUnits="userSpaceOnUse" cx="${x}" cy="${y}" r="${reach}"><stop offset="0" stop-color="#1fbf8f" stop-opacity=".5"/><stop offset=".45" stop-color="#0d6f73" stop-opacity=".28"/><stop offset="1" stop-color="#07323a" stop-opacity="0"/></radialGradient>
  <radialGradient id="f2" gradientUnits="userSpaceOnUse" cx="${x + reach * 0.42}" cy="${y - reach * 0.34}" r="${reach * 0.6}"><stop offset="0" stop-color="#46d8ff" stop-opacity=".2"/><stop offset="1" stop-color="#3fc4ff" stop-opacity="0"/></radialGradient>
  <filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .07 0"/></filter>
</defs>
<rect width="${w}" height="${h}" fill="#07070f"/><rect width="${w}" height="${h}" fill="url(#f1)"/><rect width="${w}" height="${h}" fill="url(#f2)"/><rect width="${w}" height="${h}" filter="url(#n)"/>`;

(async () => {
  const browser = await openEdge(9449);
  const page = await browser.newPage();
  const render = async (file, w, h, body, transparent) => {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>${CSS}svg{display:block}</style>${body}`);
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 250));
    await page.screenshot({ path: path.join(out, file), omitBackground: !!transparent, type: 'png' });
    console.log(file, w + 'x' + h, fs.statSync(path.join(out, file)).size);
  };

  // Card: portrait, name under the orb.
  const CW = 840, CH = 1260;
  await render('cover.png', CW, CH, `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">${field(CW, CH, 420, 500, 860)}
    <path d="M-30 800C200 860 560 800 880 330" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="3"/>
    ${orb(420, 500, 300)}
    <text x="420" y="925" text-anchor="middle" font-family="Outfit" font-weight="800" font-size="104" fill="#fff" style="letter-spacing:-1.5px;filter:drop-shadow(0 6px 22px rgba(0,0,0,.55))">Oazy</text>
    <text x="420" y="1030" text-anchor="middle" font-family="Outfit" font-weight="500" font-size="82" fill="#fff" fill-opacity=".92" style="filter:drop-shadow(0 6px 22px rgba(0,0,0,.55))">Research</text>
  </svg>`);

  // Banner: wide, orb right of centre, left side quiet for Oazy's own text.
  const HW = 2880, HH = 1240;
  await render('hero.png', HW, HH, `<svg width="${HW}" height="${HH}" viewBox="0 0 ${HW} ${HH}" xmlns="http://www.w3.org/2000/svg">${field(HW, HH, 1960, 620, 1650)}
    <path d="M-40 1120C520 1130 760 900 1120 950S1500 760 1960 620 2600 150 2960 40" fill="none" stroke="#fff" stroke-opacity=".24" stroke-width="4"/>
    ${orb(1960, 620, 400)}
  </svg>`);

  // Logo: the mark and the name, transparent.
  const LW = 1120, LH = 300;
  await render('logo.png', LW, LH, `<svg width="${LW}" height="${LH}" viewBox="0 0 ${LW} ${LH}" xmlns="http://www.w3.org/2000/svg">
    ${orb(132, 150, 118)}
    <text x="272" y="194" font-family="Outfit" font-weight="800" font-size="124" fill="#fff" style="letter-spacing:-1.5px;filter:drop-shadow(0 4px 14px rgba(0,0,0,.55))" textLength="830" lengthAdjust="spacing"><tspan>Oazy</tspan><tspan font-weight="500" dx="26">Research</tspan></text>
  </svg>`, true);

  // Preview sheet, not shipped.
  const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(out, f)).toString('base64');
  const icon = orbUri;
  await page.setViewport({ width: 1500, height: 880, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><body style="margin:0;background:#16171f;padding:16px;display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:start"><img src="${b64('cover.png')}" height="600"><div><img src="${b64('hero.png')}" width="1060" style="display:block"><div style="display:flex;gap:18px;align-items:center;margin-top:16px"><img src="${b64('logo.png')}" width="560"></div><div style="display:flex;gap:18px;align-items:center;margin-top:12px">${[256, 128, 64, 48, 32, 24, 16].map((s) => `<img src="${icon}" width="${s}" height="${s}">`).join('')}</div></div></body>`);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(process.env.TEMP, 'oz', 'preview.png') });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
