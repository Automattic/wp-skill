import { chromium } from 'playwright';
import path from 'node:path';

// visual-gate.mjs — batch full-page screenshots across paths × viewports, with blank/HTTP checks.
//
// Wraps the same capture shot.mjs does, but for a whole site in one call: predictable filenames,
// desktop + mobile by default, and a non-zero exit if any page 404s/errors or renders blank (so a
// silently broken route doesn't slip past a "looks fine" desktop-only pass). Playwright handles
// Playground's session cookie automatically, same as shot.mjs.
//
// Usage:
//   node visual-gate.mjs <baseUrl> [--paths /,/journal/,/about/] [--viewports desktop,mobile] [--out <dir>]
// Defaults: --paths /  --viewports desktop,mobile  --out .
//   desktop = 1280×900, mobile = 390×844 (the two viewports design.md asks for).

const VIEWPORTS = { desktop: [1280, 900], mobile: [390, 844] };

async function launchBrowser() {
  try { return await chromium.launch(); }
  catch (bundled) {
    for (const channel of ['chrome', 'chromium', 'chrome-headless-shell']) {
      try { return await chromium.launch({ channel }); } catch {}
    }
    throw new Error(
      'Could not launch a browser for the visual gate. Tried Playwright\'s bundled/cached Chromium ('
      + String(bundled.message || bundled).split('\n')[0] + ') and system channels chrome/chromium/'
      + 'chrome-headless-shell. Install Google Chrome (or `npx playwright install chromium`, '
      + 'unsupported on some OSes such as Ubuntu 26.04 — prefer system Chrome there).'
    );
  }
}

const argv = process.argv.slice(2);
const baseUrl = argv[0];
if (!baseUrl || baseUrl.startsWith('--')) {
  console.error('Usage: visual-gate.mjs <baseUrl> [--paths /,/a/,/b/] [--viewports desktop,mobile] [--out <dir>]');
  process.exit(2);
}
const flag = (name, def) => { const i = argv.indexOf(name); return i === -1 ? def : argv[i + 1]; };
const paths = flag('--paths', '/').split(',').map(s => s.trim()).filter(Boolean);
const viewports = flag('--viewports', 'desktop,mobile').split(',').map(s => s.trim()).filter(Boolean);
const outDir = flag('--out', '.');

for (const vp of viewports) {
  if (!VIEWPORTS[vp]) { console.error(`unknown viewport "${vp}" — known: ${Object.keys(VIEWPORTS).join(', ')}`); process.exit(2); }
}

// '/' -> 'home', '/journal/' -> 'journal', '/a/b/' -> 'a-b'
const slug = (p) => p.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'home';

const browser = await launchBrowser();
let failures = 0, shots = 0;
for (const vp of viewports) {
  const [w, h] = VIEWPORTS[vp];
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  // Reduced motion → scroll-reveal sections (motion.css `.reveal-on-scroll`) render at full
  // opacity in the full-page capture, so a motion theme isn't shot mid-reveal and read as blank.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const p of paths) {
    const url = new URL(p, baseUrl).toString();
    const file = path.join(outDir, `visual-${slug(p)}-${vp}.png`);
    let status = 0, navErr = null;
    try { const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); status = resp ? resp.status() : 0; }
    catch (e) { navErr = String(e.message || e).split('\n')[0]; }
    if (navErr) { console.log(`FAIL  ${vp} ${p} — navigation error: ${navErr}`); failures++; continue; }
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => ({ text: (document.body?.innerText || '').trim().length, h: document.body?.scrollHeight || 0 }));
    await page.screenshot({ path: file, fullPage: true });
    shots++;
    const blank = m.text < 10 || m.h < 50;
    const bad = status >= 400 || blank;
    if (bad) failures++;
    console.log(`${bad ? 'FAIL' : 'ok  '}  ${vp} ${p} -> ${file}  (HTTP ${status}${blank ? ', BLANK' : ''})`);
  }
  await page.close();
}
await browser.close();
console.log(failures === 0 ? `VISUAL OK (${shots} shots)` : `VISUAL FAIL: ${failures} issue(s) across ${shots} shots`);
process.exit(failures === 0 ? 0 : 1);
