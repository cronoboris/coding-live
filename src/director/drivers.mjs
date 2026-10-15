// How the app talks to each agent's own program. Every driver: (chat, cmd, resume) -> { send(text), stop(), close() }.
// All of them ask the user before the agent edits files or runs commands.

import { launch } from './chat.mjs';
import { normalizeTool as claudeTool } from '../adapters/claude-code.mjs';
import { normalizeTool as ompTool } from '../adapters/omp.mjs';

const summarize = t => [t.path, t.command, t.pattern, t.prompt].find(v => typeof v === 'string' && v) ?? '';
const detailOf = v => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };

// Claude Code: `claude -p` with JSON lines both ways; permission requests come to us with `--permission-prompt-tool stdio`.
export function claude(chat, cmd, resume) {
  let n = 0, streamed = false;
  const p = launch(chat, cmd, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'manual', '--permission-prompt-tool', 'stdio', ...(resume ? ['--resume', resume] : [])], m => {
    if (m.parent_tool_use_id) return; // a subagent's own work
    if (m.type === 'system' && m.subtype === 'init' && m.session_id) chat.setState({ sessionId: m.session_id });
    else if (m.type === 'stream_event') {
      const e = m.event;
      if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') { streamed = true; chat.text(e.delta.text); }
    } else if (m.type === 'assistant') {
      const blocks = m.message?.content ?? [];
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
      if (text && !streamed) chat.text(text);
      if (text) { chat.messageEnd(); streamed = false; }
      for (const b of blocks) if (b.type === 'tool_use') chat.tool(b.name, summarize(claudeTool(b.name, b.input)));
    } else if (m.type === 'control_request' && m.request?.subtype === 'can_use_tool') {
      const r = m.request;
      chat.ask({ tool: r.tool_name, summary: r.description || summarize(claudeTool(r.tool_name, r.input)), detail: detailOf(r.input), canAlways: !!r.permission_suggestions?.length }, d => p.write({
        type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: d === 'deny'
          ? { behavior: 'deny', message: 'The user declined this.' }
          : { behavior: 'allow', updatedInput: r.input, ...(d === 'session' && r.permission_suggestions?.length ? { updatedPermissions: r.permission_suggestions } : {}) } },
      }));
    } else if (m.type === 'control_request') {
      p.write({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: 'unsupported' } });
    } else if (m.type === 'result') {
      // total_cost_usd is the whole session's cost so far, earlier runs of a resumed session included
      if (Number.isFinite(m.total_cost_usd)) chat.setState({ costUsd: m.total_cost_usd });
      chat.turnEnd(m.subtype === 'success' && !m.is_error);
    }
  });
  p.write({ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } });
  return {
    send: text => p.write({ type: 'user', message: { role: 'user', content: text } }),
    stop: () => p.write({ type: 'control_request', request_id: `stop${++n}`, request: { subtype: 'interrupt' } }),
    close: p.kill,
  };
}

