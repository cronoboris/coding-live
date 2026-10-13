import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraCallMoments, claimsSuccess } from '../src/core/moments.mjs';
import { Match } from '../src/core/match.mjs';
import { buildProject } from '../src/project.mjs';
import { parseDocument } from '../src/adapters/mixdog.mjs';
const detects = (tool, type, risky = false) => extraCallMoments(tool, risky).some(m => m.type === type);
test('mixdog apply_patch delete record produces an engine delete moment', () => {
  const m = new Match();
  for (const event of parseDocument(JSON.stringify({
    owner: 'cli', createdAt: '2026-10-13T00:00:00Z',
    messages: [
      { role: 'assistant', toolCalls: [{ id: 'delete', name: 'apply_patch', arguments: { patch: '*** Begin Patch\n*** Delete File: source.js\n*** End Patch' } }] },
      { role: 'tool', toolCallId: 'delete', content: 'Success' },
    ],
  }))) m.push(event);
  assert.ok(m.moments.some(moment => moment.type === 'delete'));
  assert.ok(!m.moments.some(moment => moment.type === 'risky'));
});
test('claim mismatch requires success and a failed last test', () => {
  assert.ok(claimsSuccess('done'));
  assert.ok(!claimsSuccess('not done'));
  for (const fail of [0, 1]) {
    const m = new Match();
    m.push({ type: 'call', at: 1, id: 't', tool: { kind: 'shell', command: 'npm test' } });
    m.push({ type: 'result', at: 2, id: 't', output: `# pass 1\n# fail ${fail}` });
    m.push({ type: 'end', at: 3, text: 'done' });
    assert.equal(m.moments.some(x => x.type === 'claim-mismatch'), !!fail);
  }
});
test('delete excludes disposable paths and risky duplicate; detects removed lines and patches', () => {
  for (const [command, yes] of [['rm source.js', true], ['git rm source.js', true], ['rm dist/out.js', false], ['ls source.js', false]])
    assert.equal(detects({ kind: 'shell', command }, 'delete'), yes);
  assert.equal(detects({ kind: 'shell', command: 'rm -rf src' }, 'delete', true), false);
  for (const n of [39, 40]) assert.equal(detects({ kind: 'edit', removed: Array(n).fill('x').join('\n') }, 'delete'), n === 40);
  assert.ok(detects({ patch: '*** Delete File: source.js' }, 'delete'));
});
test('publish and secret have positive and negative cases', () => {
  for (const command of ['git commit -m x', 'git push']) assert.ok(detects({ kind: 'shell', command }, 'publish'));
  assert.ok(!detects({ kind: 'shell', command: 'echo git push' }, 'publish'));
  assert.ok(!detects({ kind: 'shell', command: 'echo "x; git push"' }, 'publish'));
  for (const path of ['.env.local', 'a.pem', 'a.key', 'id_rsa.pub', '~/.ssh/config', 'credentials.json', 'secrets-dev.json', '.npmrc', '.netrc'])
    assert.ok(detects({ kind: 'read', path }, 'secret'));
  assert.ok(!detects({ kind: 'read', path: 'README.md' }, 'secret'));
  assert.ok(detects({ kind: 'shell', command: 'printenv' }, 'secret'));
  assert.ok(!detects({ kind: 'shell', command: 'echo printenv' }, 'secret'));
});
test('clash is per file/player pair, not reads or repeated writes by one player', () => {
  const snap = kind => {
    const m = new Match();
    for (let i = 0; i < 2; i++) {
      m.push({ type: 'call', at: 1000 + i, id: `${i}`, tool: { kind, path: 'a.js' } });
      m.push({ type: 'result', at: 1000 + i, id: `${i}`, output: '' });
    }
    return m.snapshot();
  };
  const a = { key: 'a', snap: snap('edit') };
  for (const kind of ['read', 'edit']) {
    const p = buildProject({ cwd: '' }, [a, { key: 'b', snap: snap(kind) }]);
    assert.equal(p.moments.filter(m => m.type === 'clash').length, kind === 'edit' ? 1 : 0);
  }
  const b = { key: 'b', snap: snap('edit') };
  b.snap.moments.push({ type: 'clash', key: 'clash@1000', at: 0, eventAt: 1000, lastAt: 1000, comment: { caster: '설명', line: '확인' } });
  const rebuilt = buildProject({ cwd: '' }, [a, b]);
  assert.equal(rebuilt.moments.filter(m => m.type === 'clash').length, 1);
  assert.equal(rebuilt.moments.find(m => m.type === 'clash').comment.caster, '설명');
});
