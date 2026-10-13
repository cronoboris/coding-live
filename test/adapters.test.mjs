// Each adapter replays the same match: write code, write a test, the test fails, the test file is edited (VAR),
// the test passes, and the agent closes by stating an assumption. Records follow the formats read from each
// agent's source; all of them must produce the same broadcast.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/core/match.mjs';
import { adapter as codex } from '../src/adapters/codex.mjs';
import { adapter as gemini } from '../src/adapters/gemini.mjs';
import { adapter as pi } from '../src/adapters/pi.mjs';

const T = i => new Date(Date.UTC(2026, 9, 12, 10, 0, i * 5)).toISOString();
const FINAL = 'Done. I assumed inputs are numbers; strings are not coerced.';
const SUM = 'export const sum = (a, b) => a + b;';
const TEST = "import { sum } from '../src/sum.mjs';\ntest('adds', () => assert.equal(sum(1, 2), 3));";

function expectStory(m, { model, project }) {
  const s = m.snapshot();
  assert.equal(s.model, model);
  assert.equal(s.request, 'Add a sum function with tests');
  assert.equal(s.title, project);
  assert.deepEqual(s.feed.filter(c => c.kind === 'test').map(c => c.failed), [true, false]);
  assert.deepEqual(s.moments.filter(x => x.type !== 'big-write').map(x => x.type), ['first-test', 'first-fail', 'var', 'recovery', 'decision']);
  assert.ok(s.finished);
  assert.equal(s.rating.score, 7.5);
  const files = Object.fromEntries(s.files.map(f => [f.path.replace(/^\/w\/demo\//, ''), f.status]));
  assert.deepEqual(files, { 'src/sum.mjs': 'write', 'test/sum.test.mjs': 'pass' });
  return s;
}

const replayLines = (adapter, records) => {
  const m = new Match();
  const parse = adapter.createParser();
  for (const r of records) for (const ev of parse(JSON.parse(JSON.stringify(r)))) m.push(ev);
  return m;
};

test('codex rollout (paginated history, exec_command + apply_patch, long-running test)', () => {
  const patch = (verb, path, body) => `*** Begin Patch\n*** ${verb} File: ${path}\n${body.split('\n').map(l => (verb === 'Add' ? '+' : ' ') + l).join('\n')}\n*** End Patch\n`;
  const rec = (i, type, payload) => ({ timestamp: T(i), type, payload });
  const ri = (i, payload) => rec(i, 'response_item', payload);
  const m = replayLines(codex, [
    rec(0, 'session_meta', { id: 't1', cwd: '/w/demo', originator: 'codex_cli_rs', history_mode: 'paginated' }),
    rec(0, 'turn_context', { turn_id: 'a', cwd: '/w/demo', model: 'gpt-5.5-codex' }),
    rec(0, 'event_msg', { type: 'task_started', turn_id: 'a' }),
    ri(0, { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] }),
    rec(0, 'event_msg', { type: 'item_completed', item: { type: 'UserMessage', id: 'u', content: [{ type: 'text', text: 'Add a sum function with tests' }] } }),
    ri(1, { type: 'reasoning', summary: [{ type: 'summary_text', text: 'plan' }], encrypted_content: 'x' }),
    ri(1, { type: 'custom_tool_call', status: 'completed', call_id: 'c1', name: 'apply_patch', input: patch('Add', 'src/sum.mjs', SUM) }),
    ri(2, { type: 'custom_tool_call_output', call_id: 'c1', output: JSON.stringify({ output: 'Success. Updated the following files:\nA src/sum.mjs\n', metadata: { exit_code: 0 } }) }),
    ri(3, { type: 'custom_tool_call', status: 'completed', call_id: 'c2', name: 'apply_patch', input: patch('Add', 'test/sum.test.mjs', TEST) }),
    ri(4, { type: 'custom_tool_call_output', call_id: 'c2', output: 'Success.' }),
    ri(5, { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test', workdir: '/w/demo' }), call_id: 'c3' }),
    ri(6, { type: 'function_call_output', call_id: 'c3', output: 'Chunk ID: 1\nWall time: 10.0 seconds\nProcess running with session ID 7\nOutput:\nTAP version 13\n' }),
    ri(7, { type: 'function_call', name: 'write_stdin', arguments: JSON.stringify({ session_id: 7, chars: '' }), call_id: 'c4' }),
    ri(8, { type: 'function_call_output', call_id: 'c4', output: 'Wall time: 1.2 seconds\nProcess exited with code 1\nOutput:\nnot ok 1 - adds\n# tests 2\n# pass 1\n# fail 1\n' }),
    ri(9, { type: 'custom_tool_call', status: 'completed', call_id: 'c5', name: 'apply_patch', input: patch('Update', 'test/sum.test.mjs', '-old\n+new') }),
    ri(10, { type: 'custom_tool_call_output', call_id: 'c5', output: 'Success.' }),
    ri(11, { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }), call_id: 'c6' }),
    ri(12, { type: 'function_call_output', call_id: 'c6', output: 'Wall time: 1.0 seconds\nProcess exited with code 0\nOutput:\n# tests 2\n# pass 2\n# fail 0\n' }),
    ri(13, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: FINAL }], phase: 'final_answer' }),
    rec(13, 'event_msg', { type: 'task_complete', turn_id: 'a', last_agent_message: FINAL }),
  ]);
  const s = expectStory(m, { model: 'gpt-5.5-codex', project: 'demo' });
  assert.equal(s.modelLabel, 'GPT-5.5-codex');
  assert.equal(s.player, `${s.name} (${s.modelLabel})`);
  assert.deepEqual(s.feed.find(c => c.kind === 'test').score, { pass: 1, fail: 1 });
});

