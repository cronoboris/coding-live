// Finds agent sessions on disk, tails the ones someone is watching, and keeps a Match per session.

import { open, stat, readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { basename, dirname } from 'node:path';
import { Match } from './core/match.mjs';
import { adapters } from './adapters/index.mjs';
import { MARK } from './providers.mjs';

const LIVE_MS = 2 * 60_000;
const LIST_LIMIT = 60;
const HEAD_BYTES = 256 * 1024;

const keyOf = (agent, file) => Buffer.from(`${agent}\0${file}`).toString('base64url');
export const parseKey = key => { const [agent, file] = Buffer.from(key, 'base64url').toString().split('\0'); return { agent, file }; };

// The task title is the first real prompt; read only the head of the file to find it.
async function titleOf(adapter, file) {
  try {
    const m = new Match();
    if (adapter.format === 'document') { for (const ev of adapter.parseDocument(await readFile(file, 'utf8'), file)) m.push(ev); }
    else {
      const fh = await open(file, 'r');
      try {
        const { bytesRead, buffer } = await fh.read(Buffer.alloc(HEAD_BYTES), 0, HEAD_BYTES, 0);
        const parse = adapter.createParser(file);
        for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
          if (!line.trim()) continue;
          let entry; try { entry = JSON.parse(line); } catch { continue; }
          for (const ev of parse(entry)) m.push(ev);
          if (m.request && m.model && m.cwd) break;
        }
      } finally { await fh.close(); }
    }
    return { title: m.request.replace(/\s+/g, ' ').slice(0, 120), model: m.model, project: m.project, cwd: m.cwd, parent: m.parent, role: m.role, tag: m.tag, name: m.recordedName ?? null };
  } catch { return { title: '', model: '' }; }
}

// Whether the agent's last turn has ended: replay the end of the file and see if a turn end came last.
const TAIL_BYTES = 128 * 1024;
async function finishedOf(adapter, file, size) {
  try {
    let events = [];
    if (adapter.format === 'document') events = adapter.parseDocument(await readFile(file, 'utf8'), file);
    else {
      const fh = await open(file, 'r');
      try {
        const start = Math.max(0, size - TAIL_BYTES);
        const { bytesRead, buffer } = await fh.read(Buffer.alloc(size - start), 0, size - start, start);
        const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
        if (start > 0) lines.shift(); // partial first line
        const parse = adapter.createParser(file);
        for (const line of lines) { if (!line.trim()) continue; try { events.push(...parse(JSON.parse(line))); } catch {} }
      } finally { await fh.close(); }
    }
    const last = events.filter(e => e.type === 'end' || e.type === 'prompt' || e.type === 'call' || e.type === 'say').at(-1);
    return last?.type === 'end';
  } catch { return false; }
}

class Tail extends EventEmitter {
  constructor(adapter, file, key) {
    super();
    Object.assign(this, { adapter, file, key, offset: 0, rest: '', mtimeMs: 0, timer: null, watchers: 0 });
    this.reset();
  }
  reset() {
    const old = this.match;
    this.match = new Match({ id: this.key, agent: this.adapter.agentOf?.(this.file) ?? this.adapter.id, title: basename(dirname(this.file)) });
    if (old) for (const [k, v] of old.comments) this.match.comments.set(k, v); // keep commentary across a rebuild
    this.parse = this.adapter.format === 'document' ? null : this.adapter.createParser(this.file);
    this.offset = 0; this.rest = '';
  }
  async poll() {
    let s;
    try { s = await stat(this.file); } catch { return; }
    if (this.adapter.format === 'document') { // rewritten or upserted in place: rebuild from the whole file
      // Some agents keep the running turn in side files; a change to any of them counts.
      const sig = [s, ...(this.adapter.related?.(this.file) ?? []).map(f => { try { return statSync(f); } catch { return null; } })]
        .map(x => (x ? `${x.mtimeMs}:${x.size}` : '-')).join('|');
      if (sig === this.sig) return;
      this.sig = sig;
      let text; try { text = await readFile(this.file, 'utf8'); } catch { return; }
      this.reset();
      for (const ev of this.adapter.parseDocument(text, this.file)) this.match.push(ev);
      this.emit('update');
      return;
    }
    if (s.size < this.offset || (this.ino && s.ino !== this.ino)) this.reset(); // truncated, or replaced by an atomic rewrite
    this.ino = s.ino;
    if (s.size === this.offset) return;
    const fh = await open(this.file, 'r');
    try {
      const len = s.size - this.offset;
      const { bytesRead, buffer } = await fh.read(Buffer.alloc(len), 0, len, this.offset);
      this.offset += bytesRead;
      const lines = (this.rest + buffer.subarray(0, bytesRead).toString('utf8')).split('\n');
      this.rest = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let entry; try { entry = JSON.parse(line); } catch { continue; }
        for (const ev of this.parse(entry)) this.match.push(ev);
      }
    } finally { await fh.close(); }
    this.emit('update');
  }
  start() { if (!this.timer) { this.timer = setInterval(() => this.poll().catch(() => {}), 1000); this.timer.unref?.(); } return this.poll(); }
  stop() { clearInterval(this.timer); this.timer = null; }
}

