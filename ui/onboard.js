// First run: a short setup (language, agents found, commentary AI, taste, alerts), then a tour of the match screen.
// The tour uses a real match when there is one, else the recorded example match, which only exists while the tour
// runs (it never shows in the match list).

import { $, el, avatar } from './shared.js';
import { t } from './i18n.js';
import { api } from './transport.js';
import { openSettings } from './settings.js';

const seg = (value, options, onChange) => { const g = el('div', 'seg'); for (const [v, label] of options) { const b = el('button', null, label); b.type = 'button'; b.setAttribute('aria-pressed', String(v === value)); b.onclick = () => onChange(v); g.append(b); } return g; };
const toggle = (checked, onChange) => { const b = el('button', 'switch'); b.type = 'button'; b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(!!checked)); b.onclick = () => onChange(!checked); return b; };
const row = (name, desc, control) => { const r = el('div', 'srow'); const txt = el('div'); txt.append(el('div', 'nm', name)); if (desc) txt.append(el('div', 'ds', desc)); r.append(txt); if (control) r.append(control); return r; };
const button = (label, cls, onclick) => { const b = el('button', `btn ${cls}`, label); b.type = 'button'; b.onclick = onclick; return b; };

// ---- setup -----------------------------------------------------------------------------------
const STEPS = ['language', 'agents', 'ai', 'taste', 'alerts'];
export async function startOnboarding({ onDone }) {
  const scrim = $('onboard');
  let step = 0, s = await api.getSettings();
  const save = async patch => { s = await api.setSettings(patch); draw(); };
  const finish = async thenTour => { s = await api.setSettings({ general: { onboarded: true } }); scrim.hidden = true; scrim.replaceChildren(); watch.disconnect(); onDone(thenTour); };
  // Coming back from the commentary settings opened in step 3 shows the new connection state.
  const watch = new MutationObserver(() => { if ($('settings').hidden) draw(); });
  watch.observe($('settings'), { attributes: true, attributeFilter: ['hidden'] });

  async function body(name) {
    if (name === 'language') return [seg(s.general.language ?? 'system', [['system', t('시스템')], ['ko', '한국어'], ['en', 'English']], v => save({ general: { language: v } }))];
    if (name === 'agents') {
      const list = el('div', 'detect frame');
      for (const a of await api.agents().catch(() => [])) {
        const r = el('div', 'r'), mid = el('div'); mid.style.minWidth = '0';
        mid.append(el('div', 'nm', a.label), el('div', 'ph', a.roots[0] ?? ''));
        r.append(avatar(a.id), mid, el('span', `chip${a.sessions ? ' good' : ''}`, a.sessions ? t('경기 {n}개', { n: a.sessions }) : a.found ? t('기록 없음') : t('못 찾음')));
        list.append(r);
      }
      return [list];
    }
    if (name === 'ai') {
      const st = await api.micStatus().catch(() => null);
      const state = el('div', `onb-ai${st?.active ? ' on' : ''}`, st?.active ? t('연결됨: {label}', { label: st.active.label }) : t('아직 연결되지 않았어요. 연결하지 않아도 정해진 문구로 중계해요.'));
      return [state, button(st?.active ? t('연결 바꾸기') : t('해설 AI 연결하기'), st?.active ? '' : 'primary', () => openSettings('commentary'))];
    }
    if (name === 'taste') return [
      row(t('선수 이름'), t('말장난 이름은 AI 업계 인물을 패러디한 재미용 이름이에요.'), seg(s.general.nameStyle === 'plain' ? 'plain' : 'pun', [['pun', t('말장난(기본)')], ['plain', t('일반|이름')]], v => save({ general: { nameStyle: v } }))),
      row(t('말투'), t('매운맛은 시니컬한 농담을, 순한맛은 차분한 응원을 해요.'), seg(s.commentary.tone, [['spicy', t('매운맛')], ['mild', t('순한맛')]], v => save({ commentary: { tone: v } }))),
    ];
    return [
      row(t('알림 받기'), t('에이전트가 막히거나, 혼자 결정하거나, 일을 끝내면 알려 줘요.'), toggle(s.notifications.enabled, v => save({ notifications: { enabled: v } }))),
      ...(api.desktop ? [row(t('컴퓨터를 켤 때 실행'), t('트레이에서 조용히 기다리다가 에이전트가 일을 시작하면 바로 중계해요.'), toggle(s.general.launchAtLogin, v => save({ general: { launchAtLogin: v } })))] : []),
    ];
  }
  const TITLE = { language: ['반가워요! 몇 가지만 정할게요', '언어부터 골라 주세요. 나중에 설정에서 바꿀 수 있어요.'], agents: ['찾은 에이전트', '이 컴퓨터에서 찾은 코딩 에이전트예요. 다른 폴더에 설치했다면 설정 → 에이전트에서 지정할 수 있어요.'],
    ai: ['해설 AI 연결', '작은 AI가 결정적 장면을 해설하고, 역할 지도와 파일 설명도 만들어요. 쓴 만큼 고른 프로바이더에 요금이 붙어요.'], taste: ['취향', '선수 이름과 해설 말투를 골라요.'], alerts: ['알림', '중요한 순간을 놓치지 않게 알려 드려요.'] };
  async function draw() {
    const name = STEPS[step];
    const card = el('div', 'onb');
    const top = el('div', 'onb-top');
    top.append(el('span', 'faint', `${step + 1} / ${STEPS.length}`), button(t('나중에 하기'), 'ghost', () => finish(false)));
    const content = el('div', 'onb-body');
    content.append(...await body(name));
    const foot = el('div', 'onb-foot');
    foot.append(step ? button(t('이전'), '', () => { step--; draw(); }) : el('span'));
    foot.append(step < STEPS.length - 1 ? button(t('다음'), 'primary', () => { step++; draw(); }) : button(t('시작하고 튜토리얼 보기'), 'primary', () => finish(true)));
    card.append(top, el('h2', null, t(TITLE[name][0])), el('p', 'ds', t(TITLE[name][1])), content, foot);
    if (STEPS[step] !== name) return; // the step changed while this one loaded
    scrim.replaceChildren(card);
  }
  scrim.hidden = false;
  await draw();
}

