// mixdog (tribgames/mixdog, CLI and desktop app): ~/.mixdog/data/sessions/<id>.json (MIXDOG_HOME / MIXDOG_DATA_DIR).
// The session file is rewritten whole and only advances when a turn commits; while a turn runs, its messages live in
// <data>/turn-checkpoints/<id>.json (header) + <id>.jsonl (append-only journal), both deleted at commit. So the
// adapter rebuilds the match from the session file plus the running turn's checkpoint (format: 'document').

import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { textOf, diffLines } from '../core/events.mjs';
import { listFiles } from './fs-util.mjs';
import { t } from '../i18n/index.mjs';

const dataDir = (env = process.env) => env.MIXDOG_DATA_DIR || join(env.MIXDOG_HOME || join(env.HOME || env.USERPROFILE || homedir(), '.mixdog'), 'data');
const idOf = file => basename(file).replace(/\.json$/, '');
const checkpointFiles = file => { const dir = join(dirname(dirname(file)), 'turn-checkpoints'); return [join(dir, `${idOf(file)}.json`), join(dir, `${idOf(file)}.jsonl`)]; };
const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

function patchTarget(patch) {
  const m = /\*\*\* (Add|Update|Delete) File: (.+)/.exec(String(patch ?? ''));
  if (!m) return { kind: 'edit' };
  if (m[1] !== 'Add') return { kind: 'edit', path: m[2].trim(), ...diffLines(patch), ...(m[1] === 'Delete' ? { deleted: true } : {}) };
  const body = String(patch).split(/\*\*\* Add File: .+\n/)[1] ?? '';
  return { kind: 'write', path: m[2].trim(), content: body.split('\n').filter(l => l.startsWith('+')).map(l => l.slice(1)).join('\n') };
}
export function normalizeTool(name, a = {}) {
  a = a ?? {};
  switch (name) {
    case 'shell': return { name, kind: 'shell', command: String(a.command ?? '').replace(/^\[mixdog compacted command:[^\]]*\]\n/, '') };
    case 'read': return { name, kind: 'read', path: Array.isArray(a.file_path) ? a.file_path[0]?.file_path : a.file_path };
    case 'edit': return { name, kind: 'edit', path: a.file_path, added: a.new_string, removed: a.old_string };
    case 'apply_patch': return { name, ...patchTarget(a.patch) };
    case 'grep': case 'glob': return { name, kind: 'search', pattern: a.pattern };
    case 'find': return { name, kind: 'search', pattern: a.query };
    case 'list': return { name, kind: 'search', pattern: a.path ?? '.' };
    case 'agent': return { name, kind: 'delegate', tag: a.tag, agent: a.agent, prompt: String(a.prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 160), type: a.type };
    case 'goal': return { name, kind: 'plan' };
    case 'git': { const command = [].concat(a.command ?? []).filter(Boolean).join(' && '); return { name, kind: 'other', ...(command ? { command } : {}) }; }
    default: return { name, kind: 'other' };
  }
}

// The user's words, without mixdog's task wrapper and trailing reminders.
const promptText = c => {
  let t = textOf(c);
  const task = /# Task\n([\s\S]*)$/.exec(t);
  if (task && t.trimStart().startsWith('<')) t = task[1];
  return t.replace(/\n*<system-reminder>[\s\S]*$/, '').trim();
};
const exitCode = out => Number(/^\s*(?:\[session:[^\n]*\]\s*\n)?(?:Error:\s*)?(?:\[shell-run-failed\]\s*)?\[exit code:\s*(\d+)\]/i.exec(out)?.[1] ?? NaN);
const timeOf = (m, fallback) => { const v = m?.meta?.transcript?.at ?? m?.createdAt ?? m?.ts; const t = typeof v === 'number' ? v : Date.parse(v ?? ''); return Number.isFinite(t) && t > 0 ? t : fallback; };

