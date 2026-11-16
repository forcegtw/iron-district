#!/usr/bin/env node
// Serve game/ and open one shot URL in headless Chrome, printing console errors.
// Usage: node check-shot.mjs [shot] [seed]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const shotName = process.argv[2] ?? 'play';
const seed = process.argv[3] ?? '7';
const root = resolve('game');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };

const server = createServer((req, res) => {
  let p = new URL(req.url, 'http://x').pathname;
  if (p.endsWith('/')) p += 'index.html';
  const f = resolve(join(root, normalize(p)));
  if (!f.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const s = statSync(f).size;
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'content-length': s });
    createReadStream(f).pipe(res);
  } catch { res.writeHead(404).end(); }
});

server.listen(8125, '127.0.0.1', () => {
  const chrome = `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
  const child = spawn(chrome, [
    '--headless', '--no-sandbox', '--disable-gpu', '--window-size=1280,720',
    '--virtual-time-budget=8000', '--dump-dom',
    `http://127.0.0.1:8125/index.html?shot=${shotName}&seed=${seed}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  let dom = '';
  child.stdout.on('data', (d) => { dom += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('exit', () => {
    const consoleLines = err.split('\n').filter((l) => /CONSOLE|Uncaught|SyntaxError|TypeError|ReferenceError/i.test(l));
    console.log(consoleLines.length ? consoleLines.join('\n') : 'NO CONSOLE ERRORS');
    console.log('shotReady in DOM:', /__shotReady/.test(dom) ? 'marker present' : 'n/a (dom dump)');
    console.log('minimap canvas:', /id="minimap"/.test(dom) ? 'yes' : 'MISSING');
    console.log('announcer text:', (/id="announcer"[^>]*>([^<]*)</.exec(dom) ?? [])[1] ?? '(none)');
    console.log('stats rows:', (dom.match(/class="stat-row"/g) ?? []).length);
    server.close();
    process.exit(0);
  });
});
