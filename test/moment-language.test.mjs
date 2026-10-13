import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage, catalogs } from '../src/i18n/index.mjs';
import { MOMENT_LABEL, MOMENT_GROUPS, MomentTracker, extraCallMoments } from '../src/core/moments.mjs';
import { Match } from '../src/core/match.mjs';
test('moment labels, group copy and stored detector notes change language without replay', () => {
  setLanguage('ko');
  const m = new Match();
  m.push({ type: 'call', at: 1, id: 'a', tool: { kind: 'read', path: '.env' } });
  m.push({ type: 'result', at: 2, id: 'a', output: '' });
  const korean = m.snapshot().moments[0].note;
  assert.equal(korean, '인증 정보가 있을 수 있는 파일을 읽었습니다.');
  try {
    setLanguage('en');
    assert.doesNotMatch(JSON.stringify(MOMENT_LABEL), /[가-힣]/);
    assert.doesNotMatch(JSON.stringify(MOMENT_GROUPS), /[가-힣]/);
    assert.equal(m.snapshot().moments[0].note, 'Read a file that may contain credentials.');
    const tracker = new MomentTracker();
    for (const ev of [...tracker.usage(10), ...tracker.compact(1), ...extraCallMoments({ kind: 'edit', deleted: true })]) {
      assert.doesNotMatch(ev.note, /[가-힣]/);
      assert.ok(!ev.note.includes('[object Object]'));
    }
    assert.deepEqual(Object.keys(catalogs.ko).filter(k => k.startsWith('moment.')).sort(), Object.keys(catalogs.en).filter(k => k.startsWith('moment.')).sort());
  } finally { setLanguage('ko'); }
  assert.equal(m.snapshot().moments[0].note, korean);
});
