// The broadcast service shared by the desktop app (IPC) and the browser mode (HTTP): session discovery,
// one live snapshot stream per watched match, the commentary booth, post-match reviews, settings and alerts.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { Hub } from './hub.mjs';
import { Booth, filePersona, filePrompt, ROLES, rolePersona, rolePrompt } from './mic.mjs';
import { LEGACY, PROVIDERS, ask, describe, explain as explainError, extractJson, resolve, status as providerStatus, test as testProvider } from './providers.mjs';
import { envSecrets } from './secrets.mjs';
import { demoAdapter, playDemo, stopDemo, DEMO_CWD, DEMO_LINES, demoRoles } from './demo.mjs';
import { Settings } from './settings.mjs';
import { groupProjects, buildProject, projectKey } from './project.mjs';
import { LineCounter } from './lines.mjs';
import { parseKey } from './hub.mjs';
import { dirname, join, basename, relative, resolve as resolvePath, sep } from 'node:path';
import { recordedCompactions, momentEnabled, momentSettings } from './core/moments.mjs';
import { setNameStyle } from './core/names.mjs';
import { setLanguage, language, t } from './i18n/index.mjs';

const VERSION = (() => { try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch { return ''; } })();
const LEFT_HISTORY = 20; // subagents that left the match whose plays are still read into it
const ALERT_LABEL = Object.defineProperties({}, Object.fromEntries(['decision', 'trick', 'stuck', 'quiet', 'final'].map(type => [type, { enumerable: true, get: () => t(`alert.${type}`) }])));
const TRICK_ALERT = new Set(['var', 'skip', 'weaken', 'mask', 'silence', 'risky']);

// A command-line or environment choice (--mic claude|gemini|codex|anthropic|…|off) as commentary settings.
const override = (mic, base) => { const id = LEGACY[mic] ?? mic; return id === 'off' || id === 'auto' || PROVIDERS[id] ? { ...base, provider: id, providers: { ...base.providers, ...(LEGACY[mic] ? { [id]: { ...base.providers[id], via: 'cli' } } : {}) } } : base; };

export class Live {
  static async create({ mic, env = process.env, settingsFile = null, secrets = null, locale } = {}) {
    const settings = new Settings(settingsFile);
    const live = new Live(new Hub({ env, extra: [demoAdapter] }), settings, { locale });
    live.secrets = secrets ?? envSecrets(env);
    live.micOverride = mic || null; // a command-line choice wins for this run but is never saved
    await live.apply(settings.get());
    settings.on('change', s => live.apply(s));
    await stopDemo(); // an example match left by a tutorial that didn't finish
    await live.hub.scan();
    live.scanTimer = setInterval(() => live.hub.scan().catch(() => {}), 3000);
    live.scanTimer.unref?.();
    return live;
  }

  constructor(hub, settings, { locale } = {}) {
    this.locale = locale;
    this.hub = hub; this.settings = settings; this.backend = null; this.booth = new Booth(null); this.secrets = envSecrets({});
    this.micOn = new Set(); this.micOff = new Set(); this.reviews = new Map(); this.alertSubs = new Map(); this.onAlert = null;
    this.compactionFiles = new WeakMap(); this.restored = new WeakSet(); this.fileNotes = new Map(); this.roleMaps = new Map();
    this.lineCounter = new LineCounter(); this.lineCounts = new Map();
    this.momentSettings = momentSettings(settings.value?.moments);
    setNameStyle(settings.value?.general?.nameStyle);
    setLanguage(settings.value?.general?.language, this.locale);
  }

