import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caster, testScore, pathsIn, isTestPath } from '../src/core/caster.mjs';

test('test scores from common runners', () => {
  assert.deepEqual(testScore('# tests 5\n# pass 4\n# fail 1'), { pass: 4, fail: 1 });
  assert.deepEqual(testScore('Tests:       2 failed, 10 passed, 12 total'), { pass: 10, fail: 2 });
  assert.deepEqual(testScore(' Tests  1 failed | 7 passed (8)'), { pass: 7, fail: 1 });
  assert.deepEqual(testScore('===== 3 failed, 9 passed in 0.52s ====='), { pass: 9, fail: 3 });
  assert.deepEqual(testScore('========== 12 passed in 1.01s =========='), { pass: 12, fail: 0 });
  assert.deepEqual(testScore('test result: FAILED. 8 passed; 2 failed; 0 ignored'), { pass: 8, fail: 2 });
  assert.equal(testScore('hello'), null);
});

test('shell commands map to plays', () => {
  assert.equal(caster({ kind: 'shell', command: 'cd /x && npm test' }, '# pass 3\n# fail 0').kind, 'test');
  assert.equal(caster({ kind: 'shell', command: 'pytest -q' }, '== 1 failed, 2 passed in 0.1s ==').text, '테스트 실행! 3개 중 1개 실패');
  assert.equal(caster({ kind: 'shell', command: 'npm install zod' }).kind, 'install');
  assert.equal(caster({ kind: 'shell', command: "cat > test/a.test.mjs <<'EOF'\nx\nEOF" }).kind, 'write-test');
  assert.equal(caster({ kind: 'shell', command: 'node -e "console.log(1)"' }).paths.length, 0);
  assert.equal(caster({ kind: 'shell', command: 'git status' }).kind, 'look');
  assert.equal(caster({ kind: 'write', path: 'src/a.ts', content: 'a\nb' }).text, '코드 파일 `a.ts`을(를) 씁니다 (2줄)');
});

test('paths and test files', () => {
  assert.deepEqual(pathsIn('node -e "console.log(1)" && cat src/x.mjs'), ['src/x.mjs']);
  assert.ok(isTestPath('test/a.mjs') && isTestPath('src/a.test.ts') && isTestPath('tests/test_x.py') && !isTestPath('src/latest.mjs'));
});
