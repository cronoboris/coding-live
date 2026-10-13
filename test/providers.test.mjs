import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ask, explain, resolve, status, test as testProvider } from '../src/providers.mjs';
import { envSecrets, fileSecrets } from '../src/secrets.mjs';
import { sanitize } from '../src/settings.mjs';
import { Booth } from '../src/mic.mjs';
import { Match } from '../src/core/match.mjs';

// One fake server for every provider's HTTP API; it records what it was sent.
let server, url, seen = [];
before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const j = body ? JSON.parse(body) : null;
      seen.push({ url: req.url, method: req.method, headers: req.headers, body: j });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers['x-api-key'] === 'bad' || req.headers.authorization === 'Bearer bad') return send(401, { error: { message: 'invalid x-api-key' } });
      if (j?.model === 'nope') return send(404, { error: { message: 'model: nope not found' } });
      if (j?.model === 'busy') return send(429, { error: { message: 'rate limit exceeded' } });
      if (req.url === '/v1/messages') return send(200, { content: [{ type: 'text', text: '{"ok": true}' }], usage: { input_tokens: 10, output_tokens: 5 } });
      if (req.url === '/v1/chat/completions' || req.url === '/chat/completions') return send(200, { choices: [{ message: { content: '{"ok": true}' } }], usage: { total_tokens: 12 } });
      if (/^\/models\/[^/]+:generateContent$/.test(req.url)) return send(200, { candidates: [{ content: { parts: [{ text: '{"ok": true}' }] } }], usageMetadata: { totalTokenCount: 9 } });
      if (req.url === '/api/tags') return send(200, { models: [{ name: 'qwen3:8b' }, { name: 'gemma3:12b' }] });
      if (req.url === '/api/chat') return send(200, { message: { content: '{"caster": "들어갑니다!", "line": "좋아요.", "ask": "다시 돌려 줘."}' }, prompt_eval_count: 3, eval_count: 4 });
      send(404, { error: 'unknown' });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
const last = () => seen.at(-1);

test('each provider API gets the right request shape', async () => {
  let r = await ask({ provider: 'anthropic', via: 'api', model: 'claude-haiku-5-5', key: 'sk-ant-test', url }, 'hi', 'SYS');
  assert.equal(r.text, '{"ok": true}'); assert.equal(r.tokens, 15);
  assert.equal(last().url, '/v1/messages'); assert.equal(last().headers['x-api-key'], 'sk-ant-test'); assert.equal(last().headers['anthropic-version'], '2023-06-01');
  assert.equal(last().body.system, 'SYS'); assert.equal(last().body.model, 'claude-haiku-5-5');

  r = await ask({ provider: 'openai', via: 'api', model: '', key: 'sk-test', url: `${url}/v1` }, 'hi', 'SYS');
  assert.equal(r.text, '{"ok": true}');
  assert.equal(last().headers.authorization, 'Bearer sk-test'); assert.equal(last().body.model, 'gpt-5-mini'); assert.deepEqual(last().body.response_format, { type: 'json_object' });
  assert.deepEqual(last().body.messages.map(m => m.role), ['system', 'user']);

  r = await ask({ provider: 'google', via: 'api', model: 'gemini-2.5-flash', key: 'AIza-test', url }, 'hi', 'SYS');
  assert.equal(r.text, '{"ok": true}');
  assert.equal(last().url, '/models/gemini-2.5-flash:generateContent'); assert.equal(last().headers['x-goog-api-key'], 'AIza-test');
  assert.equal(last().body.systemInstruction.parts[0].text, 'SYS');

  r = await ask({ provider: 'ollama', via: 'local', model: 'qwen3:8b', url }, 'hi', 'SYS');
  assert.match(r.text, /들어갑니다/); assert.equal(last().body.format, 'json'); assert.equal(last().body.stream, false);

  await ask({ provider: 'compatible', via: 'api', model: 'local-model', url, key: null }, 'hi', 'SYS');
  assert.equal(last().url, '/chat/completions'); assert.equal(last().headers.authorization, undefined, 'no key, no auth header');
});

test('failures turn into one fixable reason', async () => {
  const fail = conf => ask(conf, 'hi', 'SYS').then(() => null, e => explain(e, conf));
  assert.equal((await fail({ provider: 'anthropic', via: 'api', key: 'bad', url })).code, 'auth');
  assert.match((await fail({ provider: 'anthropic', via: 'api', key: 'bad', url })).message, /API 키/);
  assert.equal((await fail({ provider: 'openai', via: 'api', key: 'k', model: 'nope', url })).code, 'model');
  assert.equal((await fail({ provider: 'openai', via: 'api', key: 'k', model: 'busy', url })).code, 'rate');
  const off = await fail({ provider: 'ollama', via: 'local', model: 'x', url: 'http://127.0.0.1:9' });
  assert.equal(off.code, 'offline'); assert.match(off.message, /Ollama/);
  assert.equal((await fail({ provider: 'ollama', via: 'local', model: '', url })).code, 'model');
  assert.equal(explain(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }), { provider: 'anthropic', via: 'cli' }).code, 'missing');
});

