import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage } from '../src/i18n/index.mjs';
import { PROVIDERS, METHOD_LABEL, describe, status, explain, hooks, test as testProvider } from '../src/providers.mjs';

const english = value => assert.doesNotMatch(JSON.stringify(value), /[가-힣]/);
test('provider metadata, status, descriptions and every error branch are English at call time', async ctx => {
  ctx.mock.method(hooks, 'where', async () => null);
  ctx.mock.method(globalThis, 'fetch', async () => ({ ok: true, text: async () => '{"models":[]}' }));
  try {
    setLanguage('en');
    english(PROVIDERS); english(METHOD_LABEL);
    const prefs = { providers: Object.fromEntries(Object.keys(PROVIDERS).map(id => [id, { via: PROVIDERS[id].methods[0] }])) };
    const secrets = { get: () => null, describe: () => ({ has: false, source: null }) };
    english(await status(prefs, secrets));
    ctx.mock.method(hooks, 'where', async () => '/test/cli');
    english(await status(prefs, secrets));
    ctx.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
    english(await status(prefs, secrets));
    const apiPrefs = { providers: Object.fromEntries(Object.entries(PROVIDERS).filter(([, p]) => p.methods.includes('api')).map(([id]) => [id, { via: 'api' }])) };
    english(await status(apiPrefs, secrets));
    for (const [provider, p] of Object.entries(PROVIDERS)) for (const via of p.methods) {
      const conf = { provider, via, model: p.defaultModel, url: p.defaultUrl };
      english(describe(conf));
      for (const err of [{ code: 'nomodel' }, { code: 'nourl' }, { offline: true }, { code: 'ENOENT' }, { status: 404 }, { status: 402 }, { status: 401 }, { status: 403 }, { status: 429 }, { status: 500 }, { killed: true }, {}, { message: 'unexpected response' }])
        english(explain(err, conf));
    }
    english(await testProvider(null));
    setLanguage('ko');
    assert.equal(PROVIDERS.compatible.label, 'OpenAI 호환 서버');
    assert.equal(METHOD_LABEL.api, 'API 키');
    assert.equal(explain({ status: 404 }).message, '모델을 찾지 못했어요. 모델 이름을 확인하거나 다른 모델을 고르세요.');
  } finally { setLanguage('ko'); }
});
