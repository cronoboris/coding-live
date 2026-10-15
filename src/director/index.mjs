// The "지시" tab: the user gives a coding agent instructions from inside the app. One chat per project; the work it
// does shows up as a match like any other, because the agent writes its usual session files.

import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Chat } from './chat.mjs';
import { claude, codex, omp } from './drivers.mjs';

const AGENTS = [
  { id: 'claude-code', label: 'Claude Code', bin: 'claude', driver: claude },
  { id: 'codex', label: 'Codex', bin: 'codex', driver: codex },
  { id: 'omp', label: 'omp', bin: 'omp', driver: omp },
];

// The program's full path on PATH (with Windows' executable extensions), or null.
export function which(bin, env = process.env) {
  const exts = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const f = join(dir, bin + ext);
      try { if (existsSync(f) && statSync(f).isFile()) return f; } catch {}
    }
  }
  return null;
}

export class Director {
  // projects(): the match list (each { key, cwd }); commands: { [agentId]: [program, ...args] } overrides (tests).
  constructor({ projects, env = process.env, commands = {} }) {
    this.projects = projects; this.env = env; this.commands = commands; this.chats = new Map();
  }
  command(id) {
    if (this.commands[id]) return this.commands[id];
    const f = which(AGENTS.find(a => a.id === id)?.bin, this.env);
    return f ? [f] : null;
  }
  agents() { return { agents: AGENTS.map(a => ({ id: a.id, label: a.label, installed: !!this.command(a.id) })) }; }
  find(project) { return { id: [...this.chats.values()].find(c => c.project === project)?.id ?? null }; }
  get(id) { return this.chats.get(id) ?? null; }

  start({ project, agent, resume } = {}) {
    const p = this.projects().find(x => x.key === project);
    if (!p?.cwd || !existsSync(p.cwd)) return { error: 'unknown project' };
    const a = AGENTS.find(x => x.id === agent);
    if (!a) return { error: 'unknown agent' };
    const cmd = this.command(a.id);
    if (!cmd) return { error: 'not installed' };
    // Only a session this project's match list shows for this agent can be continued.
    if (resume != null && resume !== '' && ![...(p.players ?? []), ...(p.left ?? [])].some(s => s.agent === a.id && s.sessionId === resume)) return { error: 'unknown session' };
    for (const c of this.chats.values()) if (c.project === project) this.drop(c.id);
    const chat = new Chat({ id: randomUUID(), agent: a.id, project, cwd: p.cwd });
    try { chat.driver = a.driver(chat, cmd, resume || null); } catch (e) { return { error: e.message }; }
    this.chats.set(chat.id, chat);
    return { id: chat.id };
  }
  drop(id) {
    const c = this.chats.get(id);
    if (!c) return { error: 'unknown chat' };
    this.chats.delete(id);
    return c.close();
  }
  closeAll() { for (const id of [...this.chats.keys()]) this.drop(id); }
}
