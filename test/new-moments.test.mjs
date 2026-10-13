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
  b.max = 1; b.paused = true;
  b.cover(m, () => {});
  assert.equal(b.queue[0].m.type, 'report');
  m.addMoment('assign', 0, 'next', 3000);
  b.cover(m, () => {});
  assert.equal(b.queue.length, 1);
});

test('two lines are written at once, one for a local model', async () => {
  const m = new Match({ id: 'k' });
  const b = new Booth({ provider: 'compatible', via: 'api' });
  b.connect(m);
  m.addMoment('compact', 0, 'summary', 1000); m.addMoment('first-fail', 0, 'fail', 2000); m.addMoment('assign', 0, 'helper', 3000); m.addMoment('var', 0, 'test edit', 4000);
  b.paused = true;
  b.cover(m, () => {});
  assert.deepEqual(b.queue.map(q => q.m.type), ['var', 'assign', 'first-fail', 'compact'], 'every enabled moment, newest first');
  let release; const gate = new Promise(r => { release = r; });
  b.write = async () => { b.running++; await gate; b.running--; };
  b.paused = false; b.pump();
  assert.equal(b.running, 2);
  release(); await gate;
  const local = new Booth({ provider: 'ollama', via: 'local' });
  local.paused = true; local.cover(new Match({ id: 'l' }), () => {});
  const n = new Match({ id: 'l' }); local.connect(n);
  n.addMoment('first-fail', 0, 'a', 1000); n.addMoment('again', 0, 'b', 70000);
  local.cover(n, () => {});
  local.write = async () => { local.running++; };
  local.paused = false; local.pump();
  assert.equal(local.running, 1);
});

test('on connect only the newest recorded moment is queued; later moments jump ahead, newest first', () => {
  const m = new Match();
  m.addMoment('assign', 0, 'old', 1000); m.addMoment('instruction', 0, 'older but recorded', 2000); m.addMoment('report', 0, 'latest', 3000);
  const b = new Booth({ provider: 'compatible', via: 'api' });
  b.paused = true;
  b.cover(m, () => {});
  assert.deepEqual(b.queue.map(q => q.m.type), ['report']);
  assert.ok(!m.comments.has(m.moments[0].key), 'older moments keep their fixed lines');
  m.addMoment('big-write', 0, 'next', 4000); m.addMoment('abort', 0, 'newest', 5000);
  b.cover(m, () => {});
  assert.deepEqual(b.queue.map(q => q.m.type), ['abort', 'big-write', 'report']);
});

test('a reply written for a rebuilt session shows on the new match; compaction keeps its key', () => {
  const before = new Match({ id: 'session' });
  before.addMoment('report', 0, 'done', 1000);
  const b = new Booth({ provider: 'compatible', via: 'api' });
  b.paused = true;
  b.cover(before, () => {});
  const key = before.moments[0].key;
  // The hub rebuilds the session's Match from its file and shares the commentary map.
  const after = new Match({ id: 'session' });
  after.comments = before.comments;
  after.addMoment('report', 0, 'done', 1000); after.addMoment('abort', 0, 'stopped', 2000);
  b.cover(after, () => {});
  assert.deepEqual(b.queue.map(q => q.m.type), ['abort', 'report'], 'no duplicate and no reconnect after the rebuild');
  before.setComment(key, { caster: 'call', line: 'line' });
  assert.equal(after.snapshot().moments.find(m => m.key === key).comment.caster, 'call');
  const compactKey = at => { const m = new Match(); m.detected(m.tracker.compact(1), at); return m.moments[0].key; };
  assert.equal(compactKey(5000), compactKey(90000));
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
