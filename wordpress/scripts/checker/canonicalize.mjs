import { chromium } from 'playwright';
import { readFileSync } from 'fs';

// canonicalize.mjs — ask the LIVE editor what a block's markup SHOULD be.
//
// The editor gate (editor-gate.mjs) tells you a block is INVALID but not what the
// correct markup is. This does: it parses/serializes against the running site's real
// block registry, so you can diff your markup against canonical and see the exact fix.
// Same browser-discovery + registry approach as editor-gate.mjs (bundled Chromium, then
// system Chrome). No dependencies beyond the checker's existing Playwright.
//
// Usage:
//   node canonicalize.mjs <baseUrl> <file.html|->            # canonicalize markup (file or stdin)
//   node canonicalize.mjs <baseUrl> --block <name> --attrs '<json>' [--inner '<markup>']
//
// Examples:
//   node canonicalize.mjs http://127.0.0.1:9400 patterns/hero.php
//   echo '<!-- wp:button {...} --><div ...>...</div><!-- /wp:button -->' | node canonicalize.mjs http://127.0.0.1:9400 -
//   node canonicalize.mjs http://127.0.0.1:9400 --block core/cover --attrs '{"url":"x.png","alt":"...","dimRatio":50}'
//
// Output: per-block validity (✓/✗), then the CANONICAL serialization. If your input
// differs from canonical, the diff is the bug — copy the canonical form.

async function launchBrowser() {
  try { return await chromium.launch(); }
  catch (e) {
    if (/Executable doesn't exist|playwright install/i.test(String(e))) return await chromium.launch({ channel: 'chrome' });
    throw e;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let d = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => (d += c));
    process.stdin.on('end', () => resolve(d));
  });
}

const argv = process.argv.slice(2);
const baseUrl = argv[0];
if (!baseUrl) {
  console.error('usage: node canonicalize.mjs <baseUrl> <file.html|-> | --block <name> --attrs <json> [--inner <markup>]');
  process.exit(2);
}
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
const blockName = flag('--block');

let markup;
if (blockName) {
  // build mode: turn name + attrs (+ optional inner markup) into canonical markup
  const attrs = JSON.parse(flag('--attrs') || '{}');
  const inner = flag('--inner') || '';
  markup = JSON.stringify({ __build: true, name: blockName, attrs, inner });
} else {
  const src = argv[1];
  if (!src) { console.error('provide a markup file, "-" for stdin, or --block'); process.exit(2); }
  markup = src === '-' ? await readStdin() : readFileSync(src, 'utf8');
}

const browser = await launchBrowser();
const page = await browser.newPage();
await page.goto(baseUrl + '/wp-admin/post-new.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.wp && wp.blocks && wp.blocks.parse && wp.blocks.serialize', null, { timeout: 30000 });

const out = await page.evaluate((payload) => {
  let blocks;
  try {
    const built = JSON.parse(payload);
    if (built && built.__build) {
      const inner = built.inner ? wp.blocks.parse(built.inner) : [];
      blocks = [wp.blocks.createBlock(built.name, built.attrs, inner)];
    } else { blocks = wp.blocks.parse(payload); }
  } catch { blocks = wp.blocks.parse(payload); }
  const flat = [];
  const walk = (bs) => bs.forEach(b => { flat.push({ name: b.name, valid: b.isValid !== false }); walk(b.innerBlocks || []); });
  walk(blocks);
  return { flat, canonical: wp.blocks.serialize(blocks) };
}, markup);

let bad = 0;
for (const b of out.flat) { const ok = b.valid && b.name !== 'core/missing'; if (!ok) bad++; console.log(`${ok ? '✓' : '✗ INVALID'}  ${b.name}`); }
console.log('\n--- CANONICAL (copy this) ---');
console.log(out.canonical.trim());
if (!blockName) {
  const same = out.canonical.trim() === String(markup).trim();
  console.log(same ? '\n(input already matches canonical)' : '\n(input DIFFERS from canonical — the diff above is your fix)');
}
await browser.close();
process.exit(bad === 0 ? 0 : 1);
