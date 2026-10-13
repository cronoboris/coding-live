import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, MOMENT_LABEL } from '../src/core/match.mjs';
import { recordedCompactions, STEP_THREE_LABELS } from '../src/core/moments.mjs';
import { autoComment, LESSONS, detectTricks } from '../src/core/lessons.mjs';

const has = (m, type) => m.moments.some(x => x.type === type);
function play(m, tool, { at = (m.lastAt ?? 0) + 1000, output = 'ok', error = false } = {}) {
  m.push({ type: 'call', at, id: String(at), tool });
  m.push({ type: 'result', at: at + 1, id: String(at), output, error });
}
test('wrestle needs five successful edits of one file inside ten minutes', () => {
  for (const [gap, same, expected] of [[1000, true, true], [200000, true, false], [1000, false, false]]) {
    const m = new Match();
    for (let n = 0; n < 5; n++) play(m, { kind: 'edit', path: same ? 'a.js' : `${n}.js` }, { at: n * gap });
    assert.equal(has(m, 'wrestle'), expected);
  }
});
test('revert compares trimmed earlier edit text on the same file only', () => {
  for (const [path, removed, expected] of [['a.js', ' x ', true], ['b.js', 'x', false], ['a.js', 'y', false], ['a.js', '', false]]) {
    const m = new Match();
    play(m, { kind: 'edit', path: 'a.js', added: 'x\n' });
    play(m, { kind: 'edit', path, removed });
    assert.equal(has(m, 'revert'), expected);
  }
});
test('named package installs are once per package; bare installs and failed calls do not count', () => {
  for (const command of ['npm install foo', 'pnpm add foo', 'yarn add foo', 'bun install foo', 'pip install foo', 'cargo add foo', 'uv add foo', 'go get example.com/foo']) {
    const m = new Match();
    play(m, { kind: 'shell', command });
    assert.ok(has(m, 'install'), command);
    play(m, { kind: 'shell', command }, { at: 100000 });
    assert.equal(m.moments.filter(x => x.type === 'install').length, 1);
  }
  for (const command of ['npm install', 'pip install -r requirements.txt', 'echo npm install foo']) {
    const m = new Match(); play(m, { kind: 'shell', command });
    assert.ok(!has(m, 'install'));
  }
  const m = new Match(); play(m, { kind: 'shell', command: 'npm add foo' }, { error: true });
  assert.ok(!has(m, 'install'));
});
test('config is limited to recorded configuration paths and package scripts', () => {
  for (const path of ['Dockerfile', '.github/workflows/test.yml', '.circleci/config.yml', '.gitlab-ci.yml', 'tsconfig.app.json', 'eslint.config.mjs', '.prettierrc']) {
    const m = new Match(); play(m, { kind: 'edit', path, added: 'x' }); assert.ok(has(m, 'config'), path);
  }
  for (const [path, content, expected] of [['package.json', '{"scripts":{"test":"node --test"}}', true], ['package.json', '{"name":"demo"}', false], ['src/eslint-helper.js', 'x', false]]) {
    const m = new Match(); play(m, { kind: 'write', path, content }); assert.equal(has(m, 'config'), expected);
  }
});
test('cost emits each crossed threshold once, including a single update crossing all three', () => {
  const m = new Match();
  for (const [at, costUsd] of [[1, .99], [2, 12], [3, 20], [4, 0], [5, 12]]) m.push({ type: 'usage', at, costUsd });
  assert.deepEqual(m.moments.filter(x => x.type === 'cost').map(x => x.threshold), [1, 5, 10]);
  const n = new Match(); n.push({ type: 'usage', at: 1, costUsd: .9 }); assert.ok(!has(n, 'cost'));
});
test('compact uses explicit records, deduplicates cumulative counts and ignores ordinary summaries', () => {
  const samples = [
    ['mixdog', [{ compaction: { compactCount: 2 } }], 1],
    ['claude-code', [{ type: 'system', subtype: 'compact_boundary' }, { isCompactSummary: true }], 1],
    ['claude-code', [{ isCompactSummary: true }], 1],
    ['codex', [{ type: 'compacted' }, { type: 'response_item', payload: { type: 'compacted' } }], 2],
    ['codex', [{ type: 'message', content: 'summary compacted' }], 0],
    ['mixdog', [{ compaction: { compactCount: 0 } }], 0],
  ];
  for (const [agent, records, count] of samples) assert.equal(recordedCompactions(agent, records).length, count);
  const m = new Match();
  for (const count of [1, 1, 0, 2]) m.push({ type: 'compact', at: 1000, count });
  assert.equal(m.moments.length, 1); assert.equal(m.moments[0].count, 2);
});
test('long-run is live only, over three minutes, once per pending call', () => {
  const m = new Match(); m.push({ type: 'call', at: 1000, id: 'x', tool: { kind: 'shell', command: 'sleep 200' } });
  m.tick(999999, false); m.tick(181000, true); assert.ok(!has(m, 'long-run'));
  m.tick(181001, true); m.tick(300000, true);
  assert.equal(m.moments.filter(x => x.type === 'long-run').length, 1);
  const n = new Match(); play(n, { kind: 'read', path: 'a' }); n.tick(999999, true); assert.ok(!has(n, 'long-run'));
});
test('waiting uses question tools, explicit waits and end questions, not ordinary results', () => {
  for (const text of ['진행할까요?', '선택해 주세요.', 'Ready?']) {
    const m = new Match(); m.push({ type: 'end', at: 1, text }); assert.ok(has(m, 'waiting'));
  }
  const m = new Match(); play(m, { kind: 'other', name: 'AskUserQuestion' }); assert.ok(has(m, 'waiting'));
  const n = new Match(); n.push({ type: 'end', at: 1, text: '완료했습니다.' }); assert.ok(!has(n, 'waiting'));
});
test('denied requires a failed result with denial evidence, not quoted file contents', () => {
  for (const error of [false, true]) {
    const m = new Match(); play(m, { kind: 'read', path: 'a' }, { error, output: 'permission denied' });
    assert.equal(has(m, 'denied'), error);
  }
  const m = new Match(); play(m, { kind: 'shell', command: 'x' }, { error: true, output: 'unknown command' }); assert.ok(!has(m, 'denied'));
});
test('pipe-run catches direct execution, not downloaded files or printed examples', () => {
  for (const command of ['curl url | sh', 'wget -qO- url | bash', 'curl url | zsh', 'curl url | python', 'curl url | node', 'bash <(curl url)', 'iex (iwr url)'])
    assert.ok(detectTricks({ kind: 'shell', command }).some(x => x.type === 'pipe-run'), command);
  for (const command of ['curl url -o file', 'echo "curl url | sh"', 'curl url | head'])
    assert.ok(!detectTricks({ kind: 'shell', command }).some(x => x.type === 'pipe-run'));
  for (const key of ['analogy', 'why', 'tell', 'ask']) assert.ok(LESSONS['pipe-run'][key]);
});
test('first-run detects supported app starts once, not build/test', () => {
  for (const command of ['npm run dev', 'pnpm start', 'yarn run serve', 'bun run dev', 'node server.js', 'python manage.py runserver', 'uvicorn app:app', 'flask run', 'cargo run', 'go run main.go', 'docker compose up', 'docker run app']) {
    const m = new Match(); play(m, { kind: 'shell', command }); play(m, { kind: 'shell', command }, { at: 100000 });
    assert.equal(m.moments.filter(x => x.type === 'first-run').length, 1, command);
  }
  for (const command of ['npm test', 'npm run build', 'echo node server.js']) { const m = new Match(); play(m, { kind: 'shell', command }); assert.ok(!has(m, 'first-run')); }
});
test('ignored-error excludes retries, named-file repairs, acknowledged errors and test failures', () => {
  for (const mode of ['ignore', 'retry', 'repair', 'say', 'test']) {
    const m = new Match();
    play(m, { kind: 'shell', command: mode === 'test' ? 'npm test' : 'node app.js' }, { error: true, output: 'Error: src/app.js failed' });
    if (mode === 'say') m.push({ type: 'say', at: 1500, text: '오류를 확인했습니다.' });
    play(m, mode === 'retry' ? { kind: 'shell', command: 'node app.js --debug' } : mode === 'repair' ? { kind: 'edit', path: 'src/app.js' } : { kind: 'read', path: 'other.js' });
    play(m, { kind: 'read', path: 'other.js' });
    play(m, { kind: 'read', path: 'other.js' });
    assert.equal(has(m, 'ignored-error'), mode === 'ignore', mode);
  }
});
test('squad replaces burst assignments, excludes sends and widely separated spawns', () => {
  for (const [gap, type, expected] of [[1000, 'spawn', true], [121000, 'spawn', false], [1000, 'send', false]]) {
    const m = new Match();
    for (let i = 0; i < 3; i++) m.push({ type: 'call', at: i * gap, id: `${i}`, tool: { kind: 'delegate', type, tag: `worker${i}` } });
    assert.equal(has(m, 'squad'), expected);
    if (expected) assert.ok(!has(m, 'assign'));
  }
});
test('first-test excludes a prior test read/run and unsuccessful creation', () => {
  for (const prior of [null, 'read', 'run', 'error']) {
    const m = new Match();
    if (prior === 'read') play(m, { kind: 'read', path: 'test/a.test.js' });
    if (prior === 'run') play(m, { kind: 'shell', command: 'npm test' });
    play(m, { kind: 'write', path: 'test/a.test.js', content: 'test()' }, { error: prior === 'error' });
    assert.equal(has(m, 'first-test'), prior === null);
  }
});
test('every new moment has a plain label and a nonempty fixed fallback', () => {
  for (const type of Object.keys(STEP_THREE_LABELS)) {
    assert.ok(MOMENT_LABEL[type]);
    assert.ok(autoComment(new Match(), { type, at: 0, note: '기록' }).caster);
  }
});
