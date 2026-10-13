import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain, important } from '../src/core/glossary.mjs';
import { Match } from '../src/core/match.mjs';
import { PROVIDERS } from '../src/providers.mjs';

test('shell glossary splits operators, preserves quoted data, never guesses unknown commands', () => {
  const e = explain({ kind: 'shell', command: 'git status && npm test; unknown || cat "a|b" | head' });
  assert.deepEqual(e.steps.map(s => s.term), ['git status', 'npm test', 'unknown', 'cat', 'head']);
  assert.equal(e.steps[2].what, '');
  assert.ok(e.steps[0].what.includes('변경'));
  assert.ok(explain({ kind: 'shell', command: 'rm -rf folder' }).steps[0].what.includes('폴더'));
  for (const kind of ['read', 'write', 'edit', 'search', 'plan', 'delegate', 'other'])
    assert.ok(explain({ kind }).steps[0].what);
});

test('important flags failed tests and tricks but not passing tests', () => {
  assert.equal(important({ kind: 'shell', command: 'npm test' }, '# pass 0\n# fail 1'), true);
  assert.equal(important({ kind: 'shell', command: 'npm test' }, '# pass 1\n# fail 0'), false);
  assert.equal(important({ kind: 'shell', command: 'git reset --hard' }), true);
});

test('feed and snapshot expose tool explanations', () => {
  const m = new Match();
  m.push({ type: 'call', at: 1000, id: 'a', tool: { kind: 'read', path: 'main.js' } });
  m.push({ type: 'result', at: 2000, id: 'a', output: '' });
  const s = m.snapshot();
  assert.deepEqual(s.explain, s.feed[0].explain);
  assert.equal(s.feed[0].important, false);
  for (const id of ['opencode-go', 'openrouter', 'deepseek', 'xai'])
    assert.ok(PROVIDERS[id].models.every(m => m.id));
});