  async apply(s) {
    setLanguage(s.general.language, this.locale);
    setNameStyle(s.general.nameStyle);
    this.momentSettings = momentSettings(s.moments);
    for (const tail of this.hub.tails.values()) tail.match.setMomentSettings(this.momentSettings);
    // Calls already sent cannot be recalled; remove disabled work before the queue starts another call.
    this.booth.queue = this.booth.queue.filter(({ m }) => momentEnabled(m.type, this.momentSettings));
    const disabled = Object.entries(s.agents).filter(([, a]) => a.enabled === false).map(([id]) => id);
    const roots = Object.fromEntries(Object.entries(s.agents).filter(([, a]) => a.path).map(([id, a]) => [id, [a.path]]));
    this.hub.configure({ disabled, roots });
    const conf = await resolve(this.commentary(s), this.secrets);
    this.backend = describe(conf); // a display label, or null when commentary falls back to fixed lines
    Object.assign(this.booth, { conf, max: s.commentary.maxCalls, tone: s.commentary.tone, includeSayings: s.commentary.includeSayings, teach: s.commentary.teach });
    if (!this.backend) this.micOn.clear();
    this.hub.scan().catch(() => {});
    for (const key of this.hub.tails.keys()) this.hub.emit('update', key);
  }

  // The tutorial's example match: replays a recorded match as if it were happening now (no agent, no credits) and
  // resolves to its project key once the match shows up, or null if it didn't within a few seconds.
  async startTutorial() {
    playDemo().then(() => this.hub.scan());
    const key = projectKey({ cwd: DEMO_CWD });
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 400));
      await this.hub.scan();
      if (this.projects().some(p => p.key === key)) return { key };
    }
    return { key: null };
  }
  async stopTutorial() { await stopDemo(); await this.hub.scan(); return { stopped: true }; }

  commentary(s = this.settings.value) { return this.micOverride ? override(this.micOverride, s.commentary) : s.commentary; }

  // Is commentary set up? Every provider's state, which one answers, and what went wrong last time.
  async micStatus() {
    const c = this.commentary();
    return { active: this.booth.conf ? { provider: this.booth.conf.provider, via: this.booth.conf.via, model: this.booth.conf.model, label: this.backend } : null, choice: c.provider, override: this.micOverride,
      providers: await providerStatus(c, this.secrets), canSaveKeys: this.secrets.canSave, whyNoSave: this.secrets.whyNot ?? null, lastError: this.booth.lastError, spentUsd: this.booth.spentUsd, tokens: this.booth.tokens };
  }
  // Test the provider that answers now, or one named provider with its own settings (before choosing it).
  async testMic(provider = null) {
    const c = this.commentary();
    const conf = provider && PROVIDERS[provider] ? await resolve({ ...c, provider }, this.secrets) : this.booth.conf;
    if (provider && !conf) return { ok: false, code: 'missing', message: (await providerStatus({ ...c, provider }, this.secrets)).find(p => p.id === provider)?.reason ?? t('live.notConnected') };
    const r = await testProvider(conf);
    if (!provider || conf === this.booth.conf) this.booth.lastError = r.ok ? null : { ...r, at: Date.now(), backend: describe(conf) };
    return r;
  }
  async setSecret(provider, key) {
    const r = await this.secrets.set(String(provider), key == null || key === '' ? null : String(key));
    if (r.ok) await this.apply(this.settings.get());
    return r;
  }

  info() { return { version: VERSION, mic: this.backend, micAvailable: !!this.backend, micError: this.booth.lastError, spentUsd: this.booth.spentUsd, tokens: this.booth.tokens, agents: this.hub.adapters.map(a => ({ id: a.id, label: a.label })) }; }
  sessions() { return this.hub.sessions; }
  projects() { return groupProjects(this.hub.sessions); }
  // The match list: the tutorial's example match is left out.
  listProjects() { return this.projects().filter(p => !p.players.some(x => x.demo)); }

  // A project match: subscribes to every player (and to new ones as they appear) and sends one merged snapshot.
  async subscribeProject(pkey, send) {
    const project = () => this.projects().find(p => p.key === pkey);
    if (!project()) return null;
    const players = new Map(); // session key -> { snap, stop }
    const clashScenes = new WeakMap();
    let order = [], timer = null, closed = false;
    const flush = () => {
      timer = null; if (closed) return;
      const p = project();
      // Players who left the roster after being watched still contribute their plays.
      const departed = p ? p.left.map(l => l.key).filter(k => players.get(k)?.snap && !order.includes(k)) : [];
      if (p) send(withRoles(p, named(buildProject(p, [...order, ...departed].map(k => ({ key: k, snap: players.get(k)?.snap ?? null })), (key, moment) => {
        const match = this.hub.tails.get(key)?.match;
        if (!match) return null;
        match.setMomentSettings(this.momentSettings);
        const scenes = clashScenes.get(match) ?? new Set();
        if (!scenes.has(moment.scene)) {
          match.addMoment(moment.type, moment.at, moment.note, moment.eventAt);
          scenes.add(moment.scene); clashScenes.set(match, scenes);
        }
        const existing = match.moments.find(m => m.type === moment.type && m.eventAt <= moment.eventAt && m.lastAt >= moment.eventAt);
        if (this.micOn.has(key)) this.booth.cover(match, () => { this.saveComments(key, match); schedule(); });
        return match.comments.get(existing?.key ?? `${moment.type}@${moment.eventAt}`) ?? null;
      }, this.momentSettings))));
    };
    const withRoles = (p, snap) => { snap.roles = this.roleMap(p, snap.files.map(f => f.path), schedule); snap.lines = this.codeLines(p, schedule); return snap; };
    // Each player's match takes its name from the project, so its commentary calls the player what the screen does.
    const named = snap => {
      for (const pl of [...snap.players, ...(snap.left ?? [])]) { const match = this.hub.tails.get(pl.key)?.match; if (match && pl.name) match.assignedName = pl.name; }
      return snap;
    };
    const schedule = () => { if (!timer) timer = setTimeout(flush, 300); };
    const sync = () => {
      const p = project();
      if (!p || closed) return;
      order = p.players.map(x => x.key).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
      // The most recent subagents that already left are read too, so their plays stay in the feed and file map.
      const recentLeft = p.left.slice(0, LEFT_HISTORY).map(x => x.key);
      for (const k of [...order, ...recentLeft]) {
        if (players.has(k)) continue;
        const entry = { snap: null, stop: null };
        players.set(k, entry);
        this.subscribe(k, snap => { entry.snap = snap; schedule(); }, { background: !order.includes(k), project: pkey }).then(stop => { if (closed) stop?.(); else entry.stop = stop; });
      }
      schedule();
    };
    this.hub.on('sessions', sync);
    sync();
    return () => { closed = true; clearTimeout(timer); this.hub.off('sessions', sync); for (const e of players.values()) e.stop?.(); };
  }
  // The person's switch for a whole match; turned off, it also keeps players who join later off.
  setMicProject(pkey, on) {
    const p = this.projects().find(x => x.key === pkey);
    if (!p) return { error: 'unknown project' };
    if (on) this.micOff.delete(pkey); else this.micOff.add(pkey);
    for (const pl of p.players) this.setMic(pl.key, on);
    return { on, backend: this.backend };
  }
  getSettings() { return this.settings.get(); }
  updateSettings(patch) { return this.settings.update(patch); }

  // What each agent adapter looks at and what it found, for the settings screen.
  agentStatus() {
    const s = this.settings.get();
    return this.hub.adapters.filter(a => a.id !== 'demo').map(a => {
      const custom = s.agents[a.id]?.path || '';
      const roots = custom ? [custom] : a.roots(this.hub.env);
      const home = this.hub.env.HOME || homedir();
      const pretty = r => (home && r.startsWith(home) ? `~${r.slice(home.length)}` : r);
      return { id: a.id, label: a.label, enabled: s.agents[a.id]?.enabled !== false, path: custom, roots: roots.map(pretty), found: roots.some(r => existsSync(r)),
        sessions: this.hub.sessions.filter(x => x.agent === a.id).length, live: this.hub.sessions.filter(x => x.agent === a.id && x.live).length };
    });
  }

  snapshot(key) {
    const tail = this.hub.tails.get(key);
    if (!tail) return null;
    tail.match.setMomentSettings(this.momentSettings);
    this.workerOutcome(key, tail.match);
    tail.match.tick(Date.now(), this.hub.sessions.some(s => s.key === key && s.live));
    const identity = parseKey(key);
    if (['mixdog', 'claude-code', 'codex'].includes(identity.agent)) {
      try {
        const stat = statSync(identity.file), signature = `${stat.mtimeMs}:${stat.size}`;
        if (this.compactionFiles.get(tail.match) !== signature) {
          const text = readFileSync(identity.file, 'utf8');
          const records = identity.agent === 'mixdog' ? [JSON.parse(text)] : text.split('\n').filter(Boolean).flatMap(line => {
            try { return [JSON.parse(line)]; } catch (error) { if (error instanceof SyntaxError) return []; throw error; }
          });
          // A compaction sits where it happened in the feed, not at the end where it was read.
          const feed = tail.match.feed;
          for (const event of recordedCompactions(identity.agent, records)) {
            const timed = Number.isFinite(event.at);
            const index = timed ? Math.max(0, feed.findLastIndex(c => c.at <= event.at)) : Math.max(0, feed.length - 1);
            tail.match.detected(tail.match.tracker.compact(event.count), timed ? event.at : tail.match.lastAt, index);
          }
          this.compactionFiles.set(tail.match, signature);
        }
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    }
    const snap = tail.match.snapshot();
    snap.mic = { on: this.micOn.has(key), backend: this.backend, available: !!this.backend, error: this.booth.lastError };
    snap.review = this.reviews.get(`${language()}\0${key}`) ?? null;
    return snap;
  }

  workerOutcome(key, match) {
    const { agent, file } = parseKey(key);
    if (agent !== 'mixdog' || !match.parent) return;
    let workers;
    try { workers = JSON.parse(readFileSync(join(dirname(dirname(file)), 'agent-workers.json'), 'utf8')).workers; }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return; throw error; }
    const worker = workers?.[basename(file, '.json')];
    if (!worker) return;
    const value = worker.finishedAt ?? worker.updatedAt;
    const at = typeof value === 'number' ? value : Date.parse(value);
    match.workerOutcome({ status: worker.status, error: worker.error, at: Number.isFinite(at) ? at : match.lastAt });
  }

  // Calls `send(snapshot)` now and whenever the match changes (throttled), plus a heartbeat for clock-driven
  // states like "quiet". Resolves to an unsubscribe function, or null for an unknown session.
  // AI lines survive a restart: saved per session next to the settings file, restored when the session is watched,
  // so a reopened match neither falls back to fixed lines nor pays for the same line twice.
  commentaryFile(key) { return this.settings.file ? join(dirname(this.settings.file), 'commentary', `${createHash('sha1').update(key).digest('hex')}.json`) : null; }
  restoreComments(key, match) {
    const file = this.commentaryFile(key);
    if (!file || this.restored.has(match.comments)) return;
    this.restored.add(match.comments);
    let saved;
    try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return; throw error; }
    for (const [k, v] of Object.entries(saved ?? {})) if (!match.comments.has(k) && typeof v?.caster === 'string' && typeof v?.line === 'string') match.comments.set(k, v);
  }
  saveComments(key, match) {
    const file = this.commentaryFile(key);
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries([...match.comments].filter(([, v]) => typeof v?.caster === 'string'))));
    renameSync(tmp, file);
  }
  // What to run when the booth finishes a line for this session.
  lineDone(key, tail) { return () => { this.saveComments(key, tail.match); this.hub.emit('update', key); }; }

  // With "turn on automatically", commentary starts whenever a watched player is playing: when the match opens, and
  // again when a player that was waiting (between turns, as after a restart) starts its next turn. Never for a match
  // or player the person turned off. `project` is the project match this player is part of.
  async subscribe(key, send, { background = false, project = null } = {}) {
    const tail = await this.hub.watch(key);
    if (!tail) return null;
    this.restoreComments(key, tail.match);
    const autoMic = () => {
      if (!background && this.backend && this.settings.value.commentary.autoOn && !tail.match.finished && !this.hub.sessions.find(s => s.key === key)?.demo && !this.micOn.has(key) && !this.micOff.has(key) && !(project && this.micOff.has(project))) this.switchMic(key, true);
    };
    autoMic();
    let timer = null, sentVersion = -1, closed = false;
    const flush = () => { timer = null; if (closed) return; const s = this.snapshot(key); if (s) { if (this.micOn.has(key)) this.booth.cover(tail.match, this.lineDone(key, tail)); send(s); sentVersion = tail.match.version; } };
    const schedule = () => { if (!timer) timer = setTimeout(flush, 250); };
    const onUpdate = k => {
      if (k !== key) return;
      tail.match.setMomentSettings(this.momentSettings);
      this.workerOutcome(key, tail.match);
      autoMic();
      if (this.micOn.has(key)) this.booth.cover(tail.match, this.lineDone(key, tail));
      schedule();
    };
    this.hub.on('update', onUpdate);
    const heartbeat = setInterval(() => (tail.match.version !== sentVersion ? schedule() : flush()), 15_000);
    flush();
    return () => { closed = true; this.hub.off('update', onUpdate); clearInterval(heartbeat); clearTimeout(timer); this.hub.unwatch(key); };
  }

  // The person's switch for one player; switchMic is the switch itself.
  setMic(key, on) {
    if (on) this.micOff.delete(key); else this.micOff.add(key);
    return this.switchMic(key, on);
  }
  switchMic(key, on) {
    const tail = this.hub.tails.get(key);
    if (!tail) return { error: 'not watching this match' };
    tail.match.setMomentSettings(this.momentSettings);
    if (on && this.backend) { if (!this.micOn.has(key)) this.booth.connect(tail.match); this.micOn.add(key); this.booth.cover(tail.match, this.lineDone(key, tail)); } else this.micOn.delete(key);
    this.hub.emit('update', key);
    return { on: this.micOn.has(key), backend: this.backend };
  }

  // What a project file is for, in plain words: from its path, the names around it and the start of its text.
  // Only files inside the project folder; answers are kept per file version and language.
  async explainFile(pkey, path) {
    if (!this.settings.value.commentary.fileExplain) return { error: 'off' };
    const conf = this.booth.conf;
    if (!conf) return { error: 'nomic' };
    const p = this.projects().find(x => x.key === pkey);
    if (!p?.cwd) return { error: 'missing' };
    // Contained after links are followed, so a link inside the project cannot reach a file outside it.
    let root, file, stat;
    try { root = realpathSync(p.cwd); file = realpathSync(resolvePath(root, String(path ?? ''))); stat = statSync(file); } catch { return { error: 'missing' }; }
    if (!file.startsWith(root + sep) || !stat.isFile()) return { error: 'missing' };
    const cacheKey = `${language()}\0${file}\0${stat.mtimeMs}:${stat.size}`;
    if (this.fileNotes.has(cacheKey)) return this.fileNotes.get(cacheKey);
    const buf = Buffer.alloc(Math.min(stat.size, 24_000));
    const fd = openSync(file, 'r');
    try { readSync(fd, buf, 0, buf.length, 0); } finally { closeSync(fd); }
    // Text only: valid UTF-8 (a character cut at the read limit is fine) without NUL bytes.
    let text = null;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf, { stream: true }); } catch {}
    const binary = text === null || text.includes('\u0000');
    const names = dir => { try { return readdirSync(dir).filter(n => !n.startsWith('.')).slice(0, 40); } catch { return []; } };
    const prompt = filePrompt({
      project: p.name, path: relative(root, file).split(sep).join('/'), binary,
      neighbours: names(dirname(file)).filter(n => n !== basename(file)), top: names(root),
      head: binary ? '' : text.split('\n').slice(0, 200).join('\n'),
    });
    try {
      const r = await ask(conf, prompt, filePersona());
      this.booth.count(r);
      const j = extractJson(r.text);
      if (typeof j?.text !== 'string' || !j.text.trim()) return { error: 'format', message: t('provider.badReply') };
      const note = { part: String(j.part ?? '').slice(0, 40), text: j.text.trim().slice(0, 1200), ai: describe(conf) };
      this.fileNotes.set(cacheKey, note);
      return note;
    } catch (e) { return { error: 'call', message: explainError(e, conf).message }; }
  }

  // Lines of code and of tests in the project, counted again at most every 30 seconds. `base` is the first count
  // since coding live started watching this folder, so the stats bar can show how much each side grew since.
  codeLines(p, onChange) {
    if (p.cwd === DEMO_CWD) return DEMO_LINES;
    if (!p.cwd) return null;
    let m = this.lineCounts.get(p.cwd);
    if (!m) { m = { now: null, base: null, busy: false, at: 0 }; this.lineCounts.set(p.cwd, m); }
    if (!m.busy && Date.now() - m.at > 30_000) {
      m.busy = true;
      this.lineCounter.count(p.cwd)
        .then(r => { if (!r.tooMany && !r.missing) m.base ??= r; m.now = r; })
        .finally(() => { m.busy = false; m.at = Date.now(); onChange(); });
    }
    return m.now ? { ...m.now, base: m.base } : null;
  }

  // The role map: the AI sorts the project's touched files into the fixed areas (ROLES), from their paths alone.
  // One call at a time per project, new files asked as they appear; kept on disk per project and language so a
  // reopened match keeps its areas. `onChange` redraws once an answer lands. Files outside the project are "other"
  // without being sent.
  roleFile(id) { return this.settings.file ? join(dirname(this.settings.file), 'roles', `${createHash('sha1').update(id).digest('hex')}.json`) : null; }
  roleMap(p, paths, onChange) {
    if (!this.settings.value.commentary.roleMap) return { off: true };
    if (p.cwd === DEMO_CWD) return demoRoles(language());
    const conf = this.booth.conf;
    if (!conf || !p.cwd) return { nomic: true };
    const id = `${language()}\0${p.cwd}`;
    let m = this.roleMaps.get(id);
    if (!m) {
      m = { files: {}, areas: {}, busy: false, error: null, errorAt: 0 };
      const file = this.roleFile(id);
      try { const saved = file && JSON.parse(readFileSync(file, 'utf8')); if (saved?.files) Object.assign(m, { files: saved.files, areas: saved.areas ?? {} }); }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      this.roleMaps.set(id, m);
    }
    for (const path of paths) if (!Object.hasOwn(m.files, path) && (/^([\\/]|[A-Za-z]:)/.test(path) || path.split(/[\\/]/).includes('..'))) m.files[path] = 'other';
    const todo = paths.filter(path => !Object.hasOwn(m.files, path));
    if (todo.length && !m.busy && Date.now() - m.errorAt > 60_000) {
      m.busy = true;
      const names = dir => { try { return readdirSync(dir).filter(n => !n.startsWith('.')).slice(0, 40); } catch { return []; } };
      const batch = todo.slice(0, 150);
      ask(conf, rolePrompt({ project: p.name, top: names(p.cwd), paths: batch }), rolePersona())
        .then(r => {
          this.booth.count(r);
          const j = extractJson(r.text);
          if (!j || typeof j.files !== 'object') throw new Error(t('provider.badReply'));
          for (const path of batch) m.files[path] = ROLES.includes(j.files[path]) ? j.files[path] : 'other';
          for (const [role, text] of Object.entries(j.areas ?? {})) if (ROLES.includes(role) && typeof text === 'string' && text.trim()) m.areas[role] = text.trim().slice(0, 160);
          m.error = null;
          const file = this.roleFile(id);
          if (file) {
            mkdirSync(dirname(file), { recursive: true });
            const tmp = `${file}.${process.pid}.tmp`;
            writeFileSync(tmp, JSON.stringify({ files: m.files, areas: m.areas }));
            renameSync(tmp, file);
          }
        })
        .catch(e => { m.error = explainError(e, conf).message; m.errorAt = Date.now(); })
        .finally(() => { m.busy = false; onChange(); });
    }
    return { files: { ...m.files }, areas: { ...m.areas }, pending: todo.length > 0 && !m.error, error: m.error };
  }

  async review(key) {
    const tail = this.hub.tails.get(key);
    if (!tail) return { error: 'not watching this match' };
    if (!this.backend) return { error: 'no commentary backend' };
    if (!tail.match.finished) return { error: 'match not finished' };
    const reviewLanguage = language();
    const r = await this.booth.review(tail.match).catch(() => null);
    if (!r) return { error: 'review failed' };
    this.reviews.set(`${reviewLanguage}\0${key}`, r);
    this.hub.emit('update', key);
    return r;
  }

  // Alerts for every live session, whether or not a window shows it: only things a person should act on
  // (a decision the agent made alone, being stuck, a long silence, the final whistle). Nothing that already
  // happened before the session was picked up is announced.
  startAlerts(onAlert) {
    this.onAlert = onAlert;
    const sync = async list => {
      for (const s of list) {
        if (!s.live || s.demo || this.alertSubs.has(s.key)) continue;
        const seen = { moments: null, quiet: false, finished: null };
        this.alertSubs.set(s.key, { seen, stop: null, since: Date.now() });
        const stop = await this.subscribe(s.key, snap => this.check(s, snap, seen), { background: true });
        const sub = this.alertSubs.get(s.key);
        if (!stop || !sub) { this.alertSubs.delete(s.key); stop?.(); continue; }
        sub.stop = stop;
      }
      for (const [key, sub] of this.alertSubs) { // stop following sessions that went cold
        const s = list.find(x => x.key === key);
        if (!s || (!s.live && Date.now() - s.updatedAt > 10 * 60_000)) { sub.stop?.(); this.alertSubs.delete(key); }
      }
    };
    this.hub.on('sessions', list => { sync(list).catch(() => {}); });
    sync(this.hub.sessions).catch(() => {});
  }

  check(session, snap, seen) {
    const prefs = this.settings.value.notifications;
    const title = t('alert.title', { player: snap.player, agent: session.agentLabel, project: snap.title || session.project });
    const fire = (kind, body) => { if (prefs.enabled && prefs[kind]) this.onAlert?.({ key: session.key, kind, label: ALERT_LABEL[kind], title, body, sound: prefs.sound }); };
    if (seen.moments === null) { seen.moments = new Set(snap.moments.map(m => m.key)); seen.finished = snap.finished; seen.quiet = snap.state.code === 'quiet'; return; }
    for (const m of snap.moments) {
      if (!momentEnabled(m.type, this.momentSettings)) continue;
      if (seen.moments.has(m.key)) continue;
      seen.moments.add(m.key);
      if (m.type === 'decision') fire('decision', t('alert.decisionBody', { note: m.note.slice(0, 140) }));
      if (m.type === 'stuck') fire('stuck', t('alert.stuckBody'));
      if (TRICK_ALERT.has(m.type)) fire('trick', `${m.note.replace(/`/g, '')} ${m.lesson ? t('alert.ask', { question: m.lesson.ask }) : ''}`.trim().slice(0, 240));
    }
    const quiet = snap.state.code === 'quiet';
    if (quiet && !seen.quiet && momentEnabled('quiet', this.momentSettings)) fire('quiet', t('alert.quietBody'));
    seen.quiet = quiet;
    if (snap.finished && !seen.finished) fire('final', t('alert.finalBody', { score: snap.rating?.score ?? '-', check: snap.oneCheck ?? '' }).trim());
    seen.finished = snap.finished;
  }

  close() { clearInterval(this.scanTimer); for (const s of this.alertSubs.values()) s.stop?.(); for (const t of this.hub.tails.values()) t.stop(); }
}
