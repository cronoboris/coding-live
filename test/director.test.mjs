import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Director } from '../src/director/index.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-agent.mjs', import.meta.url));
const AGENTS = { 'claude-code': 'claude', codex: 'codex', omp: 'omp' };

function setup(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'coding-live-director-'));
  const commands = Object.fromEntries(Object.entries(AGENTS).map(([id, mode]) => [id, [process.execPath, FAKE, mode]]));
  const players = [{ agent: 'claude-code', sessionId: 'old-session' }, { agent: 'codex', sessionId: 'old-session' }, { agent: 'omp', sessionId: '/s/old.jsonl' }];
  const d = new Director({ projects: () => [{ key: 'p1', cwd, players, left: [] }], env: { PATH: '' }, commands });
  // Windows keeps the folder locked until the closed agents have fully exited, so removal retries.
  t.after(() => { d.closeAll(); return rm(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
  return d;
}
// Collects a chat's events and resolves once one matches.
function watch(chat) {
  const events = [];
  let waiters = [];
  chat.subscribe(e => { events.push(e); waiters = waiters.filter(w => !(w.test(e) && (w.done(e), true))); });
  const until = test => new Promise((done, fail) => {
    const hit = events.find(test);
    if (hit) return done(hit);
    const timer = setTimeout(() => fail(new Error('timed out')), 5000);
    waiters.push({ test, done: e => { clearTimeout(timer); done(e); } });
  });
  return { events, until };
}
const said = events => events.filter(e => e.type === 'text').map(e => e.delta).join('');

for (const [agent, mode] of Object.entries(AGENTS)) {
  test(`${agent}: streamed reply, approval allowed and denied`, async t => {
    const d = setup(t);
    const { id } = d.start({ project: 'p1', agent });
    const chat = d.get(id);
    const w = watch(chat);
    assert.deepEqual(d.find('p1'), { id });

    assert.deepEqual(await chat.send('do it'), { ok: true });
    assert.equal(chat.state.busy, true);
    assert.deepEqual(await chat.send('again'), { error: 'busy' }, 'one turn at a time');
    const ask = await w.until(e => e.type === 'approval');
    assert.match(ask.summary + ask.tool, /a\.txt|write/i);
    assert.equal(ask.canAlways, mode !== 'omp');
    chat.approve(ask.requestId, 'once');
    await w.until(e => e.type === 'turn_end');
    assert.equal(said(w.events), 'hi there allowed');
    assert.ok(w.events.some(e => e.type === 'approval_resolved' && e.decision === 'once'));
    assert.ok(w.events.some(e => e.type === 'message_end'));
    assert.equal(chat.state.busy, false);
    if (mode === 'codex') assert.equal(chat.state.tokens, 1200); else assert.ok(chat.state.costUsd > 0);
    assert.ok(chat.state.sessionId, 'session id known');

    const before = w.events.length;
    await chat.send('do it');
    const ask2 = await w.until(e => e.type === 'approval' && e.requestId !== ask.requestId);
    chat.approve(ask2.requestId, 'deny');
    await w.until(e => e.type === 'turn_end' && w.events.indexOf(e) > before);
    assert.match(said(w.events.slice(before)), / denied$/);

    // A new viewer gets the whole conversation, with each reply in one piece.
    const replay = [];
    chat.subscribe(e => replay.push(e))();
    assert.equal(replay[0].type, 'state');
    assert.deepEqual(replay.filter(e => e.type === 'user').map(e => e.text), ['do it', 'do it']);
    assert.equal(said(replay), said(w.events));
    assert.ok(replay.filter(e => e.type === 'text').length < w.events.filter(e => e.type === 'text').length, 'deltas merged');
  });

  test(`${agent}: resume, session-wide approval, stop and exit`, async t => {
    const d = setup(t);
    const resume = mode === 'omp' ? '/s/old.jsonl' : 'old-session';
    const chat = d.get(d.start({ project: 'p1', agent, resume }).id);
    const w = watch(chat);
    await w.until(e => e.type === 'state' && e.sessionId === resume);

    if (mode !== 'omp') {
      await chat.send('do it');
      const ask = await w.until(e => e.type === 'approval');
      chat.approve(ask.requestId, 'session');
      await w.until(e => e.type === 'turn_end');
      assert.match(said(w.events), /allowed always$/, 'the agent was told to allow for the session');
    }

    const from = w.events.length;
    const sent = chat.send('hang');
    chat.stop(); // right away, before the agent has even started the turn
    await sent;
    const end = await w.until(e => e.type === 'turn_end' && w.events.indexOf(e) >= from);
    assert.equal(end.ok, false, 'a stopped turn did not finish');

    await chat.send('crash');
    await w.until(e => e.type === 'exit');
    assert.equal(chat.state.busy, false);
    assert.ok(w.events.some(e => e.type === 'error'));
    assert.deepEqual(await chat.send('more'), { error: 'ended' });
  });
}

test('a new viewer during a turn sees it as running', async t => {
  const d = setup(t);
  const chat = d.get(d.start({ project: 'p1', agent: 'claude-code' }).id);
  const w = watch(chat);
  await chat.send('do it');
  chat.approve((await w.until(e => e.type === 'approval')).requestId, 'once');
  await w.until(e => e.type === 'turn_end');
  await chat.send('hang');
  const seen = [];
  chat.subscribe(e => seen.push(e))();
  assert.equal(seen.at(-1).type, 'state');
  assert.equal(seen.at(-1).busy, true, 'the replayed turn end is not the last word');
});

test('an agent that ends at once does not leave a send waiting', async t => {
  for (const agent of ['codex', 'omp']) {
    const d = new Director({ projects: () => [{ key: 'p', cwd: tmpdir() }], env: { PATH: '' }, commands: { [agent]: [process.execPath, FAKE, 'none'] } });
    t.after(() => d.closeAll());
    const chat = d.get(d.start({ project: 'p', agent }).id);
    const w = watch(chat);
    await w.until(e => e.type === 'exit');
    assert.deepEqual(await chat.send('hello'), { error: 'ended' });
    // and while it is still starting
    const d2 = new Director({ projects: () => [{ key: 'p', cwd: tmpdir() }], env: { PATH: '' }, commands: { [agent]: [process.execPath, FAKE, 'none'] } });
    t.after(() => d2.closeAll());
    const early = d2.get(d2.start({ project: 'p', agent }).id);
    assert.deepEqual(await early.send('hello'), { ok: true });
    await watch(early).until(e => e.type === 'exit');
    assert.equal(early.state.busy, false);
  }
});

test('closing a chat ends its viewers; continuing needs a session of this project', async t => {
  const d = setup(t);
  const chat = d.get(d.start({ project: 'p1', agent: 'codex' }).id);
  let gone = false;
  const seen = [];
  chat.subscribe(e => seen.push(e), () => { gone = true; });
  d.start({ project: 'p1', agent: 'omp' });
  assert.equal(gone, true);
  assert.equal(seen.at(-1).type, 'exit');
  assert.equal(chat.listenerCount('event'), 0);
  assert.deepEqual(d.start({ project: 'p1', agent: 'codex', resume: 'someone-else' }), { error: 'unknown session' });
  assert.deepEqual(d.start({ project: 'p1', agent: 'codex', resume: '/s/old.jsonl' }), { error: 'unknown session' }, 'an omp session is not a Codex one');
});

test('a Windows .cmd agent never gets an argument the shell would run', () => {
  const players = [{ agent: 'claude-code', sessionId: 'x" & calc & "' }, { agent: 'omp', sessionId: 'C:\\s\\a|calc.jsonl' }];
  const d = new Director({ projects: () => [{ key: 'p', cwd: tmpdir(), players }], env: { PATH: '' }, commands: { 'claude-code': ['C:\\npm\\claude.cmd'], omp: ['C:\\npm\\omp.cmd'] } });
  for (const s of players) assert.match(d.start({ project: 'p', agent: s.agent, resume: s.sessionId }).error, /unsafe argument/);
  assert.equal(d.chats.size, 0, 'nothing started');
});

test('starting again replaces the chat; unknown projects, agents and missing programs are refused', async t => {
  const d = setup(t);
  const a = d.start({ project: 'p1', agent: 'omp' }).id;
  const b = d.start({ project: 'p1', agent: 'codex' }).id;
  assert.notEqual(a, b);
  assert.equal(d.get(a), null);
  assert.ok(d.get(b).closed === false);
  assert.deepEqual(d.start({ project: 'nope', agent: 'codex' }), { error: 'unknown project' });
  assert.deepEqual(d.start({ project: 'p1', agent: 'mixdog' }), { error: 'unknown agent' });
  const bare = new Director({ projects: () => [{ key: 'p1', cwd: tmpdir() }], env: { PATH: '' } });
  assert.deepEqual(bare.start({ project: 'p1', agent: 'claude-code' }), { error: 'not installed' });
  assert.deepEqual(bare.agents().agents.map(x => x.installed), [false, false, false]);
  assert.deepEqual(d.drop(b), { ok: true });
  assert.deepEqual(d.find('p1'), { id: null });
});

test('director routes refuse writes without the app header', async t => {
  const { startServer } = await import('../src/server.mjs');
  const home = mkdtempSync(join(tmpdir(), 'coding-live-director-home-'));
  const port = 4700 + Math.floor(Math.random() * 200);
  const s = await startServer({ port, env: { HOME: home, PATH: '' }, settingsFile: join(home, 'settings.json') });
  t.after(() => { s.close(); return rm(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
  const url = `http://127.0.0.1:${port}/api/director`;
  assert.equal((await fetch(`${url}/start`, { method: 'POST', body: '{}' })).status, 403);
  const ok = await fetch(`${url}/start`, { method: 'POST', headers: { 'x-coding-live': '1' }, body: JSON.stringify({ project: 'x', agent: 'codex' }) });
  assert.deepEqual(await ok.json(), { error: 'unknown project' });
  assert.deepEqual(await (await fetch(`${url}/agents`)).json(), { agents: [{ id: 'claude-code', label: 'Claude Code', installed: false }, { id: 'codex', label: 'Codex', installed: false }, { id: 'omp', label: 'omp', installed: false }] });
  assert.equal((await fetch(`${url}/nope/stream`)).status, 404);
});
