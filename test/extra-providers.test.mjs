import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ask, resolve, PROVIDERS, describe } from '../src/providers.mjs';
import { sanitize } from '../src/settings.mjs';

test('additional providers select their documented wire and endpoints', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    return { ok: true, text: async () => JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }],
      content: [{ type: 'text', text: '{"ok":true}' }],
      output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }],
    }) };
  });
  for (const [provider, model, suffix] of [
    ['opencode-go', 'glm-5.2', '/chat/completions'],
    ['opencode-go', 'claude-opus-5-5', '/messages'],
    ['opencode-go', 'gpt-5', '/responses'],
    ['openrouter', 'openrouter/auto', '/chat/completions'],
    ['deepseek', 'deepseek-v4-pro', '/chat/completions'],
    ['xai', 'grok-4.5', '/chat/completions'],
  ]) {
    const result = await ask({ provider, via: 'api', model, key: 'secret' }, 'prompt', 'system');
    const c = calls.at(-1);
    assert.equal(c.url, PROVIDERS[provider].defaultUrl + suffix);
    assert.equal(c.body.model, model);
    assert.equal(result.text, '{"ok":true}');
    if (model.startsWith('claude')) {
      assert.equal(c.headers['x-api-key'], 'secret');
      assert.equal(c.headers['anthropic-version'], '2023-06-01');
      assert.equal(c.body.system, 'system');
    } else {
      assert.equal(c.headers.authorization, 'Bearer secret');
      if (model.startsWith('gpt')) assert.equal(c.body.instructions, 'system');
      else assert.equal(c.body.messages[0].content, 'system');
    }
    if (provider === 'openrouter') {
      assert.equal(c.headers['HTTP-Referer'], 'https://github.com/cronoboris/coding-live');
      assert.equal(c.headers['X-OpenRouter-Title'], 'coding live');
    }
  }
});

test('new providers accept environment keys and settings, saved keys win', async () => {
  for (const provider of ['opencode-go', 'openrouter', 'deepseek', 'xai']) {
    const env = PROVIDERS[provider].envKeys[0], old = process.env[env];
    process.env[env] = 'environment-key';
    try {
      const settings = sanitize({ commentary: { provider } });
      const conf = await resolve(settings.commentary);
      assert.equal(conf.key, 'environment-key');
      assert.equal(conf.model, PROVIDERS[provider].defaultModel);
      assert.ok(describe(conf).includes(PROVIDERS[provider].label));
      assert.equal((await resolve(settings.commentary, { get: () => 'saved-key' })).key, 'saved-key');
    } finally {
      if (old === undefined) delete process.env[env]; else process.env[env] = old;
    }
  }
  const legacy = sanitize({ commentary: { provider: 'compatible', providers: { compatible: { via: 'api', url: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' } } } });
  assert.equal((await resolve(legacy.commentary)).provider, 'compatible');
});
