// Servidor local únic per a la PWA i l'API.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { handleApi } from './api.js';
import { tournamentRoute } from '../frontend/routes.js';

const root = resolve('frontend');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api/v1/')) {
    // Cap error d'una petició ha d'aturar el servidor de desenvolupament.
    try {
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
        duplex: 'half',
      });
      const response = await handleApi(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error(err);
      if (res.headersSent) { res.end(); return; }
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'No s’ha pogut completar la petició.' }));
    }
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400); res.end('Camí no vàlid'); return; }
  const served = /^\/(?:game(?:\/[^/]+(?:\/(?:points|rounds|edit))?)?|history(?:\/[^/]+(?:\/edit)?)?|shared\/[^/]+(?:\/rounds)?)$/.test(pathname) ? '/index.html'
    : tournamentRoute(pathname).mode !== 'missing' ? '/tournament.html'
      : pathname === '/' ? '/index.html' : pathname;
  const file = resolve(join(root, served));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error('No és un fitxer.');
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    if (req.method === 'HEAD') res.end(); else res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('No trobat'); }
});

const port = Number(process.env.PORT || 4173);
server.listen(port, () => console.log(`APPayo: http://localhost:${port}`));
