// Gemini CLI: ~/.gemini/tmp/<project>/chats/session-*.jsonl (0.39+, append-only log of upserts) or
// session-*.json (0.38 and earlier, whole file rewritten). Messages are upserted by id, so the adapter reads
// the whole file and rebuilds the event list (format: 'document').

import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { textOf } from '../core/events.mjs';
import { listFiles } from './fs-util.mjs';

const TOOL = {
  run_shell_command: a => ({ kind: 'shell', command: a.command }),
  read_file: a => ({ kind: 'read', path: a.file_path ?? a.absolute_path ?? a.path }),
  read_many_files: () => ({ kind: 'read' }),
  write_file: a => ({ kind: 'write', path: a.file_path ?? a.path, content: a.content }),
  replace: a => ({ kind: 'edit', path: a.file_path ?? a.path, added: a.new_string, removed: a.old_string }),
  edit: a => ({ kind: 'edit', path: a.file_path ?? a.path, added: a.new_string, removed: a.old_string }),
  grep_search: a => ({ kind: 'search', pattern: a.pattern }),
  search_file_content: a => ({ kind: 'search', pattern: a.pattern }),
  glob: a => ({ kind: 'search', pattern: a.pattern }),
  list_directory: a => ({ kind: 'search', pattern: a.dir_path ?? a.path ?? '.' }),
  write_todos: () => ({ kind: 'plan' }),
  invoke_agent: () => ({ kind: 'delegate' }),
};
export const normalizeTool = (name, args = {}) => ({ name, ...(TOOL[name]?.(args ?? {}) ?? { kind: 'other' }) });

const partsText = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => (typeof p === 'string' ? p : p?.text ?? '')).join('') : textOf(c));
const hasFunctionResponse = c => Array.isArray(c) && c.some(p => p?.functionResponse);

function resultOf(call) {
  const resp = [].concat(call.result ?? []).map(r => r?.functionResponse?.response).find(Boolean) ?? {};
  const output = typeof resp.output === 'string' ? resp.output : resp.error ? String(resp.error) : typeof call.resultDisplay === 'string' ? call.resultDisplay : JSON.stringify(resp);
  const exit = Number(/Exit Code: (-?\d+)/.exec(output)?.[1] ?? 0);
  return { output, error: call.status === 'error' || call.status === 'cancelled' || !!resp.error || exit !== 0 };
}

// Replay the log of records into the current message list.
export function messagesOf(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') && !trimmed.includes('\n{')) { // legacy single JSON document
    try { const doc = JSON.parse(trimmed); if (Array.isArray(doc.messages)) return { messages: doc.messages }; } catch {}
  }
  let list = [];
  const index = () => new Map(list.map((m, i) => [m.id, i]));
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.$set) { if (Array.isArray(r.$set.messages)) list = r.$set.messages.slice(); continue; }
    if (r.$rewindTo) { const i = list.findIndex(m => m.id === r.$rewindTo); if (i >= 0) list = list.slice(0, i); continue; }
    if (r.$patch) {
      const pt = r.$patch;
      for (const u of [...(pt.id ? [pt] : []), ...(pt.updates ?? [])]) {
        const m = list.find(x => x.id === u.id);
        if (!m) continue;
        if (u.content !== undefined) m.content = u.content;
        for (const tc of u.toolCalls ?? []) { const c = (m.toolCalls ??= []).find(x => x.id === tc.id); if (c) Object.assign(c, tc); else m.toolCalls.push(tc); }
      }
      if (pt.removeIds) list = list.filter(m => !pt.removeIds.includes(m.id));
      continue;
    }
    if (typeof r.id === 'string' && r.type) { const i = index().get(r.id); if (i === undefined) list.push(r); else list[i] = r; }
  }
  return { messages: list };
}

export function parseDocument(text) {
  const { messages } = messagesOf(text);
  const out = [];
  let lastGemini = null;
  for (const m of messages) {
    const at = Date.parse(m.timestamp ?? '') || out.at(-1)?.at || 0;
    if (m.type === 'user') {
      if (hasFunctionResponse(m.content)) continue; // tool results are read from toolCalls
      const t = partsText(m.displayContent ?? m.content).trim();
      if (t) out.push({ type: 'prompt', at, text: t });
      lastGemini = null;
    } else if (m.type === 'gemini') {
      if (m.model) out.push({ type: 'model', at, model: m.model });
      if (m.thoughts?.length) out.push({ type: 'think', at });
      const t = partsText(m.content).trim();
      if (t) out.push({ type: 'say', at, text: t });
      for (const c of m.toolCalls ?? []) {
        const cat = Date.parse(c.timestamp ?? '') || at;
        out.push({ type: 'call', at: cat, id: c.id, tool: normalizeTool(c.name, c.args) });
        if (c.result || c.status === 'success' || c.status === 'error' || c.status === 'cancelled') out.push({ type: 'result', at: cat, id: c.id, ...resultOf(c) });
      }
      lastGemini = m;
    }
  }
  // No explicit end marker: a model reply with text and no tool calls closes the turn.
  if (lastGemini && !lastGemini.toolCalls?.length && partsText(lastGemini.content).trim()) out.push({ type: 'end', at: out.at(-1).at, text: partsText(lastGemini.content) });
  return out;
}

export const adapter = {
  id: 'gemini',
  label: 'Gemini CLI',
  format: 'document',
  roots(env = process.env) { return [join(env.GEMINI_CLI_HOME || homedir(), '.gemini', 'tmp')]; },
  // tmp/<project>/chats/session-*.jsonl; subagent chats sit one level deeper and are skipped.
  async discover(env, roots = this.roots(env)) { return (await Promise.all(roots.map(r => listFiles(r, { depth: 3, match: f => /[\\/]chats[\\/]session-[^\\/]*\.jsonl?$/.test(f) })))).flat(); },
  project: file => basename(dirname(dirname(file))),
  parseDocument,
};
