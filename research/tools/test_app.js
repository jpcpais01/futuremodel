// Drives the real page in Edge (or a running packaged app via CDP) and fails on any error.
// Usage: node tools/test_app.js [outDir]       |  node tools/test_app.js <outDir> --cdp=9333
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { openEdge } = require('./browser');
const out = process.argv[2] || path.join(process.env.TEMP, 'pz_shots');
const cdp = (process.argv.find(a => a.startsWith('--cdp=')) || '').split('=')[1];
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const checks = [];
const ok = (name, pass, extra = '') => { checks.push([name, pass]); console.log((pass ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

(async () => {
  const browser = cdp
    ? await puppeteer.connect({ browserURL: `http://127.0.0.1:${cdp}`, defaultViewport: null })
    : await openEdge(9445, ['--allow-file-access-from-files']);
  const page = globalThis.__page = cdp ? (await browser.pages())[0] : await browser.newPage();
  await page.bringToFront();
  // __watchdog: tells a frozen page apart from a stuck test tool.
  let stalls = 0; const dog = setInterval(async () => { const t0 = Date.now(); const r = await Promise.race([page.evaluate(() => 1).catch(() => 0), sleep(8000).then(() => 'stall')]); if (r === 'stall') { stalls++; console.log('PAGE STALL at', new Date().toISOString().slice(11, 19)); } }, 4000); globalThis.__dog = () => { clearInterval(dog); return stalls; };
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warn') errors.push('console.' + m.type() + ': ' + m.text()); });
  page.on('requestfailed', r => { const f = r.failure(); if (f && !/aborted/i.test(f.errorText)) errors.push('requestfailed: ' + r.url().slice(0, 90) + ' ' + f.errorText); });
  if (!cdp) {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto('file:///' + path.join(__dirname, '..', 'app', 'index.html').replace(/\\/g, '/'));
  } else {
    await page.reload({ waitUntil: 'load' });
    console.log('window', await page.evaluate(() => innerWidth + 'x' + innerHeight + ' hidden=' + document.hidden + ' title=' + document.title));
  }
  const shot = async n => { await sleep(1000); await page.screenshot({ path: path.join(out, n + '.png'), captureBeyondViewport: false }); };
  await page.waitForFunction(() => S.loaded, { timeout: 30000, polling: 500 });
  await page.waitForFunction(() => $$('#rail .tile').length > 1, { timeout: 10000, polling: 500 });
  await sleep(1500);
  const counts = await page.evaluate(() => ({ tiles: $$('#rail .tile').length, held: held().length, ws: S.ws }));
  ok('positions load', counts.held > 0, JSON.stringify(counts));
  await shot('01_home_core');

  // The app's P&L must equal an independent sum over raw positions.
  const math = await page.evaluate(async () => {
    const k = K();
    const manual = held().reduce((a, h) => { const q = S.pos[h.m], px = S.px[h.m] || q.mark; return a + q.szi * (px - q.entry) + q.real - q.fees + q.fund; }, 0);
    const hasOther = held().some(h => /XYZ100/.test(h.m));
    return { total: k.total, manual, hasOther, value: k.value, cost: k.cost };
  });
  ok('P&L is sum of positions', Math.abs(math.total - math.manual) < 1e-9 && !math.hasOther, JSON.stringify(math));

  // Browse with the keyboard and mouse.
  await page.evaluate(() => { window.__trace = []; const L = (...a) => __trace.push(Math.round(performance.now()) + ' ' + a.join(' ')); for (const ev of ['pointerdown', 'pointerup', 'wheel', 'keydown']) addEventListener(ev, e => L(ev, e.isTrusted, e.pointerType || '', e.clientX ?? '', e.clientY ?? '', e.key || '', e.deltaY ?? '', (e.target.id || e.target.className || e.target.tagName)), true); for (const n of ['choose', 'structure', 'go', 'layoutRail', 'pollPos']) { const o = window[n]; window[n] = function (...a) { L(n, JSON.stringify(a).slice(0, 30), 'sel=' + S.sel, 'held=' + held().length, new Error().stack.split('\n').slice(2, 6).map(x => x.trim().split(' ')[1]).join('<')); return o.apply(this, a); }; } });
  await page.evaluate(() => { window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => __lt.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }); });
  const t0 = Date.now();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => S.sel !== 'CORE', { timeout: 8000, polling: 50 }).catch(() => {});
  console.log('key latency', Date.now() - t0, 'ms');
  await sleep(900);
  const sel1 = await page.evaluate(() => S.sel);
  ok('arrow selects position', sel1 !== 'CORE', sel1);
  await page.waitForFunction(() => document.querySelector('#heroC')._ch, { timeout: 15000, polling: 500 });
  await shot('02_home_position');
  for (const r of ['1D', '1W', '3M', '6M', '1M']) { await page.click(`#ranges [data-r="${r}"]`); await sleep(1300); }
  const hasChart = await page.evaluate(() => !!document.querySelector('#heroC')._ch);
  ok('range chips draw a chart', hasChart);
  const box = await page.evaluate(() => { const r = $('#heroC').getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 }; });
  await page.evaluate(() => { window.__ml = []; $('#heroC').addEventListener('mouseleave', e => __ml.push('leave ' + e.clientX + ',' + e.clientY + ' to ' + (e.relatedTarget && (e.relatedTarget.id || e.relatedTarget.tagName)))); $('#heroC').addEventListener('mousemove', e => __ml.push('move ' + e.clientX + ',' + e.clientY)); });
  await page.mouse.move(box.x, box.y); await sleep(200);
  console.log('hover events', JSON.stringify(await page.evaluate(() => __ml)));
  await page.waitForFunction(() => !$('#heroC')._ch.busy, { timeout: 4000, polling: 50 });
  await page.mouse.move(box.x + 2, box.y); await sleep(200);
  ok('chart hover shows tip', await page.evaluate(() => +getComputedStyle($('#tip')).opacity > 0 && $('#tip').textContent.length > 5));
  await page.mouse.move(5, 300);
  await page.click('#ranges [data-r="1W"]'); await sleep(500);
  await page.keyboard.press('Enter'); await sleep(500);
  ok('Enter opens details after clicking a chip', await page.evaluate(() => $('#ov').classList.contains('on')), await page.evaluate(() => 'active=' + document.activeElement.tagName + ' sel=' + S.sel));
  await page.keyboard.press('Escape'); await sleep(300);
  await page.click('#ranges [data-r="1M"]'); await sleep(900);
  await page.click('#infoD'); await sleep(700);
  ok('details opens', await page.evaluate(() => $('#ov').classList.contains('on') && !!$('#sheet h3')));
  await shot('03_details');
  await page.keyboard.press('Escape'); await sleep(300);
  ok('Esc closes details', await page.evaluate(() => !$('#ov').classList.contains('on')));
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
  await sleep(700);
  const end = await page.evaluate(() => { const it = railItems(); return it[it.length - 1] === S.sel; });
  ok('browse stops at last tile', end);
  await shot('04_home_last');
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowLeft');
  await sleep(700);
  ok('browse returns to Core', await page.evaluate(() => S.sel === 'CORE'));

  // Carousel: wheel, drag, click, and smoothness while spinning fast.
  await page.mouse.move(700, 500);
  await page.evaluate(() => { window.__fr = []; let l = performance.now(); const f = n => { __fr.push(n - l); l = n; if (__fr.length < 400) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  for (let i = 0; i < 12; i++) { await page.mouse.wheel({ deltaY: 110 }); await sleep(45); }
  await sleep(700);
  const spin = await page.evaluate(() => { const a = __fr.slice(2, 60).sort((x, y) => x - y); return { sel: S.sel, index: R.items.indexOf(S.sel), settled: R.pos === R.target && Number.isInteger(R.pos), med: a[a.length >> 1], p95: a[Math.floor(a.length * .95)] }; });
  ok('wheel spins through tiles and snaps', spin.index === 12 && spin.settled, JSON.stringify(spin));
  ok('fast scroll stays smooth', spin.p95 < 34, 'p95 frame ' + spin.p95.toFixed(1) + 'ms');
  await page.mouse.move(655, 130); await page.mouse.down(); await page.mouse.move(475, 130, { steps: 6 }); await page.mouse.move(305, 130, { steps: 6 }); await sleep(120); await page.mouse.up(); await sleep(700);
  const dragged = await page.evaluate(() => railItems().indexOf(S.sel));
  ok('drag moves the rail', dragged !== spin.index, 'index ' + dragged);
  ok('drag did not open details', await page.evaluate(() => !$('#ov').classList.contains('on')));
  await page.evaluate(() => step(-5)); await sleep(700);
  const onebox = await page.evaluate(() => { const e = R.els[R.items.indexOf(S.sel) + 1].getBoundingClientRect(); return { x: e.x + e.width / 2, y: e.y + e.height / 2 }; });
  const b4 = await page.evaluate(() => S.sel); await page.mouse.click(onebox.x, onebox.y); await sleep(600);
  ok('clicking a tile selects it', await page.evaluate(b => S.sel !== b, b4));
  await page.evaluate(() => step(-99)); await sleep(800);
  ok('logos fill their tile', await page.evaluate(() => $$('.tile .tface').every(f => { const r = f.getBoundingClientRect(), t = f.parentNode.getBoundingClientRect(); return Math.abs(r.width - t.width) < 1; })));
  await shot('04b_rail');
  const wide = await page.evaluate(() => { const bad = []; for (const n of R.items) { S.sel = n; renderInfo(); document.getAnimations().filter(a => a.animationName === 'fd').forEach(a => a.finish()); const e = $('#title'), b = $('#heroC').getBoundingClientRect(), r = document.createRange(); r.selectNodeContents(e); const t = r.getBoundingClientRect(), st = $('#info .right'); if (t.bottom > b.top || (st && t.right > st.getBoundingClientRect().left)) bad.push(n); } S.sel = 'CORE'; renderInfo(); return bad; });
  ok('no title reaches the chart', wide.length === 0, wide.join());

  // Every page.
  await page.keyboard.press('2'); await sleep(500);
  ok('holdings cards render', await page.evaluate(() => $$('#grid .card').length === held().length));
  await shot('05_holdings');
  await page.type('#q', 'nvd'); await sleep(300);
  ok('search filters', await page.evaluate(() => $$('#grid .card').length === 1));
  await page.evaluate(() => { $('#q').value = ''; $('#q').dispatchEvent(new Event('input')); $('#q').blur(); });
  await page.click('#roleChips [data-r="AI"]'); await sleep(200);
  ok('role filter', await page.evaluate(() => $$('#grid .card').length === held().filter(h => h.role === 'AI').length));
  await page.click('#roleChips [data-r="All"]');
  await page.click('#grid .card'); await sleep(700);
  ok('card opens on Home', await page.evaluate(() => S.page === 'home' && S.sel !== 'CORE'));
  await page.keyboard.press('3'); await sleep(600);
  await page.waitForFunction(() => document.querySelector('#perfC')._ch, { timeout: 60000, polling: 500 }).catch(() => {});
  ok('performance curve draws', await page.evaluate(() => !!$('#perfC')._ch));
  ok('curve never runs backward in time', await page.evaluate(() => perfSeries().every(s => s.p.every((q, i) => !i || q[0] >= s.p[i - 1][0]))));
  ok('leaders listed', await page.evaluate(() => $$('#lead .rw').length > 0 && $$('#lag .rw').length > 0));
  await shot('06_performance');
  await page.keyboard.press('4'); await sleep(500);
  await page.waitForFunction(() => PLAN.assets.every(a => S.daily[a[1]]), { timeout: 60000, polling: 500 }).catch(() => {});
  await sleep(400);
  ok('market board filled', await page.evaluate(() => PLAN.assets.every(a => S.daily[a[1]]) && $$('#board .mr').length === PLAN.assets.length));
  await page.click('#perChips [data-p="90"]'); await sleep(300);
  await shot('07_market');
  await page.keyboard.press('5'); await sleep(500);
  ok('countdown ticks', await page.evaluate(() => $$('#cd div').length === 4 || !nextBig()));
  await shot('08_outlook');
  await page.click('#rulesBtn'); await sleep(500);
  ok('rules open', await page.evaluate(() => $$('#sheet .rl').length === PLAN.rules.length));
  await page.keyboard.press('Escape'); await sleep(300);
  await page.click('#bell'); await sleep(400);
  ok('signals open', await page.evaluate(() => $('#pop').classList.contains('on')));
  await shot('09_signals');
  await page.mouse.click(600, 600); await sleep(300);
  ok('click-away closes signals', await page.evaluate(() => !$('#pop').classList.contains('on')));
  await page.click('#gear'); await sleep(500);
  await page.evaluate(() => { $('#adI').value = 'bad'; });
  await page.click('#adS'); await sleep(200);
  ok('invalid address rejected', await page.evaluate(() => $('#ov').classList.contains('on') && /^0x/.test(S.address)));
  await page.keyboard.press('Escape'); await sleep(300);
  await page.keyboard.press('Tab'); await sleep(300);
  ok('Tab cycles pages', await page.evaluate(() => S.page === 'home'));
  ok('rapid browsing left the queue clear', await page.evaluate(() => Q.length < 6), String(await page.evaluate(() => Q.length)));
  ok('API budget respected', await page.evaluate(() => used() <= 1200), String(await page.evaluate(() => used())));
  ok('no overlap of text and chart', await page.evaluate(() => { const i = $('#info').getBoundingClientRect(), c = $('#heroC').getBoundingClientRect(); return i.bottom <= c.top + 1; }));

  // Smallest window.
  if (!cdp) {
    await page.setViewport({ width: 1080, height: 660 });
    await sleep(700);
    await page.keyboard.press('ArrowRight'); await sleep(900);
    await shot('10_small_home');
    const overflow = await page.evaluate(() => { const i = $('#info').getBoundingClientRect(), r = $('#rail').getBoundingClientRect(); return { infoTop: i.top, railBottom: r.bottom }; });
    ok('info clears the tile row at min size', overflow.infoTop >= overflow.railBottom - 12, JSON.stringify(overflow));
    await page.keyboard.press('3'); await sleep(800); await shot('11_small_perf');
    await page.keyboard.press('5'); await sleep(600); await shot('12_small_outlook');
    await page.keyboard.press('4'); await sleep(600); await shot('13_small_market');
  }
  await sleep(500);
  console.log('long tasks ms', JSON.stringify(await page.evaluate(() => __lt)));
  const uniq = [...new Set(errors.filter(e => !/429/.test(e)))];
  if (errors.some(e => /429/.test(e))) console.log('note: API returned 429 during the run; the queue retried');
  ok('no console or page errors', uniq.length === 0, uniq.slice(0, 8).join(' | '));
  if (cdp) await browser.disconnect(); else await browser.close();
  console.log('page stalls', globalThis.__dog());
  const failed = checks.filter(c => !c[1]).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error('TEST CRASH', e.message); try { console.log('TRACE\n' + (await globalThis.__page.evaluate(() => (window.__trace || []).join('\n') + '\nsel=' + S.sel + ' pos=' + R.pos))); } catch {} process.exit(2); });
