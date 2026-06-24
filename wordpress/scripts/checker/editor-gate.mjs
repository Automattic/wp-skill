import { chromium } from 'playwright';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Browser discovery, in order: Playwright's bundled/cached Chromium, then system Chrome, then a
// system Chromium channel, then chrome-headless-shell (Playwright's cached headless shell — what a
// prior `playwright install` often leaves behind). Don't run `npx playwright install` first — it errors on some newer OSes
// (e.g. Ubuntu 26.04) and a bundled/cached build is usually already present. On total failure, say
// exactly what was tried so a failed *install* is never mistaken for a failed *gate*.
async function launchBrowser() {
  try { return await chromium.launch(); }
  catch (bundled) {
    for (const channel of ['chrome', 'chromium', 'chrome-headless-shell']) {
      try { return await chromium.launch({ channel }); } catch {}
    }
    throw new Error(
      'Could not launch a browser for the editor gate. Tried Playwright\'s bundled/cached Chromium ('
      + String(bundled.message || bundled).split('\n')[0] + ') and system channels chrome/chromium/chrome-headless-shell. '
      + 'Install Google Chrome (or `npx playwright install chromium`, which is unsupported on some '
      + 'OSes such as Ubuntu 26.04 — prefer system Chrome there). A failed browser install is not a '
      + 'failed gate: if a bundled/cached Chromium already exists, this should not be reached.'
    );
  }
}

const [,, baseUrl, themeDir] = process.argv;
const files = [];
for (const sub of ['templates', 'parts']) {
  try { for (const f of readdirSync(join(themeDir, sub))) if (f.endsWith('.html')) files.push(join(themeDir, sub, f)); } catch {}
}
const browser = await launchBrowser();
const page = await browser.newPage();
await page.goto(baseUrl + '/wp-admin/post-new.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.wp && wp.blocks && wp.blocks.parse && wp.data', null, { timeout: 30000 });
let bad = 0; const seen = [];
const CANON_MAX = 1500; // cap inline canonical output so a huge item doesn't flood the log
const check = async (label, markup) => {
  const res = await page.evaluate((m) => {
    const blocks = wp.blocks.parse(m);
    const flat = []; const walk = (bs) => bs.forEach(b => { flat.push({ name: b.name, valid: b.isValid !== false }); walk(b.innerBlocks || []); });
    walk(blocks);
    const anyBad = flat.some(b => !b.valid || b.name === 'core/missing');
    // Serialize the canonical form (what the editor expects) only when something is invalid —
    // the diff against your file IS the fix, saving a separate canonicalize.mjs round-trip.
    return { flat, canonical: anyBad ? wp.blocks.serialize(blocks) : null };
  }, markup);
  let labelBad = false;
  for (const b of res.flat) if (!b.valid || b.name === 'core/missing') { bad++; labelBad = true; console.log(`INVALID ${label} -> ${b.name}`); }
  if (labelBad && res.canonical) {
    const c = res.canonical.trim();
    const shown = c.length > CANON_MAX ? c.slice(0, CANON_MAX) + '\n…[truncated — run canonicalize.mjs on this file for the full form]' : c;
    console.log(`  canonical markup the editor expects for ${label} (diff against your file):`);
    for (const line of shown.split('\n')) console.log('    ' + line);
  }
  seen.push(label);
};
for (const f of files) await check(f.split('/').slice(-2).join('/'), readFileSync(f, 'utf8'));
// patterns: take the SERVER-RENDERED content from the editor's registry (inline PHP executed)
const patterns = await page.evaluate(async () => {
  const ps = await wp.data.resolveSelect('core').getBlockPatterns();
  return ps.filter(p => (p.name || '').includes('/')).map(p => ({ name: p.name, content: p.content }));
});
const slug = JSON.parse(readFileSync(join(themeDir, 'theme.json'), 'utf8'));
for (const p of patterns) {
  if (!/^core\//.test(p.name) && p.content) await check(`pattern:${p.name}`, p.content);
}
console.log(bad === 0 ? `GATE PASS (${seen.length} items)` : `GATE FAIL: ${bad} invalid across ${seen.length} items`);
await browser.close();
