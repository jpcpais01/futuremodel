// Starts a private headless Edge and connects over its debugging port.
// puppeteer.launch can't be used here: this Edge's launcher exits with code 0 after handing off
// to a child process, which puppeteer reads as a failed start.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

async function openEdge(port = 9445, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pz_edge_'));
  spawn(EDGE, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, ...extra, 'about:blank'], { detached: true, stdio: 'ignore' }).unref();
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url + '/json/version');
      if (r.ok) return puppeteer.connect({ browserURL: url, defaultViewport: null });
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Edge did not open its debugging port');
}

module.exports = { openEdge };
