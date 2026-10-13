import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/core/match.mjs';
import { Booth } from '../src/mic.mjs';
import { Live } from '../src/live.mjs';
import { fileURLToPath } from 'node:url';
const types = m => m.moments.map(x => x.type);
const child = () => { const m = new Match(); m.push({ type: 'role', at: 1000, parent: 'p', name: 'tools' }); return m; };
test('assign detects spawn, not send; instructions exclude initial prompt; throttle keeps key', () => {
  const m = new Match();
  m.push({ type: 'prompt', at: 1000, text: 'first' });
  assert.deepEqual(types(m), []);
  m.push({ type: 'prompt', at: 2000, text: 'next' });
  const key = m.moments[0].key;
  m.push({ type: 'prompt', at: 3000, text: 'again' });
  assert.equal(m.moments.length, 1);
  assert.equal(m.moments[0].key, key);
  assert.equal(m.moments[0].count, 2);
  m.push({ type: 'prompt', at: 63000, text: 'later' });
  assert.equal(m.moments.length, 2);
  m.push({ type: 'call', at: 64000, id: 'send', tool: { kind: 'delegate', type: 'send' } });
  assert.ok(!types(m).includes('assign'));
  m.push({ type: 'call', at: 65000, id: 'spawn', tool: { kind: 'delegate', type: 'spawn', tag: 'tools', prompt: 'read tools' } });
  assert.match(m.moments.at(-1).note, /tools: read tools/);
});
test('subagent ends report, error/stopped/truncated abort; parent and active worker do not', () => {
  for (const status of ['error', 'failed', 'stopped', 'truncated']) {
    const m = child();
    m.push({ type: 'end', at: 2000, text: 'result' });
    assert.deepEqual(types(m), ['report']);
    m.workerOutcome({ status, at: 3000, error: 'stopped' });
    assert.deepEqual(types(m), ['abort']);
  }
  const m = child();
  m.workerOutcome({ status: 'running', at: 2000 });
  assert.deepEqual(types(m), []);
  m.push({ type: 'end', at: 3000, text: '[truncated]' });
  assert.deepEqual(types(m), ['abort']);
  const parent = new Match(); parent.push({ type: 'end', at: 1000, text: 'done' });
  assert.deepEqual(types(parent), []);
});
test('big-write includes new files and 100 added lines, excludes short edits and errors', () => {
  for (const [tool, error, expected] of [
    [{ kind: 'write', path: 'a', content: 'x' }, false, true],
    [{ kind: 'edit', path: 'a', added: Array(100).fill('x').join('\n') }, false, true],
    [{ kind: 'edit', path: 'a', added: Array(99).fill('x').join('\n') }, false, false],
    [{ kind: 'write', path: 'a', content: 'x' }, true, false],
  ]) {
    const m = new Match();
    m.push({ type: 'call', at: 1000, id: 'a', tool });
    m.push({ type: 'result', at: 2000, id: 'a', output: '', error });
    assert.equal(types(m).includes('big-write'), expected);
    if (expected) assert.ok(m.snapshot().moments[0].auto.caster);
  }
});
test('new moments enter the existing Booth queue and obey its limit', () => {
  const m = child();
  m.push({ type: 'end', at: 2000, text: 'result' });
  const b = new Booth({ provider: 'compatible', via: 'api' }, { max: 0 });
  b.cover(m, () => {});
  assert.equal(b.queue.length, 0);
  b.max = 1; b.busy = true;
  b.cover(m, () => {});
  assert.equal(b.queue[0].m.type, 'report');
  m.addMoment('assign', 0, 'next', 3000);
  b.cover(m, () => {});
  assert.equal(b.queue.length, 1);
});

test('worker registry errors supersede a report and repeated polling is idempotent', () => {
  const live = new Live({}, {});
  const key = id => Buffer.from(`mixdog\0${fileURLToPath(new URL(`./fixtures/worker-lifecycle/sessions/${id}.json`, import.meta.url))}`).toString('base64url');
  const m = child();
  m.push({ type: 'end', at: 2000, text: 'result' });
  live.workerOutcome(key('sess_error'), m);
  assert.deepEqual(types(m), ['abort']);
  assert.equal(m.moments[0].note, '작업 실행 실패');
  const version = m.version;
  live.workerOutcome(key('sess_error'), m);
  assert.equal(m.version, version);
  const running = child();
  live.workerOutcome(key('sess_running'), running);
  assert.deepEqual(types(running), []);
});