// ---- tour ------------------------------------------------------------------------------------
const TOUR = [
  { target: '#who', title: '경기', text: '보고 있는 프로젝트와 선수예요. 한 폴더에서 일하는 에이전트는 모두 한 경기의 선수가 돼요.' },
  { target: '#stats', title: '상태창', text: '경기 시간, 비용, 테스트 결과, 실패 횟수예요. 아랫줄은 코드와 테스트 줄 수예요. 테스트가 코드만큼 늘면 노란색, 2배 넘게 늘면 빨간색이 돼요.' },
  { target: '#filemap', title: '역할 지도', text: '선수가 건드린 파일을 화면·규칙·데이터·테스트 같은 구역으로 묶어요. 선수 칩은 지금 있는 파일이고, 파일을 누르면 AI가 그 파일이 하는 일을 설명해요.' },
  { target: '#fmRoutes', title: '이동 기록', text: '선수마다 어느 구역을 거쳐 갔는지 순서대로 보여 줘요. 구역 사이 선은 한 구역을 고치다 다른 구역으로 넘어가 고친 곳이에요.' },
  { target: '.side', title: '중계와 해설', text: '에이전트가 하는 일을 한 줄씩 중계해요. 중요한 장면에는 캐스터와 해설위원이 반응하고, "더보기"를 누르면 쓴 도구와 명령을 쉬운 말로 풀어 줘요.' },
  { target: '.side [data-t="report"]', title: '리포트', text: '경기가 끝나면 결과 요약과, 결과를 믿기 전에 확인할 점을 정리해 줘요.' },
  { target: '.side [data-t="players"]', title: '선수', text: '선수별 기록과, 사용자에게 묻지 않고 스스로 정한 결정을 모아 보여 줘요.' },
  { target: '#mic', title: 'AI 해설', text: '작은 AI가 결정적 장면을 해설해요. 이 버튼으로 켜고 꺼요.' },
  { target: '#widgetBtn', title: '위젯', text: '다른 일을 하면서도 화면 구석의 작은 창으로 경기를 볼 수 있어요.' },
  { target: '#list', title: '경기 목록', text: '에이전트가 일하는 프로젝트가 여기 경기로 쌓여요. 지금 경기 중인 건 맨 위에 있어요.' },
];
const shown = n => { if (!n) return false; const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[hidden]'); };

// hooks: { openMatch(key), closeMatch(), current() } from the main window.
let touring = false;
export async function startTour(hooks) {
  if (touring) return;
  touring = true;
  const list = await api.projects().catch(() => []);
  const real = list.find(p => p.live) ?? list[0] ?? null;
  let example = false, key = real?.key ?? hooks.current()?.key ?? null;
  if (!key) { key = (await api.startTutorial())?.key ?? null; example = !!key; }
  if (key && hooks.current()?.key !== key) hooks.openMatch(key);
  for (let i = 0; i < 40 && key && !hooks.current()?.snap; i++) await new Promise(r => setTimeout(r, 200));

  // Four dim panels around the highlighted part (a huge box-shadow isn't always painted).
  const layer = el('div', 'tour'), hole = el('div', 'tour-hole'), bubble = el('div', 'tour-bubble');
  const shades = [0, 1, 2, 3].map(() => el('div', 'tour-shade'));
  layer.append(...shades, hole, bubble);
  document.body.append(layer);
  const steps = [
    { title: '튜토리얼', text: example ? '지금 보이는 건 녹화된 예시 경기예요. 세 에이전트가 한 프로젝트에서 동시에 일해요. 진짜 에이전트를 돌리면 이렇게 중계돼요. (숫자도 예시예요.)' : '지금 경기를 예로 들어 화면 읽는 법을 안내할게요.' },
    ...(key ? TOUR : TOUR.slice(-1)),
    { title: '준비 끝', text: '에이전트를 돌리면 여기서 바로 중계가 시작돼요. 튜토리얼은 설정 → 정보에서 다시 볼 수 있어요.' },
  ];
  let i = 0;
  const end = async () => {
    layer.remove(); removeEventListener('resize', place); touring = false;
    if (example) { hooks.closeMatch(); await api.stopTutorial(); }
  };
  function place() {
    const st = steps[i], target = st.target ? document.querySelector(st.target) : null;
    layer.classList.toggle('dim', !target);
    shades.forEach(s => { s.hidden = !target; });
    if (!target) { hole.hidden = true; Object.assign(bubble.style, { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }); return; }
    target.scrollIntoView({ block: 'nearest' });
    const r = target.getBoundingClientRect(), pad = 6, W = innerWidth, H = innerHeight;
    const L = Math.max(0, r.left - pad), T = Math.max(0, r.top - pad), R = Math.min(W, r.right + pad), B = Math.min(H, r.bottom + pad);
    hole.hidden = false;
    Object.assign(hole.style, { left: `${L}px`, top: `${T}px`, width: `${R - L}px`, height: `${B - T}px` });
    [[0, 0, W, T], [0, B, W, H - B], [0, T, L, B - T], [R, T, W - R, B - T]].forEach(([x, y, w, h], k) => Object.assign(shades[k].style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }));
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight, gap = 14;
    let x = r.left, y = r.bottom + gap;
    if (y + bh > H - 8) y = r.top - gap - bh;
    if (y < 8) { y = Math.min(Math.max(8, r.top), H - bh - 8); x = r.right + gap + bw <= W - 8 ? r.right + gap : r.left - gap - bw; }
    Object.assign(bubble.style, { left: `${Math.min(Math.max(8, x), W - bw - 8)}px`, top: `${Math.min(Math.max(8, y), H - bh - 8)}px`, transform: 'none' });
  }
  function draw() {
    // Steps whose part of the screen isn't showing (narrow windows, the widget in browser mode) are skipped.
    while (steps[i]?.target && !shown(document.querySelector(steps[i].target))) i += i < steps.length - 1 ? 1 : -1;
    const st = steps[i];
    const nav = el('div', 'tour-nav');
    nav.append(button(t('건너뛰기'), 'ghost', end));
    if (i) nav.append(button(t('이전'), '', () => { i--; while (i > 0 && steps[i].target && !shown(document.querySelector(steps[i].target))) i--; draw(); }));
    nav.append(i < steps.length - 1 ? button(t('다음'), 'primary', () => { i++; draw(); }) : button(t('끝내기'), 'primary', end));
    bubble.replaceChildren(el('span', 'faint', `${i + 1} / ${steps.length}`), el('h3', null, t(st.title)), el('p', null, t(st.text)), nav);
    place();
  }
  addEventListener('resize', place);
  draw();
}