test('codex legacy history uses user_message prompts and the old shell tool', () => {
  const m = replayLines(codex, [
    { timestamp: T(0), type: 'session_meta', payload: { cwd: '/w/demo', history_mode: 'legacy' } },
    { timestamp: T(0), type: 'event_msg', payload: { type: 'user_message', message: 'run the tests' } },
    { timestamp: T(1), type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'pytest -q'] }), call_id: 'x' } },
    { timestamp: T(2), type: 'response_item', payload: { type: 'function_call_output', call_id: 'x', output: 'Exit code: 1\nWall time: 0.4 seconds\nOutput:\n===== 1 failed, 3 passed in 0.31s =====\n' } },
  ]);
  const s = m.snapshot();
  assert.equal(s.request, 'run the tests');
  assert.deepEqual(s.feed[0].score, { pass: 3, fail: 1 });
});

test('gemini chat log (jsonl upserts, $set and functionResponse records)', () => {
  const call = (id, name, args, output, i) => ({ id, name, args, status: 'success', timestamp: T(i), result: [{ functionResponse: { id, name, response: { output } } }] });
  const g = (id, i, extra) => ({ id, type: 'gemini', timestamp: T(i), content: '', model: 'gemini-2.5-pro', ...extra });
  const fr = (id, i) => ({ id, type: 'user', timestamp: T(i), content: [{ functionResponse: { id: 'x', name: 'x', response: { output: '' } } }] });
  const lines = [
    { sessionId: 's', projectHash: 'h', startTime: T(0), lastUpdated: T(0), kind: 'main' },
    { id: 'u1', type: 'user', timestamp: T(0), content: [{ text: 'Add a sum function with tests' }] },
    g('g1', 1, { thoughts: [{ subject: 'Plan', description: '...' }] }),
    g('g1', 1, { thoughts: [{ subject: 'Plan', description: '...' }], toolCalls: [call('w1', 'write_file', { file_path: '/w/demo/src/sum.mjs', content: SUM }, 'ok', 1), call('w2', 'write_file', { file_path: '/w/demo/test/sum.test.mjs', content: TEST }, 'ok', 2)] }),
    fr('u2', 2),
    { $set: { lastUpdated: T(2) } },
    g('g2', 3, { toolCalls: [call('r1', 'run_shell_command', { command: 'npm test' }, 'Output: not ok 1 - adds\n# pass 1\n# fail 1\nExit Code: 1\nProcess Group PGID: 9', 3)] }),
    fr('u3', 4),
    g('g3', 5, { toolCalls: [call('e1', 'replace', { file_path: '/w/demo/test/sum.test.mjs', old_string: 'a', new_string: 'b' }, 'ok', 5)] }),
    fr('u4', 6),
    g('g4', 7, { toolCalls: [call('r2', 'run_shell_command', { command: 'npm test' }, 'Output: # pass 2\n# fail 0\nExit Code: 0', 7)] }),
    fr('u5', 8),
    g('g5', 9, { content: FINAL }),
    { $set: { lastUpdated: T(9) } },
  ];
  const m = new Match();
  for (const ev of gemini.parseDocument(lines.map(l => JSON.stringify(l)).join('\n') + '\n')) m.push(ev);
  m.push({ type: 'meta', at: Date.parse(T(0)), cwd: '/w/demo' }); // the project comes from the chats directory in the app
  expectStory(m, { model: 'gemini-2.5-pro', project: 'demo' });
});

