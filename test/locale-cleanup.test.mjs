import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage, language } from '../src/i18n/index.mjs';
import { adapter } from '../src/adapters/mixdog.mjs';
import { demoAdapter } from '../src/demo.mjs';
import { envSecrets } from '../src/secrets.mjs';
import { Live } from '../src/live.mjs';
import { Match } from '../src/core/match.mjs';
test('adapter, demo and secret messages respond to a language change', async () => {
  const secrets = envSecrets({});
  try {
    setLanguage('ko'); assert.equal(adapter.label, '믹스독');
    setLanguage('en'); assert.equal(adapter.label, 'mixdog');
    assert.equal(demoAdapter.labelOf('/demo/claude-code/a.jsonl'), 'Claude Code (demo)');
    assert.doesNotMatch(secrets.whyNot, /[가-힣]/);
    assert.doesNotMatch((await secrets.set()).error, /[가-힣]/);
  } finally { setLanguage('ko'); }
});
test('Live uses the supplied desktop locale, while explicit choices override it', () => {
  try {
    new Live({}, { value: { general: { language: 'system' } } }, { locale: 'ko-KR' });
    assert.equal(language(), 'ko');
    new Live({}, { value: { general: { language: 'system' } } }, { locale: 'en-GB' });
    assert.equal(language(), 'en');
    new Live({}, { value: { general: { language: 'ko' } } }, { locale: 'en-GB' });
    assert.equal(language(), 'ko');
  } finally { setLanguage('ko'); }
});
test('stored glossary explanations rerender; cached reviews never leak across languages', async () => {
  const m = new Match();
  const key = Buffer.from('demo\0/session').toString('base64url');
  const live = new Live({ tails: new Map([[key, { match: m }]]), sessions: [], emit() {} }, { value: { general: { language: 'ko' } } });
  m.push({ type: 'call', at: 1, id: 'r', tool: { kind: 'read', path: 'a.js' } });
  m.push({ type: 'result', at: 2, id: 'r', output: '' });
  m.push({ type: 'end', at: 3, text: 'Done' });
  live.backend = 'test';
  live.booth.review = async () => ({ headline: '한글 리포트' });
  try {
    await live.review(key);
    assert.equal(live.snapshot(key).review.headline, '한글 리포트');
    setLanguage('en');
    assert.equal(live.snapshot(key).review, null);
    assert.doesNotMatch(JSON.stringify(m.snapshot().feed[0].explain.steps), /[가-힣]/);
    setLanguage('ko');
    assert.equal(live.snapshot(key).review.headline, '한글 리포트');
  } finally { setLanguage('ko'); }
});
