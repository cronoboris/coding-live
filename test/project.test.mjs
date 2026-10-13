import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupProjects, buildProject } from '../src/project.mjs';
import { Match } from '../src/core/match.mjs';

const H = 3600_000;
test('sessions in the same folder at about the same time are one match', () => {
  const now = Date.now();
  const s = (key, cwd, ago, live = false, agent = 'claude-code') => ({ key, cwd, project: cwd.split('/').at(-1), agent, agentLabel: agent, title: key, live, updatedAt: now - ago });
  const ps = groupProjects([s('a', '/w/shop', 0, true), s('b', '/w/shop', 60_000, true, 'codex'), s('old', '/w/shop', 5 * H), s('c', '/w/blog', 10 * H)]);
  assert.deepEqual(ps.map(p => [p.name, p.players.map(x => x.key), p.live, p.older]), [['shop', ['a', 'b'], true, 1], ['blog', ['c'], false, 0]]);
});

test('a project snapshot merges players, files and timelines', () => {
  const mk = (cwd, t0, events) => { const m = new Match(); m.push({ type: 'meta', at: t0, cwd }); for (const e of events) m.push({ ...e, at: t0 + e.dt }); return m.snapshot(t0 + 60_000); };
  const t0 = Date.parse('2026-10-12T10:00:00Z');
  const a = mk('/w/shop', t0, [
    { type: 'prompt', dt: 0, text: 'csv export' }, { type: 'model', dt: 0, model: 'claude-haiku-5-5' },
    { type: 'call', dt: 1000, id: '1', tool: { kind: 'write', path: '/w/shop/src/export.mjs', content: 'x' } }, { type: 'result', dt: 2000, id: '1', output: 'ok' },
  ]);
  const b = mk('/w/shop', t0 + 5000, [
    { type: 'prompt', dt: 0, text: 'fix export' }, { type: 'model', dt: 0, model: 'gpt-5.5-codex' },
    { type: 'call', dt: 1000, id: '1', tool: { kind: 'edit', path: '/w/shop/src/export.mjs' } }, { type: 'result', dt: 1500, id: '1', output: 'ok' },
    { type: 'call', dt: 2000, id: '2', tool: { kind: 'shell', command: 'npm test' } }, { type: 'result', dt: 3000, id: '2', output: '# pass 3\n# fail 1' },
  ]);
  const p = buildProject({ key: 'k', name: 'shop', cwd: '/w/shop' }, [{ key: 'a', snap: a }, { key: 'b', snap: b }]);
  assert.equal(p.players.length, 2);
  assert.equal(p.startedAt, t0);
  assert.deepEqual(p.feed.map(f => f.player), ['a', 'b', 'b']);
  const file = p.files.find(f => f.path === 'src/export.mjs');
  assert.deepEqual(file.players.map(x => x.key), ['a', 'b'], 'two players touched the same file');
  assert.deepEqual(p.tests, { pass: 3, fail: 1 });
  assert.equal(p.players[1].lane, 3, 'a failed test puts the player in the VAR zone');
  assert.equal(p.moments.find(m => m.type === 'first-fail').player, 'b');
  assert.equal(p.moments.find(m => m.type === 'big-write').player, 'a');
});
