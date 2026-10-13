import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLanguage } from '../src/i18n/index.mjs';
import { Match } from '../src/core/match.mjs';
import { adapter } from '../src/adapters/claude-code.mjs';
import { Live } from '../src/live.mjs';
import { DEFAULTS } from '../src/settings.mjs';
import { buildProject } from '../src/project.mjs';
test('recorded match notes, rating and status rerender in English and back to Korean', () => {
  setLanguage('ko');
  const m = new Match({ id: 'fixture' });
  const parse = adapter.createParser();
  for (const row of readFileSync(new URL('./fixtures/claude-code-rrule.jsonl', import.meta.url), 'utf8').trim().split('\n'))
    for (const event of parse(JSON.parse(row))) m.push(event);
  const ko = m.snapshot();
  try {
    setLanguage('en');
    const en = m.snapshot();
    assert.doesNotMatch(JSON.stringify({ feed: en.feed.map(f => f.text), notes: en.moments.map(m => m.note), rating: en.rating, state: en.state, check: en.oneCheck, pushes: en.pushes, player: en.player }), /[가-힣]/);
    assert.equal(en.rating.score, ko.rating.score);
  } finally { setLanguage('ko'); }
  assert.deepEqual(m.snapshot().moments.map(m => m.note), ko.moments.map(m => m.note));
});
test('clash and notification copy follows the current language', () => {
  const players = ['a', 'b'].map((key, i) => {
    const m = new Match({ id: key });
    m.push({ type: 'call', at: i + 1, id: 'x', tool: { kind: 'edit', path: 'a.js' } });
    m.push({ type: 'result', at: i + 2, id: 'x', output: '' });
    return { key, snap: m.snapshot() };
  });
  const live = new Live({}, { value: structuredClone(DEFAULTS) });
  try {
    setLanguage('en');
    const p = buildProject({ cwd: '' }, players);
    assert.equal(p.moments.find(m => m.type === 'clash').auto.caster, 'Two agents edited the same file.');
    const alerts = []; live.onAlert = a => alerts.push(a);
    live.check({ key: 'x', agentLabel: 'Claude' }, { player: 'Player', title: 'Project', state: { code: 'quiet' }, finished: true, rating: { score: 8 }, oneCheck: 'Check tests', moments: [{ key: 'stuck@1', type: 'stuck', note: 'Three failures' }] }, { moments: new Set(), quiet: false, finished: false });
    assert.equal(alerts.length, 3);
    assert.doesNotMatch(JSON.stringify(alerts), /[가-힣]/);
  } finally { setLanguage('ko'); }
});
