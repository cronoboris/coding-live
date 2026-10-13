import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, MOMENT_LABEL } from '../src/core/match.mjs';
import { autoComment } from '../src/core/lessons.mjs';
test('every label and fallback uses factual Korean, not borrowed sports terminology', () => {
  const forbidden = /실점|골|만회|VAR|태클|주심|감독|작전 타임|경기 지연|슈팅|패스/;
  const m = new Match();
  for (const [type, label] of Object.entries(MOMENT_LABEL)) {
    const auto = autoComment(m, { type, at: 0, note: '기록' });
    assert.ok(label && auto.caster && auto.line, type);
    assert.doesNotMatch(`${label} ${auto.caster} ${auto.line}`, forbidden, type);
  }
  m.push({ type: 'prompt', at: 0, text: '작업' });
  assert.doesNotMatch(JSON.stringify(m.snapshot(999999).pushes), forbidden);
  m.push({ type: 'think', at: 1000 });
  assert.doesNotMatch(m.state(181001).text, forbidden);
});
