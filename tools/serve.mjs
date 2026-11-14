#!/usr/bin/env node
// Static server for the preview page: http://localhost:8130/player/preview.html
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { ROOT } from './lib/scan.mjs';

const PORT = +(process.env.PORT || 8130);
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.obj': 'text/plain', '.mtl': 'text/plain', '.mid': 'audio/midi', '.jpg': 'image/jpeg', '.png': 'image/png' };
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') { res.writeHead(302, { location: '/player/preview.html' }).end(); return; }
  const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const b = await readFile(p);
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(b);
  } catch { res.writeHead(404).end('not found'); }
}).listen(PORT, () => console.log(`preview: http://localhost:${PORT}/player/preview.html`));
