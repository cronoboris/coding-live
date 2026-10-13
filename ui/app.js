// coding live — main window. A match is a project: every agent working in the same folder is a player.
// Works in the desktop app (IPC) and in browser mode (HTTP), see transport.js.

import { $, el, clock, money, rich, ago, store, momentLabel, MOMENT_CHIP, avatar, icon, applyTheme, lessonCard, learned, explainNode, orderPlayers, playerLabel, isSub, subClass, everyone, doneBadge, leftLine } from './shared.js';
import { t, applyLanguage } from './i18n.js';
import { api } from './transport.js';
import { openSettings, toast } from './settings.js';
import { renderFileMap, renderRoutes } from './filemap.js';
import { startOnboarding, startTour } from './onboard.js';

let info = { agents: [] };
let projects = [];
const view = { filter: store.get('cl-filter') || 'all', agent: store.get('cl-agent') || '', query: '' };
let current = null; // { key, stop, snap, rendered, tab, sel }
let shownError = null;
let prefs = { teach: 'full', explain: true, fileExplain: true, nameStyle: 'pun' }; // settings the match view needs
let shownLang = 'ko'; // the language the page is drawn in (the HTML ships in Korean)
// A language change re-translates the static page and redraws everything that was built in the old language.
const applyPrefs = s => {
  applyTheme(s.general.theme);
  const lang = applyLanguage(s, api.locale);
  if (lang !== shownLang) { shownLang = lang; $('fmLegend').replaceChildren(); chromeText(); renderList(); if (current?.snap) render(); else if (!current) renderWelcome(); }
  prefs.teach = s.commentary?.teach ?? 'full'; prefs.explain = s.commentary?.explain !== false; prefs.fileExplain = s.commentary?.fileExplain !== false; prefs.nameStyle = s.general.nameStyle ?? 'pun';
};
const parodyNote = () => (prefs.nameStyle === 'plain' ? null : el('p', 'parody', t('선수 이름은 재미를 위한 패러디이며 실제 인물과 관계없어요.')));
const TRICK_IDS = ['answer-key', 'skip-test', 'weaker-test', 'silence', 'mask'];
async function copy(text) {
  const ok = await api.copy(text).catch(() => false);
  toast(ok === false ? t('복사하지 못했어요. 직접 선택해서 복사하세요.') : t('복사했어요. 에이전트 입력창에 붙여 넣으세요.'), ok === false ? 'bad' : '');
}
const agentLabel = id => info.agents.find(a => a.id === id)?.label ?? id;
const isMac = /Mac/.test(navigator.platform);
const playerOf = (s, key) => everyone(s).find(p => p.key === key);
const since = s => (s.startedAt == null ? 0 : ((s.finished ? s.lastAt : Date.now()) - s.startedAt) / 1000);

