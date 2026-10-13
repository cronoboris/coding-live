import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DEFAULTS, sanitize } from '../src/settings.mjs';
import { MOMENT_GROUPS, MOMENT_LABEL } from '../src/core/moments.mjs';
import { Match } from '../src/core/match.mjs';
import { buildProject } from '../src/project.mjs';
import { Booth } from '../src/mic.mjs';
import { Live } from '../src/live.mjs';

const key = Buffer.from('demo\0/demo/session').toString('base64url');
const emit = (m, type, at = 1000) => m.addMoment(type, 0, '기록', at);
const fakeHub = match => Object.assign(new EventEmitter(), {
  tails: new Map([[key, { match }]]), sessions: [],
  configure() {}, async scan() {}, async watch() { return this.tails.get(key); }, unwatch() {},
});

test('six groups describe every known type exactly once; defaults and sanitize use only booleans', () => {
  assert.deepEqual(MOMENT_GROUPS.map(g => g.label), ['테스트', '의심 행동', '서브에이전트', '파일·명령', '진행 상황', '사용자 확인']);
  const members = MOMENT_GROUPS.flatMap(g => g.moments);
  assert.deepEqual(members.map(m => m.type).sort(), Object.keys(MOMENT_LABEL).sort());
  for (const m of members) {
    assert.equal(m.label, MOMENT_LABEL[m.type]);
    assert.ok(m.description.length > 5);
    assert.deepEqual(Object.keys(m).sort(), ['description', 'label', 'type']);
  }
  assert.deepEqual(Object.keys(DEFAULTS.moments).sort(), Object.keys(MOMENT_LABEL).sort());
  assert.ok(Object.values(DEFAULTS.moments).every(v => v === true));
  const prefs = sanitize({ moments: { quiet: false, assign: 'false', unknown: false, cost: 0 } }).moments;
  assert.equal(prefs.quiet, false);
  assert.equal(prefs.assign, true);
  assert.equal(prefs.cost, true);
  assert.ok(!Object.hasOwn(prefs, 'unknown'));
});

test('the central creation filter blocks every disabled type and its commentary', () => {
  for (const type of Object.keys(MOMENT_LABEL)) {
    const m = new Match({ moments: { [type]: false } });
    emit(m, type);
    m.setComment(`${type}@1000`, { caster: '늦은 응답', line: '기록' });
    assert.equal(m.moments.length, 0, type);
    assert.equal(m.comments.size, 0, type);
    assert.equal(m.snapshot().moments.length, 0, type);
    const booth = new Booth({ provider: 'compatible', via: 'api' });
    booth.busy = true;
    booth.cover(m, () => {});
    assert.equal(booth.queue.length, 0, type);
  }
});

test('settings remove existing moments without removing tool feed; re-enabling allows future events', () => {
  const m = new Match();
  m.push({ type: 'call', at: 1, id: 'a', tool: { kind: 'write', path: 'a.js', content: 'x' } });
  m.push({ type: 'result', at: 2, id: 'a', output: '' });
  const moment = m.moments.find(m => m.type === 'big-write');
  m.setComment(moment.key, { caster: '설명', line: '완료' });
  m.setMomentSettings({ 'big-write': false, quiet: false });
  assert.equal(m.moments.length, 0);
  assert.equal(m.comments.size, 0);
  assert.equal(m.feed.length, 1);
  assert.equal(m.snapshot(999999).pushes.length, 0);
  m.setMomentSettings({ 'big-write': true });
  assert.equal(m.moments.length, 0, 'no historical backfill');
  emit(m, 'big-write', 100000);
  assert.equal(m.moments.length, 1);
});

test('project generation filters stale snapshots and never emits disabled clashes or invokes AI callbacks', () => {
  const players = ['a', 'b'].map((key, i) => {
    const m = new Match();
    m.push({ type: 'call', at: 1000 + i, id: 'w', tool: { kind: 'edit', path: 'same.js' } });
    m.push({ type: 'result', at: 1002 + i, id: 'w', output: '' });
    emit(m, 'decision');
    return { key, snap: m.snapshot() };
  });
  let callbacks = 0;
  const p = buildProject({ cwd: '' }, players, () => { callbacks++; }, { clash: false, decision: false, quiet: false });
  assert.equal(callbacks, 0);
  assert.equal(p.moments.length, 0);
  assert.ok(p.players.every(p => p.decisions.length === 0 && p.moments === 0));
  assert.equal(p.feed.length, 2);
  assert.ok(!p.pushes.some(p => p.kind === 'quiet'));
});

test('live settings purge queued commentary and late replies, then filter rebuilt matches', async () => {
  const m = new Match();
  emit(m, 'assign'); emit(m, 'report');
  const settings = { value: sanitize({ commentary: { provider: 'off' } }) };
  const hub = fakeHub(m), live = new Live(hub, settings);
  live.booth = new Booth({ provider: 'compatible', via: 'api' });
  live.booth.busy = true;
  live.booth.cover(m, () => {});
  assert.equal(live.booth.queue.length, 2);
  settings.value = sanitize({ commentary: { provider: 'off' }, moments: { assign: false } });
  await live.apply(settings.value);
  assert.deepEqual(live.booth.queue.map(q => q.m.type), ['report']);
  assert.deepEqual(m.moments.map(m => m.type), ['report']);
  m.setComment('assign@1000', { caster: '늦은 응답', line: '완료' });
  assert.ok(!m.comments.has('assign@1000'));
  const rebuilt = new Match();
  emit(rebuilt, 'assign');
  hub.tails.get(key).match = rebuilt;
  assert.equal(live.snapshot(key).moments.length, 0);
  emit(rebuilt, 'assign', 100000);
  assert.equal(rebuilt.moments.length, 0);
});

test('live update filters rebuilt matches before Booth cover; disabled types cannot alert', async () => {
  const m = new Match();
  const settings = { value: sanitize({ moments: { decision: false, quiet: false } }) };
  const hub = fakeHub(m), live = new Live(hub, settings);
  const stop = await live.subscribe(key, () => {});
  try {
    live.micOn.add(key);
    live.booth.conf = { provider: 'compatible', via: 'api' };
    live.booth.busy = true;
    const rebuilt = new Match(); emit(rebuilt, 'decision');
    hub.tails.get(key).match = rebuilt;
    hub.emit('update', key);
    assert.equal(live.booth.queue.length, 0);
    assert.equal(rebuilt.moments.length, 0);
    let alerts = 0; live.onAlert = () => alerts++;
    live.check({ key, agentLabel: '에이전트' }, {
      player: '이름', title: '작업', state: { code: 'quiet' }, finished: false,
      moments: [{ key: 'decision@1', type: 'decision', note: '기록' }],
    }, { moments: new Set(), quiet: false, finished: false });
    assert.equal(alerts, 0);
  } finally { stop(); }
});
