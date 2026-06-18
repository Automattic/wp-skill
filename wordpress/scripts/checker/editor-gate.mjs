import { chromium } from 'playwright';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Prefer Playwright's bundled Chromium; if it isn't installed (e.g. `npx playwright install`
// was blocked by a sandboxed network), fall back to the system-installed Chrome.
async function launchBrowser() {
  try { return await chromium.launch(); }
  catch (e) {
    if (/Executable doesn't exist|playwright install/i.test(String(e))) return await chromium.launch({ channel: 'chrome' });
    throw e;
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
const check = async (label, markup) => {
  const res = await page.evaluate((m) => {
    const flat = []; const walk = (bs) => bs.forEach(b => { flat.push({ name: b.name, valid: b.isValid !== false }); walk(b.innerBlocks || []); });
    walk(wp.blocks.parse(m)); return flat;
  }, markup);
  for (const b of res) if (!b.valid || b.name === 'core/missing') { bad++; console.log(`INVALID ${label} -> ${b.name}`); }
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
