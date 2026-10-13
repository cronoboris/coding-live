// Browser mode (`coding-live` on the command line): a local-only HTTP server for the same UI the desktop app shows.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { Live } from './live.mjs';
import { MOMENT_GROUPS } from './core/moments.mjs';

const UI = fileURLToPath(new URL('../ui/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const STATIC = new Set(['index.html', 'app.js', 'settings.js', 'widget.html', 'widget.js', 'shared.js', 'transport.js', 'filemap.js', 'onboard.js', 'i18n.js', 'style.css', 'widget.css', 'manifest.webmanifest', 'sw.js', 'icon.svg']);

export async function startServer({ port = 4417, host = '127.0.0.1', mic, env = process.env, settingsFile = join(homedir(), '.coding-live', 'settings.json') } = {}) {
  const live = await Live.create({ mic, env, settingsFile });
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

  const server = createServer(async (req, res) => {
    // Transcripts are private: refuse anything that is not addressed to this loopback server by name
    // (blocks DNS rebinding), and require a custom header on writes (blocks cross-site form posts).
    if (!allowedHosts.has(req.headers.host ?? '')) { res.writeHead(421).end(); return; }
    const path = new URL(req.url, `http://${req.headers.host}`).pathname;
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    try {
      if (req.method === 'GET' && (path === '/' || STATIC.has(path.slice(1)))) {
        const file = path === '/' ? 'index.html' : path.slice(1);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache', ...(file.endsWith('.html') ? { 'x-frame-options': 'DENY' } : {}) });
        res.end(await readFile(join(UI, file)));
        return;
      }
      if (req.method === 'GET' && path === '/api/info') return json(res, 200, live.info());
      if (req.method === 'GET' && path === '/api/sessions') return json(res, 200, { sessions: live.sessions() });
      if (req.method === 'GET' && path === '/api/projects') return json(res, 200, { projects: live.listProjects() });
      const pm = /^\/api\/project\/([\w-]+)\/(stream|mic)$/.exec(path);
      if (pm && pm[2] === 'stream' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
        const stop = await live.subscribeProject(pm[1], snap => res.write(`data: ${JSON.stringify(snap)}\n\n`));
        if (!stop) { res.end('event: gone\ndata: {}\n\n'); return; }
        req.on('close', stop);
        return;
      }
      if (pm && pm[2] === 'mic') {
        if (req.method !== 'POST' || req.headers['x-coding-live'] !== '1') return json(res, 403, { error: 'forbidden' });
        return json(res, 200, live.setMicProject(pm[1], !!JSON.parse((await readBody(req)) || '{}').on));
      }
      if (req.method === 'GET' && path === '/api/settings') return json(res, 200, live.getSettings());
      if (req.method === 'GET' && path === '/api/moment-groups') return json(res, 200, MOMENT_GROUPS);
      if (req.method === 'GET' && path === '/api/agents') return json(res, 200, live.agentStatus());
      if (req.method === 'GET' && path === '/api/mic') return json(res, 200, await live.micStatus());
      if (path === '/api/mic/test') {
        if (req.method !== 'POST' || req.headers['x-coding-live'] !== '1') return json(res, 403, { error: 'forbidden' });
        const { provider } = JSON.parse((await readBody(req)) || '{}');
        return json(res, 200, await live.testMic(typeof provider === 'string' ? provider : null));
      }
      if (path === '/api/settings' && req.method === 'POST') {
        if (req.headers['x-coding-live'] !== '1') return json(res, 403, { error: 'forbidden' });
        return json(res, 200, await live.updateSettings(JSON.parse((await readBody(req)) || '{}')));
      }
      if (path === '/api/tutorial' || path === '/api/tutorial/stop') {
        if (req.method !== 'POST' || req.headers['x-coding-live'] !== '1') return json(res, 403, { error: 'forbidden' });
        return json(res, 200, path === '/api/tutorial' ? await live.startTutorial() : await live.stopTutorial());
      }
      const f = /^\/api\/project\/([\w-]+)\/file$/.exec(path);
      if (f) {
        if (req.method !== 'POST' || req.headers['x-coding-live'] !== '1') return json(res, 403, { error: 'forbidden' });
        const { path: file } = JSON.parse((await readBody(req)) || '{}');
        return json(res, 200, await live.explainFile(f[1], typeof file === 'string' ? file : ''));
      }
      const m = /^\/api\/match\/([\w-]+)\/(stream|mic|review)$/.exec(path);
      if (!m) return json(res, 404, { error: 'not found' });
      const [, key, action] = m;
      if (action === 'stream' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
        const stop = await live.subscribe(key, snap => res.write(`data: ${JSON.stringify(snap)}\n\n`));
        if (!stop) { res.end('event: gone\ndata: {}\n\n'); return; }
        req.on('close', stop);
        return;
      }
      if (req.method !== 'POST' || req.headers['x-coding-live'] !== '1') return json(res, 403, { error: 'forbidden' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = action === 'mic' ? live.setMic(key, !!body.on) : await live.review(key);
      return json(res, r.error ? (r.error.startsWith('not watching') ? 404 : 409) : 200, r);
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, hub: live.hub, live, backend: live.backend, url: `http://127.0.0.1:${port}/`, close: () => { live.close(); server.close(); } };
}

const readBody = req => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', c => { data += c; if (data.length > 1e5) { reject(new Error('too large')); req.destroy(); } });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});
