import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hub } from '../src/hub.mjs';

const line = o => JSON.stringify(o) + '\n';
const now = () => new Date().toISOString();

test('a session whose subagents fill the list still lists its own, older file', async t => {
  const home = mkdtempSync(join(tmpdir(), 'coding-live-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex'), GEMINI_CLI_HOME: home, PI_CODING_AGENT_DIR: join(home, '.pi', 'agent'), XDG_DATA_HOME: join(home, '.local', 'share') };
  const dir = join(home, '.claude', 'projects', '-w-big');
  mkdirSync(join(dir, 'boss', 'subagents'), { recursive: true });
  const { utimesSync } = await import('node:fs');
  writeFileSync(join(dir, 'boss.jsonl'), line({ type: 'user', timestamp: now(), sessionId: 'boss', cwd: '/w/big', message: { role: 'user', content: 'lead task' } }));
  utimesSync(join(dir, 'boss.jsonl'), new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
  for (let i = 0; i < 70; i++)
    writeFileSync(join(dir, 'boss', 'subagents', `agent-${i}.jsonl`), line({ type: 'user', timestamp: now(), sessionId: 'boss', agentId: `a${i}`, isSidechain: true, cwd: '/w/big', message: { role: 'user', content: `sub task ${i}` } }));
  const list = await new Hub({ env }).scan();
  const ids = new Set(list.map(s => s.sessionId));
  assert.ok(ids.has('boss'), 'the parent is listed');
  assert.ok(list.filter(s => s.parent === 'boss').length >= 1);
  assert.ok(list.filter(s => s.parent).every(s => ids.has(s.parent)), 'no listed subagent is missing its parent');
});

test('finds sessions of every agent in their default layouts and tails a live one', async t => {
  const home = mkdtempSync(join(tmpdir(), 'coding-live-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { HOME: home, XDG_DATA_HOME: join(home, '.local', 'share'), CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex'), GEMINI_CLI_HOME: home, PI_CODING_AGENT_DIR: join(home, '.pi', 'agent') };

  const cc = join(home, '.claude', 'projects', '-w-demo');
  mkdirSync(join(cc, 'abc', 'subagents'), { recursive: true });
  writeFileSync(join(cc, 'abc.jsonl'), line({ type: 'user', timestamp: now(), cwd: '/w/demo', message: { role: 'user', content: 'claude task' } }));
  writeFileSync(join(cc, 'abc', 'subagents', 'agent-1.jsonl'), line({ type: 'user', timestamp: now(), message: { role: 'user', content: 'subagent' } }));

  const cx = join(home, '.codex', 'sessions', '2026', '10', '12');
  mkdirSync(cx, { recursive: true });
  const rollout = join(cx, 'rollout-2026-10-12T10-00-00-t1.jsonl');
  writeFileSync(rollout, line({ timestamp: now(), type: 'session_meta', payload: { cwd: '/w/api' } }) + line({ timestamp: now(), type: 'event_msg', payload: { type: 'user_message', message: 'codex task' } }));

  const gm = join(home, '.gemini', 'tmp', 'webapp', 'chats');
  mkdirSync(gm, { recursive: true });
  writeFileSync(join(gm, 'session-2026-10-12T10-00-abcd1234.jsonl'), line({ sessionId: 's', projectHash: 'h' }) + line({ id: 'u1', type: 'user', timestamp: now(), content: [{ text: 'gemini task' }] }));

  const pd = join(home, '.pi', 'agent', 'sessions', '--w-cli--');
  mkdirSync(pd, { recursive: true });
  writeFileSync(join(pd, '2026-10-12T10-00-00-000Z_x.jsonl'), line({ type: 'session', version: 3, id: 'x', timestamp: now(), cwd: '/w/cli' }) + line({ type: 'message', id: 'a', parentId: null, timestamp: now(), message: { role: 'user', content: 'pi task' } }));

  const od = join(home, '.omp', 'agent', 'sessions', '-w-tool');
  mkdirSync(od, { recursive: true });
  writeFileSync(join(od, '2026-10-12T10-00-00-000Z_y.jsonl'), line({ type: 'title', v: 1, title: 'x', pad: '   ' }) + line({ type: 'session', version: 3, id: 'y', timestamp: now(), cwd: '/w/tool' }) + line({ type: 'message', id: 'b', parentId: null, timestamp: now(), message: { role: 'user', content: 'omp task' } }));

  const md = join(home, '.mixdog', 'data');
  mkdirSync(join(md, 'sessions'), { recursive: true });
  mkdirSync(join(md, 'turn-checkpoints'), { recursive: true });
  const mix = join(md, 'sessions', 'sess_1_1_1_abc.json');
  writeFileSync(mix, JSON.stringify({ id: 'sess_1_1_1_abc', owner: 'user', model: 'claude-sonnet-5-5', cwd: '/w/shop', createdAt: now(), messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'mixdog task' }] }));
  writeFileSync(join(md, 'sessions', 'sess_2_1_1_def.json'), JSON.stringify({ id: 'sess_2_1_1_def', owner: 'agent', agent: 'worker', messages: [{ role: 'user', content: 'subagent' }] }));

  const hub = new Hub({ env });
  const list = await hub.scan();
  const main = list.filter(s => s.title !== 'subagent');
  const byAgent = Object.fromEntries(main.map(s => [s.agent, s]));
  assert.deepEqual(Object.keys(byAgent).sort(), ['claude-code', 'codex', 'gemini', 'mixdog', 'omp', 'pi']);
  assert.equal(list.length, 8, 'mixdog and Claude Code subagent transcripts are listed');
  assert.deepEqual(Object.fromEntries(main.map(s => [s.agent, [s.title, s.project, s.live]])), {
    'claude-code': ['claude task', 'demo', true], codex: ['codex task', 'api', true], gemini: ['gemini task', 'webapp', true], pi: ['pi task', 'cli', true],
    omp: ['omp task', 'tool', true], mixdog: ['mixdog task', 'shop', true],
  });

  // Tail the codex session as it grows.
  const tail = await hub.watch(byAgent.codex.key);
  assert.equal(tail.match.request, 'codex task');
  appendFileSync(rollout, line({ timestamp: now(), type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"npm test"}', call_id: 'c' } })
    + line({ timestamp: now(), type: 'response_item', payload: { type: 'function_call_output', call_id: 'c', output: 'Process exited with code 0\nOutput:\n# pass 3\n# fail 0\n' } }));
  await tail.poll();
  assert.deepEqual(tail.match.feed.at(-1).score, { pass: 3, fail: 0 });
  hub.unwatch(byAgent.codex.key);

  // mixdog: a running turn lives in checkpoint side files until it commits.
  const mtail = await hub.watch(byAgent.mixdog.key);
  const ck = join(md, 'turn-checkpoints', 'sess_1_1_1_abc');
  writeFileSync(ck + '.json', JSON.stringify({ sessionId: 'sess_1_1_1_abc', turnToken: 'tk', turnMessages: [{ role: 'user', content: 'run tests' }] }));
  writeFileSync(ck + '.jsonl', line({ t: 'h', turnToken: 'tk', s: 0 })
    + line({ t: 'm', i: 1, m: { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'shell', arguments: { command: 'npm test' } }] }, s: 1 })
    + line({ t: 'm', i: 2, m: { role: 'tool', toolCallId: 'c1', content: '[exit code: 1]\n# pass 2\n# fail 1', toolKind: 'normal' }, s: 2 }));
  await mtail.poll();
  assert.deepEqual(mtail.match.feed.at(-1).score, { pass: 2, fail: 1 });
  assert.equal(mtail.match.feed.at(-1).failed, true);
  hub.unwatch(byAgent.mixdog.key);

  // A key can only name a file an adapter discovered.
  const forged = Buffer.from(`codex\0${join(home, 'secret.jsonl')}`).toString('base64url');
  writeFileSync(join(home, 'secret.jsonl'), line({ type: 'session_meta', payload: {} }));
  assert.equal(await hub.watch(forged), null);
});
