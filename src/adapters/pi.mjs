// Pi coding agent: ~/.pi/agent/sessions/--<cwd>--/<ts>_<id>.jsonl (append-only, one entry per complete message).
// Overrides: PI_CODING_AGENT_DIR (agent dir), PI_CODING_AGENT_SESSION_DIR (flat sessions dir).

import { join } from 'node:path';
import { homedir } from 'node:os';
import { textOf, replacements } from '../core/events.mjs';
import { listFiles } from './fs-util.mjs';

const TOOL = {
  bash: a => ({ kind: 'shell', command: a.command }),
  powershell: a => ({ kind: 'shell', command: a.command }),
  read: a => ({ kind: 'read', path: a.path }),
  write: a => ({ kind: 'write', path: a.path, content: a.content }),
  edit: a => ({ kind: 'edit', path: a.path, ...(Array.isArray(a.edits) ? replacements(a.edits, 'oldText', 'newText') : { added: a.newText, removed: a.oldText }) }),
  grep: a => ({ kind: 'search', pattern: a.pattern }),
  find: a => ({ kind: 'search', pattern: a.pattern }),
  ls: a => ({ kind: 'search', pattern: a.path ?? '.' }),
};
export const normalizeTool = (name, args = {}) => ({ name, ...(TOOL[name]?.(args ?? {}) ?? { kind: 'other' }) });

export function createParser() {
  let lastAt = 0, cost = 0;
  return function parse(e) {
    const at = Date.parse(e.timestamp ?? '') || lastAt || Date.now();
    lastAt = at;
    const out = [];
    if (e.type === 'session') { if (e.cwd) out.push({ type: 'meta', at, cwd: e.cwd }); return out; }
    if (e.type === 'model_change' && e.modelId) { out.push({ type: 'model', at, model: e.modelId }); return out; }
    if (e.type === 'usage') { const c = e.usage?.cost?.total; if (Number.isFinite(c)) { cost += c; out.push({ type: 'usage', at, costUsd: cost }); } return out; }
    if (e.type !== 'message') return out;
    const m = e.message ?? {};
    if (m.role === 'user') { const t = textOf(m.content).trim(); if (t) out.push({ type: 'prompt', at, text: t }); }
    else if (m.role === 'assistant') {
      if (m.model) out.push({ type: 'model', at, model: m.model });
      const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: textOf(m.content) }];
      for (const b of blocks) {
        if (b?.type === 'thinking') out.push({ type: 'think', at });
        else if (b?.type === 'text' && b.text?.trim()) out.push({ type: 'say', at, text: b.text });
        else if (b?.type === 'toolCall') out.push({ type: 'call', at, id: b.id, tool: normalizeTool(b.name, b.arguments) });
      }
      const c = m.usage?.cost?.total;
      if (Number.isFinite(c)) { cost += c; out.push({ type: 'usage', at, costUsd: cost }); }
      if (m.stopReason && !['toolUse', 'pending', 'deferred'].includes(m.stopReason)) out.push({ type: 'end', at, text: blocks.filter(b => b?.type === 'text').map(b => b.text).join('\n') });
    } else if (m.role === 'toolResult') {
      const output = textOf(m.content);
      out.push({ type: 'result', at, id: m.toolCallId, output, error: !!m.isError || /Command exited with code [1-9]/.test(output) });
    }
    return out;
  };
}

export const adapter = {
  id: 'pi',
  label: 'Pi',
  format: 'jsonl',
  roots(env = process.env) {
    if (env.PI_CODING_AGENT_SESSION_DIR) return [env.PI_CODING_AGENT_SESSION_DIR];
    return [join(env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'sessions')];
  },
  async discover(env = process.env, roots) {
    const depth = !roots && env.PI_CODING_AGENT_SESSION_DIR ? 1 : 2;
    return (await Promise.all((roots ?? this.roots(env)).map(r => listFiles(r, { depth, match: f => f.endsWith('.jsonl') })))).flat();
  },
  createParser,
};