test('auto picks the first provider that is ready; a chosen one is used only if ready', async () => {
  const path = process.env.PATH;
  process.env.PATH = mkdtempSync(join(tmpdir(), 'nopath-')); // no CLIs at all
  try {
    const secrets = envSecrets({ GEMINI_API_KEY: 'AIza-env-key-123' });
    const c = sanitize({ commentary: { provider: 'auto' } }).commentary;
    c.providers.ollama.url = 'http://127.0.0.1:9'; // not running
    const conf = await resolve(c, secrets);
    assert.equal(conf.provider, 'google'); assert.equal(conf.via, 'api'); assert.equal(conf.key, 'AIza-env-key-123');
    assert.equal(await resolve({ ...c, provider: 'anthropic' }, secrets), null);
    assert.equal(await resolve({ ...c, provider: 'off' }, secrets), null);
    const local = await resolve({ ...c, provider: 'ollama', providers: { ...c.providers, ollama: { via: 'local', model: '', url } } }, secrets);
    assert.equal(local.model, 'gemma3:12b', 'no model chosen: the first installed one');
    const st = await status({ ...c, providers: { ...c.providers, ollama: { via: 'local', model: '', url } } }, secrets);
    const g = st.find(p => p.id === 'google');
    assert.equal(g.key.source, 'env'); assert.equal(g.key.hint, '…-123'); assert.equal(JSON.stringify(st).includes('AIza-env-key-123'), false, 'status never carries a key');
    assert.deepEqual(st.find(p => p.id === 'ollama').ollama.models, ['gemma3:12b', 'qwen3:8b']);
    assert.equal(st.find(p => p.id === 'anthropic').reason, 'Claude Code가 설치돼 있지 않아요');
  } finally { process.env.PATH = path; }
});

test('a provider test reports time and tokens', async () => {
  const r = await testProvider({ provider: 'anthropic', via: 'api', key: 'k', url, model: 'claude-haiku-5-5' });
  assert.equal(r.ok, true); assert.equal(r.tokens, 15); assert.match(r.label, /Anthropic · Haiku 5\.5/);
  assert.equal((await testProvider(null)).ok, false);
});

test('saved keys are encrypted at rest and never shown whole', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'sec-')), 'secrets.json');
  const crypt = { encrypt: s => Buffer.from([...s].reverse().join('')), decrypt: b => [...b.toString()].reverse().join('') };
  const s = fileSecrets(file, crypt, { OPENAI_API_KEY: 'sk-from-env-0000' });
  assert.deepEqual(s.describe('openai'), { has: true, source: 'env', env: 'OPENAI_API_KEY', hint: '…0000' });
  assert.equal((await s.set('openai', 'sk-saved-key-9876')).ok, true);
  assert.equal(s.get('openai'), 'sk-saved-key-9876');
  assert.equal(s.describe('openai').source, 'saved');
  assert.equal(readFileSync(file, 'utf8').includes('sk-saved-key-9876'), false);
  assert.equal((await s.set('openai', 'short')).ok, false);
  assert.equal((await s.set('ollama', 'whatever-key')).ok, false, 'Ollama takes no key');
  await s.set('openai', null);
  assert.equal(s.get('openai'), 'sk-from-env-0000');
  assert.equal(fileSecrets(file, crypt, {}).get('openai'), null);
});

test('settings: old backend migrates, limits can be unlimited, only local servers take an address', () => {
  const a = sanitize({ commentary: { backend: 'codex', maxCalls: 60 } }).commentary;
  assert.equal(a.provider, 'openai'); assert.equal(a.maxCalls, 60); assert.equal(a.teach, 'full');
  const b = sanitize({ commentary: { provider: 'compatible', maxCalls: null, providers: { compatible: { via: 'api', url: 'http://127.0.0.1:1234/v1', model: 'm' }, google: { url: 'http://evil.example' } } } }).commentary;
  assert.equal(b.maxCalls, null); assert.equal(b.providers.compatible.url, 'http://127.0.0.1:1234/v1'); assert.equal(b.providers.google.url, '');
  assert.equal(sanitize({ commentary: { maxCalls: 5000 } }).commentary.maxCalls, 1000);
});

test('an unlimited booth covers every key moment; a limited one stops at the limit', async () => {
  const fill = m => {
    m.push({ type: 'prompt', at: 0, text: 'fix it' });
    for (let k = 1; k <= 5; k++) {
      m.push({ type: 'call', at: k * 61000, id: `a${k}`, tool: { kind: 'shell', command: 'npm test' } });
      m.push({ type: 'result', at: k * 61000 + 1, id: `a${k}`, output: k % 2 ? '# pass 1\n# fail 1' : '# pass 2\n# fail 0' });
    }
    return m;
  };
  const conf = { provider: 'ollama', via: 'local', model: 'qwen3:8b', url };
  const run = async max => {
    const m = new Match(), booth = new Booth(conf, { max });
    booth.connect(m); // the mic connected before the match began, so every moment is new
    fill(m);
    await new Promise(done => { booth.cover(m, () => { if (!booth.queue.length && !booth.busy) done(); }); setTimeout(done, 3000); });
    await new Promise(r => setTimeout(r, 50));
    return { moments: m.moments.length, commented: [...m.comments.values()].filter(c => c.caster).length };
  };
  const all = await run(null);
  assert.ok(all.moments >= 4); assert.equal(all.commented, all.moments);
  assert.equal((await run(2)).commented, 2);
  const s = fill(new Match()).snapshot();
  assert.ok(s.moments.every(x => x.auto?.line), 'every moment has fixed commentary to fall back on');
});
