import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ask, explain, resolve, status, hooks, PROVIDERS, ORDER, MARK } from '../src/providers.mjs';
import { sanitize } from '../src/settings.mjs';

// Stand-ins for the installed agents: `run` records what would have been spawned and returns a canned reply.
const stubRun = (t, reply) => {
  const calls = [];
  t.mock.method(hooks, 'run', async (bin, args, input) => {
    calls.push({ bin, args, input });
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return calls;
};
// `found` lists the binaries that are "installed".
const stubWhere = (t, found) => t.mock.method(hooks, 'where', async bin => (found.includes(bin) ? `/usr/local/bin/${bin}` : null));
const failure = (conf, err) => ask(conf, 'PROMPT', 'PERSONA').then(() => null, e => explain(e, conf));

test('Cursor CLI: print mode with JSON output, optional model, marker and persona in the input', async t => {
  assert.deepEqual(PROVIDERS.cursor.methods, ['cli']);
  assert.equal(PROVIDERS.cursor.cli.bin, 'agent');
  assert.match(PROVIDERS.cursor.setupUrl, /^https:\/\/cursor\.com\//);
  assert.ok(ORDER.indexOf('cursor') > ORDER.indexOf('openai') && ORDER.indexOf('cursor') < ORDER.indexOf('ollama'));

  const calls = stubRun(t, JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{"ok": true}' }));
  const r = await ask({ provider: 'cursor', via: 'cli', model: 'gpt-5' }, 'PROMPT', 'PERSONA');
  assert.equal(r.text, '{"ok": true}');
  assert.deepEqual(calls[0].args, ['-p', '--output-format', 'json', '--model', 'gpt-5']);
  assert.equal(calls[0].input, `${MARK}\nPERSONA\n\nPROMPT`);

  await ask({ provider: 'cursor', via: 'cli', model: '' }, 'PROMPT', 'PERSONA');
  assert.deepEqual(calls.at(-1).args, ['-p', '--output-format', 'json'], 'no model typed: the CLI default');
});

test('Cursor CLI: a failed result, a missing binary and a logged-out CLI each give one reason', async t => {
  const conf = { provider: 'cursor', via: 'cli', model: '' };
  stubRun(t, JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Not logged in' }));
  const auth = await failure(conf);
  assert.equal(auth.code, 'auth');
  assert.match(auth.message, /agent login/);

  stubRun(t, Object.assign(new Error('spawn agent ENOENT'), { code: 'ENOENT' }));
  const missing = await failure(conf);
  assert.equal(missing.code, 'missing');
  assert.match(missing.message, /Cursor CLI를 찾지 못했어요/);

  stubRun(t, Object.assign(new Error('Command failed'), { stderr: 'Error: not logged in. Run `agent login`.' }));
  assert.equal((await failure(conf)).code, 'auth');
});

test('Cursor CLI: not installed shows up in status and blocks an explicit choice', async t => {
  stubWhere(t, []);
  assert.equal(await resolve({ provider: 'cursor', providers: { cursor: { via: 'cli' } } }, null), null);
  const st = await status({ provider: 'cursor', providers: {} }, null);
  const cursor = st.find(p => p.id === 'cursor');
  assert.equal(cursor.cli.installed, false);
  assert.equal(cursor.ready, false);
  assert.equal(cursor.reason, 'Cursor CLI가 설치돼 있지 않아요');
});

test('auto reaches an installed Cursor CLI after the CLIs ahead of it, and skips it when absent', async t => {
  const keys = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY'];
  const saved = keys.map(k => process.env[k]);
  keys.forEach(k => delete process.env[k]);
  try {
    const c = sanitize({ commentary: { provider: 'auto' } }).commentary;
    stubWhere(t, ['agent']);
    const conf = await resolve(c, null);
    assert.equal(conf.provider, 'cursor'); assert.equal(conf.via, 'cli'); assert.equal(conf.model, '');
    stubWhere(t, []);
    assert.notEqual((await resolve(c, null))?.provider, 'cursor');
  } finally {
    keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
  }
});

test('Copilot CLI: piped prompt with -s and --no-ask-user, recommended model flag, marker and persona', async t => {
  assert.deepEqual(PROVIDERS.copilot.methods, ['cli']);
  assert.equal(PROVIDERS.copilot.cli.bin, 'copilot');
  assert.equal(PROVIDERS.copilot.defaultModel, 'claude-haiku-4.5');
  assert.match(PROVIDERS.copilot.setupUrl, /^https:\/\/docs\.github\.com\/en\/copilot\//);
  assert.equal(ORDER[ORDER.indexOf('cursor') + 1], 'copilot');

  const calls = stubRun(t, 'Copilot 답변\n');
  const r = await ask({ provider: 'copilot', via: 'cli', model: 'gpt-5.4' }, 'PROMPT', 'PERSONA');
  assert.equal(r.text, 'Copilot 답변\n');
  assert.deepEqual(calls[0].args, ['-s', '--no-ask-user', '--model', 'gpt-5.4']);
  assert.equal(calls[0].input, `${MARK}\nPERSONA\n\nPROMPT`);

  await ask({ provider: 'copilot', via: 'cli', model: '' }, 'PROMPT', 'PERSONA');
  assert.deepEqual(calls.at(-1).args, ['-s', '--no-ask-user'], 'no model typed: the CLI default');
});

test('Copilot CLI: login and install problems each give one reason', async t => {
  const conf = { provider: 'copilot', via: 'cli', model: '' };
  stubRun(t, Object.assign(new Error('Command failed'), { stderr: 'Not authenticated. Run /login' }));
  const auth = await failure(conf);
  assert.equal(auth.code, 'auth');
  assert.match(auth.message, /`\/login`/);

  stubRun(t, Object.assign(new Error('spawn copilot ENOENT'), { code: 'ENOENT' }));
  assert.match((await failure(conf)).message, /Copilot CLI를 찾지 못했어요/);

  stubWhere(t, []);
  const st = await status({ provider: 'copilot', providers: {} }, null);
  assert.equal(st.find(p => p.id === 'copilot').reason, 'Copilot CLI가 설치돼 있지 않아요');
});

test('Qwen Code: -p with piped input, recommended model flag, marker and persona', async t => {
  assert.deepEqual(PROVIDERS.qwen.methods, ['cli']);
  assert.equal(PROVIDERS.qwen.cli.bin, 'qwen');
  assert.equal(PROVIDERS.qwen.defaultModel, 'qwen3-coder-plus');
  assert.match(PROVIDERS.qwen.setupUrl, /^https:\/\/qwenlm\.github\.io\/qwen-code-docs\//);
  assert.equal(ORDER[ORDER.indexOf('copilot') + 1], 'qwen');

  const calls = stubRun(t, 'Qwen 답변');
  const r = await ask({ provider: 'qwen', via: 'cli', model: 'qwen3-coder-plus' }, 'PROMPT', 'PERSONA');
  assert.equal(r.text, 'Qwen 답변');
  assert.deepEqual(calls[0].args, ['-m', 'qwen3-coder-plus', '-p', '입력으로 받은 지시를 따라 답해.']);
  assert.equal(calls[0].input, `${MARK}\nPERSONA\n\nPROMPT`);

  await ask({ provider: 'qwen', via: 'cli', model: '' }, 'PROMPT', 'PERSONA');
  assert.deepEqual(calls.at(-1).args, ['-p', '입력으로 받은 지시를 따라 답해.'], 'no model typed: the CLI default');
});

test('Qwen Code: login, install and missing-binary problems each give one reason', async t => {
  const conf = { provider: 'qwen', via: 'cli', model: '' };
  stubRun(t, Object.assign(new Error('Command failed'), { stderr: 'Please log in to continue' }));
  const auth = await failure(conf);
  assert.equal(auth.code, 'auth');
  assert.match(auth.message, /`qwen`/);

  stubRun(t, Object.assign(new Error('spawn qwen ENOENT'), { code: 'ENOENT' }));
  assert.match((await failure(conf)).message, /Qwen Code를 찾지 못했어요/);

  stubWhere(t, []);
  const st = await status({ provider: 'qwen', providers: {} }, null);
  assert.equal(st.find(p => p.id === 'qwen').reason, 'Qwen Code가 설치돼 있지 않아요');
});

test('opencode, Amp and Grok CLIs: documented non-interactive modes, model flags and order', async t => {
  assert.deepEqual(ORDER.slice(ORDER.indexOf('qwen') + 1, ORDER.indexOf('ollama')), ['opencode', 'amp', 'grok']);
  const calls = stubRun(t, '답변');

  assert.equal((await ask({ provider: 'opencode', via: 'cli', model: 'anthropic/claude-haiku-4-5' }, 'PROMPT', 'PERSONA')).text, '답변');
  const [run, m, model, f, file, message] = calls[0].args;
  assert.deepEqual([run, m, model, f, message], ['run', '-m', 'anthropic/claude-haiku-4-5', '-f', '첨부한 파일의 지시를 따라 답해.']);
  const { readFileSync } = await import('node:fs');
  assert.equal(readFileSync(file, 'utf8'), `${MARK}\nPERSONA\n\nPROMPT`);

  await ask({ provider: 'amp', via: 'cli', model: '' }, 'PROMPT', 'PERSONA');
  assert.deepEqual(calls[1].args, ['-x']);
  assert.equal(calls[1].input, `${MARK}\nPERSONA\n\nPROMPT`);

  await ask({ provider: 'grok', via: 'cli', model: 'grok-4.5' }, 'PROMPT', 'PERSONA');
  assert.deepEqual(calls[2].args.slice(0, 5), ['--no-auto-update', '-m', 'grok-4.5', '--output-format', 'plain']);
  assert.equal(calls[2].args[5], '-p');
  assert.match(calls[2].args[6], /^\[coding-live 해설 요청\][\s\S]*PROMPT$/);
});

test('opencode, Amp and Grok CLIs: not installed shows one reason each', async t => {
  stubWhere(t, []);
  const st = await status({ provider: 'auto', providers: {} }, null);
  for (const id of ['opencode', 'amp', 'grok']) assert.match(st.find(p => p.id === id).reason, /설치돼 있지 않아요/);
});
