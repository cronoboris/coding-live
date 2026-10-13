import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTricks, LESSONS, MOMENT_LESSON, TRICKS } from '../src/core/lessons.mjs';
import { normalizeTool as claudeTool } from '../src/adapters/claude-code.mjs';
import { normalizeTool as codexTool } from '../src/adapters/codex.mjs';
import { Match } from '../src/core/match.mjs';

const types = (tool, out = '') => detectTricks(tool, out).map(x => x.type);

test('skipped or focused tests in a test file are flagged, in code or in the command', () => {
  assert.deepEqual(types(claudeTool('Edit', { file_path: 'test/cart.test.ts', old_string: "it('adds', () => {", new_string: "it.skip('adds', () => {" })), ['skip']);
  assert.deepEqual(types(claudeTool('Edit', { file_path: 'test/cart.test.ts', old_string: "it('adds'", new_string: "it.only('adds'" })), ['skip']);
  assert.deepEqual(types(claudeTool('Write', { file_path: 'tests/test_cart.py', content: '@pytest.mark.skip\ndef test_total():\n    assert 1' })), ['skip']);
  assert.deepEqual(types({ kind: 'shell', command: 'npx jest --passWithNoTests' }), ['skip']);
  assert.deepEqual(types(claudeTool('Edit', { file_path: 'src/cart.ts', old_string: 'a', new_string: 'it.skip(' })), [], 'only test files count');
});

test('fewer assertions or a deleted test file is a weaker test', () => {
  const edit = claudeTool('Edit', { file_path: 'test/cart.test.ts', old_string: 'expect(total).toBe(30);\nexpect(tax).toBe(3);', new_string: 'expect(total).toBeDefined();' });
  assert.deepEqual(types(edit), ['weaken']);
  assert.deepEqual(types({ kind: 'shell', command: 'rm test/cart.test.ts && npm test' }), ['weaken'], 'deleting a test is not also reported as a risky rm');
});

test('silenced checks, masked failures and risky commands', () => {
  assert.deepEqual(types(claudeTool('Edit', { file_path: 'src/a.ts', old_string: 'x', new_string: '// @ts-ignore\nx' })), ['silence']);
  assert.deepEqual(types({ kind: 'shell', command: 'git commit -am wip --no-verify' }), ['silence']);
  assert.deepEqual(types({ kind: 'shell', command: 'npm test || true' }), ['mask']);
  assert.deepEqual(types(claudeTool('Edit', { file_path: 'package.json', old_string: '"test": "node --test"', new_string: '"test": "node --test || true"' })), ['mask']);
  assert.deepEqual(types({ kind: 'shell', command: 'git reset --hard HEAD~1' }), ['risky']);
  assert.deepEqual(types({ kind: 'shell', command: 'rm -rf src/legacy' }), ['risky']);
  assert.deepEqual(types({ kind: 'shell', command: 'rm -rf node_modules dist && npm ci' }), [], 'rebuildable folders are fine to delete');
  assert.deepEqual(types({ kind: 'shell', command: 'npm test 2>&1 | tail -20' }), [], 'trimming output is not masking');
  assert.deepEqual(types({ kind: 'shell', command: 'ls -la' }), []);
});

test('patch-based edits expose what they add and remove', () => {
  const patch = '*** Begin Patch\n*** Update File: test/slug.test.js\n@@\n-  assert.equal(slug("A B"), "a-b");\n+  // fine\n*** End Patch';
  const tool = codexTool('apply_patch', { input: patch });
  assert.equal(tool.kind, 'edit');
  assert.match(tool.removed, /assert\.equal/);
  assert.deepEqual(types(tool), ['weaken']);
});

test('every moment teaches something, and the same trick is called out at most twice', () => {
  for (const id of Object.values(MOMENT_LESSON)) for (const k of ['name', 'analogy', 'why', 'tell', 'ask']) assert.ok(LESSONS[id][k], `${id}.${k}`);
  assert.ok(TRICKS.includes('answer-key') && TRICKS.includes('skip-test'));
  const m = new Match();
  m.push({ type: 'prompt', at: 0, text: 'fix it' });
  for (let k = 1; k <= 3; k++) {
    m.push({ type: 'call', at: k * 1000, id: String(k), tool: claudeTool('Edit', { file_path: 'test/a.test.js', old_string: 'it(', new_string: 'it.skip(' }) });
    m.push({ type: 'result', at: k * 1000 + 1, id: String(k), output: 'ok' });
  }
  const s = m.snapshot();
  const skips = s.moments.filter(x => x.type === 'skip');
  assert.equal(skips.length, 1);
  assert.equal(skips[0].count, 3);
  assert.equal(skips[0].lesson.id, 'skip-test');
  assert.match(skips[0].auto.caster, /테스트 건너뛰기/);
  m.push({ type: 'end', at: 9000, text: 'done' });
  assert.match(m.snapshot().oneCheck, /건너뛰게\(skip\)/);
  assert.deepEqual(m.snapshot().learn.map(l => l.id), ['no-test']);
});
