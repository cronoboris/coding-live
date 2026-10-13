import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage, register, t } from '../src/i18n/index.mjs';
import { Match, playerName } from '../src/core/match.mjs';
import { caster, LANES } from '../src/core/caster.mjs';
test('existing feed captions and model labels rerender without replay', () => {
  const m = new Match();
  setLanguage('ko');
  m.push({ type: 'call', at: 1, id: 'x', tool: { kind: 'read', path: 'src/a.js' } });
  m.push({ type: 'result', at: 2, id: 'x', output: '' });
  assert.equal(m.snapshot().feed[0].text, '`a.js` 파일을 읽습니다');
  try {
    setLanguage('en');
    assert.equal(m.snapshot().feed[0].text, 'Reads `a.js`');
    assert.equal(playerName('claude-opus-5-5'), 'Opus 5.5');
    assert.equal(playerName('gemini-2.5-flash'), 'Gemini 2.5 Flash');
    assert.equal(LANES[0], 'Reading');
    for (const tool of [{kind:'write',path:'a.js',content:'x'}, {kind:'shell',command:'npm test'}, {kind:'shell',command:'git status'}, {kind:'delegate'}])
      assert.doesNotMatch(caster(tool).text, /[가-힣]/);
    register('ko', { 'test.registration': '등록' });
    register('en', { 'test.registration': 'Registered' });
    assert.equal(t('test.registration'), 'Registered');
  } finally { setLanguage('ko'); }
  assert.equal(m.snapshot().feed[0].text, '`a.js` 파일을 읽습니다');
});
test('non-code files use a neutral file caption in both languages', () => {
  try {
    for (const lang of ['ko', 'en']) {
      setLanguage(lang);
      for (const path of ['MEMORY.md', 'notes.txt', 'data.json', 'ci.yml', 'rows.csv', 'image.png'])
        assert.doesNotMatch(caster({ kind: 'write', path, content: 'x' }).text, /코드 파일|code file/);
      assert.match(caster({ kind: 'write', path: 'app.js', content: 'x' }).text, lang === 'ko' ? /코드 파일/ : /code file/);
    }
  } finally { setLanguage('ko'); }
});
