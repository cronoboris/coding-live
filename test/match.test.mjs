import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Match } from '../src/core/match.mjs';
import { adapter } from '../src/adapters/claude-code.mjs';

const replay = (file, prompt) => {
  const m = new Match({ id: 'x', agent: 'claude-code' });
  const parse = adapter.createParser();
  const lines = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8').split('\n').filter(Boolean);
  if (prompt) m.push({ type: 'prompt', at: Date.parse(JSON.parse(lines.find(l => l.includes('"timestamp"')) ?? '{}').timestamp ?? 0) || 1, text: prompt });
  for (const l of lines) for (const ev of parse(JSON.parse(l))) m.push(ev);
  return m;
};

test('cloud session replay: test fail, VAR, recovery, decision and rating', () => {
  const m = replay('claude-code-rrule.jsonl');
  const s = m.snapshot();
  assert.equal(s.model, 'claude-haiku-5-5');
  assert.equal(s.modelLabel, '하이쿠 5.5');
  assert.equal(s.player, `${s.name} (${s.modelLabel})`);
  assert.match(s.request, /^This is a self-contained practice task/);
  assert.ok(s.finished);
  const tests = s.feed.filter(c => c.kind === 'test');
  assert.deepEqual(tests.map(c => c.score), [{ pass: 43, fail: 1 }, { pass: 44, fail: 0 }]);
  assert.equal(tests[0].failed, true);
  assert.equal(tests[1].failed, false);
  assert.ok(s.feed.some(c => c.text === '실패한 테스트를 자세히 들여다봅니다'), 'a piped re-run is a look, not a second failure');
  assert.deepEqual(s.moments.filter(x => x.type !== 'big-write').map(x => x.type), ['config', 'first-test', 'first-fail', 'var', 'recovery', 'decision']);
  assert.equal(s.rating.score, 7.5);
  assert.deepEqual(s.files.map(f => f.path).sort(), ['/tmp/match/package.json', '/tmp/match/src/recurrence.mjs', '/tmp/match/test/recurrence.test.mjs']);
  assert.equal(s.files.find(f => f.path.endsWith('recurrence.test.mjs')).status, 'pass');
  assert.match(s.oneCheck, /테스트를 왜 바꿨어/);
  assert.equal(s.moments.find(x => x.type === 'var').lesson.name, '정답지 고치기');
  assert.match(s.moments.find(x => x.type === 'var').auto.line, /채점표를 손본/);
});

test('headless stream-json replay keeps the offline engine result', () => {
  const m = replay('claude-stream-csv.jsonl', 'Add src/exports.mjs exporting ordersToCsv(orders).');
  const s = m.snapshot();
  assert.equal(s.model, 'claude-haiku-5-5');
  assert.ok(s.finished);
  assert.ok(s.moments.some(x => x.type === 'var'));
  assert.equal(s.moments.filter(x => x.type === 'decision').length, 1);
  assert.equal(s.moments.find(x => x.type === 'decision').count, 2);
  assert.match(s.moments.find(x => x.type === 'decision').note, /customerName/);
  assert.equal(s.rating.score, 7);
  assert.ok(Number.isFinite(s.costUsd));
});

test('a follow-up prompt reopens a finished match as a coach call', () => {
  const m = new Match();
  m.push({ type: 'prompt', at: 1000, text: 'do it' });
  m.push({ type: 'end', at: 2000, text: 'done' });
  assert.ok(m.finished);
  m.push({ type: 'prompt', at: 3000, text: 'now add docs' });
  assert.equal(m.finished, false);
  assert.equal(m.feed.at(-1).kind, 'coach');
});

test('silence becomes a quiet state, reasoning keeps it a timeout', () => {
  const m = new Match();
  m.push({ type: 'prompt', at: 0, text: 'x' });
  assert.equal(m.state(10 * 60_000).code, 'quiet');
  m.push({ type: 'think', at: 1000 });
  assert.equal(m.state(5 * 60_000).code, 'timeout');
});

test('three failures in a row raise one stuck moment, not one per later edit', () => {
  const m = new Match();
  let at = 0;
  const play = (tool, output, error = false) => { const id = String(++at); m.push({ type: 'call', at: at * 1000, id, tool }); m.push({ type: 'result', at: at * 1000 + 1, id, output, error }); };
  m.push({ type: 'prompt', at: 0, text: 'fix it' });
  for (let k = 0; k < 3; k++) { play({ kind: 'shell', command: 'npm test' }, '# pass 1\n# fail 1'); play({ kind: 'edit', path: 'src/a.mjs' }, 'ok'); }
  assert.equal(m.moments.filter(x => x.type === 'stuck').length, 1);
});