// ---- sidebar: projects ---------------------------------------------------------------------
async function loadProjects() {
  try { projects = await api.projects(); } catch { return; }
  // A match can merge into another as players' folders become known; follow it.
  if (current && !projects.some(p => p.key === current.key)) {
    const next = projects.find(p => p.players.some(pl => current.members.includes(pl.key)));
    if (next) { openMatch(next.key); return; }
  }
  renderList();
  if (!current) renderWelcome();
}
function renderList() {
  document.querySelectorAll('.side-filters [data-f]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === view.filter)));
  const sel = $('agentFilter');
  const agents = [...new Set(projects.flatMap(p => p.players.map(x => x.agent)))];
  if ([...sel.options].slice(1).map(o => o.value).join() !== agents.join()) sel.replaceChildren(new Option(t('모든 에이전트'), ''), ...agents.map(a => new Option(agentLabel(a), a)));
  sel.options[0].text = t('모든 에이전트');
  sel.value = agents.includes(view.agent) ? view.agent : '';
  const q = view.query.trim().toLowerCase();
  const shown = projects.filter(p => (view.filter !== 'live' || p.live) && (!sel.value || p.players.some(x => x.agent === sel.value))
    && (!q || `${p.name} ${p.cwd} ${p.players.map(x => `${x.title} ${x.agentLabel} ${x.model ?? ''}`).join(' ')}`.toLowerCase().includes(q)));
  const list = $('list');
  list.replaceChildren();
  const group = (title, items) => {
    if (!items.length) return;
    const g = el('div', 'group'); g.append(el('span', null, title), el('span', 'faint', String(items.length))); list.append(g);
    for (const p of items) list.append(rowFor(p));
  };
  group(t('지금 경기 중'), shown.filter(p => p.live));
  group(t('최근 경기'), shown.filter(p => !p.live));
  if (!shown.length) list.append(el('div', 'list-empty', t(q ? '찾는 경기가 없어요.' : view.filter === 'live' ? '지금 뛰는 경기가 없어요.' : '아직 찾은 경기가 없어요.')));
}
function rowFor(p) {
  const b = el('button', 'row'); b.type = 'button'; b.setAttribute('role', 'listitem');
  if (current?.key === p.key) b.setAttribute('aria-current', 'true');
  const av = el('div', 'avatars'); p.players.slice(0, 3).forEach(x => av.append(avatar(x.agent)));
  const mid = el('div'); mid.style.minWidth = '0';
  const agents = [...new Set(p.players.map(x => x.agentLabel))].join(' · ');
  mid.append(el('div', 'ttl', p.name), el('div', 'meta', `${t('선수 {n}명', { n: p.players.length })} · ${agents}`));
  const end = el('div', 'end');
  if (p.live) end.append(el('span', 'livedot'));
  const when = el('span', 'faint', ago(p.updatedAt)); when.style.fontSize = '11px'; end.append(when);
  b.style.gridTemplateColumns = `${22 + (Math.min(3, p.players.length) - 1) * 16}px minmax(0, 1fr) auto`;
  b.append(av, mid, end);
  b.onclick = () => openMatch(p.key);
  return b;
}

// ---- welcome / onboarding ------------------------------------------------------------------
let agentsCache = null, agentsAt = 0;
async function renderWelcome() {
  if (Date.now() - agentsAt > 5000) { try { agentsCache = await api.agents(); agentsAt = Date.now(); } catch { agentsCache = null; } }
  const box = $('detect');
  box.replaceChildren();
  if (!agentsCache) { box.append(el('div', 'list-empty', t('에이전트 정보를 불러오지 못했어요.'))); return; }
  for (const a of agentsCache) {
    const r = el('div', 'r');
    const mid = el('div'); mid.style.minWidth = '0';
    mid.append(el('div', 'nm', a.label), el('div', 'ph', a.roots[0] ?? ''));
    const st = !a.enabled ? el('span', 'chip', t('꺼짐')) : a.live ? el('span', 'chip live', t('경기 중 {n}', { n: a.live })) : a.sessions ? el('span', 'chip good', t('경기 {n}개', { n: a.sessions })) : a.found ? el('span', 'chip', t('기록 없음')) : el('span', 'chip', t('못 찾음'));
    if (a.live) st.prepend(el('span', 'dot'));
    r.append(avatar(a.id), mid, st);
    box.append(r);
  }
}

// ---- match ---------------------------------------------------------------------------------
function openMatch(key) {
  current?.stop?.();
  const members = projects.find(p => p.key === key)?.players.map(p => p.key) ?? [];
  current = { key, members, stop: null, snap: null, rendered: 0, tab: store.get('cl-side') || 'feed', sel: null, map: { hops: new Map(), zones: new Map() } };
  store.set('cl-last', key);
  $('app').classList.add('watching');
  $('welcome').hidden = true;
  $('match').hidden = false;
  for (const id of ['filemap', 'stats', 'side', 'who', 'statePill', 'selChip']) $(id).replaceChildren();
  $('side').append(el('div', 'list-empty', t('경기를 불러오는 중…')));
  current.stop = api.watchProject(key, snap => { if (current?.key !== key) return; current.snap = snap; current.members = [...new Set([...current.members, ...snap.players.map(p => p.key)])]; render(); }, state => {
    if (current?.key !== key) return;
    if (state === 'gone') setTimeout(() => { if (current?.key === key && !current.snap) loadProjects(); }, 1500);
    else if (state === 'reconnecting') toast(t('연결이 끊겼어요. 다시 연결하는 중…'));
  });
  renderList();
}
function closeMatch() {
  current?.stop?.(); current = null;
  $('match').hidden = true; $('welcome').hidden = false;
  $('app').classList.remove('watching');
  renderList(); renderWelcome();
}
function select(key) {
  current.sel = current.sel === key ? null : key;
  render();
}

function render() {
  const s = current?.snap;
  if (!s) return;
  try { renderTop(s); renderStats(s); renderFiles(s); renderSide(s); }
  catch (e) { console.error('render failed', e); }
  current.rendered++;
}
const STATE = { live: ['live', '경기 중'], timeout: ['accent live', '생각 중'], quiet: ['warn', '정적'], final: ['', '경기 종료'], waiting: ['', '입장 중'] };
function statePill(code) {
  const [cls, text] = STATE[code] ?? ['', code];
  const p = el('span', `chip ${cls}`);
  if (code === 'live' || code === 'timeout') p.append(el('span', 'dot'));
  p.append(document.createTextNode(t(text)));
  return p;
}
function renderTop(s) {
  const who = $('who');
  const av = el('div', 'avatars'); s.players.slice(0, 4).forEach(p => av.append(avatar(p.agent)));
  const txt = el('div'); txt.style.minWidth = '0';
  txt.append(el('div', 't', s.name), el('div', 's', `${t('선수 {n}명', { n: s.players.length })} · ${s.players.filter(p => !isSub(p)).map(p => p.player).join(', ')}${s.cwd ? ` · ${s.cwd}` : ''}`));
  who.replaceChildren(av, txt);
  $('statePill').replaceChildren(statePill(s.state));
  const mic = $('mic');
  const err = s.mic?.error;
  mic.className = `btn${s.mic?.on ? (err ? ' warn' : ' on') : ''}`;
  mic.replaceChildren(icon('mic'), document.createTextNode(t(!s.mic?.available ? 'AI 해설 설정' : s.mic.on ? (err ? 'AI 해설 오류' : 'AI 해설 중') : 'AI 해설')));
  mic.title = !s.mic?.available ? t('해설에 쓸 AI CLI를 찾지 못했어요. 눌러서 설정하세요.') : err ? err.message : s.mic.on ? t('{backend}로 해설 중 · 누르면 꺼요', { backend: s.mic.backend }) : t('결정적 장면을 작은 AI가 해설해요');
  if (err && s.mic.on && err.at !== shownError) { shownError = err.at; toast(t('AI 해설이 안 돼요: {message}', { message: err.message }), 'bad'); }
}
function renderStats(s) {
  const box = $('stats');
  box.replaceChildren();
  const stat = (k, v, cls = '', id, extra = '') => { const d = el('div', `stat ${extra}`); d.append(el('span', 'k', t(k))); const x = el('span', `v ${cls}`, v); if (id) x.id = id; d.append(x); box.append(d); return d; };
  stat('경기 시간', clock(since(s)), '', 'clock');
  stat('뛰는 선수', `${s.players.filter(p => !p.finished).length} / ${s.players.length}`, '', null, 'rate');
  stat('비용', Number.isFinite(s.costUsd) ? money(s.costUsd) : '—');
  stat('테스트', s.tests ? `${s.tests.pass}/${s.tests.pass + s.tests.fail}` : '—', s.tests ? (s.tests.fail ? 'bad' : 'good') : '');
  stat('실패', String(s.fails), s.fails ? 'bad' : '');
  // Lines of code vs. tests in the project, and how much each grew while watching: tests growing as fast as the code
  // is worth a look, twice as fast a warning (only once 50+ test lines were added).
  const L = s.lines?.tooMany || s.lines?.missing ? null : s.lines;
  const waiting = s.lines?.tooMany ? t('Git 저장소가 아닌 큰 폴더라 코드 줄 수를 세지 않았어요.') : s.lines?.missing ? t('이 컴퓨터에서 프로젝트 폴더를 찾지 못해 코드 줄 수를 세지 않았어요.') : t('코드 줄 수를 세는 중이에요.');
  const n = v => (Math.abs(v) >= 10_000 ? `${(v / 1000).toFixed(1)}k` : v.toLocaleString());
  const sign = v => (v > 0 ? `+${n(v)}` : v < 0 ? `−${n(-v)}` : '0');
  const share = L && L.code + L.test ? Math.round((L.test / (L.code + L.test)) * 100) : 0;
  stat('코드 줄', L ? `${n(L.code)} · ${t('테스트')} ${n(L.test)} (${share}%)` : '—', 'sm', null, 'lines').title = L
    ? t('실제 코드 {code}줄, 테스트 코드 {test}줄이에요. 전체 코드 중 테스트가 {share}%예요. 빈 줄은 세지 않아요.', { code: L.code.toLocaleString(), test: L.test.toLocaleString(), share }) : waiting;
  const dc = L ? L.code - L.base.code : 0, dt = L ? L.test - L.base.test : 0;
  const level = dt < 50 ? '' : dt >= 2 * Math.max(dc, 0) ? 'bad' : dt >= Math.max(dc, 0) ? 'warn' : '';
  stat('지켜본 뒤 증가', L ? `${sign(dc)} · ${t('테스트')} ${sign(dt)}` : '—', `sm ${level}`, null, 'lines').title = !L ? waiting
    : `${t('coding live가 지켜보기 시작한 뒤로 실제 코드가 {dc}줄, 테스트 코드가 {dt}줄 늘었어요.', { dc: sign(dc), dt: sign(dt) })}${level === 'bad' ? `\n${t('테스트가 코드보다 2배 넘게 늘었어요. AI가 필요 이상으로 큰 테스트를 쓰고 있지 않은지 확인해 보세요.')}` : level === 'warn' ? `\n${t('테스트가 코드만큼 늘고 있어요. 테스트가 과하지 않은지 지켜보세요.')}` : ''}`;
}

// Project files as a treemap with the players on it (see filemap.js).
function renderFiles(s) {
  const lg = $('fmLegend');
  if (!lg.childElementCount) {
    for (const [c, k] of [['var(--layer-3)', '읽음'], ['var(--accent)', '씀·고침'], ['var(--good)', '테스트 통과'], ['var(--bad)', '실패|상태']]) { const sp = el('span'); const i = el('i'); i.style.background = c; sp.append(i, document.createTextNode(t(k))); lg.append(sp); }
    const cl = el('span'); const ci = el('i', 'clash'); cl.append(ci, document.createTextNode(t('여러 선수가 고친 파일'))); lg.append(cl);
    const ld = el('span'); ld.append(el('i', 'last'), document.createTextNode(t('마지막으로 만진 파일'))); lg.append(ld);
    const tr = el('span'); tr.append(el('i', 'trail'), document.createTextNode(t('최근 이동'))); lg.append(tr);
  }
  // Role view (default) needs the AI's areas; without them the folder view shows, with the reason next to the switch.
  const wanted = store.get('cl-mapview') || 'role';
  const r = s.roles ?? {};
  const roles = wanted === 'role' && r.files && (Object.keys(r.files).length || r.pending) ? r : null;
  const why = wanted !== 'role' || roles ? '' : r.off ? t('역할 보기가 설정에서 꺼져 있어요.') : r.nomic ? t('역할 보기는 해설 AI가 연결돼야 써요.') : r.error ? t('역할을 나누지 못했어요: {message}', { message: r.error }) : '';
  let sw = $('fmView');
  if (!sw) { sw = el('span', 'fmview'); sw.id = 'fmView'; $('fmLegend').before(sw); }
  const seg = el('span', 'seg');
  seg.append(...[['role', t('역할 보기')], ['folder', t('폴더 보기')]].map(([v, label]) => {
    const b = el('button', null, label); b.type = 'button'; b.setAttribute('aria-pressed', String(v === wanted));
    b.onclick = () => { store.set('cl-mapview', v); renderFiles(current.snap); };
    return b;
  }));
  sw.replaceChildren(seg);
  if (why) sw.append(el('span', 'faint why', why));
  if (roles) sw.title = t('파일을 역할별 구역으로 묶어요. 구역은 AI가 파일 경로를 보고 나눠요. 구역 사이 선은 선수가 한 구역을 고치다 다른 구역으로 넘어가 고친 곳이에요.');
  else sw.removeAttribute('title');
  renderFileMap($('filemap'), s, { sel: current.sel, onSelect: select, onFile: showFileNote, state: current.map, roles, noteFor: path => notes.get(`${current.key}\0${path}`), minH: roles ? Math.round($('mapScroll').clientHeight * 0.7) : 0 });
  renderRoutes($('fmRoutes'), s, roles);
}
const notes = new Map(); // AI file notes already fetched, by match and path: shown again when hovering the file

// A file tile opens a small note under it: what the players did with it, then the AI's take on what the file is for.
async function showFileNote(f, tile, facts) {
  const box = $('filemap');
  const open = box.querySelector('.fnote');
  open?.remove();
  if (open?.dataset.path === f.path) return; // clicking the same file again closes it
  const pop = el('div', 'fnote'); pop.dataset.path = f.path;
  const x = tile.parentElement.offsetLeft + tile.offsetLeft, top = tile.parentElement.offsetTop + tile.offsetTop;
  pop.style.left = `${Math.max(4, Math.min(x, box.clientWidth - 364))}px`;
  // The map clips overflow, so a note that would run past the bottom opens above the tile; one taller than the map scrolls inside.
  const place = () => {
    pop.style.maxHeight = `${box.clientHeight - 8}px`;
    const h = pop.offsetHeight, below = top + tile.offsetHeight + 6;
    pop.style.top = `${below + h <= box.clientHeight - 4 ? below : Math.max(4, top - h - 6)}px`;
  };
  const close = el('button', 'x', '×'); close.type = 'button'; close.setAttribute('aria-label', t('닫기')); close.onclick = () => pop.remove();
  const hd = el('div', 'hd'); hd.append(el('b', null, f.path), close);
  const body = el('div', 'body');
  const settingsLink = () => { const a = el('button', 'link', t('해설 설정')); a.type = 'button'; a.onclick = () => openSettings('commentary'); return a; };
  pop.append(hd, el('div', 'facts', facts), body);
  box.append(pop);
  if (!prefs.fileExplain) { body.append(document.createTextNode(`${t('파일 AI 설명이 꺼져 있어요.')} `), settingsLink()); place(); return; }
  const wait = el('span', 'faint'); wait.append(el('span', 'spinner'), document.createTextNode(t('AI가 파일을 읽는 중…'))); body.append(wait);
  place();
  const r = await api.explainFile(current.key, f.path);
  if (!pop.isConnected) return;
  body.replaceChildren();
  if (!r || r.error) {
    const why = !r ? t('설명을 받지 못했어요.') : r.error === 'nomic' ? t('해설 AI가 연결되지 않았어요') : r.error === 'off' ? t('파일 AI 설명이 꺼져 있어요.') : r.error === 'missing' ? t('이 파일을 찾지 못했어요.') : r.message ?? t('설명을 받지 못했어요.');
    body.append(document.createTextNode(`${why} `));
    if (r && ['nomic', 'off', 'call', 'format'].includes(r.error)) body.append(settingsLink());
  } else {
    notes.set(`${current.key}\0${f.path}`, r);
    tile.title = `${tile.title.split('\n\n')[0]}\n\n${r.text}`;
    if (r.part) body.append(el('span', 'chip', r.part));
    body.append(el('p', null, r.text), el('div', 'src', t('AI 설명 · {ai}', { ai: r.ai })));
  }
  place();
}

// ---- side: commentary, report, players -----------------------------------------------------
function renderSide(s) {
  document.querySelectorAll('.side [data-t]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.t === current.tab)));
  const chip = $('selChip'); chip.replaceChildren();
  if (current.sel) { const p = playerOf(s, current.sel); if (p) { const c = el('button', 'chip accent'); c.type = 'button'; c.style.border = '0'; c.style.cursor = 'pointer'; c.append(document.createTextNode(t('{player}만 보기', { player: p.player })), icon('x', 12)); c.onclick = () => select(current.sel); chip.append(c); } }
  if (current.tab === 'feed') renderFeed(s);
  else if (current.tab === 'report') renderReport(s);
  else renderPlayers(s);
}
function momentNode(s, m) {
  const p = playerOf(s, m.player);
  const ai = m.comment;
  const c = ai?.caster ? ai : m.auto;
  const box = el('div', `moment ${m.type}${current.sel && current.sel !== m.player ? ' dim' : ''}`);
  const hd = el('div', 'hd');
  if (p) hd.append(avatar(p.agent));
  hd.append(el('span', `chip ${MOMENT_CHIP[m.type] ?? ''}`, momentLabel(m.type)));
  if (ai?.loading) { const w = el('span', 'faint'); w.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:12px'; w.append(el('span', 'spinner'), document.createTextNode(t('마이크 잡는 중'))); hd.append(w); }
  if (ai?.failed) { const f = el('span', 'chip bad', t('AI 해설 실패')); f.title = ai.reason ?? ''; hd.append(f); }
  hd.append(el('span', 'src', t(ai?.caster ? 'AI 해설' : '자동 문구')));
  box.append(hd);
  if (ai?.failed && ai.reason) { const r = el('div', 'reason'); r.append(document.createTextNode(`${ai.reason} `)); const a = el('button', 'link', t('해설 설정')); a.type = 'button'; a.onclick = () => openSettings('commentary'); r.append(a); box.append(r); }
  const line = (who, text, cls) => { const d = el('div', `line ${cls}`); d.append(el('b', null, who), el('span', null, text)); return d; };
  if (c.caster) box.append(line(t('캐스터'), c.caster, 'call'));
  box.append(line(t('해설위원'), c.line, ''));
  if (m.lesson && prefs.teach !== 'off') {
    const id = `${m.player}:${m.key}`;
    box.append(lessonCard(m.lesson, { ask: ai?.ask, teach: prefs.teach, first: learned.first(m.lesson.id, id), onCopy: copy, key: id }));
  }
  return box;
}
function renderFeed(s) {
  const box = $('side'), scroller = $('sideScroll');
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  const before = current.feedRendered ? box.childElementCount : Infinity;
  box.replaceChildren();
  if (!s.feed.length) box.append(el('div', 'list-empty', t('선수들의 첫 동작을 기다리는 중이에요.')));
  const byRef = new Map();
  for (const m of s.moments) { if (!byRef.has(m.ref)) byRef.set(m.ref, []); byRef.get(m.ref).push(m); }
  const t0 = s.startedAt ?? 0;
  for (const c of s.feed) {
    const p = playerOf(s, c.player);
    const row = el('div', `tick${c.kind === 'coach' ? ' coach' : ''}${(c.kind === 'test' || c.kind === 'try') ? (c.failed ? ' fail' : ' pass') : ''}${current.sel && current.sel !== c.player ? ' dim' : ''}`);
    const who = el('span', 'who'); if (p) { const a = avatar(p.agent); a.classList.add('xs'); a.title = playerLabel(p); who.append(a); }
    row.append(el('span', 'time', clock(Math.max(0, (c.at - t0) / 1000))), who, rich(c.text));
    if (prefs.explain && c.explain?.steps?.length) row.append(explainNode(c.explain, { key: `${current.key}:${c.id}`, open: !!c.important }));
    row.style.gridTemplateColumns = '40px 16px minmax(0, 1fr)';
    box.append(row);
    for (const m of byRef.get(c.id) ?? []) box.append(momentNode(s, m));
  }
  for (const p of s.players) if (p.now && (!current.sel || current.sel === p.key)) { const r = el('div', 'pending'); const a = avatar(p.agent); a.classList.add('xs'); r.append(el('span', 'spinner'), a, rich(`${p.player}: ${p.now}`)); box.append(r); }
  [...box.children].slice(before).forEach(n => n.classList.add('enter'));
  if (nearBottom || !current.feedRendered) scroller.scrollTop = scroller.scrollHeight;
  current.feedRendered = true;
}
function renderReport(s) {
  current.feedRendered = false;
  const box = $('side'); box.replaceChildren();
  const list = orderPlayers(current.sel ? everyone(s).filter(p => p.key === current.sel && p.request != null) : s.players);
  for (const p of list) {
    const card = el('section', `pcard frame${subClass(list, p)}`);
    const hd = el('div', 'prow'); const txt = el('div'); txt.style.minWidth = '0';
    txt.append(nameLine(p), el('div', 'faint', p.request.split('\n')[0].slice(0, 80)));
    txt.lastChild.style.cssText = 'font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    hd.append(avatar(p.agent), txt, p.finished && p.rating ? el('span', 'mono', `${p.rating.score}`) : statePill(p.state.code));
    if (p.finished && p.rating) hd.lastChild.style.cssText = 'font-size:24px;font-weight:600';
    card.append(hd);
    if (!p.finished || !p.rating) card.append(el('p', 'muted', t('경기가 끝나면 평점과 직접 확인할 것 하나를 보여 드려요.')));
    else {
      const ded = el('div', 'ded');
      if (!p.rating.deductions.length) ded.append(el('div', 'muted', t('감점 없음')));
      for (const [label, v] of p.rating.deductions) { const r = el('div'); r.append(el('span', null, label), el('b', null, String(v))); ded.append(r); }
      card.append(ded, el('div', 'callout', p.oneCheck));
      if (p.review?.headline) card.append(el('p', null, p.review.headline));
      if (p.mic?.available && !p.review) {
        const b = el('button', 'btn'); b.type = 'button'; b.append(icon('mic'), document.createTextNode(t('AI 경기 리뷰')));
        b.onclick = async () => { b.disabled = true; b.lastChild.textContent = t('리뷰 쓰는 중…'); const r = await api.review(p.key); if (!r) { b.disabled = false; b.lastChild.textContent = t('다시 시도'); toast(t('리뷰를 받지 못했어요. 해설 설정을 확인하세요.'), 'bad'); } };
        card.append(b);
      }
    }
    const decs = p.review?.decisions?.length ? p.review.decisions : p.decisions.map(d => t('선수 본인 주장: “{text}”', { text: d }));
    if (decs.length) { card.append(el('span', 'label', t('임의 기준 선택 · 내가 정할 것'))); const ul = el('ul', 'list-plain'); decs.forEach(d => ul.append(el('li', null, d))); card.append(ul); }
    box.append(card);
  }
  if (!current.sel) leftSection(s, box);
  renderLearned(s, box, list);
  const f = el('p', 'faint', t('평점은 공개된 계산식이에요: 반복 실패 −1(최대 −3), 직접 시험 오류 −0.5(최대 −1.5), 실패 직후 테스트 수정 −2, 꼼수 의심 장면 −1씩(최대 −2), 마지막 테스트 실패·미실행 −2, 임의 기준 −0.5씩.'));
  f.style.cssText = 'font-size:12px;margin-top:12px'; box.append(f);
}
// What this match taught: every lesson its moments raised, plus the end-of-match ones, with the questions to ask.
function renderLearned(s, box, players) {
  if (prefs.teach === 'off') return;
  const keys = new Set(players.map(p => p.key));
  const seen = new Map();
  for (const m of s.moments) if (m.lesson && keys.has(m.player) && !seen.has(m.lesson.id)) seen.set(m.lesson.id, { lesson: m.lesson, ask: m.comment?.ask });
  for (const p of players) for (const l of p.learn ?? []) if (!seen.has(l.id)) seen.set(l.id, { lesson: l });
  const sec = el('section', 'learned');
  const all = learned.all();
  const got = TRICK_IDS.filter(id => all[id]).length;
  const hd = el('div', 'lh2'); hd.append(el('span', 'label', t('이번 경기에서 배운 것')), el('span', 'chip', t('AI 꼼수 도감 {got}/{total}', { got, total: TRICK_IDS.length })));
  sec.append(hd);
  if (!seen.size) sec.append(el('p', 'muted', t('아직 짚을 만한 장면이 없어요. 결정적 장면이 나오면 여기에 모여요.')));
  for (const [id, { lesson, ask }] of seen) sec.append(lessonCard(lesson, { ask, teach: prefs.teach === 'short' ? 'short' : 'full', first: false, badge: false, onCopy: copy, key: `report:${id}` }));
  box.append(sec);
}
function renderPlayers(s) {
  current.feedRendered = false;
  const box = $('side'); box.replaceChildren();
  for (const p of orderPlayers(s.players)) {
    const card = el('section', `pcard frame pick${subClass(s.players, p)}${current.sel && current.sel !== p.key ? ' dim' : ''}`);
    card.tabIndex = 0; card.title = t(current.sel === p.key ? '다시 누르면 모든 선수 보기' : '눌러서 이 선수만 보기');
    card.onclick = e => { if (!e.target.closest('button')) select(p.key); };
    card.onkeydown = e => { if (e.key === 'Enter' && e.target === card) select(p.key); };
    const hd = el('div', 'prow'); const txt = el('div'); txt.style.minWidth = '0'; txt.append(nameLine(p), el('div', 'faint', `${agentLabel(p.agent)} · ${t('동작 {n}', { n: p.plays })} · ${t('결정적 장면 {n}', { n: p.moments })}`)); txt.lastChild.style.fontSize = '12px';
    hd.append(avatar(p.agent), txt, statePill(p.state.code)); card.append(hd);
    const kv = el('div', 'kv');
    const se = p.season;
    const rows = [['비용', Number.isFinite(p.costUsd) ? money(p.costUsd) : '—'], ['실패', String(p.fails)], ['테스트', p.lastScore ? `${p.lastScore.pass}/${p.lastScore.pass + p.lastScore.fail}` : '—'], ['경기 시간', clock(since(p))]];
    if (se) rows.push(['시즌 첫 테스트 통과율', `${se.firstTestPassRate}%`], ['시즌 실패 직후 테스트 수정 비율', `${se.varGameRate}%`]);
    for (const [k, v] of rows) { const d = el('div'); d.append(el('span', null, t(k)), el('b', null, v)); kv.append(d); }
    card.append(kv);
    const req = el('p', 'muted', p.request.slice(0, 300)); req.style.fontSize = '12.5px'; card.append(req);
    box.append(card);
  }
  leftSection(s, box);
  const note = parodyNote(); if (note) box.append(note);
}
function nameLine(p) {
  const nm = el('div', 'nm', isSub(p) ? playerLabel(p) : t('{player} 선수', { player: p.player }));
  const b = doneBadge(p); if (b) nm.append(b);
  return nm;
}
// Subagents that left the match, collapsed under the roster; picking one filters the feed and file map to its plays.
function leftSection(s, box) {
  const left = s.left ?? [];
  if (!left.length) return;
  const sec = el('section', 'left-sec');
  const hd = el('button', 'left-hd'); hd.type = 'button'; hd.setAttribute('aria-expanded', String(!!current.leftOpen));
  hd.append(icon('chevron', 12), document.createTextNode(t('나간 선수 {n}명', { n: left.length })));
  hd.onclick = () => { current.leftOpen = !current.leftOpen; render(); };
  sec.append(hd);
  if (current.leftOpen) {
    const ul = el('div', 'left-list');
    for (const p of left) {
      const r = el('button', `left-row${current.sel === p.key ? ' on' : current.sel ? ' dim' : ''}`); r.type = 'button';
      r.setAttribute('aria-pressed', String(current.sel === p.key));
      r.title = t(current.sel === p.key ? '다시 누르면 모든 선수 보기' : '눌러서 이 선수만 보기');
      const a = avatar(p.agent); a.classList.add('xs');
      r.append(a, el('span', null, leftLine(p)));
      r.onclick = () => select(p.key);
      ul.append(r);
    }
    sec.append(ul);
  }
  box.append(sec);
}

// ---- wiring --------------------------------------------------------------------------------
const tour = () => startTour({ openMatch, closeMatch, current: () => current });
const onboard = () => startOnboarding({ onDone: thenTour => { if (thenTour) tour(); } });
// Text in the page chrome that isn't in the HTML (the HTML itself is translated by applyLanguage).
function chromeText() {
  $('widgetBtn').lastChild.textContent = t('위젯 켜기·끄기');
  if (isMac) { $('openSettings').title = t('설정 (⌘,)'); }
}
function setupChrome() {
  $('openSettings').append(icon('settings'));
  $('searchIcon').replaceWith(icon('search'));
  $('searchKbd').textContent = isMac ? '⌘K' : 'Ctrl K';
  $('back').append(icon('back'));
  const wb = $('widgetBtn'); wb.append(icon('widget'), el('span', null)); wb.hidden = !api.desktop;
  chromeText();
  $('openSettings').onclick = () => openSettings();
  $('settingsHero').onclick = () => openSettings('agents');
  $('back').onclick = closeMatch;
  wb.onclick = () => api.toggleWidget();
  $('tourHero').onclick = tour;
  addEventListener('cl:tour', tour);
  addEventListener('cl:onboard', onboard);
  document.querySelectorAll('.side-filters [data-f]').forEach(b => { b.onclick = () => { view.filter = b.dataset.f; store.set('cl-filter', view.filter); renderList(); }; });
  $('agentFilter').onchange = e => { view.agent = e.target.value; store.set('cl-agent', view.agent); renderList(); };
  $('search').oninput = e => { view.query = e.target.value; renderList(); };
  $('search').onkeydown = e => {
    if (e.key === 'Enter') document.querySelector('#list .row')?.click();
    if (e.key === 'Escape') { e.target.value = ''; view.query = ''; renderList(); e.target.blur(); }
  };
  document.querySelectorAll('.side [data-t]').forEach(b => { b.onclick = () => { current.tab = b.dataset.t; current.feedRendered = false; store.set('cl-side', current.tab); renderSide(current.snap); if (current.tab !== 'feed') $('sideScroll').scrollTop = 0; }; });
  document.querySelectorAll('.mtabs [data-v]').forEach(b => { b.onclick = () => {
    document.querySelectorAll('.mtabs [data-v]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    $('stage').classList.toggle('show-side', b.dataset.v === 'side');
  }; });
  $('mic').onclick = async () => {
    if (!current?.snap) return;
    if (!current.snap.mic?.available) { openSettings('commentary'); return; }
    const r = await api.setMicProject(current.key, !current.snap.mic.on);
    if (!r) toast(t('해설을 켜지 못했어요.'), 'bad');
  };
  document.addEventListener('keydown', e => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('search').focus(); $('search').select(); }
    if (mod && e.key === ',') { e.preventDefault(); openSettings(); }
    if (e.key === 'Escape' && current?.sel && $('settings').hidden) select(current.sel);
  });
  // Alerts and the widget name either a project or one of its players' sessions.
  api.onOpenMatch(async key => { await loadProjects(); const p = projects.find(x => x.key === key) ?? projects.find(x => x.players.some(pl => pl.key === key)); if (p) openMatch(p.key); });
  api.onSettings(s => { applyPrefs(s); if (current?.snap) renderSide(current.snap); });
  setInterval(() => { const s = current?.snap, c = $('clock'); if (s && c && !s.finished) c.textContent = clock(since(s)); }, 1000);
  // Recently touched files shrink back gradually even when nothing new arrives; the map follows its width.
  setInterval(() => { if (current?.snap && !current.snap.finished) renderFiles(current.snap); }, 10_000);
  let mapWidth = 0;
  new ResizeObserver(() => { const w = $('filemap').clientWidth; if (w !== mapWidth) { mapWidth = w; if (current?.snap) renderFiles(current.snap); } }).observe($('filemap'));
}

(async () => {
  setupChrome();
  let first = false;
  try { const s = await api.getSettings(); applyPrefs(s); first = !s.general.onboarded; } catch { applyPrefs({ general: {} }); }
  try { info = await api.info(); } catch {}
  await loadProjects();
  setInterval(loadProjects, 4000);
  const last = store.get('cl-last');
  if (last && projects.some(p => p.key === last) && matchMedia('(min-width: 761px)').matches) openMatch(last);
  if (!api.desktop && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (first) onboard();
})();
