// The broadcast service shared by the desktop app (IPC) and the browser mode (HTTP): session discovery,
// one live snapshot stream per watched match, the commentary booth, post-match reviews, settings and alerts.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { Hub } from './hub.mjs';
import { Booth } from './mic.mjs';
import { LEGACY, PROVIDERS, describe, resolve, status as providerStatus, test as testProvider } from './providers.mjs';
import { envSecrets } from './secrets.mjs';
import { demoAdapter, playDemo, demoPlaying } from './demo.mjs';
import { Settings } from './settings.mjs';
import { groupProjects, buildProject } from './project.mjs';
import { parseKey } from './hub.mjs';
import { dirname, join, basename } from 'node:path';
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
    await live.hub.scan();
    live.scanTimer = setInterval(() => live.hub.scan().catch(() => {}), 3000);
    live.scanTimer.unref?.();
    return live;
  }

  constructor(hub, settings, { locale } = {}) {
    this.locale = locale;
    this.hub = hub; this.settings = settings; this.backend = null; this.booth = new Booth(null); this.secrets = envSecrets({});
    this.micOn = new Set(); this.reviews = new Map(); this.alertSubs = new Map(); this.onAlert = null;
    this.compactionFiles = new WeakMap();
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

  // Replays recorded matches as if they were happening now (no agent, no credits needed).
  startDemo() { const was = demoPlaying(); playDemo().then(() => this.hub.scan()).catch(() => {}); setTimeout(() => this.hub.scan().catch(() => {}), 600); return { started: !was }; }

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
      if (p) send(buildProject(p, [...order, ...departed].map(k => ({ key: k, snap: players.get(k)?.snap ?? null })), (key, moment) => {
        const match = this.hub.tails.get(key)?.match;
        if (!match) return null;
        match.setMomentSettings(this.momentSettings);
        const scenes = clashScenes.get(match) ?? new Set();
        if (!scenes.has(moment.scene)) {
          match.addMoment(moment.type, moment.at, moment.note, moment.eventAt);
          scenes.add(moment.scene); clashScenes.set(match, scenes);
        }
        const existing = match.moments.find(m => m.type === moment.type && m.eventAt <= moment.eventAt && m.lastAt >= moment.eventAt);
        if (this.micOn.has(key)) this.booth.cover(match, schedule);
        return match.comments.get(existing?.key ?? `${moment.type}@${moment.eventAt}`) ?? null;
      }, this.momentSettings));
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
        this.subscribe(k, snap => { entry.snap = snap; schedule(); }, { background: !order.includes(k) }).then(stop => { if (closed) stop?.(); else entry.stop = stop; });
      }
      schedule();
    };
    this.hub.on('sessions', sync);
    sync();
    return () => { closed = true; clearTimeout(timer); this.hub.off('sessions', sync); for (const e of players.values()) e.stop?.(); };
  }
  setMicProject(pkey, on) {
    const p = this.projects().find(x => x.key === pkey);
    if (!p) return { error: 'unknown project' };
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
          for (const event of recordedCompactions(identity.agent, records))
            tail.match.detected(tail.match.tracker.compact(event.count), Number.isFinite(event.at) ? event.at : tail.match.lastAt);
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
  async subscribe(key, send, { background = false } = {}) {
    const tail = await this.hub.watch(key);
    if (!tail) return null;
    if (!background && this.backend && this.settings.value.commentary.autoOn && !tail.match.finished) this.setMic(key, true);
    let timer = null, sentVersion = -1, closed = false;
    const flush = () => { timer = null; if (closed) return; const s = this.snapshot(key); if (s) { if (this.micOn.has(key)) this.booth.cover(tail.match, () => this.hub.emit('update', key)); send(s); sentVersion = tail.match.version; } };
    const schedule = () => { if (!timer) timer = setTimeout(flush, 250); };
    const onUpdate = k => {
      if (k !== key) return;
      tail.match.setMomentSettings(this.momentSettings);
      this.workerOutcome(key, tail.match);
      if (this.micOn.has(key)) this.booth.cover(tail.match, () => this.hub.emit('update', key));
      schedule();
    };
    this.hub.on('update', onUpdate);
    const heartbeat = setInterval(() => (tail.match.version !== sentVersion ? schedule() : flush()), 15_000);
    flush();
    return () => { closed = true; this.hub.off('update', onUpdate); clearInterval(heartbeat); clearTimeout(timer); this.hub.unwatch(key); };
  }

  setMic(key, on) {
    const tail = this.hub.tails.get(key);
    if (!tail) return { error: 'not watching this match' };
    tail.match.setMomentSettings(this.momentSettings);
    if (on && this.backend) { if (!this.micOn.has(key)) this.booth.connect(tail.match); this.micOn.add(key); this.booth.cover(tail.match, () => this.hub.emit('update', key)); } else this.micOn.delete(key);
    this.hub.emit('update', key);
    return { on: this.micOn.has(key), backend: this.backend };
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
        if (!s.live || this.alertSubs.has(s.key)) continue;
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
