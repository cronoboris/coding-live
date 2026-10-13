// One match = one agent session. Feed it common events (see events.mjs) in order; read `snapshot()` to render.
// Everything here is rule-based: the ticker, key moments, the stadium, the file tree and the rating.
// The only model output that ever enters a match is commentary, attached with `setComment`.

import { caster, lane, looksFailed, isTestPath, base } from './caster.mjs';
import { detectTricks, lessonFor, autoComment, endLessons, LESSONS, MOMENT_LESSON } from './lessons.mjs';
import { readFileSync } from 'node:fs';
import { explain, important } from './glossary.mjs';
import { sessionName } from './names.mjs';
import { t, language, renderMessage } from '../i18n/index.mjs';
import { MOMENT_LABEL, MomentTracker, extraCallMoments, claimsSuccess, momentEnabled, momentSettings } from './moments.mjs';
export { MOMENT_LABEL } from './moments.mjs';

export const SEASON = JSON.parse(readFileSync(new URL('./season.json', import.meta.url), 'utf8'));

export function playerName(model) {
  const m = String(model || '').trim();
  if (!m) return t('model.unknown');
  const claude = /^claude-(?:(\d{1,2})-(\d{1,2})-)?(haiku|sonnet|opus|fable)(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:-\d{8})?$/.exec(m);
  if (claude) { const v = claude[4] ? `${claude[4]}${claude[5] ? `.${claude[5]}` : ''}` : claude[1] ? `${claude[1]}.${claude[2]}` : ''; return `${t(`model.${claude[3]}`)} ${v}`.trim(); }
  if (language() === 'en' && m.startsWith('gemini-')) return m.replace(/^gemini-/, t('model.gemini')).replace(/-(flash|pro|lite)/g, (_, word) => ` ${word[0].toUpperCase()}${word.slice(1)}`);
  return m.replace(/^gpt-/, 'GPT-').replace(/^gemini-/, t('model.gemini')).replace(/^o(\d)/, 'o$1');
}

export const DECISION = /\bassum(e|ed|ing|ption)|\bI (chose|picked|decided|went with|treated)\b|one choice for you|if you (meant|want|prefer|need)|falls? back to|defaults? to|instead of|left (it|this) (as|to)|not specified|unspecified|ambiguous|가정했|임의로|기본값으로|대신에/i;
const TRICK_CAP = 2; // the same trick-ish pattern is called out at most twice a match
const GAP_SECONDS = 180;

export class Match {
  constructor({ id, agent, title, moments } = {}) {
    Object.assign(this, { id, agent, title });
    this.cwd = '';
    this.t0 = null; this.lastAt = null; this.model = ''; this.request = ''; this.final = ''; this.finished = false; this.costUsd = null;
    this.feed = []; this.moments = []; this.comments = new Map(); this.files = new Map(); this.ball = []; this.pending = new Map();
    this.fails = 0; this.failsInRow = 0; this.sawFail = false; this.testFailedAt = null; this.decisions = 0; this.prevFailed = false;
    this.aliveSinceAction = false; this.alive = false; this.version = 0;
    this.tracker = new MomentTracker();
    this.noteSources = new WeakMap();
    this.momentSettings = momentSettings(moments);
  }

