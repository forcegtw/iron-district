#!/usr/bin/env node
// Capture the three deterministic screenshots with the headless Chromium that
// playwright caches, driving it over CDP with nothing but the standard library
// and a WebSocket... which the standard library does not have. So instead: run
// Chrome with --screenshot, one URL at a time, after waiting for __shotReady by
// a fixed delay. The shot mode freezes after two paints, so a delay is safe.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync as stat } from 'node:fs';
import { extname, join as pjoin, normalize, resolve, sep } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const chrome = process.env.CHROME
  ?? join(process.env.HOME, '.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

// Serve game/ so module scripts and the import map load with correct MIME.
const root = resolve(pjoin(here, 'game'));
const server = createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname); }
  catch { response.writeHead(400).end(); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = resolve(pjoin(root, normalize(pathname)));
  if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try {
    const size = stat(file).size;
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'content-length': size });
    createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end(); }
});

function capture(url, out) {
  return new Promise((resolveP, rejectP) => {
    const args = [
      '--headless', '--no-sandbox', '--disable-gpu',
      '--window-size=1280,720', '--hide-scrollbars',
      '--virtual-time-budget=9000',
      `--screenshot=${out}`, url,
    ];
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', rejectP);
    child.on('exit', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`chrome exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

function waitPort(port, tries = 50) {
  return new Promise((resolveP, rejectP) => {
    const attempt = (n) => {
      const req = require('node:http').get(`http://127.0.0.1:${port}/index.html`, (res) => {
        res.resume();
        resolveP();
      });
      req.on('error', () => {
        if (n <= 0) rejectP(new Error('server never came up'));
        else setTimeout(() => attempt(n - 1), 100);
      });
    };
    attempt(tries);
  });
}

const port = 8123;
await new Promise((r) => server.listen(port, '127.0.0.1', r));

mkdirSync(join(here, 'screenshots'), { recursive: true });
const shots = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));
for (const item of shots) {
  const out = join(here, 'screenshots', item.name);
  const url = `http://127.0.0.1:${port}/index.html${item.query}`;
  process.stdout.write(`capturing ${item.name} ... `);
  await capture(url, out);
  const size = statSync(out).size;
  process.stdout.write(`${size} bytes\n`);
}
server.close();
process.exit(0);


