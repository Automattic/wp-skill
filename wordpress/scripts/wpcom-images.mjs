#!/usr/bin/env node
/**
 * wpcom-images.mjs — generate site images through the WordPress.com AI image endpoint.
 *
 * Node 18+, zero dependencies (built-in fetch). Subcommands:
 *
 *   auth                      one-time login (OAuth2 implicit grant + manual token paste, the
 *                             same flow the WordPress Studio CLI uses). Prints an authorize URL
 *                             the USER opens in their browser; after approving, WordPress.com
 *                             shows the token on a copy page; the user pastes it back. Read from
 *                             stdin, so the USER should run this themselves (e.g. `! node … auth`)
 *                             — the token never transits the chat. The token is NOT echoed.
 *   status                    who is logged in + a live check of whether this token can actually
 *                             generate (the endpoint is Automatticians-only during launch).
 *   generate --files <f...>   scan theme files for AI_IMAGE alt markers, generate each into
 *                             <theme>/assets/<name>.png, rewrite alts to human text.
 *   generate --prompt <p> --out <file.png> [--aspect <a>]   ad-hoc single image.
 *   placeholders --files <f...>   no auth, no network: write a solid-color PNG at each marker's
 *                             aspect ratio and KEEP the AI_IMAGE marker, so the layout renders
 *                             now and `generate` can fill in real images later. The default when
 *                             the user isn't logged in or doesn't want to generate yet.
 *
 * Endpoint: POST {api}/wpcom/v2/ai-image/v1/imagine  (api = https://public-api.wordpress.com/)
 *   headers: Authorization: Bearer <token>, X-WPCOM-AI-Feature: ai-image-cli
 *   body:    { prompt, aspect_ratio?, output_format? }
 *   200:     { data: [ { b64_json, revised_prompt } ] }   (b64_json = base64 PNG bytes)
 *   Model is Google Gemini "Nano Banana Pro" server-side. Per-user quota: 200/month for regular
 *   users, unlimited for Automatticians; usage is charged only on a successful generation.
 *
 * Aspect words map square→1:1, landscape→16:9, portrait→9:16; the ratio strings
 * 1:1 | 2:3 | 3:2 | 3:4 | 4:3 | 9:16 | 16:9 | 21:9 pass through unchanged (the endpoint's enum).
 *
 * Token: ${XDG_CONFIG_HOME:-~/.config}/wp-agent-skill/wpcom-auth.json (dir 700, file 600,
 * atomic write, perms verified on every read). NEVER printed; redacted from error output.
 *
 * Failure policy (per marker): generation failure (upstream 5xx/network) → write a deterministic
 * placeholder PNG at the right aspect so the site renders, KEEP the marker, continue the batch,
 * list failures at the end (generate resumes idempotently — placeholders are detected and
 * replaced on the next run; real images are skipped). 401 → print the re-auth command and stop.
 * 403 (launch gate: Automatticians only) → stop, the user has no access yet. 429 (quota
 * exceeded) → stop the batch, placeholder the rest, print the reset message, never poll-retry.
 *
 * Exit codes: 0 = success/no-op; 1 = some images failed (placeholders written, resumable);
 * 2 = auth needed/failed (no token or 401); 3 = endpoint unreachable (network/TLS — `status`
 * only); 4 = authenticated but not authorized (403 launch gate — Automatticians only).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const API_BASE = process.env.WPCOM_API_BASE || 'https://public-api.wordpress.com/';
const OAUTH_AUTHORIZE = 'https://public-api.wordpress.com/oauth2/authorize';
const CLIENT_ID = '95109'; // WordPress Studio's WordPress.com OAuth app — its copy-oauth-token
                           // redirect is registered, and a global-scope bearer authorizes the
                           // ai-image endpoint (logged-in WordPress.com user).
const OAUTH_SCOPE = 'global';
const OAUTH_REDIRECT = 'https://developer.wordpress.com/copy-oauth-token';
const AI_FEATURE = 'ai-image-cli'; // server-side allowlisted; anything else collapses to default

const IMAGINE_PATH = 'wpcom/v2/ai-image/v1/imagine';
const ME_PATH = 'rest/v1.1/me';

// The endpoint's aspect_ratio enum → placeholder pixel dimensions (long side ~1280).
const ASPECTS = {
  '1:1': [1024, 1024], '2:3': [853, 1280], '3:2': [1280, 853], '3:4': [960, 1280],
  '4:3': [1280, 960], '9:16': [720, 1280], '16:9': [1280, 720], '21:9': [1280, 549],
};
const ASPECT_WORDS = { square: '1:1', landscape: '16:9', portrait: '9:16' };
const PLACEHOLDER_TAG = 'wp-agent-skill-placeholder';

// ---------- token store ----------

function tokenPath() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'wp-agent-skill', 'wpcom-auth.json');
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
      `your WordPress.com token is readable by other local users. Move your home or XDG_CONFIG_HOME to the Linux filesystem.`
    );
  }
}

function saveToken(data) {
  const file = tokenPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = path.join(path.dirname(file), `.wpcom-auth.json.tmp-${process.pid}`);
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

function authHint() {
  const rel = path.relative(process.cwd(), process.argv[1]);
  const script = rel && !rel.startsWith('..') ? rel : process.argv[1];
  return `Run: node ${script} auth`;
}

// ---------- HTTP ----------

function apiUrl(p) { return new URL(p, API_BASE).toString(); }

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

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, headers: res.headers, json };
}

// Pull the human-readable message + machine code out of a WordPress REST error, whichever shape
// it arrives in ({code,message} at top level, or nested under .data / .errors).
function errInfo(json) {
  const code = json?.code || json?.error || '';
  const message = json?.message || json?.error_description || '';
  return { code: String(code), message: String(message) };
}

// Classify an imagine response into: 'ok' (token + access valid), 'login' (must re-authenticate),
// 'forbidden' (authed but the launch gate blocks this user — Automatticians only today),
// 'quota' (monthly limit hit), 'unknown' (upstream/generation failure). The status `status`
// command probes with an EMPTY prompt, which the endpoint rejects (400 ai_image_missing_prompt)
// only AFTER permission_check passes — so a 400-missing-prompt means auth + access are good.
function classify(status, code, message) {
  const c = code || '';
  const m = String(message || '');
  if (status === 401 || /authentication required/i.test(m)) return 'login';
  if (status === 403 || (c === 'rest_forbidden' && /automattician/i.test(m))) return 'forbidden';
  if (status === 429 || c === 'ai_image_quota_exceeded') return 'quota';
  if (status === 200) return 'ok';
  if (status === 400 && (c === 'ai_image_missing_prompt' || /prompt/i.test(m))) return 'ok';
  return 'unknown';
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

// A batch that fails hits the same few dimensions repeatedly — build each solid-gray PNG once
// and reuse it. Uniform pixels compress fully at level 1, so the cheapest deflate is also the
// smallest output; level 9 just burned CPU for nothing.
const _placeholderCache = new Map();
function placeholderPng(w, h) {
  const key = `${w}x${h}`;
  const cached = _placeholderCache.get(key);
  if (cached) return cached;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.alloc(1 + w * 3); // filter 0 + pixels
  for (let x = 0; x < w; x++) { row[1 + x * 3] = 0xd6; row[2 + x * 3] = 0xd2; row[3 + x * 3] = 0xcb; }
  const raw = Buffer.concat(Array(h).fill(row));
  const text = Buffer.from(`Software\0${PLACEHOLDER_TAG}`, 'latin1');
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', text),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  _placeholderCache.set(key, png);
  return png;
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

// ---------- auth (OAuth2 implicit grant + manual token paste) ----------

function authorizeUrl() {
  const u = new URL(OAUTH_AUTHORIZE);
  u.searchParams.set('response_type', 'token');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('redirect_uri', OAUTH_REDIRECT);
  u.searchParams.set('scope', OAUTH_SCOPE);
  return u.toString();
}

function readStdinLine() {
  // Read one line (the pasted token) from stdin without any dependency. Works whether stdin is
  // a TTY (the user types/pastes) or a pipe (`echo $TOK | … auth`).
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl !== -1) { process.stdin.pause(); resolve(buf.slice(0, nl)); }
    });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.resume();
  });
}

async function validateToken(token) {
  const res = await getJson(apiUrl(`${ME_PATH}?fields=ID,username,email,display_name`),
    { Authorization: `Bearer ${token}` });
  if (res.status === 200 && res.json?.ID) return { ok: true, me: res.json };
  return { ok: false, status: res.status, ...errInfo(res.json) };
}

async function cmdAuth() {
  console.log('Open this URL in your browser to authorize (login is your WordPress.com account):');
  console.log(`\n  ${authorizeUrl()}\n`);
  console.log('After you approve, WordPress.com shows your access token on the next page.');
  console.log('Copy that token and paste it here, then press Enter.\n');
  process.stdout.write('Authentication token: ');

  const token = (await readStdinLine()).trim();
  if (!token) {
    console.error('\nNo token provided — re-run auth when ready.');
    process.exit(2);
  }

  let v;
  try { v = await validateToken(token); }
  catch (e) { console.error(`\nCould not reach ${API_BASE} to validate the token (${redact(e.message, token)}).`); process.exit(3); }

  if (!v.ok) {
    console.error(`\nThat token was rejected (${v.message || `HTTP ${v.status}`}). Make sure you copied the whole token; re-run auth to try again.`);
    process.exit(2);
  }

  saveToken({
    access_token: token,
    token_type: 'Bearer',
    api_base_url: API_BASE,
    username: v.me.username || v.me.display_name || null,
    user_id: v.me.ID || null,
  });
  console.log(`\nAuthorized as ${v.me.username || v.me.display_name || 'unknown user'}. Token stored at ${tokenPath()} (never commit or print it).`);
}

// ---------- status ----------

async function cmdStatus() {
  const tok = loadToken();
  if (!tok?.access_token) {
    console.log(`Not logged in (no token at ${tokenPath()}). ${authHint()}`);
    process.exit(2);
  }
  console.log(`Logged in as ${tok.username || 'unknown'} (WordPress.com).`);

  // Real check at zero generation cost: probe imagine with an EMPTY prompt. The endpoint runs
  // permission_check (login + the Automatticians launch gate) BEFORE it rejects the empty
  // prompt, so the outcome tells us exactly what this token can do.
  let res;
  try {
    res = await postJson(apiUrl(IMAGINE_PATH), { prompt: '' },
      { Authorization: `Bearer ${tok.access_token}`, 'X-WPCOM-AI-Feature': AI_FEATURE });
  } catch (e) {
    console.log(`Credentials: could not reach ${API_BASE} (${redact(e.message, tok.access_token)}).`);
    process.exit(3);
  }
  const { code, message } = errInfo(res.json);
  const verdict = classify(res.status, code, message);
  if (verdict === 'ok') { console.log('Credentials: working — you can generate images.'); return; }
  if (verdict === 'login') {
    console.log(`Credentials: NOT working — ${message || `HTTP ${res.status}`}. ${authHint()}`);
    process.exit(2);
  }
  if (verdict === 'forbidden') {
    console.log(`Access: image generation is currently limited to Automatticians (${message || 'HTTP 403'}). Your login works, but you can't generate images yet.`);
    process.exit(4);
  }
  if (verdict === 'quota') {
    console.log(`Access: authenticated, but this month's image quota is exhausted (${message || 'HTTP 429'}). It resets at the start of next month.`);
    return; // auth is fine; this is not an auth failure
  }
  console.log(`Credentials: unclear (HTTP ${res.status}${message ? `: ${message}` : ''}) — the endpoint may be having trouble.`);
  process.exit(3);
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
  const res = await postJson(apiUrl(IMAGINE_PATH),
    { prompt, aspect_ratio: aspect, output_format: 'png' },
    { Authorization: `Bearer ${tok.access_token}`, 'X-WPCOM-AI-Feature': AI_FEATURE });
  const b64 = res.json?.data?.[0]?.b64_json;
  if (res.status === 200 && b64) return { ok: true, buf: Buffer.from(b64, 'base64') };
  const { code, message } = errInfo(res.json);
  return { ok: false, status: res.status, code, message };
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
    return reportHardFailure(res);
  }

  // ---- batch over theme files ----
  const fi = args.indexOf('--files');
  const files = fi === -1 ? [] : args.slice(fi + 1).filter(a => !a.startsWith('--'));
  if (!files.length) { console.error('Usage: generate --files <theme files...>  (or --prompt/--out)'); process.exit(2); }

  const jobs = scanMarkers(files);
  if (!jobs.length) { console.log('No AI_IMAGE markers found — nothing to do.'); return; }

  const done = new Set(); const failures = [];
  let stopped = null; let exitCode = 1;

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
    const verdict = classify(res.status, res.code, res.message);
    if (verdict === 'login') {
      console.error(`\nAuthentication rejected (${res.message || 'token revoked or expired'}). ${authHint()}`);
      console.error('Stopping — markers and placeholders are kept; re-run generate after auth to resume.');
      stopped = 'stopped: needs login'; exitCode = 2;
      ensurePlaceholder(job, failures, `${label} — needs login`);
      continue;
    }
    if (verdict === 'forbidden') {
      console.error(`\nAccess denied (${res.message || 'Automatticians only during launch'}). Image generation is currently limited to Automatticians.`);
      console.error('Stopping — markers and placeholders are kept so the site still renders.');
      stopped = 'stopped: not authorized (launch gate)'; exitCode = 4;
      ensurePlaceholder(job, failures, `${label} — not authorized (Automatticians only)`);
      continue;
    }
    if (verdict === 'quota') {
      console.error(`\nMonthly image quota exhausted (${res.message || '429'}). It resets at the start of next month.`);
      console.error('Stopping the batch — re-run generate next month to fill the remaining placeholders.');
      stopped = 'stopped: quota exceeded';
      ensurePlaceholder(job, failures, `${label} — monthly quota exceeded`);
      continue;
    }
    // Upstream generation failure (could be content moderation or a temporary Gemini/proxy
    // outage; the endpoint passes through the upstream status) or network error: placeholder,
    // keep the marker, continue the batch.
    ensurePlaceholder(job, failures, `${label} — generation failed (HTTP ${res.status || 'network'}${res.message ? `: ${res.message}` : ''}; could be content moderation or a temporary outage)`);
  }

  if (failures.length) {
    console.error(`\n${failures.length} image(s) not generated:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error('Markers were kept and gray placeholder images written at the right aspect ratio,');
    console.error('so the site still renders. Re-run the same generate command to resume (idempotent:');
    console.error('finished images are skipped, placeholders are replaced).');
    process.exit(exitCode);
  }
  console.log('All images generated.');
}

// ---------- placeholders (no auth, no network) ----------

async function cmdPlaceholders(args) {
  // Write a solid-color placeholder PNG for every AI_IMAGE marker, at the marker's aspect
  // ratio, and KEEP the marker untouched so `generate` can replace it with a real image later.
  // This needs no token and makes no network call — it's the default when the user isn't logged
  // in or doesn't want to generate yet, and the layout still renders at the right dimensions.
  const fi = args.indexOf('--files');
  const files = fi === -1 ? [] : args.slice(fi + 1).filter(a => !a.startsWith('--'));
  if (!files.length) { console.error('Usage: placeholders --files <theme files...>'); process.exit(2); }

  const jobs = scanMarkers(files);
  if (!jobs.length) { console.log('No AI_IMAGE markers found — nothing to do.'); return; }

  let written = 0, skipped = 0, bad = 0;
  for (const job of jobs) {
    if (job.error) { console.error(`  bad marker in ${path.basename(job.file)}: ${job.error}`); bad++; continue; }
    // Never clobber a real image that's already there; refresh our own placeholders freely.
    if (fs.existsSync(job.target) && !isPlaceholder(job.target)) { skipped++; continue; }
    const [w, h] = ASPECTS[job.aspect] || ASPECTS['16:9'];
    writeFileAtomic(job.target, placeholderPng(w, h));
    written++;
  }
  console.log(`Wrote ${written} placeholder image(s)${skipped ? `, skipped ${skipped} existing real image(s)` : ''}${bad ? `, ${bad} bad marker(s)` : ''}.`);
  console.log('AI_IMAGE markers were kept — run `generate --files ...` later to replace placeholders with real images.');
  if (bad) process.exit(1);
}

function ensurePlaceholder(job, failures, message) {
  if (job.target && !fs.existsSync(job.target)) {
    const [w, h] = ASPECTS[job.aspect] || ASPECTS['16:9'];
    writeFileAtomic(job.target, placeholderPng(w, h));
  }
  failures.push(message);
}

function reportHardFailure(res) {
  const verdict = classify(res.status, res.code, res.message);
  if (verdict === 'login') {
    console.error(`Authentication rejected (${res.message || 'token revoked or expired'}). ${authHint()}`);
    process.exit(2);
  }
  if (verdict === 'forbidden') {
    console.error(`Access denied (${res.message || 'Automatticians only during launch'}). Image generation is currently limited to Automatticians.`);
    process.exit(4);
  }
  if (verdict === 'quota') {
    console.error(`Monthly image quota exhausted (${res.message || '429'}). It resets at the start of next month — never retry in a loop.`);
    process.exit(1);
  }
  console.error(`Generation failed (HTTP ${res.status}${res.message ? `: ${res.message}` : ''}).`);
  console.error('An upstream failure can be content moderation or a temporary outage — the endpoint passes the status through. Rephrase the prompt or retry later.');
  process.exit(1);
}

// ---------- main ----------

const [, , cmd, ...rest] = process.argv;
try {
  if (cmd === 'auth') await cmdAuth();
  else if (cmd === 'status') await cmdStatus();
  else if (cmd === 'generate') await cmdGenerate(rest);
  else if (cmd === 'placeholders') await cmdPlaceholders(rest);
  else {
    console.log('Usage: wpcom-images.mjs <auth | status | generate --files <f...> | generate --prompt <p> --out <f.png> [--aspect <a>] | placeholders --files <f...>>');
    process.exit(cmd ? 2 : 0);
  }
} catch (e) {
  const tok = loadToken();
  console.error('Error: ' + redact(e.message, tok?.access_token));
  process.exit(2);
}