test('gemini $rewindTo drops later messages and legacy .json documents still parse', () => {
  const lines = [
    { id: 'u1', type: 'user', timestamp: T(0), content: [{ text: 'first' }] },
    { id: 'g1', type: 'gemini', timestamp: T(1), content: 'answer one' },
    { id: 'u2', type: 'user', timestamp: T(2), content: [{ text: 'second' }] },
    { $rewindTo: 'u2' },
  ];
  const evs = gemini.parseDocument(lines.map(l => JSON.stringify(l)).join('\n'));
  assert.deepEqual(evs.filter(e => e.type === 'prompt').map(e => e.text), ['first']);
  const legacy = gemini.parseDocument(JSON.stringify({ sessionId: 's', messages: lines.slice(0, 2) }, null, 2));
  assert.equal(legacy.at(-1).type, 'end');
});

test('pi session (tree entries, toolCall/toolResult, cost)', () => {
  let n = 0;
  const e = (i, message) => ({ type: 'message', id: `e${++n}`, parentId: n > 1 ? `e${n - 1}` : null, timestamp: T(i), message });
  const asst = (i, content, stopReason = 'toolUse') => e(i, { role: 'assistant', content, model: 'claude-sonnet-4-5', provider: 'anthropic', usage: { cost: { total: 0.001 } }, stopReason });
  const res = (i, id, name, text, isError = false) => e(i, { role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError });
  const m = replayLines(pi, [
    { type: 'session', version: 3, id: 's', timestamp: T(0), cwd: '/w/demo' },
    e(0, { role: 'user', content: 'Add a sum function with tests', timestamp: 0 }),
    asst(1, [{ type: 'thinking', thinking: '' }, { type: 'toolCall', id: 't1', name: 'write', arguments: { path: 'src/sum.mjs', content: SUM } }]),
    res(1, 't1', 'write', 'Wrote src/sum.mjs'),
    asst(2, [{ type: 'toolCall', id: 't2', name: 'write', arguments: { path: 'test/sum.test.mjs', content: TEST } }]),
    res(2, 't2', 'write', 'Wrote test'),
    asst(3, [{ type: 'toolCall', id: 't3', name: 'bash', arguments: { command: 'npm test' } }]),
    res(4, 't3', 'bash', 'not ok 1 - adds\n# pass 1\n# fail 1\n\nCommand exited with code 1', true),
    asst(5, [{ type: 'toolCall', id: 't4', name: 'edit', arguments: { path: 'test/sum.test.mjs', edits: [{ oldText: 'a', newText: 'b' }] } }]),
    res(5, 't4', 'edit', 'Edited'),
    asst(6, [{ type: 'toolCall', id: 't5', name: 'bash', arguments: { command: 'npm test' } }]),
    res(7, 't5', 'bash', '# pass 2\n# fail 0'),
    asst(8, [{ type: 'text', text: FINAL }], 'stop'),
  ]);
  const s = expectStory(m, { model: 'claude-sonnet-4-5', project: 'demo' });
  assert.equal(s.costUsd.toFixed(3), '0.006');
});

