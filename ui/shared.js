// Helpers shared by the full app and the widget.

import { t } from './i18n.js';

export const $ = id => document.getElementById(id);
export const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
export const clock = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const money = v => `$${v < 0.1 ? v.toFixed(4) : v.toFixed(2)}`;
export const rich = (text, cls = 'tx') => { const p = el('span', cls); String(text).split(/(`[^`]+`)/).forEach(part => p.append(part.length > 1 && part.startsWith('`') && part.endsWith('`') ? el('code', null, part.slice(1, -1)) : document.createTextNode(part))); return p; };
export const ago = ms => { const s = Math.round((Date.now() - ms) / 1000); return s < 60 ? t('방금') : s < 3600 ? t('{n}분 전', { n: Math.round(s / 60) }) : s < 86400 ? t('{n}시간 전', { n: Math.round(s / 3600) }) : t('{n}일 전', { n: Math.round(s / 86400) }); };
export const isTestPath = p => /(^|[\\/])(test|tests|__tests__|spec)[\\/]|[._-](test|spec)\.|^test_|[\\/]test_\w+\.py$/.test(String(p ?? ''));
export const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
export const elapsed = s => (s.startedAt == null ? 0 : ((s.finished ? s.lastAt : Date.now()) - s.startedAt) / 1000);

// Same words as the engine (src/core/caster.mjs LANES, src/core/moments.mjs MOMENT_LABEL); test/ui-labels.test.mjs keeps them in sync.
export const LANES = ['읽기', '작성', '테스트', '실패 후 수정', '통과'];
export const LABEL = {
  decision: '임의 기준 선택', 'first-fail': '첫 테스트 실패', again: '다시 테스트 실패',
  recovery: '실패 뒤 통과', var: '실패 직후 테스트 수정', stuck: '연속 실패',
  quiet: '새 활동 없음', thinking: '오래 생각 중', skip: '테스트 건너뛰기',
  weaken: '검사 줄이기', silence: '경고·검사 끄기', mask: '실패 무시 설정',
  risky: '되돌리기 어려운 명령', assign: '서브에이전트에게 맡김',
  report: '서브에이전트 완료', abort: '서브에이전트 중단', instruction: '추가 요청',
  'big-write': '파일 작성·대규모 추가',
  'claim-mismatch': '완료 주장과 테스트 결과 불일치', delete: '파일·내용 삭제',
  clash: '같은 파일 동시 수정', publish: '작업 기록 저장·공유', secret: '민감한 파일 접근',
  wrestle: '같은 파일 반복 수정', revert: '이전 수정 되돌림', install: '새 패키지 설치',
  config: '실행·검사 설정 수정', cost: '비용 기준 도달', compact: '대화 맥락 요약',
  'long-run': '오래 실행 중인 도구', waiting: '사용자 응답 대기', denied: '도구 실행 거절',
  'pipe-run': '내려받은 코드 바로 실행', 'first-run': '첫 앱 실행', 'ignored-error': '오류 확인 없이 다음 작업',
  squad: '여러 서브에이전트에 작업 분배', 'first-test': '첫 테스트 파일 작성',
};
// Shown in the current language (the Korean words above are the dictionary keys in i18n.js).
export const laneLabel = i => t(`${LANES[i] ?? LANES[0]}|단계`);
export const momentLabel = type => (LABEL[type] ? t(LABEL[type]) : type);
export const MOMENT_CHIP = {
  decision: 'warn', var: 'bad', stuck: 'bad', quiet: 'warn', 'first-fail': 'bad', again: 'bad', recovery: 'good', thinking: '',
  skip: 'bad', weaken: 'bad', mask: 'bad', silence: 'warn', risky: 'warn', assign: '', report: 'good', abort: 'bad', instruction: '',
  'big-write': '', 'claim-mismatch': 'bad', delete: 'warn', clash: 'warn', publish: '', secret: 'bad', wrestle: 'warn', revert: 'warn',
  install: '', config: 'warn', cost: 'warn', compact: '', 'long-run': 'warn', waiting: 'warn', denied: 'warn', 'pipe-run': 'bad',
  'first-run': '', 'ignored-error': 'warn', squad: '', 'first-test': 'good',
};

// Sub-players (an agent's helpers) are listed right under the player who sent them.
export const isSub = p => !!p.parent;
// Everyone who played in the match: the roster plus the subagents that left (their plays stay in the feed and file map).
export const everyone = s => [...s.players, ...(s.left ?? [])];
// A subagent that finished but is still on the roster for a few minutes.
export const doneBadge = p => (isSub(p) && p.finished && !p.left ? el('span', 'done-badge', t('끝남')) : null);
const helperOf = p => t('↳ {name}의 보조', { name: p.parentName ?? t('다른 선수') });
export const leftLine = p => [`${p.name} (${p.modelLabel})`, p.role, helperOf(p), p.lastAt ? ago(p.lastAt) : null].filter(Boolean).join(' · ');
export const subClass = (players, p) => (!p.parent ? '' : players.some(x => x.key === p.parent) ? ' sub nested' : ' sub'); // indented only under a parent that is listed
export const playerLabel = p => (p.parent ? `${p.name} ${helperOf(p)}${p.role ? ` · ${p.role}` : ''}` : p.player);
export function orderPlayers(players) {
  const keys = new Set(players.map(p => p.key));
  const out = [];
  const add = p => { out.push(p); for (const c of players) if (c.parent === p.key && !out.includes(c)) add(c); };
  for (const p of players) if (!p.parent || !keys.has(p.parent)) if (!out.includes(p)) add(p);
  for (const p of players) if (!out.includes(p)) add(p);
  return out;
}

// What a tool call or command does, step by step. With `toggle`, a small "더보기" button opens the panel;
// its open/closed state is kept per `key` across re-renders.
const explainOpen = new Map();
export function explainNode(explain, { key, open = false, toggle = true } = {}) {
  const panel = el('div', 'ex-panel');
  for (const s of explain.steps ?? []) {
    const r = el('div', 'ex-step');
    r.append(el('code', null, s.term), el('span', s.what ? null : 'faint', s.what || t('사전에 없는 명령이에요')));
    panel.append(r);
  }
  if (explain.raw) { const r = el('div', 'ex-raw'); r.append(el('span', 'k', t('원문')), el('code', null, explain.raw)); panel.append(r); }
  if (!toggle) return panel;
  const box = el('div', 'explain');
  const b = el('button', 'ex-toggle'); b.type = 'button';
  const set = v => { panel.hidden = !v; b.textContent = v ? t('접기') : t('더보기'); b.setAttribute('aria-expanded', String(v)); if (key) explainOpen.set(key, v); };
  set(key && explainOpen.has(key) ? explainOpen.get(key) : open);
  b.onclick = e => { e.stopPropagation(); set(panel.hidden); };
  box.append(b, panel);
  return box;
}
// The explanation card shown beside the widget: player, their action line, and the steps.
export function explainCard({ agent, player, action, explain }, onClose) {
  const card = el('div', 'ex-card');
  const hd = el('div', 'ex-hd');
  const who = el('div', 'ex-who'); who.append(el('b', null, player ?? ''), rich(action ?? '', 'ex-act'));
  const x = el('button', 'w-btn ex-close'); x.type = 'button'; x.title = t('닫기'); x.setAttribute('aria-label', t('설명 닫기')); x.append(icon('x', 14)); x.onclick = onClose;
  hd.append(avatar(agent), who, x);
  card.append(hd, el('span', 'ex-label', t('이 동작이 하는 일')), explainNode(explain ?? { steps: [] }, { toggle: false }));
  return card;
}
export const MARK = { look: '·', write: '✎', 'write-test': '✎', test: '▶', try: '▷', install: '+', other: '·', coach: '›' };
export const AGENT = {
  'claude-code': { short: 'CC', color: '#d97757' }, codex: { short: 'CX', color: '#10a37f' }, gemini: { short: 'GM', color: '#4f7cf7' },
  pi: { short: 'Pi', color: '#8b5cf6' }, omp: { short: 'om', color: '#db2777' }, mixdog: { short: 'MX', color: '#d97706' }, demo: { short: 'DM', color: '#6b7280' },
};
export function avatar(agent) { const a = AGENT[agent] ?? { short: String(agent).slice(0, 2), color: '#6b7280' }; const n = el('span', 'avatar', a.short); n.style.background = a.color; return n; }

// Small line icons (24px grid).
const PATHS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  play: 'M6 4l14 8-14 8z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3',
  widget: 'M3 5h18v14H3zM13 12h6v5h-6z',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  x: 'M18 6L6 18M6 6l12 12',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 6l6 6-6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
};
export function icon(name, size = 16) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'icon'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', PATHS[name] ?? ''); s.append(p);
  return s;
}

export function applyTheme(theme) { document.documentElement.dataset.theme = theme || 'system'; }

// Lessons: the plain-language explanation under a key moment, and the question to paste into the agent.
// Which lessons this person has already seen lives in this browser only (it decides what opens by default).
const KIND = { trick: 'AI 꼼수 패턴', signal: '경기 흐름 읽기', rule: '기본 룰' };
export const learned = {
  all() { try { return JSON.parse(localStorage.getItem('cl-learned') || '{}') ?? {}; } catch { return {}; } },
  // True when this moment is where the person first met the lesson (stays true on every re-render).
  first(lessonId, momentId) {
    const all = learned.all();
    if (!all[lessonId]) { all[lessonId] = momentId; try { localStorage.setItem('cl-learned', JSON.stringify(all)); } catch {} }
    return all[lessonId] === momentId;
  },
};
const opened = new Map(); // details the person opened or closed, kept across re-renders
export function lessonCard(lesson, { ask, teach = 'full', first = false, onCopy, key, badge = true } = {}) {
  const box = el('div', `lesson ${lesson.kind}`);
  const hd = el('div', 'lh');
  hd.append(el('span', 'kind', t(KIND[lesson.kind] ?? '배움')), el('b', null, lesson.name));
  if (!first && badge) hd.append(el('span', 'seen', t('아는 패턴')));
  box.append(hd);
  if (teach === 'full') {
    box.append(el('p', 'analogy', lesson.analogy));
    const d = el('details'); d.open = key && opened.has(key) ? opened.get(key) : first;
    if (key) d.ontoggle = () => opened.set(key, d.open);
    const body = el('div', 'more');
    body.append(el('p', null, t('왜 중요해요 · {text}', { text: lesson.why })), el('p', null, t('구분하는 법 · {text}', { text: lesson.tell })));
    d.append(el('summary', null, t('왜 중요하고, 어떻게 구분하나요?')), body);
    box.append(d);
  }
  const q = el('div', 'ask');
  const text = (ask || lesson.ask).replace(/^[“"]|[”"]$/g, '');
  const w = el('div'); w.append(el('span', 'k', t('이렇게 물어보세요')), rich(`“${text}”`, 'q'));
  const b = el('button', 'btn ghost copy', t('복사')); b.type = 'button'; b.title = t('복사해서 에이전트 입력창에 붙여 넣으세요');
  b.onclick = e => { e.stopPropagation(); onCopy?.(text); };
  q.append(w, b);
  box.append(q);
  return box;
}
