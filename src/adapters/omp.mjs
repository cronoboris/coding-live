// omp (oh-my-pi, @oh-my-pi/pi-coding-agent): a Pi fork. Sessions live in ~/.omp/agent/sessions/<cwd-slug>/<ts>_<id>.jsonl
// (or $XDG_DATA_HOME/omp/sessions, profiles, PI_CONFIG_DIR / PI_CODING_AGENT_DIR overrides). Entries are Pi's, plus a
// 256-byte `title` slot on line 1 that is rewritten in place, extra roles and tools, and occasional atomic full rewrites
// (the hub restarts the tail when the file is replaced).

import { existsSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { textOf, diffLines } from '../core/events.mjs';
import { listFiles } from './fs-util.mjs';

// Paths named in a patch body: Codex-style "*** Add/Update File: p" or omp's hashline "[path#TAG]" headers.
function patchTarget(input) {
  const s = String(input ?? '');
  const v4a = /\*\*\* (Add|Update|Delete) File: (.+)/.exec(s);
  const { added, removed } = diffLines(s);
  if (v4a) return v4a[1] === 'Add' ? { kind: 'write', path: v4a[2].trim(), content: added } : { kind: 'edit', path: v4a[2].trim(), added, removed, ...(v4a[1] === 'Delete' ? { deleted: true } : {}) };
  const hash = /^\[([^\]\n#]+)#[^\]\n]*\]/m.exec(s);
  return { kind: 'edit', path: hash?.[1]?.trim(), added, removed };
}

export function normalizeTool(name, a = {}) {
  a = a ?? {};
  switch (name) {
    case 'bash': return { name, kind: 'shell', command: a.command };
    case 'eval': return { name, kind: 'shell', command: a.language === 'py' ? `python3 -c ${JSON.stringify(String(a.code ?? '').slice(0, 200))}` : `node -e ${JSON.stringify(String(a.code ?? '').slice(0, 200))}` };
    case 'read': return { name, kind: 'read', path: String(a.path ?? '').replace(/(:\d[\d,:-]*|#[^\\/]*)$/, '') };
    case 'write': return { name, kind: 'write', path: a.path, content: a.content };
    case 'edit': return { name, ...(a.path ? { kind: 'edit', path: a.path } : patchTarget(a.input)) };
    case 'apply_patch': return { name, ...patchTarget(a.input ?? a.patch) };
    case 'ast_edit': return { name, kind: 'edit', path: a.path };
    case 'grep': case 'search': case 'ast_grep': return { name, kind: 'search', pattern: a.pattern };
    case 'glob': return { name, kind: 'search', pattern: a.pattern ?? a.path };
    case 'find': return { name, kind: 'search', pattern: a.query };
    case 'task': return {
      name, kind: 'delegate',
      agent: a.tasks?.map(t => t.agent).filter(Boolean).join(', '),
      tag: a.tasks?.map(t => t.name).filter(Boolean).join(', '),
      prompt: (a.tasks ?? []).map(t => t.task ?? '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 160),
    };
    case 'todo': return { name, kind: 'plan' };
    default: return { name, kind: 'other' };
  }
}

export function createParser(file = '') {
  let lastAt = 0, cost = 0;
  const addCost = (at, usage) => { const c = usage?.cost?.total; if (Number.isFinite(c)) { cost += c; return [{ type: 'usage', at, costUsd: cost }]; } return []; };
  return function parse(e) {
    const at = Date.parse(e.timestamp ?? '') || lastAt || Date.now();
    lastAt = at;
    switch (e.type) {
      case 'session': {
        const out = e.cwd ? [{ type: 'meta', at, cwd: e.cwd }] : [];
        // Only the task transcript layout denotes delegation; parentSession alone also denotes forks.
        if (e.parentSession && basename(dirname(file)) === basename(e.parentSession, '.jsonl')) {
          out.push({ type: 'role', at, parent: e.parentSession, role: 'subagent', name: basename(file, '.jsonl') });
        }
        return out;
      }
      case 'model_change': return e.model && e.role !== 'smol' ? [{ type: 'model', at, model: String(e.model).split('/').at(-1) }] : [];
      case 'model_usage': return addCost(at, e.usage);
      case 'message': break;
      default: return []; // title slot, compaction, labels, mode changes, ...
    }
    const m = e.message ?? {};
    const out = [];
    if (m.role === 'user') { if (!m.synthetic) { const t = textOf(m.content).trim(); if (t) out.push({ type: 'prompt', at, text: t }); } }
    else if (m.role === 'assistant') {
      if (m.model) out.push({ type: 'model', at, model: m.model });
      const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: textOf(m.content) }];
      for (const b of blocks) {
        if (b?.type === 'thinking' || b?.type === 'redactedThinking') out.push({ type: 'think', at });
        else if (b?.type === 'text' && b.text?.trim()) out.push({ type: 'say', at, text: b.text });
        else if (b?.type === 'toolCall') out.push({ type: 'call', at, id: b.id, tool: normalizeTool(b.name, b.arguments) });
      }
      out.push(...addCost(at, m.usage));
      if (m.stopReason && m.stopReason !== 'toolUse') out.push({ type: 'end', at, text: blocks.filter(b => b?.type === 'text').map(b => b.text).join('\n') || String(m.errorMessage ?? '') });
    } else if (m.role === 'toolResult') {
      const output = textOf(m.content);
      out.push({ type: 'result', at, id: m.toolCallId, output, error: !!m.isError || Number.isFinite(m.details?.exitCode) });
    }
    return out;
  };
}

// Every place omp may keep sessions, newest layout first.
function roots(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const out = [];
  const xdg = env.XDG_DATA_HOME || join(home, '.local', 'share');
  if (existsSync(join(xdg, 'omp'))) {
    out.push(join(xdg, 'omp', 'sessions'));
    try { for (const p of readdirSync(join(xdg, 'omp', 'profiles'))) out.push(join(xdg, 'omp', 'profiles', p)); } catch {}
  }
  // PI_CODING_AGENT_DIR is shared with Pi; it is left to the Pi adapter so one session isn't listed twice.
  const base = join(home, env.PI_CONFIG_DIR || '.omp');
  out.push(join(base, 'agent', 'sessions'));
  try { for (const p of readdirSync(join(base, 'profiles'))) out.push(join(base, 'profiles', p, 'agent', 'sessions')); } catch {}
  return [...new Set(out)];
}

export const adapter = {
  id: 'omp',
  label: 'omp',
  format: 'jsonl',
  roots,
  sessionId: file => file,
  // Task transcripts live in <cwd-slug>/<parent-stem>/<task-name>.jsonl.
  async discover(env, rs = roots(env)) { return (await Promise.all(rs.map(r => listFiles(r, { depth: 3, match: f => f.endsWith('.jsonl') })))).flat(); },
  createParser,
};
