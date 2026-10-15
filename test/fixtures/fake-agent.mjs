// Speaks just enough of Claude Code's, Codex's or omp's control protocol for the director tests (no AI).
// Usage: node fake-agent.mjs <claude|codex|omp> [the agent's own arguments...]
// A turn says "hi there", asks to write a.txt, then says " allowed" or " denied". "hang" waits for stop; "crash" exits 3.
import { createInterface } from 'node:readline';

const [mode, ...args] = process.argv.slice(2);
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
const flag = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
let answer = null, hung = null;

const claude = m => {
  const say = text => out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
  const end = ok => { out({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } }); out({ type: 'result', subtype: ok ? 'success' : 'error_during_execution', is_error: !ok, total_cost_usd: 0.01 }); };
  if (m.type === 'control_request' && m.request.subtype === 'initialize') {
    out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: {} } });
    out({ type: 'system', subtype: 'init', session_id: flag('--resume') ?? 'new-claude', args });
  } else if (m.type === 'control_request' && m.request.subtype === 'interrupt') { if (hung) { hung = null; end(false); } }
  else if (m.type === 'control_response') { const r = m.response.response; answer?.(r.behavior === 'allow', r); }
  else if (m.type === 'user') turn(m.message.content, say, cb => {
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'a.txt', content: 'x' } }] } });
    out({ type: 'control_request', request_id: 'p1', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: 'a.txt', content: 'x' }, permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits' }] } });
    answer = cb;
  }, end);
};

const codex = m => {
  const say = delta => out({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { delta } });
  const end = ok => { out({ jsonrpc: '2.0', method: 'item/completed', params: { item: { type: 'agentMessage' } } }); out({ jsonrpc: '2.0', method: 'thread/tokenUsage/updated', params: { tokenUsage: { total: { totalTokens: 1200 } } } }); out({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { status: ok ? 'completed' : 'interrupted' } } }); };
  const reply = result => out({ jsonrpc: '2.0', id: m.id, result });
  if (m.method === 'initialize') reply({});
  else if (m.method === 'thread/start') reply({ thread: { id: 'new-codex' }, params: m.params });
  else if (m.method === 'thread/resume') reply({ thread: { id: m.params.threadId } });
  else if (m.method === 'turn/interrupt') { reply({}); if (hung) { hung = null; end(false); } }
  else if (m.method === 'turn/start') {
    reply({ turn: { id: 't1' } });
    out({ jsonrpc: '2.0', method: 'turn/started', params: { turn: { id: 't1' } } });
    turn(m.params.input[0].text, say, cb => { out({ jsonrpc: '2.0', id: 100, method: 'item/fileChange/requestApproval', params: { reason: 'write a.txt' } }); answer = cb; }, end);
  } else if (m.id === 100 && m.result) answer?.(m.result.decision !== 'decline', m.result);
};

const omp = m => {
  const say = delta => out({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta } });
  const end = () => { out({ type: 'message_end', message: { role: 'assistant', usage: { cost: { total: 0.02 } } } }); out({ type: 'agent_end' }); };
  if (m.type === 'get_state') out({ type: 'response', id: m.id, command: 'get_state', success: true, data: { sessionFile: flag('--resume') ?? '/s/new-omp.jsonl' } });
  else if (m.type === 'abort') { if (hung) { hung = null; end(); } }
  else if (m.type === 'extension_ui_response') answer?.(m.value === 'Approve', m);
  else if (m.type === 'prompt') {
    out({ type: 'response', id: m.id, command: 'prompt', success: true });
    out({ type: 'agent_start' });
    turn(m.message, say, cb => { out({ type: 'extension_ui_request', id: 'u1', method: 'select', title: 'Allow tool: write\nPath: a.txt', options: ['Approve', 'Deny'] }); answer = cb; }, end);
  }
};

function turn(text, say, ask, end) {
  if (text === 'crash') process.exit(3);
  if (text === 'hang') { hung = true; return; }
  say('hi '); say('there');
  ask((allowed, raw) => { answer = null; say(allowed ? ' allowed' : ' denied'); if (raw?.updatedPermissions || raw?.decision === 'acceptForSession') say(' always'); end(true); });
}

const handle = { claude, codex, omp }[mode];
if (!handle) process.exit(0); // `node --test` also loads this file on its own
if (mode === 'omp') out({ type: 'ready' });
createInterface({ input: process.stdin }).on('line', l => { if (l.trim()) handle(JSON.parse(l)); });
