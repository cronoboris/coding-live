// Claude Code: ~/.claude/projects/<project>/<session>.jsonl (append-only, one entry per line).
// The same parser also reads headless `claude -p --output-format stream-json` output.

import { join } from 'node:path';
import { homedir } from 'node:os';
import { textOf, replacements } from '../core/events.mjs';
import { listFiles } from './fs-util.mjs';

const TOOL = {
  Bash: i => ({ kind: 'shell', command: i.command }),
  Read: i => ({ kind: 'read', path: i.file_path }),
  Write: i => ({ kind: 'write', path: i.file_path, content: i.content }),
  Edit: i => ({ kind: 'edit', path: i.file_path, added: i.new_string, removed: i.old_string }),
  MultiEdit: i => ({ kind: 'edit', path: i.file_path, ...replacements(i.edits, 'old_string', 'new_string') }),
  NotebookEdit: i => ({ kind: 'edit', path: i.notebook_path }),
  Grep: i => ({ kind: 'search', pattern: i.pattern }),
  Glob: i => ({ kind: 'search', pattern: i.pattern }),
  TodoWrite: () => ({ kind: 'plan' }),
  TaskCreate: () => ({ kind: 'plan' }),
  TaskUpdate: () => ({ kind: 'plan' }),
  Agent: i => ({ kind: 'delegate', agent: i.subagent_type, tag: i.description, prompt: String(i.prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) }),
  Task: i => TOOL.Agent(i),
};
export const normalizeTool = (name, input = {}) => ({ name, ...(TOOL[name]?.(input ?? {}) ?? { kind: 'other' }) });

const isNoise = text => !text.trim() || /^\s*<(system-reminder|command-|local-command|bash-|user-prompt-submit-hook|task-notification)/.test(text) || /^\[Request interrupted/.test(text);

export function createParser(file = '') {
  let lastAt = 0, cwd = null;
  const child = /(?:^|[\\/])(?:subagents[\\/])?agent-[^\\/]+\.jsonl$/.test(file);
  let linked = false;
  return function parse(entry) {
    const at = Date.parse(entry.timestamp ?? '') || lastAt || Date.now();
    lastAt = at;
    if (entry.isSidechain && !child) return [];
    const out = [];
    if (child && !linked && entry.sessionId) {
      out.push({ type: 'role', at, parent: entry.sessionId, role: 'subagent', tag: entry.agentId });
      linked = true;
    }
    const dir = entry.cwd ?? (entry.type === 'system' && entry.subtype === 'init' ? entry.cwd : null);
    if (dir && dir !== cwd) { cwd = dir; out.push({ type: 'meta', at, cwd }); }
    const msg = entry.message ?? {};
    switch (entry.type) {
      case 'assistant': {
        if (msg.model && !msg.model.startsWith('<')) out.push({ type: 'model', at, model: msg.model });
        for (const b of Array.isArray(msg.content) ? msg.content : []) {
          if (b?.type === 'text' && b.text?.trim()) out.push({ type: 'say', at, text: b.text });
          else if (b?.type === 'thinking' || b?.type === 'redacted_thinking') out.push({ type: 'think', at });
          else if (b?.type === 'tool_use') out.push({ type: 'call', at, id: b.id, tool: normalizeTool(b.name, b.input) });
        }
        break;
      }
      case 'user': {
        if (entry.isMeta || entry.isCompactSummary || entry.isVisibleInTranscriptOnly) break;
        if (typeof msg.content === 'string') { if (!isNoise(msg.content)) out.push({ type: 'prompt', at, text: msg.content }); break; }
        for (const b of Array.isArray(msg.content) ? msg.content : []) {
          if (b?.type === 'tool_result') out.push({ type: 'result', at, id: b.tool_use_id, output: textOf(b.content), error: !!b.is_error });
          else if (b?.type === 'text' && !isNoise(b.text ?? '')) out.push({ type: 'prompt', at, text: b.text });
        }
        break;
      }
      case 'system':
        if (entry.subtype === 'init' && entry.model) out.push({ type: 'model', at, model: entry.model });
        else if (entry.subtype === 'stop_hook_summary' || entry.subtype === 'turn_duration') out.push({ type: 'end', at, text: '' });
        else if (entry.subtype === 'thinking_tokens') out.push({ type: 'alive', at });
        break;
      case 'result': // stream-json
        if (Number.isFinite(entry.total_cost_usd)) out.push({ type: 'usage', at, costUsd: entry.total_cost_usd });
        out.push({ type: 'end', at, text: String(entry.result ?? '') });
        break;
      case 'progress': case 'tool_progress':
        out.push({ type: 'alive', at });
        break;
      case 'cost-state':
        if (Number.isFinite(entry.totalCostUSD)) out.push({ type: 'usage', at, costUsd: entry.totalCostUSD });
        break;
    }
    return out;
  };
}

export const adapter = {
  id: 'claude-code',
  label: 'Claude Code',
  roots(env = process.env) { return [join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')]; },
  // Includes <project>/<session>/subagents/agent-*.jsonl.
  async discover(env, roots = this.roots(env)) { return (await Promise.all(roots.map(r => listFiles(r, { depth: 4, match: f => f.endsWith('.jsonl') })))).flat(); },
  sessionId: file => file.split(/[\\/]/).at(-1).replace(/\.jsonl$/, ''),
  format: 'jsonl',
  createParser,
};
