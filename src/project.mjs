// A project match: every agent session working in the same folder at about the same time is a player in one match.
import { sessionName } from './core/names.mjs';
import { playerName } from './core/match.mjs';
import { momentEnabled } from './core/moments.mjs';
import { t } from './i18n/index.mjs';

const WINDOW_MS = 3 * 60 * 60_000; // sessions within 3 hours of the project's latest activity play in the same match
const MAX_PLAYERS = 8;
const LEFT_AFTER_MS = 5 * 60_000; // a finished subagent stays on the roster this long before it leaves the match

export const projectKey = s => Buffer.from(s.cwd ? `p\0${s.cwd}` : `s\0${s.key}`).toString('base64url');

export function groupProjects(sessions) {
  const groups = new Map();
  for (const original of sessions) {
    const parent = original.parent && sessions.find(p => p.agent === original.agent && (p.sessionId === original.parent || p.key === original.parent));
    const s = parent ? { ...original, cwd: parent.cwd, project: parent.project, parent: parent.key } : original;
    const k = projectKey(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const out = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    const latest = list[0].updatedAt;
    const inWindow = list.filter(s => s.live || latest - s.updatedAt < WINDOW_MS);
    const leads = inWindow.filter(s => !s.parent).slice(0, MAX_PLAYERS), subs = inWindow.filter(s => s.parent);
    const live = inWindow.some(s => s.live);
    // On the roster: the leads, and while the match is live every working subagent plus those that ended in the last
    // few minutes (so leaving is visible); in a finished match the most recent subagents up to the limit. The other
    // subagents have left the match.
    const onField = live ? subs.filter(s => s.live || Date.now() - s.updatedAt < LEFT_AFTER_MS) : subs.slice(0, Math.max(0, MAX_PLAYERS - leads.length));
    const players = [...leads, ...onField];
    // Subagents are usually newer than the lead that sent them; keep each shown subagent's lead in the match.
    for (const p of onField) {
      const lead = !players.some(x => x.key === p.parent) && list.find(x => x.key === p.parent);
      if (lead) players.push(lead);
    }
    const left = subs.filter(s => !players.includes(s));
    const pick = ({ key, agent, agentLabel, model, title, live, updatedAt, demo, parent, role, tag, name, sessionId }) => ({ key, agent, agentLabel, model, title, live, updatedAt, demo: !!demo, parent, role, tag, name: name ?? null, sessionId });
    out.push({
      key, name: list[0].project, cwd: list[0].cwd, updatedAt: latest, live: players.some(p => p.live),
      players: players.map(pick), left: left.map(pick),
      older: list.length - players.length - left.length,
    });
  }
  return out.sort((a, b) => (b.live - a.live) || (b.updatedAt - a.updatedAt));
}

const rank = { read: 0, write: 1, pass: 2, fail: 2 };
const rel = (cwd, p) => {
  if (!cwd) return p;
  const c = cwd.replace(/[\\/]+$/, '');
  return p.startsWith(c + '/') || p.startsWith(c + '\\') ? p.slice(c.length + 1) : p;
};

// Merge the players' match snapshots into one project snapshot. `players` is [{ key, snap }] in a stable order.
export function buildProject(project, players, onMoment = null, momentSettings = {}) {
  const ready = players.filter(p => p.snap);
  const enabled = (type, snap) => momentEnabled(type, momentSettings) && momentEnabled(type, snap?.momentSettings);
  const startedAt = Math.min(...ready.map(p => p.snap.startedAt ?? Infinity));
  const lastAt = Math.max(...ready.map(p => p.snap.lastAt ?? 0));
  const files = new Map();
  const feed = [], moments = [], pushes = [];
  const names = new Map(), used = new Set();
  const unique = name => { if (used.has(name)) { let n = 2; while (used.has(`${name} ${n}`)) n++; name = `${name} ${n}`; } used.add(name); return name; };
  for (const { key, snap } of [...ready].sort((a, b) => Number(!!b.snap.recordedName) - Number(!!a.snap.recordedName) || a.key.localeCompare(b.key)))
    names.set(key, unique(snap.recordedName || sessionName(key, used, snap.model)));
  // Subagents that left before anyone watched them: named from the session list alone.
  const unseen = (project.left ?? []).filter(l => !ready.some(p => p.key === l.key));
  for (const l of unseen) names.set(l.key, unique(l.name || sessionName(l.key, used, l.model)));
  const leftKeys = new Set((project.left ?? []).map(l => l.key));
  let costUsd = 0, costKnown = false, fails = 0, pass = 0, fail = 0;
  const out = ready.map(({ key, snap: s }, idx) => {
    const t0 = s.startedAt ?? startedAt;
    s.feed.forEach((c, i) => feed.push({ ...c, id: `${idx}:${i}`, player: key, at: c.at ?? t0 + c.t * 1000 }));
    const visibleMoments = s.moments.filter(m => enabled(m.type, s));
    for (const m of visibleMoments) if (m.type !== 'clash') moments.push({ ...m, player: key, ref: `${idx}:${m.at}`, at: m.eventAt ?? t0 + (s.feed[m.at]?.t ?? 0) * 1000 });
    for (const p of s.pushes) {
      if (p.kind === 'quiet' && !enabled('quiet', s)) continue;
      if (p.kind === 'delay' && !visibleMoments.some(m => ['stuck', 'quiet'].includes(m.type) && m.t === p.t)) continue;
      pushes.push({ ...p, player: key, at: t0 + p.t * 1000 });
    }
    for (const f of s.files) {
      const path = rel(s.cwd || project.cwd, f.path);
      const e = files.get(path) ?? { path, status: f.status, players: [], edits: 0, lastAt: null };
      e.edits += f.edits ?? 0;
      if (f.lastAt != null) e.lastAt = Math.max(e.lastAt ?? 0, f.lastAt);
      if (rank[f.status] >= rank[e.status]) e.status = f.status;
      e.players.push({ key, status: f.status, here: s.ball.includes(f.path) });
      files.set(path, e);
    }
    if (Number.isFinite(s.costUsd)) { costUsd += s.costUsd; costKnown = true; }
    fails += s.fails;
    if (s.lastScore) { pass += s.lastScore.pass; fail += s.lastScore.fail; }
    const last = s.feed.at(-1);
    return {
      key, agent: s.agent, player: `${names.get(key)} (${s.modelLabel ?? playerName(s.model)})`, name: names.get(key), modelLabel: s.modelLabel ?? playerName(s.model),
      parent: [...(project.players ?? []), ...(project.left ?? [])].find(p => p.key === key)?.parent ?? null,
      parentName: names.get([...(project.players ?? []), ...(project.left ?? [])].find(p => p.key === key)?.parent) ?? null,
      left: leftKeys.has(key),
      role: s.role ?? null, tag: s.tag ?? null,
      model: s.model, request: s.request, title: s.title, cwd: s.cwd, season: s.season,
      explain: last?.explain ?? null,
      state: s.state, finished: s.finished, startedAt: s.startedAt, lastAt: s.lastAt, costUsd: s.costUsd, fails: s.fails,
      lastScore: s.lastScore, lastTestFailed: s.lastTestFailed, rating: s.rating, oneCheck: s.oneCheck, review: s.review, mic: s.mic,
      lane: s.pending ? (last?.lane ?? 0) : last?.lane ?? 0, now: s.finished ? null : s.pending, last: last ? { text: last.text, kind: last.kind, failed: last.failed } : null,
      plays: s.feed.length, moments: visibleMoments.length, decisions: visibleMoments.filter(m => m.type === 'decision').map(m => m.note), learn: s.learn ?? [],
    };
  });
  feed.sort((a, b) => a.at - b.at);
  const writers = new Map(), pairs = new Set();
  for (const item of feed) {
    if (!['write', 'write-test'].includes(item.kind) || !enabled('clash', ready.find(p => p.key === item.player)?.snap)) continue;
    for (const raw of item.paths) {
      const path = rel(ready.find(p => p.key === item.player)?.snap.cwd || project.cwd, raw).replace(/^\.\//, '');
      const seen = writers.get(path) ?? new Set();
      for (const other of seen) {
        if (other === item.player) continue;
        const pair = JSON.stringify([path, ...[other, item.player].sort()]);
        if (pairs.has(pair)) continue;
        pairs.add(pair);
        const note = `${names.get(other)} · ${names.get(item.player)}: ${path}`;
        const at = Number(item.id.split(':')[1]);
        const stored = ready.find(p => p.key === item.player)?.snap.moments.find(m => m.type === 'clash' && m.eventAt <= item.at && m.lastAt >= item.at);
        const matchMoment = onMoment?.(item.player, { type: 'clash', at, note, eventAt: item.at, scene: pair }) ?? stored?.comment;
        const previous = moments.findLast(m => m.type === 'clash' && m.player === item.player);
        if (previous && item.at - previous.lastAt < 60_000) { previous.note = note; previous.lastAt = item.at; continue; }
        moments.push({ key: `clash@${item.at}`, type: 'clash', player: item.player, at: item.at, lastAt: item.at, note, ref: item.id,
          comment: matchMoment ?? null, auto: { caster: t('project.clash'), line: note } });
      }
      seen.add(item.player); writers.set(path, seen);
    }
  }
  moments.sort((a, b) => a.at - b.at);
  const states = out.map(p => p.state.code);
  return {
    key: project.key, name: project.name, cwd: project.cwd, startedAt: Number.isFinite(startedAt) ? startedAt : null, lastAt: lastAt || null,
    finished: out.length > 0 && out.every(p => p.finished),
    state: states.includes('live') ? 'live' : states.includes('timeout') ? 'timeout' : states.includes('quiet') ? 'quiet' : out.length ? 'final' : 'waiting',
    // `players` is the roster; `left` lists subagents that left the match (watched ones keep their full entry, and their
    // plays stay in the feed and file map).
    players: out.filter(p => !p.left),
    left: [...out.filter(p => p.left), ...unseen.map(l => ({ key: l.key, agent: l.agent, player: `${names.get(l.key)} (${playerName(l.model)})`, name: names.get(l.key),
      modelLabel: playerName(l.model), parent: l.parent ?? null, parentName: names.get(l.parent) ?? null, role: l.role ?? null, tag: l.tag ?? null,
      title: l.title, finished: true, left: true, lastAt: l.updatedAt }))].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)),
    waiting: players.filter(p => !leftKeys.has(p.key)).length - ready.filter(p => !leftKeys.has(p.key)).length,
    feed: feed.slice(-500), moments, pushes: pushes.sort((a, b) => a.at - b.at),
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    costUsd: costKnown ? costUsd : null, fails, tests: pass + fail ? { pass, fail } : null,
    mic: { on: out.some(p => p.mic?.on), available: out.some(p => p.mic?.available) || !!players.find(p => p.snap?.mic?.available), error: out.map(p => p.mic?.error).find(Boolean) ?? null, backend: out.find(p => p.mic?.backend)?.mic.backend ?? null },
  };
}