// Codex: `codex app-server`, JSON-RPC. A read-only sandbox makes every edit and non-reading command ask first.
export function codex(chat, cmd, resume) {
  // Codex only accepts an interrupt once the turn has started (the turn/started notice, not the turn/start reply).
  let id = 0, thread = null, turn = null, running = false, stopping = false;
  const calls = new Map();
  const interrupt = () => request('turn/interrupt', { threadId: thread, turnId: turn }).catch(() => {});
  const request = (method, params) => new Promise((res, rej) => { const i = ++id; calls.set(i, { res, rej }); p.write({ jsonrpc: '2.0', id: i, method, params }); });
  const p = launch(chat, cmd, ['app-server'], m => {
    if (m.id !== undefined && !m.method) {
      const c = calls.get(m.id); calls.delete(m.id);
      if (c) m.error ? c.rej(new Error(m.error.message ?? 'error')) : c.res(m.result ?? {});
      return;
    }
    if (m.id !== undefined) { // the agent asks us
      if (!/\/requestApproval$/.test(m.method)) { p.write({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unsupported' } }); return; }
      const x = m.params ?? {};
      const command = Array.isArray(x.command) ? x.command.join(' ') : x.command;
      const kind = m.method.includes('commandExecution') ? 'command' : m.method.includes('fileChange') ? 'edit' : 'permissions';
      chat.ask({ tool: kind, summary: command || x.reason || kind, detail: detailOf(x), canAlways: kind !== 'permissions' }, d => p.write({
        jsonrpc: '2.0', id: m.id, result: kind === 'permissions'
          ? { permissions: d === 'deny' ? {} : (x.permissions ?? {}), scope: d === 'session' ? 'session' : 'turn' }
          : { decision: d === 'deny' ? 'decline' : d === 'session' ? 'acceptForSession' : 'accept' },
      }));
      return;
    }
    const x = m.params ?? {};
    switch (m.method) {
      case 'item/agentMessage/delta': chat.text(x.delta); break;
      case 'item/started': {
        const it = x.item ?? {};
        if (it.type === 'commandExecution') chat.tool('command', Array.isArray(it.command) ? it.command.join(' ') : it.command);
        else if (it.type === 'fileChange') chat.tool('edit', (it.changes ?? []).map(c => c.path).join(', '));
        else if (it.type === 'mcpToolCall') chat.tool(it.tool, it.server);
        else if (it.type === 'webSearch') chat.tool('search', it.query);
        break;
      }
      case 'item/completed': if (x.item?.type === 'agentMessage') chat.messageEnd(); break;
      case 'turn/started': turn = x.turn?.id ?? turn; running = true; if (stopping) { stopping = false; interrupt(); } break;
      case 'turn/completed': turn = null; running = false; stopping = false; chat.turnEnd(x.turn?.status === 'completed'); break;
      case 'thread/tokenUsage/updated': chat.setState({ tokens: x.tokenUsage?.total?.totalTokens ?? chat.state.tokens }); break;
      case 'error': if (!x.willRetry) chat.error(x.error?.message ?? 'error'); break;
    }
  }, () => { for (const c of calls.values()) c.rej(new Error('the agent ended')); calls.clear(); });
  const ready = (async () => {
    await request('initialize', { clientInfo: { name: 'coding-live', version: '1' } });
    p.write({ jsonrpc: '2.0', method: 'initialized' });
    const opts = { cwd: chat.cwd, approvalPolicy: 'on-request', sandbox: 'read-only' };
    const r = resume ? await request('thread/resume', { threadId: resume, ...opts, excludeTurns: true }) : await request('thread/start', opts);
    thread = r.thread?.id ?? null;
    chat.setState({ sessionId: thread });
  })();
  ready.catch(e => chat.error(e.message));
  return {
    send: async text => { stopping = false; await ready; const r = await request('turn/start', { threadId: thread, input: [{ type: 'text', text }] }); turn = r.turn?.id ?? turn; },
    // Stopped before the turn has started: interrupt as soon as it has.
    stop: () => { if (running) interrupt(); else stopping = true; },
    close: p.kill,
  };
}

// omp: `omp --mode rpc`; tool permission questions arrive as a "select" with Approve/Deny.
export function omp(chat, cmd, resume) {
  // omp ignores (and then hangs on) an abort sent before the turn has started, so a stop waits for agent_start.
  let n = 0, aborted = false, running = false, readyNow, readyFail;
  const ready = new Promise((r, f) => { readyNow = r; readyFail = f; });
  ready.catch(() => {});
  const p = launch(chat, cmd, ['--mode', 'rpc', '--approval-mode', 'always-ask', '--allow-home', ...(resume ? ['--resume', resume] : [])], m => {
    switch (m.type) {
      case 'ready': readyNow(); p.write({ id: 'state', type: 'get_state' }); break;
      case 'response':
        if (m.command === 'get_state' && m.success) chat.setState({ sessionId: m.data?.sessionFile ?? m.data?.sessionId ?? null });
        else if (m.success === false) { chat.error(m.error ?? `${m.command} failed`); if (m.command === 'prompt') chat.turnEnd(false); }
        break;
      case 'message_update': { const e = m.assistantMessageEvent; if (e?.type === 'text_delta') chat.text(e.delta); break; }
      case 'message_end':
        if (m.message?.role === 'assistant') { chat.addCost(m.message.usage?.cost?.total); chat.messageEnd(); }
        break;
      case 'tool_execution_start': chat.tool(m.toolName, summarize(ompTool(m.toolName, m.args))); break;
      case 'extension_ui_request': {
        const options = m.options ?? [];
        const allow = options.find(o => /approve|allow|yes/i.test(o)), deny = options.find(o => /deny|reject|no/i.test(o));
        if (m.method === 'select' && allow && deny) {
          const [head, ...rest] = String(m.title ?? '').split('\n');
          chat.ask({ tool: head.replace(/^Allow tool:\s*/i, ''), summary: rest[0] ?? head, detail: rest.join('\n'), canAlways: false },
            d => p.write({ type: 'extension_ui_response', id: m.id, value: d === 'deny' ? deny : allow }));
        } else if (['select', 'confirm', 'input', 'editor'].includes(m.method)) p.write({ type: 'extension_ui_response', id: m.id, cancelled: true });
        break;
      }
      case 'agent_start': running = true; if (aborted) abort(); break;
      case 'agent_end': chat.turnEnd(!aborted); aborted = false; running = false; break;
    }
  }, () => readyFail(new Error('the agent ended')));
  const abort = () => p.write({ id: `a${++n}`, type: 'abort' });
  return {
    send: async text => { aborted = false; await ready; p.write({ id: `m${++n}`, type: 'prompt', message: text }); },
    stop: () => { aborted = true; if (running) abort(); },
    close: p.kill,
  };
}