// Messages of the turn in progress: the checkpoint header, then the journal replayed in sequence.
export function runningTurn(header, journalText) {
  if (!header || !Array.isArray(header.turnMessages)) return null;
  let msgs = header.turnMessages.slice();
  let expected = null;
  for (const line of String(journalText ?? '').split('\n')) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (expected === null) { if (r.t === 'h' && r.turnToken === header.turnToken) expected = (r.s ?? 0) + 1; else break; continue; }
    if (Number.isFinite(r.s)) { if (r.s < expected) continue; if (r.s > expected) break; expected++; }
    if (r.t === 'm' && Number.isInteger(r.i)) msgs[r.i] = r.m;
    else if (r.t === 'len' && Number.isInteger(r.n)) msgs.length = r.n;
    else if (r.t === 'full' && Array.isArray(r.ms)) msgs = r.ms.slice();
  }
  return msgs.filter(Boolean);
}

export function parseDocument(text, file, read = readJson, readText = f => { try { return readFileSync(f, 'utf8'); } catch { return ''; } }) {
  let doc; try { doc = JSON.parse(text); } catch { return []; }
  if (!doc || (doc.owner && !['user', 'cli', 'agent'].includes(doc.owner))) return [];
  let messages = Array.isArray(doc.messages) ? doc.messages : [];
  let running = false;
  if (file) {
    const [hdr, jnl] = checkpointFiles(file);
    const turn = runningTurn(read(hdr), readText(jnl));
    if (turn) { messages = [...messages, ...turn]; running = true; }
  }
  const out = [];
  let at = Date.parse(doc.createdAt ?? '') || (typeof doc.createdAt === 'number' ? doc.createdAt : 0);
  if (doc.parentSessionId || doc.ownerSessionId) out.push({
    type: 'role', at, parent: doc.parentSessionId || doc.ownerSessionId,
    role: doc.agent, tag: doc.agentTag, name: doc.agentTag || doc.title,
  });
  if (doc.cwd) out.push({ type: 'meta', at, cwd: doc.cwd });
  if (doc.model) out.push({ type: 'model', at, model: doc.model });
  let last = null;
  for (const m of messages) {
    at = timeOf(m, at);
    if (m.role === 'user') { const t = promptText(m.content); if (t) out.push({ type: 'prompt', at, text: t }); }
    else if (m.role === 'assistant') {
      const model = m.meta?.transcript?.modelId;
      if (model) out.push({ type: 'model', at, model });
      if (m.reasoningContent || m.thinkingBlocks || m.reasoningItems) out.push({ type: 'think', at });
      const t = textOf(m.content).trim();
      if (t) out.push({ type: 'say', at, text: t });
      for (const c of m.toolCalls ?? []) out.push({ type: 'call', at, id: c.id, tool: normalizeTool(c.name, typeof c.arguments === 'string' ? JSON.parse(c.arguments || '{}') : c.arguments) });
    } else if (m.role === 'tool') {
      const output = textOf(m.content);
      const code = exitCode(output);
      out.push({ type: 'result', at, id: m.toolCallId, output, error: m.toolKind === 'error' || (Number.isFinite(code) && code !== 0) });
    }
    if (m.role !== 'system') last = m;
  }
  if (!running && last?.role === 'assistant' && !last.toolCalls?.length) out.push({ type: 'end', at, text: textOf(last.content) });
  return out;
}

export const adapter = {
  id: 'mixdog',
  get label() { return t('agent.mixdog'); },
  format: 'document',
  roots: env => [join(dataDir(env), 'sessions')],
  async discover(env, roots = this.roots(env)) { return (await Promise.all(roots.map(r => listFiles(r, { depth: 1, match: f => /[\\/]sess_[^\\/]+\.json$/.test(f) })))).flat(); },
  // A change to the running turn's checkpoint counts as a change to the session.
  related: checkpointFiles,
  // A turn is running while its checkpoint exists or the heartbeat sidecar is fresh.
  live(file) {
    if (checkpointFiles(file).some(f => { try { statSync(f); return true; } catch { return false; } })) return true;
    try { const ms = Number(readFileSync(file.replace(/\.json$/, '.hb'), 'utf8').split('\n')[0]); return Date.now() - ms < 30_000; } catch { return false; }
  },
  parseDocument,
};
