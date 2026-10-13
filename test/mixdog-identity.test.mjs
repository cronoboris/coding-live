import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDocument, normalizeTool } from '../src/adapters/mixdog.mjs';
import { Match } from '../src/core/match.mjs';
import { DEFAULTS, sanitize } from '../src/settings.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/mixdog-subagent.json', import.meta.url), 'utf8'));

test('mixdog user, cli and agent documents produce nonempty feeds', () => {
  for (const owner of ['user', 'cli', 'agent']) {
    const events = parseDocument(JSON.stringify({ ...fixture, owner }));
    const match = new Match();
    events.forEach(event => match.push(event));
    assert.ok(match.snapshot().feed.length > 0, owner);
    assert.deepEqual(events.find(event => event.type === 'role'), {
      type: 'role', at: Date.parse(fixture.createdAt), parent: 'sess_parent',
      role: 'worker', tag: 'tool-explain', name: 'tool-explain',
    });
  }
  assert.deepEqual(parseDocument(JSON.stringify({ ...fixture, owner: 'unsupported' })), []);
});

test('mixdog delegation retains linking information and a bounded task summary', () => {
  const tool = normalizeTool('agent', { type: 'spawn', tag: 'tools', agent: 'worker', prompt: 'Read\n the tools' });
  assert.deepEqual(tool, { name: 'agent', kind: 'delegate', type: 'spawn', tag: 'tools', agent: 'worker', prompt: 'Read the tools' });
  assert.equal(normalizeTool('agent', { prompt: 'x'.repeat(200) }).prompt.length, 160);
});

test('tool explanations default on and retain boolean settings', () => {
  assert.equal(DEFAULTS.commentary.explain, true);
  assert.equal(sanitize({ commentary: { explain: false } }).commentary.explain, false);
  assert.equal(sanitize({ commentary: { explain: 'false' } }).commentary.explain, true);
});
