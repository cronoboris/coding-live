import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LineCounter } from '../src/lines.mjs';
import { isTestPath } from '../src/core/caster.mjs';

test('test files are recognised by folder, suffix and test_ prefix in any folder', () => {
  for (const p of ['test/a.mjs', 'src/__tests__/a.js', 'cart.test.js', 'cart-spec.ts', 'server/mission_tests.cpp', 'tests/x.py', 'tools/test_level_editor_model.mjs', 'test_x.py'])
    assert.ok(isTestPath(p), p);
  for (const p of ['src/cart.js', 'src/latest.js', 'contest/a.js', 'src/protest_x.js'])
    assert.ok(!isTestPath(p), p);
});

test('lines of code and tests: code files only, blank lines skipped, .gitignore respected, changes picked up', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'coding-live-lines-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'test')); mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true }); mkdirSync(join(dir, 'gen'));
  writeFileSync(join(dir, 'src', 'cart.js'), 'a\n\n  \nb\nc\n');
  writeFileSync(join(dir, 'test', 'cart.test.js'), 't1\nt2\n');
  writeFileSync(join(dir, 'README.md'), 'not code\n');
  writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), 'skip\nskip\n');
  writeFileSync(join(dir, 'gen', 'big.js'), 'generated\n');
  const counter = new LineCounter();

  assert.deepEqual(await counter.count(join(dir, 'nope')), { missing: true });
  assert.deepEqual(await counter.count(dir), { code: 4, test: 2 }, 'without Git: dependency folders skipped');

  writeFileSync(join(dir, '.gitignore'), 'gen/\nnode_modules/\n');
  execFileSync('git', ['init', '-q', dir]);
  assert.deepEqual(await counter.count(dir), { code: 3, test: 2 }, 'with Git: ignored files skipped, untracked files counted');

  writeFileSync(join(dir, 'test', 'cart.test.js'), 't1\nt2\nt3\nt4\n');
  assert.deepEqual(await counter.count(dir), { code: 3, test: 4 });
});

test('a folder holding Git repositories counts what those repositories track', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'coding-live-lines-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const repo of ['server', 'client']) {
    mkdirSync(join(dir, repo, 'src'), { recursive: true }); mkdirSync(join(dir, repo, 'runtime'));
    writeFileSync(join(dir, repo, '.gitignore'), 'runtime/\n');
    writeFileSync(join(dir, repo, 'src', 'main.cpp'), 'a\nb\n');
    writeFileSync(join(dir, repo, 'src', 'main_tests.cpp'), 't\n');
    writeFileSync(join(dir, repo, 'runtime', 'dump.js'), 'x\n'.repeat(100));
    execFileSync('git', ['init', '-q', join(dir, repo)]);
  }
  mkdirSync(join(dir, 'tools', 'ghidra'), { recursive: true });
  writeFileSync(join(dir, 'tools', 'ghidra', 'big.py'), 'y\n'.repeat(100));
  assert.deepEqual(await new LineCounter().count(dir), { code: 4, test: 2 }, 'loose folders next to the repositories are left out');
});
