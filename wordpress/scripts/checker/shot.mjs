import { chromium } from 'playwright';

// Full-page screenshot at a given viewport width.
//   node shot.mjs <url> <out.png> [width=1280] [height=900]
// Browser discovery: bundled/cached Chromium, then system Chrome, then a Chromium channel — the
// same fallback the editor gate uses. Don't pre-run `npx playwright install` (unsupported on some
// newer OSes, e.g. Ubuntu 26.04, and usually unnecessary).
const [, , url, out, w = '1280', h = '900'] = process.argv;
if (!url || !out) { console.error('Usage: shot.mjs <url> <out.png> [width] [height]'); process.exit(2); }

async function launchBrowser() {
  try { return await chromium.launch(); }
  catch (bundled) {
    for (const channel of ['chrome', 'chromium']) {
      try { return await chromium.launch({ channel }); } catch {}
    }
    throw new Error(
      'Could not launch a browser for the screenshot. Tried Playwright\'s bundled/cached Chromium ('
      + String(bundled.message || bundled).split('\n')[0] + ') and system channels chrome/chromium. '
      + 'Install Google Chrome (or `npx playwright install chromium`, unsupported on some OSes such '
      + 'as Ubuntu 26.04 — prefer system Chrome there).'
    );
  }
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('shot ->', out);