test('omp session (title slot, synthetic messages, hashline edits, bash exit details)', async () => {
  const { adapter: omp } = await import('../src/adapters/omp.mjs');
  let n = 0;
  const e = (i, message) => ({ type: 'message', id: `o${++n}`, parentId: null, timestamp: T(i), message });
  const asst = (i, content, stopReason = 'toolUse') => e(i, { role: 'assistant', content, model: 'claude-opus-5-5', usage: { cost: { total: 0.01 } }, stopReason });
  const res = (i, id, name, text, extra = {}) => e(i, { role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError: false, ...extra });
  const m = replayLines(omp, [
    { type: 'title', v: 1, title: 'Sum', source: 'auto', pad: '      ' },
    { type: 'session', version: 3, id: 's', timestamp: T(0), cwd: '/w/demo' },
    { type: 'model_change', id: 'mc', parentId: null, timestamp: T(0), model: 'anthropic/claude-opus-5-5' },
    e(0, { role: 'developer', content: 'injected', synthetic: true }),
    e(0, { role: 'user', content: 'Add a sum function with tests' }),
    e(0, { role: 'user', content: '<reminder>', synthetic: true }),
    asst(1, [{ type: 'redactedThinking', data: 'x' }, { type: 'toolCall', id: 't1', name: 'write', arguments: { path: '/w/demo/src/sum.mjs', content: SUM } }]), res(1, 't1', 'write', 'ok'),
    asst(2, [{ type: 'toolCall', id: 't2', name: 'write', arguments: { path: '/w/demo/test/sum.test.mjs', content: TEST } }]), res(2, 't2', 'write', 'ok'),
    asst(3, [{ type: 'toolCall', id: 't3', name: 'bash', arguments: { command: 'npm test' } }]), res(4, 't3', 'bash', 'not ok 1 - adds\n# pass 1\n# fail 1\n\nCommand exited with code 1', { isError: true, details: { exitCode: 1 } }),
    asst(5, [{ type: 'toolCall', id: 't4', name: 'edit', arguments: { input: '*** Begin Patch\n[/w/demo/test/sum.test.mjs#A1B2]\nPUT 3.=3:\n+fixed\n*** End Patch' } }]), res(5, 't4', 'edit', 'ok'),
    asst(6, [{ type: 'toolCall', id: 't5', name: 'bash', arguments: { command: 'npm test' } }]), res(7, 't5', 'bash', '# pass 2\n# fail 0'),
    asst(8, [{ type: 'text', text: FINAL }], 'stop'),
  ]);
  const s = expectStory(m, { model: 'claude-opus-5-5', project: 'demo' });
  assert.equal(s.costUsd.toFixed(2), '0.06');
});

test('mixdog session file plus the running turn checkpoint', async () => {
  const { parseDocument } = await import('../src/adapters/mixdog.mjs');
  const doc = { id: 'sess_x', owner: 'user', model: 'gpt-5.5', cwd: '/w/demo', createdAt: T(0), messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '<contextBlock># Task\nAdd a sum function with tests\n\n<system-reminder>be nice</system-reminder>', meta: { transcript: { at: Date.parse(T(0)) } } },
    { role: 'assistant', createdAt: T(1), content: '', reasoningContent: 'plan', toolCalls: [{ id: 'a', name: 'apply_patch', arguments: { patch: `*** Begin Patch\n*** Add File: src/sum.mjs\n+${SUM}\n*** End Patch` } }] },
    { role: 'tool', toolCallId: 'a', content: 'Done', toolKind: 'normal' },
    { role: 'assistant', createdAt: T(2), content: '', toolCalls: [{ id: 'b', name: 'apply_patch', arguments: { patch: `*** Begin Patch\n*** Add File: test/sum.test.mjs\n+x\n*** End Patch` } }] },
    { role: 'tool', toolCallId: 'b', content: 'Done', toolKind: 'normal' },
    { role: 'assistant', createdAt: T(3), content: '', toolCalls: [{ id: 'c', name: 'shell', arguments: { command: 'npm test' } }] },
    { role: 'tool', toolCallId: 'c', content: '[exit code: 1]\nnot ok 1 - adds\n# pass 1\n# fail 1', toolKind: 'normal' },
    { role: 'assistant', createdAt: T(4), content: '', toolCalls: [{ id: 'd', name: 'edit', arguments: { file_path: 'test/sum.test.mjs', old_string: 'a', new_string: 'b' } }] },
    { role: 'tool', toolCallId: 'd', content: 'ok', toolKind: 'normal' },
    { role: 'assistant', createdAt: T(5), content: '', toolCalls: [{ id: 'e', name: 'shell', arguments: { command: 'npm test' } }] },
    { role: 'tool', toolCallId: 'e', content: '[exit code: 0]\n# pass 2\n# fail 0', toolKind: 'normal' },
    { role: 'assistant', createdAt: T(6), content: FINAL },
  ] };
  const m = new Match();
  for (const ev of parseDocument(JSON.stringify(doc), null)) m.push(ev);
  const s = m.snapshot();
  assert.equal(s.request, 'Add a sum function with tests');
  assert.deepEqual(s.moments.filter(x => x.type !== 'big-write').map(x => x.type), ['first-test', 'first-fail', 'var', 'recovery', 'decision']);
  assert.ok(s.finished);
  assert.equal(s.rating.score, 7.5);
  assert.ok(parseDocument(JSON.stringify({ ...doc, owner: 'agent' }), null).length, 'subagent sessions are parsed');
});