export class Hub extends EventEmitter {
  constructor({ env = process.env, only, extra = [] } = {}) {
    super();
    this.setMaxListeners(0); // one 'update' listener per watched player; a match with many subagents passes ten
    this.env = env;
    this.adapters = [...(only ? adapters.filter(a => only.includes(a.id)) : adapters), ...extra];
    this.config = { disabled: new Set(), roots: {} }; // from settings: agents turned off, folders chosen by the user
    this.ended = new Map(); // key -> { size, mtimeMs, finished }
    this.sessions = [];
    this.titles = new Map();
    this.tails = new Map();
  }
  configure({ disabled = [], roots = {} } = {}) { this.config = { disabled: new Set(disabled), roots }; }
  enabled() { return this.adapters.filter(a => !this.config.disabled.has(a.id)); }
  discover(a) { const r = this.config.roots[a.id]; return r?.length ? a.discover(this.env, r) : a.discover(this.env); }
  async scan() {
    const found = [];
    for (const a of this.enabled()) {
      let files = [];
      try { files = await this.discover(a); } catch {}
      for (const f of files) found.push({ adapter: a, ...f });
    }
    found.sort((x, y) => y.mtimeMs - x.mtimeMs);
    const now = Date.now();
    const list = [];
    const idOf = f => f.adapter.sessionId?.(f.file) ?? basename(f.file).replace(/\.json$/, '');
    // A session with many subagents can push its own (older) file past the limit; bring listed subagents' parents along.
    // A parent pulled in for its subagents is listed even when its head holds no user prompt (e.g. a session that starts
    // from an approved plan), titled by its file name.
    const queue = found.slice(0, LIST_LIMIT), metas = new Map(), parents = new Set();
    for (let i = 0; i < queue.length; i++) { // first: every title and parent link, pulling in parents past the limit
      const f = queue[i];
      const key = keyOf(f.adapter.id, f.file);
      let meta = this.titles.get(key);
      if (!meta || (meta.size !== f.size && (!meta.title || !meta.cwd))) { meta = { ...(await titleOf(f.adapter, f.file)), size: f.size }; this.titles.set(key, meta); }
      metas.set(f, meta);
      if (!meta.parent || !meta.title || meta.title.startsWith(MARK)) continue;
      const parent = queue.find(p => p.adapter === f.adapter && idOf(p) === meta.parent) ?? found.find(p => p.adapter === f.adapter && idOf(p) === meta.parent);
      if (!parent) continue;
      parents.add(parent);
      if (!queue.includes(parent)) queue.push(parent);
    }
    for (const f of queue) {
      const key = keyOf(f.adapter.id, f.file);
      let meta = metas.get(f);
      if (meta.title?.startsWith(MARK) || (!meta.title && !parents.has(f))) continue; // not a real conversation (yet), or our own commentary call
      if (!meta.title) meta = { ...meta, title: basename(f.file).replace(/\.jsonl?$/, '') };
      const tail = this.tails.get(key);
      const recent = now - f.mtimeMs < LIVE_MS || !!f.adapter.live?.(f.file);
      let finished = tail ? tail.match.finished : false;
      if (!tail && recent) {
        const e = this.ended.get(key);
        if (e && e.size === f.size && e.mtimeMs === f.mtimeMs) finished = e.finished;
        else { finished = await finishedOf(f.adapter, f.file, f.size); this.ended.set(key, { size: f.size, mtimeMs: f.mtimeMs, finished }); }
      }
      list.push({ key, demo: f.adapter.id === 'demo', agent: f.adapter.agentOf?.(f.file) ?? f.adapter.id, agentLabel: f.adapter.labelOf?.(f.file) ?? f.adapter.label, cwd: meta.cwd || '', project: meta.project || f.adapter.project?.(f.file) || basename(dirname(f.file)), title: meta.title, model: tail?.match.model || meta.model,
        sessionId: idOf(f), parent: meta.parent, role: meta.role, tag: meta.tag, name: meta.name ?? null,
        updatedAt: f.mtimeMs, live: recent && !finished });
    }
    this.sessions = list;
    this.emit('sessions', list);
    return list;
  }
  async watch(key) {
    let tail = this.tails.get(key);
    if (!tail) {
      const { agent, file } = parseKey(key);
      const adapter = this.enabled().find(a => a.id === agent);
      if (!adapter || !(await this.knownFile(agent, file))) return null;
      tail = new Tail(adapter, file, key);
      tail.on('update', () => this.emit('update', key));
      this.tails.set(key, tail);
      await tail.start();
    }
    tail.watchers++;
    return tail;
  }
  unwatch(key) {
    const tail = this.tails.get(key);
    if (tail && --tail.watchers <= 0) { tail.stop(); this.tails.delete(key); }
  }
  // Only files an adapter itself discovered can be opened: the key is never a free-form path.
  async knownFile(agent, file) {
    const a = this.enabled().find(x => x.id === agent);
    if (!a) return false;
    try { return (await this.discover(a)).some(f => f.file === file); } catch { return false; }
  }
}
