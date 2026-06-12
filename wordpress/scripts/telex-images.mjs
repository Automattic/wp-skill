#!/usr/bin/env node
/**
 * telex-images.mjs — generate site images through the Telex images endpoint.
 *
 * Node 18+, zero dependencies (built-in fetch). Subcommands:
 *
 *   auth [--base-url <url>]   one-time login (RFC 8628 device flow). Prints a URL the USER
 *                             must open in their browser — relay it in chat, never auto-open.
 *   status                    who is logged in, token expiry warning, cheap validity check.
 *   generate --files <f...>   scan theme files for AI_IMAGE alt markers, generate each into
 *                             <theme>/assets/<name>.png, rewrite alts to human text.
 *   generate --prompt <p> --out <file.png> [--aspect <a>]   ad-hoc single image.
 *
 * Aspect words map square→1:1, landscape→16:9, portrait→9:16; the ratio strings
 * 1:1 | 4:3 | 3:4 | 9:16 | 16:9 pass through unchanged. Response is always PNG.
 *
 * Token: ${XDG_CONFIG_HOME:-~/.config}/wp-agent-skill/telex-auth.json (dir 700, file 600,
 * atomic write, perms verified on every read). NEVER printed; redacted from error output.
 *
 * Failure policy (per marker): endpoint failure (502/network) → write a deterministic
 * placeholder PNG at the right aspect so the site renders, KEEP the marker, continue the
 * batch, list failures at the end (generate resumes idempotently — placeholders are
 * detected and replaced on the next run; real images are skipped). 401 → print the re-auth
 * command and stop. 429 (forward-compat) → stop the batch, placeholder the rest, print
 * Retry-After/resets_at if present, never poll-retry. Quota is never enforced client-side.
 *
 * Exit codes: 0 = success/no-op; 1 = some images failed (placeholders written, resumable);
 * 2 = auth needed/failed.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const DEFAULT_BASE_URL = 'https://ai-w0.a8c.com/'; // staging; production is a config swap

const ASPECTS = { '1:1': [1024, 1024], '4:3': [1280, 896], '3:4': [896, 1280], '9:16': [768, 1408], '16:9': [1408, 768] };
const ASPECT_WORDS = { square: '1:1', landscape: '16:9', portrait: '9:16' };
const PLACEHOLDER_TAG = 'wp-agent-skill-placeholder';

// ---------- token store ----------

function tokenPath() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'wp-agent-skill', 'telex-auth.json');
}

function redact(msg, token) {
  let s = String(msg);
  if (token) s = s.split(token).join('<token redacted>');
  return s;
}

function verifyPerms(file) {
  // chmod, then VERIFY — on WSL DrvFs chmod silently no-ops, and a token file the whole
  // machine can read deserves a loud warning, not a silent pass.
  const dir = path.dirname(file);
  try { fs.chmodSync(dir, 0o700); } catch {}
  try { fs.chmodSync(file, 0o600); } catch {}
  const dmode = fs.statSync(dir).mode & 0o777;
  const fmode = fs.statSync(file).mode & 0o777;
  if (dmode !== 0o700 || fmode !== 0o600) {
    console.error(
      `WARNING: could not enforce permissions on ${file} (dir ${dmode.toString(8)}, file ${fmode.toString(8)}; ` +
      `want 700/600). On WSL this means the file lives on a Windows-mounted path that ignores chmod — ` +
      `your Telex token is readable by other local users. Move your home or XDG_CONFIG_HOME to the Linux filesystem.`
    );
  }
}

function saveToken(data) {
  const file = tokenPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = path.join(path.dirname(file), `.telex-auth.json.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  verifyPerms(file);
}

function loadToken() {
  const file = tokenPath();
  if (!fs.existsSync(file)) return null;
  verifyPerms(file);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function jwtClaims(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { return {}; }
}

function authHint() {
  const rel = path.relative(process.cwd(), process.argv[1]);
  const script = rel && !rel.startsWith('..') ? rel : process.argv[1];
  return `Run: node ${script} auth`;
}

// ---------- HTTP ----------

function apiUrl(base, p) { return new URL(p, base).toString(); }

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, headers: res.headers, json };
}

// ---------- placeholder PNG (deterministic, zero-dep) ----------

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function placeholderPng(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.alloc(1 + w * 3); // filter 0 + pixels
  for (let x = 0; x < w; x++) { row[1 + x * 3] = 0xd6; row[2 + x * 3] = 0xd2; row[3 + x * 3] = 0xcb; }
  const raw = Buffer.concat(Array(h).fill(row));
  const text = Buffer.from(`Software\0${PLACEHOLDER_TAG}`, 'latin1');
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', text),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function isPlaceholder(file) {
  try { return fs.readFileSync(file).includes(Buffer.from(PLACEHOLDER_TAG, 'latin1')); } catch { return false; }
}

function writeFileAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

// ---------- auth ----------

async function deviceFlowOnce(base) {
  const code = await postJson(apiUrl(base, '/auth/device/code'), {});
  if (code.status !== 200 || !code.json?.device_code) {
    throw new Error(`device code request failed (HTTP ${code.status})`);
  }
  const { device_code, verification_uri_complete, expires_in } = code.json;
  let interval = (code.json.interval || 5) * 1000;

  console.log('Open this URL in your browser to authorize (login is via WordPress.com):');
  console.log(`\n  ${verification_uri_complete}\n`);
  console.log(`Waiting for authorization (code expires in ${Math.round(expires_in / 60)} minutes)...`);

  const deadline = Date.now() + expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));
    const res = await postJson(apiUrl(base, '/auth/device/token'), { device_code });
    if (res.json?.access_token) return res.json;
    const err = res.json?.error;
    if (err === 'authorization_pending') continue;
    if (err === 'slow_down') { interval += 5000; continue; }
    if (err === 'expired_token') return { expired: true };
    if (err === 'access_denied') throw new Error('authorization was denied in the browser');
    throw new Error(`device token poll failed (HTTP ${res.status}: ${err || 'unknown error'})`);
  }
  return { expired: true };
}

async function cmdAuth(args) {
  let base = DEFAULT_BASE_URL;
  const i = args.indexOf('--base-url');
  if (i !== -1 && args[i + 1]) base = args[i + 1];
  if (!base.endsWith('/')) base += '/';

  let grant = await deviceFlowOnce(base);
  if (grant.expired) {
    console.log('The code expired before authorization. Issuing a fresh one (one retry)...');
    grant = await deviceFlowOnce(base);
    if (grant.expired) {
      console.error('The second code also expired. Treating this as a decline — re-run auth when ready.');
      process.exit(2);
    }
  }

  const claims = jwtClaims(grant.access_token);
  saveToken({
    access_token: grant.access_token,
    token_type: grant.token_type || 'Bearer',
    expires_at: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    telex_base_url: base,
    username: claims.data?.username || null,
  });
  console.log(`Authorized as ${claims.data?.username || 'unknown user'}. Token stored at ${tokenPath()} (never commit or print it).`);
}

// ---------- status ----------

function printQuota(json) {
  // The server has no quota today; surface the fields if it ever adds them. Display only —
  // the client never enforces quota.
  if (!json) return;
  const q = ['limit', 'used', 'remaining', 'resets_at'].filter(k => json[k] !== undefined);
  if (q.length) console.log('Quota: ' + q.map(k => `${k}=${json[k]}`).join(' '));
}

async function cmdStatus() {
  const tok = loadToken();
  if (!tok?.access_token) {
    console.log(`Not logged in (no token at ${tokenPath()}). ${authHint()}`);
    process.exit(2);
  }
  console.log(`Logged in as ${tok.username || 'unknown'} (server: ${tok.telex_base_url})`);
  if (tok.expires_at) {
    const days = Math.floor((Date.parse(tok.expires_at) - Date.now()) / 86400000);
    if (days < 0) console.log(`Token EXPIRED on ${tok.expires_at}. ${authHint()}`);
    else if (days < 30) console.log(`Token expires in ${days} days (${tok.expires_at}) — re-auth soon. ${authHint()}`);
    else console.log(`Token expires ${tok.expires_at}`);
  }
  // Cheap validity check: an EMPTY prompt is rejected with 400 only after auth passes,
  // so 400 = token valid at zero generation cost; 401 = invalid/revoked.
  try {
    const res = await postJson(apiUrl(tok.telex_base_url, '/api/v1/images/generate'),
      { prompt: '' }, { Authorization: `Bearer ${tok.access_token}` });
    if (res.status === 400) console.log('Token check: valid (server accepted authentication).');
    else if (res.status === 401) { console.log(`Token check: REJECTED (revoked or invalid). ${authHint()}`); process.exit(2); }
    else console.log(`Token check: unexpected HTTP ${res.status} — the endpoint may be down.`);
    printQuota(res.json);
  } catch (e) {
    console.log(`Token check: could not reach ${tok.telex_base_url} (${redact(e.message, tok.access_token)})`);
  }
}

// ---------- generate ----------

function normalizeAspect(raw, warnLabel) {
  const a = (raw || '').trim().toLowerCase();
  if (!a) return '16:9';
  if (ASPECT_WORDS[a]) return ASPECT_WORDS[a];
  if (ASPECTS[a]) return a;
  console.error(`  warning: unknown aspect "${raw}"${warnLabel ? ` in ${warnLabel}` : ''} — using 16:9`);
  return '16:9';
}

function buildPrompt(description, style) {
  const d = description.trim().replace(/\s+/g, ' ');
  const s = (style || '').trim();
  return s ? `${d}, ${s} style` : d; // no style param server-side: fold it into the prompt
}

async function generateOne(tok, prompt, aspect) {
  const res = await postJson(apiUrl(tok.telex_base_url, '/api/v1/images/generate'),
    { prompt, aspect }, { Authorization: `Bearer ${tok.access_token}` });
  if (res.status === 200 && res.json?.b64_json) return { ok: true, buf: Buffer.from(res.json.b64_json, 'base64') };
  return { ok: false, status: res.status, message: res.json?.message || '', headers: res.headers };
}

function findThemeRoot(file) {
  // theme root = nearest ancestor with style.css; fallback: the file's grandparent
  // (themes keep patterns/ and templates/ one level below the root).
  let dir = path.dirname(path.resolve(file));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'style.css'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.dirname(path.dirname(path.resolve(file)));
}

function scanMarkers(files) {
  // An AI_IMAGE marker is an <img> alt: alt="AI_IMAGE: description | style | aspect",
  // with the target filename in the same tag's src (assets/<name>.png). The tag regex
  // must swallow embedded PHP blocks: src="<?php echo … ?>" contains '>', so a naive
  // [^>]* would truncate the tag before the alt whenever src comes first.
  const jobs = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/<img\b(?:<\?php[\s\S]*?\?>|[^>])*>/g)) {
      const tag = m[0];
      const alt = tag.match(/alt="(AI_IMAGE:[^"]*)"/);
      if (!alt) continue;
      const parts = alt[1].replace(/^AI_IMAGE:/, '').split('|');
      const description = (parts[0] || '').trim();
      const style = (parts[1] || '').trim();
      const aspect = normalizeAspect(parts[2], file);
      const src = tag.match(/assets\/([a-z0-9-]+\.png)\b/);
      if (!description || !src) {
        jobs.push({ file, marker: alt[1], error: !description ? 'empty description' : 'no assets/<name>.png in src (lowercase a-z, 0-9, hyphens, .png)' });
        continue;
      }
      jobs.push({
        file, marker: alt[1], description, style, aspect,
        target: path.join(findThemeRoot(file), 'assets', src[1]),
      });
    }
  }
  return jobs;
}

function rewriteAlt(file, marker, humanAlt) {
  const text = fs.readFileSync(file, 'utf8');
  const escaped = humanAlt.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  fs.writeFileSync(file, text.split(`alt="${marker}"`).join(`alt="${escaped}"`));
}

async function cmdGenerate(args) {
  const tok = loadToken();
  if (!tok?.access_token) {
    console.error(`Not logged in. ${authHint()}`);
    process.exit(2);
  }
  const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };

  // ---- ad-hoc single image ----
  if (args.includes('--prompt')) {
    const prompt = get('--prompt'); const out = get('--out');
    if (!prompt || !out) { console.error('Usage: generate --prompt <text> --out <file.png> [--aspect <a>]'); process.exit(2); }
    const aspect = normalizeAspect(get('--aspect'));
    const res = await generateOne(tok, prompt, aspect);
    if (res.ok) { writeFileAtomic(out, res.buf); console.log(`Wrote ${out} (${aspect})`); return; }
    return reportHardFailure(res, [`${out} — HTTP ${res.status}`]);
  }

  // ---- batch over theme files ----
  const fi = args.indexOf('--files');
  const files = fi === -1 ? [] : args.slice(fi + 1).filter(a => !a.startsWith('--'));
  if (!files.length) { console.error('Usage: generate --files <theme files...>  (or --prompt/--out)'); process.exit(2); }

  const jobs = scanMarkers(files);
  if (!jobs.length) { console.log('No AI_IMAGE markers found — nothing to do.'); return; }

  const done = new Set(); const failures = [];
  let stopped = null;

  for (const job of jobs) {
    const label = `${path.basename(job.file)} -> ${job.target ? path.relative(process.cwd(), job.target) : '?'}`;
    if (job.error) { failures.push(`${label} — bad marker: ${job.error}`); continue; }

    if (stopped) { ensurePlaceholder(job, failures, `${label} — not attempted (${stopped})`); continue; }

    if (fs.existsSync(job.target) && !isPlaceholder(job.target) && !done.has(job.target)) {
      console.log(`skip (exists): ${label}`);
      rewriteAlt(job.file, job.marker, job.description);
      done.add(job.target);
      continue;
    }
    if (done.has(job.target)) { rewriteAlt(job.file, job.marker, job.description); continue; }

    process.stdout.write(`generating ${label} (${job.aspect}) ... `);
    let res;
    try { res = await generateOne(tok, buildPrompt(job.description, job.style), job.aspect); }
    catch (e) { res = { ok: false, status: 0, message: redact(e.message, tok.access_token) }; }

    if (res.ok) {
      writeFileAtomic(job.target, res.buf);
      rewriteAlt(job.file, job.marker, job.description);
      done.add(job.target);
      console.log('ok');
      continue;
    }
    console.log(`FAILED (HTTP ${res.status || 'network error'})`);
    if (res.status === 401) {
      console.error(`\nAuthentication rejected (token revoked or expired). ${authHint()}`);
      console.error('Stopping — markers and placeholders are kept; re-run generate after auth to resume.');
      stopped = 'stopped on 401';
      ensurePlaceholder(job, failures, `${label} — 401 auth rejected`);
      continue;
    }
    if (res.status === 429) {
      const retry = res.headers?.get?.('retry-after');
      const resets = res.json?.resets_at;
      console.error(`\nRate limited (429).${retry ? ` Retry-After: ${retry}.` : ''}${resets ? ` resets_at: ${resets}.` : ''}`);
      console.error('Stopping the batch — re-run generate later to fill the remaining placeholders.');
      stopped = 'stopped on 429';
      ensurePlaceholder(job, failures, `${label} — 429 rate limited`);
      continue;
    }
    // 502 (generation failed — could be moderation or an outage; the endpoint doesn't
    // distinguish) or network error: placeholder, keep the marker, continue the batch.
    ensurePlaceholder(job, failures, `${label} — ${res.status === 502 ? '502 generation failed (could be content moderation or a temporary outage)' : `error: ${res.message || res.status}`}`);
  }

  if (failures.length) {
    console.error(`\n${failures.length} image(s) not generated:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error('Markers were kept and gray placeholder images written at the right aspect ratio,');
    console.error('so the site still renders. Re-run the same generate command to resume (idempotent:');
    console.error('finished images are skipped, placeholders are replaced).');
    process.exit(1);
  }
  console.log('All images generated.');
}

function ensurePlaceholder(job, failures, message) {
  if (job.target && !fs.existsSync(job.target)) {
    const [w, h] = ASPECTS[job.aspect] || ASPECTS['16:9'];
    writeFileAtomic(job.target, placeholderPng(w, h));
  }
  failures.push(message);
}

function reportHardFailure(res, failures) {
  if (res.status === 401) { console.error(`Authentication rejected. ${authHint()}`); process.exit(2); }
  if (res.status === 429) {
    const retry = res.headers?.get?.('retry-after');
    console.error(`Rate limited (429).${retry ? ` Retry-After: ${retry}.` : ''} Try again later — never retry in a loop.`);
    process.exit(1);
  }
  console.error(`Generation failed (HTTP ${res.status}${res.message ? `: ${res.message}` : ''}).`);
  if (res.status === 502) console.error('A 502 can be content moderation or a temporary outage — the endpoint does not distinguish. Rephrase the prompt or retry later.');
  process.exit(1);
}

// ---------- main ----------

const [, , cmd, ...rest] = process.argv;
try {
  if (cmd === 'auth') await cmdAuth(rest);
  else if (cmd === 'status') await cmdStatus();
  else if (cmd === 'generate') await cmdGenerate(rest);
  else {
    console.log('Usage: telex-images.mjs <auth [--base-url <url>] | status | generate --files <f...> | generate --prompt <p> --out <f.png> [--aspect <a>]>');
    process.exit(cmd ? 2 : 0);
  }
} catch (e) {
  const tok = loadToken();
  console.error('Error: ' + redact(e.message, tok?.access_token));
  process.exit(2);
}
