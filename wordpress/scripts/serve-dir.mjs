#!/usr/bin/env node
// Minimal static file server for design preview galleries (references/design.md).
//
// Usage: node serve-dir.mjs [root]
//
// - serves <root> (default: cwd) read-only over HTTP
// - binds 127.0.0.1 on an ephemeral port (never hardcoded, never guessed)
// - prints the real URL (e.g. "http://127.0.0.1:53412/") to stdout
// - writes its PID to <root>/server.pid so it can be stopped with:
//     kill "$(cat server.pid)"
//
// Node only, zero dependencies — Node 18+ is the one runtime this skill guarantees.

import http from "node:http";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    let file = path.normalize(path.join(root, decodeURIComponent(pathname)));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    let info = await stat(file);
    if (info.isDirectory()) {
      file = path.join(file, "index.html");
      info = await stat(file);
    }
    res.writeHead(200, {
      "content-type":
        TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": info.size,
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  await writeFile(path.join(root, "server.pid"), `${process.pid}\n`);
  console.log(`http://127.0.0.1:${port}/`);
});