  // assignedName: the name this player has in its project match, so commentary uses the name on screen.
  get name() { return this.recordedName || this.assignedName || sessionName(new Set(), this.model); }
  get player() { return `${this.name} (${playerName(this.model)})`; }
  get project() { return this.cwd ? this.cwd.replace(/^file:\/\//, '').split(/[\\/]/).filter(Boolean).at(-1) ?? this.cwd : ''; }
  get season() { return SEASON[this.model] ?? null; }
  t(at) { return this.t0 === null ? 0 : Math.max(0, Math.round((at - this.t0) / 1000)); }

  push(ev) {
    if (!ev || !Number.isFinite(ev.at)) return;
    if (this.t0 === null) this.t0 = ev.at;
    this.lastAt = Math.max(this.lastAt ?? ev.at, ev.at);
    this.version++;
    switch (ev.type) {
      case 'role': this.parent = ev.parent; this.role = ev.role; this.tag = ev.tag; this.recordedName = ev.name; break;
      case 'model': if (ev.model) this.model = ev.model; break;
      case 'meta': if (ev.cwd) this.cwd = String(ev.cwd); break;
      case 'usage':
        if (Number.isFinite(ev.costUsd)) {
          this.costUsd = ev.costUsd;
          this.detected(this.tracker.usage(ev.costUsd), ev.at);
        }
        break;
      case 'compact': this.detected(this.tracker.compact(ev.count ?? this.tracker.compactCount + 1), ev.at); break;
      case 'waiting': this.addMoment('waiting', Math.max(0, this.feed.length - 1), ev.text != null ? String(ev.text) : { key: 'match.waiting' }, ev.at); break;
      case 'think': case 'alive': this.alive = this.aliveSinceAction = true; break;
      case 'prompt': {
        const text = String(ev.text ?? '').trim();
        if (!text) break;
        if (!this.request) { this.request = text; break; }
        this.finished = false; this.final = '';
        this.feed.push({ at: ev.at, t: this.t(ev.at), kind: 'coach', paths: [], get text() { return t('match.instruction', { text: text.slice(0, 80), ellipsis: text.length > 80 ? '…' : '' }); }, failed: false, lane: 0, says: [] });
        this.addMoment('instruction', this.feed.length - 1, text.slice(0, 160), ev.at);
        break;
      }
      case 'say': {
        const text = String(ev.text ?? '').trim();
        if (!text) break;
        this.feed.at(-1)?.says.push(text);
        this.lastSay = text;
        this.tracker.say(text);
        this.checkDecision(text);
        break;
      }
      case 'call': {
        this.pending.set(ev.id, { at: ev.at, tool: ev.tool });
        const detected = this.tracker.before(ev.tool ?? {}, ev.at);
        const squad = detected.find(m => m.type === 'squad');
        if (squad) this.moments = this.moments.filter(m => m.type !== 'assign' || m.lastAt < squad.since);
        this.detected(detected, ev.at);
        if (!squad && ev.tool?.kind === 'delegate' && ev.tool.type !== 'send')
          this.addMoment('assign', Math.max(0, this.feed.length - 1), { key: 'match.assign', vars: { name: ev.tool.tag || ev.tool.agent || { key: 'match.subagent' }, task: ev.tool.prompt ? String(ev.tool.prompt).slice(0, 160) : { key: 'match.task' } } }, ev.at);
        break;
      }
      case 'result': {
        const p = this.pending.get(ev.id);
        if (!p) break;
        this.pending.delete(ev.id);
        this.action(p, ev.at, String(ev.output ?? ''), !!ev.error);
        break;
      }
      case 'end': {
        this.finished = true;
        const text = String(ev.text ?? '').trim();
        if (text && text !== this.lastSay) { this.feed.at(-1)?.says.push(text); this.checkDecision(text); }
        this.final = text || this.lastSay || '';
        this.detected(this.tracker.end(this.final), ev.at);
        if (/(?:[?？]|주세요[.!]?)$/.test(this.final))
          this.addMoment('waiting', Math.max(0, this.feed.length - 1), this.final.slice(-160), ev.at);
        if (this.stats().lastTest?.failed && claimsSuccess(this.final))
          this.addMoment('claim-mismatch', Math.max(0, this.feed.length - 1), this.final.slice(0, 160), ev.at);
        if (this.parent) this.workerOutcome({ status: ev.truncated ? 'truncated' : 'completed', text: this.final, at: ev.at });
        break;
      }
    }
  }

  checkDecision(text) {
    if (this.decisions >= 2 || !DECISION.test(text)) return;
    const segs = String(text).split(/(?<=[.!?。])\s+|\n+/).map(x => x.replace(/\*\*|^[#\s>*-]+/g, '').trim()).filter(Boolean);
    const picked = [];
    segs.forEach((x, i) => { if (DECISION.test(x)) picked.push(...(x.length < 40 ? segs.slice(i + 1, i + 3) : [x])); });
    const note = [...new Set(picked)].slice(0, 2).join(' ').slice(0, 400);
    if (!note) return;
    this.decisions++;
    this.addMoment('decision', Math.max(0, this.feed.length - 1), note);
  }

  addMoment(type, at, note, eventAt = this.feed[at]?.at ?? this.lastAt ?? 0, threshold = null) {
    if (!momentEnabled(type, this.momentSettings)) return;
    const throttled = threshold === null && Object.hasOwn(MOMENT_LABEL, type);
    const previous = this.moments.findLast(m => m.type === type);
    if (throttled && previous && eventAt >= previous.lastAt && eventAt - previous.lastAt < 60_000) {
      if (previous.note !== renderMessage(note)) this.noteSources.get(previous).push(note);
      previous.lastAt = eventAt; previous.count = (previous.count ?? 1) + 1;
      return;
    }
    const key = threshold !== null ? `${type}@${threshold}` : throttled ? `${type}@${eventAt}` : `${type}@${at}`;
    if (this.moments.some(m => m.key === key)) return;
    const parts = [note];
    const moment = { key, type, at, t: this.t(eventAt), eventAt, lastAt: eventAt, count: 1, get note() { const rendered = parts.map(renderMessage).join('\n'); return parts.length > 1 ? rendered.slice(-800) : rendered; }, ...(threshold !== null ? { threshold } : {}) };
    this.noteSources.set(moment, parts);
    this.moments.push(moment);
  }

  setMomentSettings(settings) {
    const next = momentSettings(settings);
    if (Object.keys(next).every(type => next[type] === this.momentSettings[type])) return;
    this.momentSettings = next;
    this.moments = this.moments.filter(m => momentEnabled(m.type, next));
    for (const key of this.comments.keys()) if (!momentEnabled(key.split('@')[0], next)) this.comments.delete(key);
    this.version++;
  }

  detected(moments, at, index = Math.max(0, this.feed.length - 1)) {
    for (const m of moments) this.addMoment(m.type, index, m.noteMessage ?? m.note, at, m.threshold ?? null);
  }

  tick(now, live = false) {
    if (!live || this.finished) return;
    for (const pending of this.pending.values()) if (now - pending.at > 180_000 && !this.tracker.longCalls.has(pending)) {
      this.tracker.longCalls.add(pending);
      this.addMoment('long-run', Math.max(0, this.feed.length - 1), { key: 'match.longRun' }, now);
      this.version++;
    }
  }

  workerOutcome({ status, error, text = this.final, at = this.lastAt, truncated = false } = {}) {
    if (!this.parent) return;
    const failed = truncated || ['error', 'failed', 'stopped', 'cancelled', 'truncated'].includes(status)
      || !!error || /\[(?:output )?truncated\]|<truncated>/i.test(text ?? '');
    if (!failed && !['completed', 'done', 'finished'].includes(status)) return;
    const type = failed ? 'abort' : 'report';
    if (type === 'report' && this.moments.some(m => m.type === 'abort')) return;
    if (type === 'abort') this.moments = this.moments.filter(m => m.type !== 'report');
    const note = error || text ? String(error || text).replace(/\s+/g, ' ').slice(0, 160) : { key: failed ? 'match.aborted' : 'match.finished' };
    if (this.moments.some(m => m.type === type && m.note === renderMessage(note))) return;
    this.addMoment(type, Math.max(0, this.feed.length - 1), note, Number.isFinite(at) ? at : this.lastAt);
    this.version++;
  }

  touch(paths, status) {
    const rank = { read: 0, write: 1, pass: 2, fail: 2 };
    for (const raw of paths) {
      if (!raw) continue;
      const p = String(raw).replace(/^\.\//, '');
      const prev = this.files.get(p);
      if (!prev || rank[status] >= rank[prev]) this.files.set(p, status);
    }
  }

  action(p, at, output, error) {
    const c = caster(p.tool, output, error);
    const bad = c.kind === 'test' && c.score ? c.score.fail > 0 : looksFailed(output, error);
    const i = this.feed.length;
    const item = { at: p.at, t: this.t(p.at), ...c, explain: explain(p.tool), important: important(p.tool, output, error), failed: (c.kind === 'test' || c.kind === 'try') && bad, alive: this.aliveSinceAction, says: [] };
    this.aliveSinceAction = false;
    if (item.failed) this.fails++;
    const failureCount = this.fails;
    Object.defineProperty(item, 'text', { enumerable: true, get: () => {
      let caption = caster(p.tool, output, error).text;
      if (c.kind === 'test') caption = `${t(item.failed ? 'match.testFail' : 'match.testPass')} ${this.player}, ${caption}`;
      if (item.failed && failureCount > 1) caption += t('match.failureCount', { count: failureCount });
      return caption;
    } });
    Object.defineProperty(item, 'explain', { enumerable: true, get: () => explain(p.tool) });
    item.lane = lane(item, this.prevFailed);
    if (c.kind === 'test' || c.kind === 'try') this.prevFailed = item.failed;
    this.feed.push(item);
    const tricks = detectTricks(p.tool, output, error);
    this.detected(this.tracker.action(p.tool, at, output, bad, c.kind === 'test', isTestPath(p.tool.path), error), at, i);
    for (const moment of extraCallMoments(p.tool, tricks.some(x => x.type === 'risky')))
      this.addMoment(moment.type, i, moment.noteMessage ?? moment.note, at);
    if (!bad && (p.tool.kind === 'write' || (p.tool.kind === 'edit' && String(p.tool.added ?? '').replace(/\n$/, '').split('\n').length >= 100)))
      this.addMoment('big-write', i, { key: 'match.bigWrite', vars: { path: p.tool.path || { key: 'caster.file' }, action: { key: p.tool.kind === 'write' ? 'match.written' : 'match.added100' } } }, at);

    if (c.kind === 'look') this.touch(c.paths, 'read');
    if (c.kind === 'write' || c.kind === 'write-test') this.touch(c.paths, 'write');
    if (c.kind === 'try') this.touch(c.paths, item.failed ? 'fail' : 'write');
    if (c.kind === 'test') { const tests = [...this.files.keys()].filter(isTestPath); for (const f of tests) this.files.set(f, item.failed ? 'fail' : 'pass'); this.ball = tests; }
    else if (c.paths.length) this.ball = c.paths.map(x => String(x).replace(/^\.\//, ''));

    const prevT = i ? this.feed[i - 1].t : 0;
    if (i && item.t - prevT > GAP_SECONDS) {
      const mins = Math.round((item.t - prevT) / 60);
      this.addMoment(item.alive ? 'thinking' : 'quiet', i, { key: item.alive ? 'match.thinkingNote' : 'match.quietNote', vars: { minutes: mins } });
    }
    this.failsInRow = item.failed ? this.failsInRow + 1 : (c.kind === 'test' || c.kind === 'try') ? 0 : this.failsInRow;
    if (c.kind === 'test' || c.kind === 'try') {
      if (item.failed && !this.sawFail) this.addMoment('first-fail', i, () => item.text);
      else if (item.failed && c.kind === 'test' && this.failsInRow < 3) this.addMoment('again', i, () => item.text);
      if (item.failed) this.sawFail = true;
      if (item.failed && c.kind === 'test') this.testFailedAt = i;
      if (!item.failed && this.sawFail && c.kind === 'test') { this.addMoment('recovery', i, () => item.text); this.sawFail = false; }
    }
    if (c.kind === 'write-test' && this.testFailedAt !== null && i - this.testFailedAt <= 3) this.addMoment('var', i, { key: 'match.varNote', vars: { get text() { return item.text; } } });
    if (this.failsInRow === 3 && item.failed) this.addMoment('stuck', i, { key: 'match.stuckNote' });
    for (const x of detectTricks(p.tool, output, error)) if (this.moments.filter(m => m.type === x.type).length < TRICK_CAP) this.addMoment(x.type, i, () => detectTricks(p.tool, output, error).find(m => m.type === x.type)?.note ?? x.note);
  }

  stats() {
    const tests = this.feed.filter(c => c.kind === 'test');
    return { tests: tests.length, lastTest: tests.at(-1) ?? null, failedTests: tests.filter(c => c.failed).length, failedTries: this.feed.filter(c => c.kind === 'try' && c.failed).length, testsWrittenByAI: this.feed.some(c => c.kind === 'write-test') };
  }

  liveStats(at) {
    const upto = this.feed.slice(0, at + 1);
    const runs = upto.filter(c => c.kind === 'test'), runFails = runs.filter(c => c.failed).length;
    return { runs: runs.length, runFails, rate: runs.length ? Math.round(runFails / runs.length * 100) : 0, tries: upto.filter(c => c.kind === 'try' && c.failed).length, t: this.feed[at]?.t ?? 0 };
  }

  // Published formula: deductions from observable facts only. Not a code-quality score.
  rating() {
    const st = this.stats(), d = [];
    const extra = Math.max(0, st.failedTests - 1);
    if (extra) d.push([t('rating.repeats', { count: extra }), -Math.min(3, extra)]);
    if (st.failedTries) d.push([t('rating.tries', { count: st.failedTries }), -Math.min(1.5, 0.5 * st.failedTries)]);
    if (this.moments.some(m => m.type === 'var')) d.push([t('rating.var'), -2]);
    const tricks = new Set(this.moments.filter(m => ['skip', 'weaken', 'mask', 'silence'].includes(m.type)).map(m => m.type));
    if (tricks.size) d.push([t('rating.tricks', { labels: [...tricks].map(type => MOMENT_LABEL[type]).join(', ') }), -Math.min(2, tricks.size)]);
    if (!st.lastTest) d.push([t('rating.noTests'), -2]);
    else if (st.lastTest.failed) d.push([t('rating.failedEnd'), -2]);
    const dec = this.decisions;
    if (dec) d.push([t('rating.decisions', { count: dec }), -0.5 * dec]);
    return { score: Math.max(1, Math.round((10 + d.reduce((t, [, v]) => t + v, 0)) * 10) / 10), deductions: d };
  }

  // The one question worth asking after the final whistle, most serious scene first.
  oneCheck() {
    const st = this.stats();
    const seen = ['var', 'skip', 'weaken', 'mask', 'silence', 'decision', 'risky'].find(t => this.moments.some(m => m.type === t));
    const id = seen ? MOMENT_LESSON[seen] : !st.lastTest ? 'no-test' : st.testsWrittenByAI ? 'self-test' : null;
    return id ? t('match.ask', { question: LESSONS[id].ask }) : t('match.check');
  }

  // Live status from the clock: a long silence while not finished.
  state(now = Date.now()) {
    if (this.finished) return { code: 'final', text: t('state.final') };
    const idle = this.lastAt !== null ? (now - this.lastAt) / 1000 : 0;
    if (idle > GAP_SECONDS) return this.alive && idle < 30 * 60 ? { code: 'timeout', text: t('state.thinking') } : { code: 'quiet', text: t('state.quiet') };
    return { code: 'live', text: t('state.live') };
  }

  pushes(now = Date.now()) {
    const out = this.moments.filter(m => m.type === 'stuck' || m.type === 'quiet').map(m => ({ t: m.t, kind: 'delay', text: `${MOMENT_LABEL[m.type]}: ${m.note}` }));
    const s = this.state(now);
    if (s.code === 'quiet' && momentEnabled('quiet', this.momentSettings)) out.push({ t: this.t(now), kind: 'quiet', text: t('match.quietPush', { minutes: Math.round((now - this.lastAt) / 60000) }) });
    if (this.finished) out.push({ t: this.feed.at(-1)?.t ?? 0, kind: 'final', text: t('match.finalPush', { score: this.rating().score }) });
    return out;
  }

  setComment(key, comment) {
    if (!momentEnabled(key.split('@')[0], this.momentSettings)) return;
    this.comments.set(key, comment); this.version++;
  }

  snapshot(now = Date.now()) {
    const st = this.stats();
    return {
      id: this.id, agent: this.agent, title: this.project || this.title, cwd: this.cwd, model: this.model, player: this.player, season: this.season,
      explain: this.feed.at(-1)?.explain ?? null,
      name: this.name, recordedName: this.recordedName ?? null, modelLabel: playerName(this.model),
      parent: this.parent ?? null, role: this.role ?? null, tag: this.tag ?? null,
      request: this.request, final: this.final, finished: this.finished, state: this.state(now),
      startedAt: this.t0, lastAt: this.lastAt, costUsd: this.costUsd, fails: this.fails,
      lastScore: st.lastTest?.score ?? null, lastTestFailed: st.lastTest ? st.lastTest.failed : null,
      feed: this.feed.map(({ says, ...c }) => ({ ...c, says: says.slice(-2).map(s => s.slice(0, 600)) })),
      moments: this.moments.map(m => ({ ...m, comment: this.comments.get(m.key) ?? null, lesson: lessonFor(m.type), auto: autoComment(this, m) })),
      momentSettings: { ...this.momentSettings },
      files: [...this.files].map(([path, status]) => {
        const touches = this.feed.filter(c => c.paths.some(p => String(p).replace(/^\.\//, '') === path));
        return { path, status, edits: touches.filter(c => ['write', 'write-test'].includes(c.kind)).length, lastAt: touches.at(-1)?.at ?? null };
      }), ball: this.ball,
      pending: [...this.pending.values()].map(p => caster(p.tool, '', false).text.replace(/ 오류가 났습니다| 시작부터 오류가 났습니다/, '')).slice(-1)[0] ?? null,
      rating: this.finished ? this.rating() : null, oneCheck: this.finished ? this.oneCheck() : null, learn: this.finished ? endLessons(st) : [], pushes: this.pushes(now), version: this.version,
    };
  }
}

export { base };
