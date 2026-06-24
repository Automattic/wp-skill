#!/usr/bin/env node
/**
 * wpcom-images.mjs — generate site images through the WordPress.com AI image endpoint.
 *
 * Node 18+, zero dependencies (built-in fetch). Subcommands:
 *
 *   login                     Claude-Code-style browser login: open a local loopback server, send
 *                             the user to WordPress.com, capture the token from the redirect, and
 *                             store it — NO copy/paste, token never transits the chat. Needs a
 *                             dedicated OAuth app (LOOPBACK_CLIENT_ID / WPCOM_OAUTH_CLIENT_ID); if
 *                             unset, it prints how to register one. Requires the browser to be on
 *                             the same machine; for remote/SSH use `auth` instead.
 *   auth-url                  print ONLY the authorize URL (no stdin, no network). The agent can
 *                             run this and relay the link in chat — the URL is not secret.
 *   auth [--token <t>]        one-time login (OAuth2 implicit grant, the same flow the WordPress
 *                             Studio CLI uses). With `--token` it validates and stores the given
 *                             token non-interactively (the agent can run this with a token the
 *                             user pasted into the chat). Without it, prints the authorize URL and
 *                             reads the pasted token from stdin, so the USER can run it themselves
 *                             (`! node … auth`) and keep the token out of the chat. NOT echoed.
 *   status                    who is logged in + a live check of whether this token can actually
 *                             generate.
 *   check --files <f...>      no auth, no network: static pre-flight of AI_IMAGE markers —
 *                             bad/subdir/case/extension src, cover/image alt-mirror desync,
 *                             mixed aspects in a row/grid, duplicate target with differing
 *                             prompts. Exit 1 if any issue. Cheap pre-gate before the block gates.
 *   generate --files <f...> [--concurrency N]   scan theme files for AI_IMAGE alt markers,
 *                             generate each into <theme>/assets/<name>.png (in batches of N,
 *                             default 4), rewrite alts to human text.
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
 *   Model is Google Gemini "Nano Banana Pro" server-side. Per-user quota: 200 images/month;
 *   usage is charged only on a successful generation.
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
 * 429 (quota exceeded) → stop the batch, placeholder the rest, print the reset message, never
 * poll-retry.
 *
 * Exit codes: 0 = success/no-op; 1 = some images failed (placeholders written, resumable);
 * 2 = auth needed/failed (no token or 401); 3 = endpoint unreachable (network/TLS — `status`
 * only).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const API_BASE = process.env.WPCOM_API_BASE || 'https://public-api.wordpress.com/';
const OAUTH_AUTHORIZE = 'https://public-api.wordpress.com/oauth2/authorize';
const CLIENT_ID = '95109'; // WordPress Studio's WordPress.com OAuth app — its copy-oauth-token
                           // redirect is registered, and a global-scope bearer authorizes the
                           // ai-image endpoint (logged-in WordPress.com user).
const OAUTH_SCOPE = 'global';
const OAUTH_REDIRECT = 'https://developer.wordpress.com/copy-oauth-token';

// --- loopback browser login (`login`): Claude-Code-style, no copy/paste ---
// This needs a DEDICATED WordPress.com OAuth app, NOT Studio's 95109 — that client only has the
// `wp-studio://auth` deep link and the copy-oauth-token page registered, no http://localhost.
// Register one at https://developer.wordpress.com/apps/ with Redirect URL EXACTLY:
//   http://localhost:41763/callback
// then paste its client_id here (or set WPCOM_OAUTH_CLIENT_ID). client_ids are not secret; no
// client secret is used (implicit grant). The port/path below MUST match the registered URL.
const LOOPBACK_CLIENT_ID = process.env.WPCOM_OAUTH_CLIENT_ID || '142242'; // dedicated wp-skill OAuth app
const LOOPBACK_PORT = Number(process.env.WPCOM_OAUTH_PORT) || 41763;
const LOOPBACK_REDIRECT = `http://localhost:${LOOPBACK_PORT}/callback`;
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
// 'quota' (monthly limit hit), 'unknown' (upstream/generation failure). The status `status`
// command probes with an EMPTY prompt, which the endpoint rejects (400 ai_image_missing_prompt)
// only AFTER permission_check passes — so a 400-missing-prompt means auth is good.
function classify(status, code, message) {
  const c = code || '';
  const m = String(message || '');
  if (status === 401 || /authentication required/i.test(m)) return 'login';
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

function cmdAuthUrl() {
  // Print ONLY the authorize URL (no stdin, no network). The URL is not secret — the agent can
  // run this and relay the link directly in chat, so the user just clicks it; the token paste
  // (the one secret step) still happens locally via `auth`.
  console.log(authorizeUrl());
}

async function cmdAuth(args = []) {
  // Two ways in:
  //  - `auth --token <t>`  : non-interactive. The token is supplied directly (e.g. the agent
  //                          storing a token the user pasted into the chat). No stdin, no prompt.
  //  - `auth`              : interactive. Print the URL and read the pasted token from the user's
  //                          own stdin, so the token never has to transit the chat.
  const ti = args.indexOf('--token');
  const flagToken = ti !== -1 ? args[ti + 1] : undefined;

  let token;
  if (flagToken !== undefined) {
    token = String(flagToken).trim();
  } else {
    console.log('Open this URL in your browser to authorize (login is your WordPress.com account):');
    console.log(`\n  ${authorizeUrl()}\n`);
    console.log('After you approve, WordPress.com shows your access token on the next page.');
    console.log('Copy that token and paste it here, then press Enter.\n');
    process.stdout.write('Authentication token: ');
    token = (await readStdinLine()).trim();
  }
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

// ---------- login (loopback browser flow — no copy/paste) ----------

function loopbackAuthorizeUrl(state) {
  const u = new URL(OAUTH_AUTHORIZE);
  u.searchParams.set('response_type', 'token');
  u.searchParams.set('client_id', LOOPBACK_CLIENT_ID);
  u.searchParams.set('redirect_uri', LOOPBACK_REDIRECT);
  u.searchParams.set('scope', OAUTH_SCOPE);
  u.searchParams.set('state', state);
  return u.toString();
}

function openBrowser(url) {
  // Best-effort: the URL is also printed so a failed open is never fatal.
  const p = process.platform;
  const [cmd, args] = p === 'darwin' ? ['open', [url]]
    : p === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

// Capture the token via a loopback redirect. The implicit grant returns it in the URL FRAGMENT,
// which the browser never sends to the server — so /callback serves a tiny page that reads
// location.hash and POSTs it back to /token. A random `state` guards against a stray request.
function awaitLoopbackToken(state, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, LOOPBACK_REDIRECT);
      if (req.method === 'GET' && url.pathname === '/callback') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset=utf-8><title>WordPress.com login</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;text-align:center">
<h2 id=m>Finishing login…</h2>
<script>
  fetch('/token',{method:'POST',headers:{'content-type':'text/plain'},body:location.hash.substring(1)})
    .then(function(r){return r.text();})
    .then(function(t){document.getElementById('m').textContent=t;})
    .catch(function(){document.getElementById('m').textContent='Something went wrong — return to the terminal.';});
</script></body>`);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/token') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
        req.on('end', () => {
          const p = new URLSearchParams(body);
          const reply = (msg) => { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(msg); };
          const token = p.get('access_token');
          if (p.get('error')) { reply('Login was denied. You can close this tab.'); finish(new Error(`authorization denied (${p.get('error')})`)); return; }
          if (!token) { reply('No token found in the redirect. You can close this tab.'); finish(new Error('no access_token in redirect')); return; }
          if (p.get('state') !== state) { reply('Login state mismatch. You can close this tab.'); finish(new Error('state mismatch — request rejected')); return; }
          reply('Login complete — you can close this tab and return to the terminal.');
          finish(null, token);
        });
        return;
      }
      res.writeHead(404); res.end();
    });

    const finish = (err, token) => {
      clearTimeout(timer);
      try { server.closeAllConnections?.(); } catch {}
      server.close(() => (err ? reject(err) : resolve(token)));
    };

    server.on('error', (e) => { clearTimeout(timer); reject(e); });
    server.listen(LOOPBACK_PORT, '127.0.0.1', () => {
      const authUrl = loopbackAuthorizeUrl(state);
      console.log('Opening your browser to log in to WordPress.com…');
      console.log(`\nIf it doesn't open, click this link:\n\n  ${authUrl}\n`);
      openBrowser(authUrl);
    });
    timer = setTimeout(() => finish(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser login`)), timeoutMs);
  });
}

async function cmdLogin() {
  if (!LOOPBACK_CLIENT_ID) {
    console.error('Browser login needs a dedicated WordPress.com OAuth app (Studio\'s client has no localhost redirect).');
    console.error('Register one at https://developer.wordpress.com/apps/ with Redirect URL EXACTLY:');
    console.error(`  ${LOOPBACK_REDIRECT}`);
    console.error('then set WPCOM_OAUTH_CLIENT_ID=<client_id> (or hard-code LOOPBACK_CLIENT_ID in this script) and re-run.');
    console.error('Fallback that needs no app: `auth` (manual token paste).');
    process.exit(2);
  }
  const state = crypto.randomBytes(16).toString('hex');
  const timeoutMs = Number(process.env.WPCOM_OAUTH_TIMEOUT_MS) || 180000;

  let token;
  try {
    token = await awaitLoopbackToken(state, timeoutMs);
  } catch (e) {
    console.error(`\nBrowser login failed: ${e.message}`);
    if (/EADDRINUSE/.test(e.message)) console.error(`Port ${LOOPBACK_PORT} is busy — close whatever is using it, or set WPCOM_OAUTH_PORT (and register that port's redirect URL too).`);
    console.error('Fallback: `auth` (manual token paste).');
    process.exit(2);
  }

  let v;
  try { v = await validateToken(token); }
  catch (e) { console.error(`\nGot a token but could not reach ${API_BASE} to validate it (${redact(e.message, token)}).`); process.exit(3); }
  if (!v.ok) { console.error(`\nThe returned token was rejected (${v.message || `HTTP ${v.status}`}). Re-run login to try again.`); process.exit(2); }

  saveToken({
    access_token: token,
    token_type: 'Bearer',
    api_base_url: API_BASE,
    username: v.me.username || v.me.display_name || null,
    user_id: v.me.ID || null,
  });
  console.log(`\nLogged in as ${v.me.username || v.me.display_name || 'unknown user'}. Token stored at ${tokenPath()} (never commit or print it).`);
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
  // permission_check (login) BEFORE it rejects the empty prompt, so the outcome tells us exactly
  // what this token can do.
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
        let why = 'empty description';
        if (description) {
          // Diagnose the common authoring mistakes instead of just "no assets/<name>.png".
          why = 'no assets/<name>.png in src (lowercase a-z, 0-9, hyphens, .png)';
          if (/assets\/[^"'<>]*\/[A-Za-z0-9._-]+\.png/i.test(tag)) {
            why = 'marker src must be FLAT — assets/<name>.png with no subdirectory (got e.g. assets/images/…); the generator writes flat into <theme>/assets/';
          } else if (/assets\/[A-Za-z0-9._-]*[A-Z_][A-Za-z0-9._-]*\.png/.test(tag)) {
            why = 'marker filename must be lowercase a-z, 0-9, hyphens only — no uppercase or underscores — ending .png';
          } else if (/assets\/[a-z0-9-]+\.(?:jpe?g|webp|gif|avif)\b/i.test(tag)) {
            why = 'marker filename must end in .png (the endpoint outputs PNG; don\'t name it .jpg)';
          }
        }
        jobs.push({ file, marker: alt[1], error: why });
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
  // The marker can appear TWICE: as the <img alt="…"> (HTML-escaped) and — for core/cover and
  // core/image — as the block-comment "alt":"…" attribute (JSON-escaped). Rewrite BOTH with the
  // right escaping; rewriting only the <img> desyncs the two and the block fails the editor gate
  // after generation.
  const htmlEscaped = humanAlt.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const jsonEscaped = humanAlt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  let out = text.split(`alt="${marker}"`).join(`alt="${htmlEscaped}"`);   // <img alt="…">
  out = out.split(`"alt":"${marker}"`).join(`"alt":"${jsonEscaped}"`);    // block-comment "alt":"…"
  fs.writeFileSync(file, out);
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
  // Collect file args up to the next flag, so `--files a.php b.php --concurrency 4` doesn't
  // swallow the "4" as a filename.
  const fi = args.indexOf('--files');
  const files = [];
  if (fi !== -1) for (let k = fi + 1; k < args.length && !args[k].startsWith('--'); k++) files.push(args[k]);
  if (!files.length) { console.error('Usage: generate --files <theme files...> [--concurrency N]  (or --prompt/--out)'); process.exit(2); }
  const concurrency = Math.max(1, parseInt(get('--concurrency'), 10) || 4);

  const jobs = scanMarkers(files);
  if (!jobs.length) { console.log('No AI_IMAGE markers found — nothing to do.'); return; }

  const failures = [];
  let stopped = null; let exitCode = 1;
  const labelOf = (job) => `${path.basename(job.file)} -> ${job.target ? path.relative(process.cwd(), job.target) : '?'}`;

  for (const job of jobs.filter(j => j.error)) failures.push(`${labelOf(job)} — bad marker: ${job.error}`);

  // Group markers by target file. The FIRST marker for a target is the generator (its prompt
  // drives the one image); every marker sharing that target gets its alt rewritten once the
  // image exists. Grouping dedups targets so concurrent workers never race on the same file.
  const targets = new Map(); // target -> { gen, jobs: [], real?, attempted? }
  for (const job of jobs.filter(j => !j.error)) {
    const g = targets.get(job.target);
    if (g) g.jobs.push(job); else targets.set(job.target, { gen: job, jobs: [job] });
  }

  // Targets already holding a real (non-placeholder) image are left alone; the rest need work.
  const toGenerate = [];
  for (const entry of targets.values()) {
    if (fs.existsSync(entry.gen.target) && !isPlaceholder(entry.gen.target)) {
      console.log(`skip (exists): ${labelOf(entry.gen)}`);
      entry.real = true;
    } else {
      toGenerate.push(entry);
    }
  }

  // Generate in fixed batches of `concurrency` (default 4). After each batch, if a hard stop
  // (needs-login / launch-gate / quota) was hit, stop launching new batches — requests already
  // in flight in the current batch finish and are handled normally.
  const stop = (reason, code) => { if (!stopped) { stopped = reason; if (code) exitCode = code; } };
  for (let i = 0; i < toGenerate.length && !stopped; i += concurrency) {
    const batch = toGenerate.slice(i, i + concurrency);
    console.log(`generating ${i + 1}-${i + batch.length} of ${toGenerate.length} (up to ${concurrency} at once) ...`);
    await Promise.all(batch.map(async (entry) => {
      const job = entry.gen;
      entry.attempted = true;
      let res;
      try { res = await generateOne(tok, buildPrompt(job.description, job.style), job.aspect); }
      catch (e) { res = { ok: false, status: 0, message: redact(e.message, tok.access_token) }; }
      if (res.ok) {
        writeFileAtomic(job.target, res.buf);
        entry.real = true;
        console.log(`  ok: ${labelOf(job)} (${job.aspect})`);
        return;
      }
      const verdict = classify(res.status, res.code, res.message);
      console.log(`  FAILED (HTTP ${res.status || 'network'}): ${labelOf(job)}`);
      if (verdict === 'login') { stop('needs login', 2); ensurePlaceholder(job, failures, `${labelOf(job)} — needs login`); return; }
      if (verdict === 'quota') { stop('monthly quota exceeded'); ensurePlaceholder(job, failures, `${labelOf(job)} — monthly quota exceeded`); return; }
      // Upstream generation failure (content moderation or a temporary Gemini/proxy outage; the
      // endpoint passes the status through) or network error: placeholder, keep marker, continue.
      ensurePlaceholder(job, failures, `${labelOf(job)} — generation failed (HTTP ${res.status || 'network'}${res.message ? `: ${res.message}` : ''}; could be content moderation or a temporary outage)`);
    }));
  }

  // Anything we never launched because we stopped early gets a placeholder so the site renders.
  if (stopped) {
    for (const entry of toGenerate) {
      if (!entry.attempted && !entry.real) ensurePlaceholder(entry.gen, failures, `${labelOf(entry.gen)} — not attempted (stopped: ${stopped})`);
    }
    if (stopped === 'needs login') console.error(`\nAuthentication rejected. ${authHint()}\nStopped — markers and placeholders are kept; re-run generate after auth to resume.`);
    else if (stopped === 'monthly quota exceeded') console.error('\nMonthly image quota exhausted — it resets at the start of next month. Stopped the batch.');
  }

  // Rewrite alts to human text only where a real image is present; placeholdered targets keep
  // their AI_IMAGE markers so a later run can fill them in.
  for (const entry of targets.values()) {
    if (entry.real) for (const j of entry.jobs) rewriteAlt(j.file, j.marker, j.description);
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
  if (verdict === 'quota') {
    console.error(`Monthly image quota exhausted (${res.message || '429'}). It resets at the start of next month — never retry in a loop.`);
    process.exit(1);
  }
  console.error(`Generation failed (HTTP ${res.status}${res.message ? `: ${res.message}` : ''}).`);
  console.error('An upstream failure can be content moderation or a temporary outage — the endpoint passes the status through. Rephrase the prompt or retry later.');
  process.exit(1);
}

// ---------- check (no auth, no network): static marker pre-flight ----------

function checkAltMirror(file, issues) {
  // core/cover serializes its background-image alt from the BLOCK "alt" attribute, so a cover
  // whose <img alt="AI_IMAGE:…"> has no matching block-comment "alt" passes the file-level
  // validate-blocks.cjs yet FAILS the live editor gate (and re-desyncs after generation). This is
  // its static counterpart. (core/image is exempt: its alt round-trips through the <img> element,
  // so the <img alt> alone is valid — verified against the live registry, 2026-06.)
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/<!--\s*wp:(cover)\b([\s\S]*?)-->/g)) {
    const type = m[1];
    const attrs = m[2];
    // Look only inside THIS block's own body — stop at the next block delimiter so we don't
    // grab a sibling block's <img> when this one has none.
    const after = text.slice(m.index + m[0].length);
    const bound = after.search(/<!--\s*\/?wp:/);
    const region = bound === -1 ? after : after.slice(0, bound);
    const imgTag = region.match(/<img\b(?:<\?php[\s\S]*?\?>|[^>])*>/);
    if (!imgTag) continue;
    const imgAlt = imgTag[0].match(/alt="(AI_IMAGE:[^"]*)"/);
    if (!imgAlt) continue; // no marker on this block's image — nothing to mirror
    const blockAlt = attrs.match(/"alt"\s*:\s*"(AI_IMAGE:[^"]*)"/);
    if (!blockAlt) {
      issues.push(`${path.basename(file)}: core/${type} has <img alt="${imgAlt[1]}"> but no matching "alt" in the block comment — the editor serializes alt from the block attribute, so this FAILS the editor gate. Put the same marker in the block JSON "alt".`);
    } else if (blockAlt[1] !== imgAlt[1]) {
      issues.push(`${path.basename(file)}: core/${type} marker mismatch — <img alt="${imgAlt[1]}"> vs block "alt":"${blockAlt[1]}". They must be byte-identical.`);
    }
  }
}

function checkGridAspects(file, issues) {
  // Images shown together in a row/grid (cards, gallery, team) MUST share one aspect — never
  // mix. Catch differing marker aspects inside a single columns/gallery container.
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/<!--\s*wp:(columns|gallery)\b[\s\S]*?<!--\s*\/wp:\1\s*-->/g)) {
    const container = m[0];
    const aspects = new Set();
    for (const im of container.matchAll(/<img\b(?:<\?php[\s\S]*?\?>|[^>])*>/g)) {
      const alt = im[0].match(/alt="AI_IMAGE:([^"]*)"/);
      if (!alt) continue;
      aspects.add(normalizeAspect((alt[1].split('|')[2] || '').trim()));
    }
    if (aspects.size > 1) {
      issues.push(`${path.basename(file)}: a core/${m[1]} mixes aspect ratios (${[...aspects].join(', ')}) across its AI_IMAGE markers — images in one row/grid must share a single aspect.`);
    }
  }
}

async function cmdCheck(args) {
  // Static pre-flight for AI_IMAGE markers — zero network, no auth. Run it before the block
  // gates (or any time) to catch authoring mistakes that only surface mid-`generate` otherwise.
  const fi = args.indexOf('--files');
  const files = fi === -1 ? [] : args.slice(fi + 1).filter(a => !a.startsWith('--'));
  if (!files.length) { console.error('Usage: check --files <theme files...>'); process.exit(2); }

  const issues = [];
  const jobs = scanMarkers(files);
  // 1. Per-marker authoring errors (empty / subdir / case / extension) — reuse scanMarkers' hints.
  for (const j of jobs.filter(j => j.error)) {
    issues.push(`${path.basename(j.file)}: bad marker "${j.marker}" — ${j.error}`);
  }
  // 2. cover/image alt-mirror + 3. grid/row aspect consistency (structural, per file).
  for (const f of files) { checkAltMirror(f, issues); checkGridAspects(f, issues); }
  // 4. Duplicate target filename with differing prompts — markers sharing a target generate once
  //    and share the result, so their descriptions must match (or the files must differ).
  const byTarget = new Map();
  for (const j of jobs.filter(j => !j.error)) {
    if (!byTarget.has(j.target)) byTarget.set(j.target, new Set());
    byTarget.get(j.target).add(j.description);
  }
  for (const [target, descs] of byTarget) {
    if (descs.size > 1) {
      issues.push(`${path.relative(process.cwd(), target)}: ${descs.size} markers point at this one file with DIFFERENT prompts — they generate once and share the image, so use identical descriptions or distinct filenames.`);
    }
  }

  if (!issues.length) {
    console.log(`check: ${jobs.length} AI_IMAGE marker(s) across ${files.length} file(s) — no issues (no network calls made).`);
    return;
  }
  console.error(`check: ${issues.length} issue(s) found (no network calls made):`);
  for (const i of issues) console.error(`  - ${i}`);
  process.exit(1);
}

// ---------- main ----------

const [, , cmd, ...rest] = process.argv;
try {
  if (cmd === 'login') await cmdLogin();
  else if (cmd === 'auth-url') cmdAuthUrl();
  else if (cmd === 'auth') await cmdAuth(rest);
  else if (cmd === 'status') await cmdStatus();
  else if (cmd === 'generate') await cmdGenerate(rest);
  else if (cmd === 'placeholders') await cmdPlaceholders(rest);
  else if (cmd === 'check') await cmdCheck(rest);
  else {
    console.log('Usage: wpcom-images.mjs <login | auth-url | auth [--token <t>] | status | check --files <f...> | generate --files <f...> [--concurrency N] | generate --prompt <p> --out <f.png> [--aspect <a>] | placeholders --files <f...>>');
    process.exit(cmd ? 2 : 0);
  }
} catch (e) {
  const tok = loadToken();
  console.error('Error: ' + redact(e.message, tok?.access_token));
  process.exit(2);
}
