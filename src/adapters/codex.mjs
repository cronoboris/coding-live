// OpenAI Codex CLI: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<thread>.jsonl (append-only).
// Lines are {timestamp, type, payload}. Tool calls/outputs are `response_item`s in every history mode;
// prompts come from `event_msg` (user_message in legacy mode, item_completed UserMessage in paginated mode).

import { join } from 'node:path';
import { homedir } from 'node:os';
import { textOf, diffLines } from '../core/events.mjs';
import { listFiles } from './fs-util.mjs';

const parseArgs = a => { if (a && typeof a === 'object') return a; try { return JSON.parse(a ?? '{}'); } catch { return {}; } };
const joinCmd = c => (Array.isArray(c) ? (c[0] === 'bash' && c[1] === '-lc' ? c.slice(2).join(' ') : c.join(' ')) : String(c ?? ''));

function patchTool(patch) {
  const m = /\*\*\* (Add|Update|Delete) File: (.+)/.exec(String(patch ?? ''));
  if (!m) return { kind: 'edit', name: 'apply_patch' };
  if (m[1] === 'Add') {
    const body = String(patch).split(/\*\*\* (?:Add|Update|Delete) File: .+\n/)[1] ?? '';
    return { kind: 'write', name: 'apply_patch', path: m[2].trim(), content: body.split('\n').filter(l => l.startsWith('+')).map(l => l.slice(1)).join('\n') };
  }
  return { kind: 'edit', name: 'apply_patch', path: m[2].trim(), ...diffLines(patch), ...(m[1] === 'Delete' ? { deleted: true } : {}) };
}

export function normalizeTool(name, args) {
  const a = parseArgs(args);
  switch (name) {
    case 'spawn_agent': return { name, kind: 'delegate', agent: a.agent_type, tag: a.nickname, prompt: String(a.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) };
    case 'exec_command': return { name, kind: 'shell', command: a.cmd ?? joinCmd(a.command) };
    case 'shell': case 'shell_command': case 'container.exec': case 'local_shell': return { name, kind: 'shell', command: joinCmd(a.command ?? a.cmd) };
    case 'apply_patch': return patchTool(typeof args === 'string' && !args.trim().startsWith('{') ? args : a.input ?? a.patch ?? args);
    case 'update_plan': return { name, kind: 'plan' };
    case 'view_image': return { name, kind: 'read', path: a.path };
    default: return { name, kind: 'other' };
  }
}

// exec_command output header: "Process exited with code N" (or the older "Exit code: N").
const exitCode = out => Number(/Process exited with code (-?\d+)|^Exit code: (-?\d+)/m.exec(out)?.slice(1).find(x => x != null) ?? NaN);
const stillRunning = out => /Process running with session ID (\d+)/.exec(out)?.[1] ?? null;
const outputText = o => { if (typeof o === 'string') { try { const j = JSON.parse(o); if (j && typeof j.output === 'string') return j.output; } catch {} return o; } return textOf(o); };
const stripHeader = out => out.replace(/^(?:Chunk ID: .*\n)?(?:Wall time: .*\n)?(?:Process exited with code .*\n)?(?:Process running with session ID .*\n)?(?:Original token count: .*\n)?Output:\n/, '').replace(/^Exit code: .*\nWall time: .*\n(?:Total output lines: .*\n)?Output:\n/, '');

export function createParser() {
  let lastAt = 0;
  const calls = new Map();     // call_id -> { tool, id } (id: the play this output belongs to)
  const running = new Map();   // exec session id -> { tool, id } of a command that has not exited yet
  let lastPrompt = '';
  return function parse(entry) {
    const at = Date.parse(entry.timestamp ?? '') || lastAt || Date.now();
    lastAt = at;
    const p = entry.payload ?? {};
    const out = [];
    const prompt = text => { const t = String(text ?? '').trim(); if (t && t !== lastPrompt) { lastPrompt = t; out.push({ type: 'prompt', at, text: t }); } };
    switch (entry.type) {
      case 'session_meta': {
        if (p.cwd) out.push({ type: 'meta', at, cwd: p.cwd });
        const spawn = p.source?.subagent?.spawn;
        const parent = p.parent_thread_id ?? spawn?.parent_thread_id;
        if (parent) out.push({ type: 'role', at, parent, role: p.agent_role ?? spawn?.agent_role ?? p.source?.subagent?.other ?? 'subagent', name: p.agent_nickname ?? spawn?.agent_nickname });
        break;
      }
      case 'turn_context':
        if (p.model) out.push({ type: 'model', at, model: p.model });
        if (p.cwd) out.push({ type: 'meta', at, cwd: p.cwd });
        break;
      case 'response_item':
        switch (p.type) {
          case 'message':
            if (p.role === 'assistant') { const t = textOf(p.content).trim(); if (t) out.push({ type: 'say', at, text: t }); }
            break;
          case 'reasoning': out.push({ type: 'think', at }); break;
          case 'function_call': case 'custom_tool_call': {
            if (p.name === 'write_stdin') { // polling a long-running command: its output belongs to the original play
              const r = running.get(String(parseArgs(p.arguments).session_id));
              if (r) calls.set(p.call_id, r);
              out.push({ type: 'alive', at });
              break;
            }
            const tool = normalizeTool(p.name, p.type === 'custom_tool_call' ? p.input : p.arguments);
            calls.set(p.call_id, { tool, id: p.call_id });
            out.push({ type: 'call', at, id: p.call_id, tool });
            break;
          }
          case 'local_shell_call': {
            const tool = { name: 'local_shell', kind: 'shell', command: joinCmd(p.action?.command) };
            calls.set(p.call_id, { tool, id: p.call_id });
            out.push({ type: 'call', at, id: p.call_id, tool });
            break;
          }
          case 'function_call_output': case 'custom_tool_call_output': {
            const c = calls.get(p.call_id);
            if (!c) break;
            const raw = outputText(p.output);
            const sid = stillRunning(raw);
            if (sid && c.tool.kind === 'shell') { running.set(sid, { ...c, output: (c.output ?? '') + stripHeader(raw) }); out.push({ type: 'alive', at }); break; } // keep the play open until it exits
            const code = exitCode(raw);
            out.push({ type: 'result', at, id: c.id, output: (c.output ?? '') + stripHeader(raw), error: Number.isFinite(code) ? code !== 0 : false });
            break;
          }
        }
        break;
      case 'event_msg':
        switch (p.type) {
          case 'user_message': prompt(p.message); break;
          case 'item_completed': if (p.item?.type === 'UserMessage') prompt(textOf(p.item.content)); break;
          case 'task_started': case 'token_count': case 'agent_reasoning': out.push({ type: 'alive', at }); break;
          case 'task_complete': out.push({ type: 'end', at, text: String(p.last_agent_message ?? '') }); break;
          case 'turn_aborted': out.push({ type: 'end', at, text: '' }); break;
        }
        break;
    }
    return out;
  };
}

export const adapter = {
  id: 'codex',
  label: 'Codex',
  format: 'jsonl',
  sessionId: file => /([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i.exec(file)?.[1],
  roots(env = process.env) { return [join(env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')]; },
  async discover(env, roots = this.roots(env)) { return (await Promise.all(roots.map(r => listFiles(r, { depth: 4, match: f => /rollout-.*\.jsonl$/.test(f) })))).flat(); },
  createParser,
};
