// One conversation between the user and a coding agent the app runs. Drivers report what the agent does through the
// methods below; the chat keeps the history (replayed to every new viewer) and sends live events to viewers.

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

export class Chat extends EventEmitter {
  constructor({ id, agent, project, cwd }) {
    super();
    Object.assign(this, { id, agent, project, cwd });
    this.state = { type: 'state', agent, project, sessionId: null, busy: false, costUsd: null, tokens: null };
    this.log = []; this.pending = new Map(); this.seq = 0; this.closed = false; this.ended = false; this.driver = null;
  }

  // History first, then the current state again (replayed turn ends must not read as "idle"). onGone: the chat closed.
  subscribe(send, onGone) {
    send({ ...this.state });
    for (const e of this.log) send(e);
    send({ ...this.state });
    const f = e => send(e);
    this.on('event', f);
    if (onGone) this.once('gone', onGone);
    return () => { this.off('event', f); if (onGone) this.off('gone', onGone); };
  }
  push(e) {
    const last = this.log.at(-1);
    if (e.type === 'text' && last?.type === 'text') last.delta += e.delta; // history keeps one entry per reply
    else this.log.push(e.type === 'text' ? { ...e } : e);
    this.emit('event', e);
  }
  setState(patch) { Object.assign(this.state, patch); this.emit('event', { ...this.state }); }

  // From the user
  async send(text) {
    text = String(text ?? '').trim();
    if (!text) return { error: 'empty' };
    if (this.ended) return { error: 'ended' };
    if (this.state.busy) return { error: 'busy' };
    this.setState({ busy: true });
    this.push({ type: 'user', text, at: Date.now() });
    try { await this.driver.send(text); } catch (e) { this.error(e.message); this.turnEnd(false); }
    return { ok: true };
  }
  approve(requestId, decision) {
    const answer = this.pending.get(requestId);
    if (!answer) return { error: 'unknown request' };
    if (!['once', 'session', 'deny'].includes(decision)) return { error: 'bad decision' };
    this.pending.delete(requestId);
    answer(decision);
    this.push({ type: 'approval_resolved', requestId, decision });
    return { ok: true };
  }
  stop() { if (this.state.busy) this.driver.stop(); return { ok: true }; }
  close() {
    if (this.closed) return { ok: true };
    this.closed = true;
    this.driver?.close();
    this.exited();
    this.emit('gone');
    this.removeAllListeners('event');
    return { ok: true };
  }

  // From the driver
  text(delta) { if (delta) this.push({ type: 'text', delta: String(delta) }); }
  messageEnd() { if (this.log.at(-1)?.type === 'text') this.push({ type: 'message_end' }); }
  tool(name, summary = '') { this.push({ type: 'tool', name: String(name ?? ''), summary: String(summary ?? '').slice(0, 300) }); }
  ask({ tool, summary, detail, canAlways }, answer) {
    const requestId = `r${++this.seq}`;
    this.pending.set(requestId, answer);
    this.push({ type: 'approval', requestId, tool: String(tool ?? ''), summary: String(summary ?? '').slice(0, 300), detail: String(detail ?? '').slice(0, 4000), canAlways: !!canAlways });
  }
  turnEnd(ok) {
    if (!this.state.busy) return;
    for (const id of this.pending.keys()) this.push({ type: 'approval_resolved', requestId: id, decision: 'deny' });
    this.pending.clear();
    this.messageEnd();
    this.setState({ busy: false });
    this.push({ type: 'turn_end', ok: !!ok });
  }
  addCost(usd) { if (Number.isFinite(usd)) this.setState({ costUsd: (this.state.costUsd ?? 0) + usd }); }
  error(message) { this.push({ type: 'error', message: String(message ?? 'error').slice(0, 500) }); }
  exited() {
    if (this.ended) return;
    this.turnEnd(false);
    this.ended = true;
    this.push({ type: 'exit' });
  }
}

// Windows npm installs are .cmd scripts, which only run through cmd.exe. Arguments then pass through the shell, so
// anything cmd.exe would interpret is refused and arguments with spaces are quoted.
const SHELL_UNSAFE = /["%!^&|<>()\r\n]/;
function command(program, args) {
  if (!/\.(cmd|bat)$/i.test(program)) return { program, args, shell: false };
  for (const a of [program, ...args]) if (SHELL_UNSAFE.test(a)) throw new Error(`unsafe argument: ${a}`);
  const q = a => (/\s/.test(a) ? `"${a}"` : a);
  return { program: q(program), args: args.map(q), shell: true };
}

// Ends the agent and everything it started (its shell commands too).
export function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill()); return; }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
}

// Runs an agent that speaks one JSON object per line on stdin/stdout. `cmd` is [program, ...leading args].
// onExit runs once the process has ended (or could not start).
export function launch(chat, [program, ...pre], args, onMessage, onExit = () => {}) {
  const c = command(program, [...pre, ...args]);
  // Its own process group on Unix, so closing the chat can end the agent's commands with it.
  const child = spawn(c.program, c.args, { cwd: chat.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: c.shell, detached: process.platform !== 'win32' });
  let buf = '', errTail = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      try { onMessage(m); } catch (e) { chat.error(e.message); }
    }
  });
  child.stderr.on('data', d => { errTail = (errTail + d).slice(-1000); });
  child.stdin.on('error', () => {});
  let over = false;
  const end = () => { if (over) return; over = true; onExit(); chat.exited(); };
  child.on('error', e => { chat.error(e.code === 'ENOENT' ? `${program}: not found` : e.message); end(); });
  child.on('close', code => {
    if (code && !chat.closed) chat.error(errTail.trim().split('\n').at(-1) || `exit ${code}`);
    end();
  });
  return { child, write: o => { if (child.stdin.writable) child.stdin.write(JSON.stringify(o) + '\n'); }, kill: () => killTree(child) };
}
