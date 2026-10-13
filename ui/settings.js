// Settings sheet. Every change saves at once; nothing to confirm.

import { $, el, icon, avatar, applyTheme } from './shared.js';
import { t, applyLanguage } from './i18n.js';
import { api } from './transport.js';

export function toast(text, kind = '') {
  const n = el('div', `toast ${kind}`, text);
  $('toasts').append(n);
  setTimeout(() => n.remove(), 3200);
}

const SECTIONS = [
  ['general', '일반', 'sliders'],
  ['agents', '에이전트', 'plug'],
  ['commentary', '해설', 'mic'],
  ['moments', '장면', 'list'],
  ['notifications', '알림', 'bell'],
  ['widget', '위젯', 'widget'],
  ['privacy', '개인정보', 'shield'],
  ['about', '정보', 'info'],
];

let state = null; // { s: settings, section, agents, info, appInfo, mic, groups, test }

export async function openSettings(section = 'general') {
  const [s, agents, info, appInfo, mic, groups] = await Promise.all([api.getSettings(), api.agents().catch(() => []), api.info().catch(() => ({})), api.appInfo().catch(() => ({})), api.micStatus().catch(() => null), api.momentGroups().catch(() => null)]);
  state = { s, section, agents, info, appInfo, mic, groups, tests: {}, open: {}, custom: {} };
  const scrim = $('settings');
  scrim.hidden = false;
  scrim.onclick = e => { if (e.target === scrim) close(); };
  document.addEventListener('keydown', onKey);
  draw();
  scrim.querySelector('nav button[aria-current="true"]')?.focus();
}
function close() { $('settings').hidden = true; $('settings').replaceChildren(); document.removeEventListener('keydown', onKey); state = null; }
function onKey(e) { if (e.key === 'Escape') close(); }

async function save(patch, message = '저장했어요') {
  try {
    state.s = await api.setSettings(patch);
    applyTheme(state.s.general.theme);
    applyLanguage(state.s, api.locale);
    if (patch.general?.language) state.groups = await api.momentGroups().catch(() => state.groups); // engine text arrives in the new language
    if (patch.agents || patch.commentary || patch.general?.language) { [state.agents, state.info, state.mic] = await Promise.all([api.agents().catch(() => state.agents), api.info().catch(() => state.info), api.micStatus().catch(() => state.mic)]); state.tests._active = null; }
    draw();
    if (message) toast(t(message));
  } catch { toast(t('저장하지 못했어요.'), 'bad'); }
}

function draw() {
  const scrim = $('settings');
  const sheet = el('div', 'sheet'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', t('설정'));
  const nav = el('nav'); nav.append(el('h2', null, t('설정')));
  for (const [id, label, ic] of SECTIONS) {
    const b = el('button'); b.type = 'button'; b.append(icon(ic), document.createTextNode(t(label)));
    if (id === state.section) b.setAttribute('aria-current', 'true');
    b.onclick = () => { state.section = id; draw(); };
    nav.append(b);
  }
  const body = el('div', 'sheet-body');
  const head = el('div', 'sheet-head');
  head.append(el('h3', null, t(SECTIONS.find(x => x[0] === state.section)[1])));
  const x = el('button', 'btn ghost iconbtn'); x.type = 'button'; x.setAttribute('aria-label', t('닫기')); x.append(icon('x')); x.onclick = close;
  head.append(x);
  const content = el('div', 'sheet-content');
  ({ general, agents, commentary, moments, notifications, widget, privacy, about })[state.section](content);
  body.append(head, content);
  sheet.append(nav, body);
  const keepScroll = scrim.querySelector('.sheet-content')?.scrollTop ?? 0;
  if (scrim.querySelector('.sheet')) sheet.classList.add('still'); // redraws after a change shouldn't replay the opening animation
  scrim.replaceChildren(sheet);
  content.scrollTop = keepScroll;
}

// ---- controls ----
const group = (parent, title, rows, note) => {
  const g = el('div', 'sgroup');
  if (title) g.append(el('span', 'label', title));
  const box = el('div', 'sbox'); rows.filter(Boolean).forEach(r => box.append(r)); g.append(box);
  if (note) g.append(el('p', 'note', note));
  parent.append(g);
};
const row = (name, desc, control) => { const r = el('div', 'srow'); const txt = el('div'); txt.append(el('div', 'nm', name)); if (desc) txt.append(el('div', 'ds', desc)); r.append(txt); if (control) r.append(control); return r; };
const toggle = (checked, onChange, disabled = false) => { const b = el('button', 'switch'); b.type = 'button'; b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(!!checked)); b.disabled = disabled; b.onclick = () => onChange(!checked); return b; };
const select = (value, options, onChange) => { const s = el('select', 'select'); for (const [v, label] of options) s.append(new Option(label, v)); s.value = value; s.onchange = () => onChange(s.value); return s; };
const seg = (value, options, onChange) => { const g = el('div', 'seg'); for (const [v, label] of options) { const b = el('button', null, label); b.type = 'button'; b.setAttribute('aria-pressed', String(v === value)); b.onclick = () => onChange(v); g.append(b); } return g; };

// ---- sections ----
function general(c) {
  const g = state.s.general;
  group(c, t('화면'), [
    // Shown in both languages so anyone can find it.
    row(t('언어 / Language'), t('시스템을 고르면 컴퓨터 언어를 따라가요. 한국어가 아니면 영어로 보여요.'), seg(g.language ?? 'system', [['system', t('시스템')], ['ko', '한국어'], ['en', 'English']], v => save({ general: { language: v } }, null))),
    row(t('테마'), t('시스템 설정을 따르거나 직접 고를 수 있어요.'), seg(g.theme, [['system', t('시스템')], ['dark', t('다크')], ['light', t('라이트')]], v => save({ general: { theme: v } }, null))),
    row(t('선수 이름'), t('말장난·밈 이름은 모델 회사에 맞춰 AI 업계 인물에서 따와요. 재미를 위한 패러디이며 실제 인물과 관계없어요.'), seg(g.nameStyle ?? 'pun', [['pun', t('말장난(기본)')], ['meme', t('밈(실명 패러디)')], ['plain', t('일반|이름')]], v => save({ general: { nameStyle: v } }, null))),
  ]);
  group(c, t('시작'), [
    row(t('로그인하면 자동으로 켜기'), t(api.desktop ? '컴퓨터를 켜면 트레이에서 조용히 시작해요.' : '데스크톱 앱에서만 쓸 수 있어요.'), toggle(g.launchAtLogin, v => save({ general: { launchAtLogin: v } }), !api.desktop)),
    row(t('켤 때 창 숨기기'), t('트레이와 위젯만 띄우고 큰 창은 열지 않아요.'), toggle(g.startHidden, v => save({ general: { startHidden: v } }), !api.desktop)),
  ]);
}

function agents(c) {
  const rows = state.agents.map(a => {
    const r = el('div', 'srow agentrow');
    const mid = el('div'); mid.style.minWidth = '0';
    const nm = el('div', 'nm', a.label);
    const status = !a.enabled ? t('꺼짐') : a.live ? t('지금 경기 중 {live}개 · 경기 {n}개', { live: a.live, n: a.sessions }) : a.sessions ? t('경기 {n}개 찾음', { n: a.sessions }) : t(a.found ? '폴더는 있지만 기록이 없어요' : '기록 폴더를 못 찾았어요(설치 안 됨)');
    mid.append(nm, el('div', 'ds', status));
    const pr = el('div', 'pathrow');
    const input = el('input', 'input'); input.value = a.path; input.placeholder = a.roots[0] ?? t('기본 폴더'); input.setAttribute('aria-label', t('{label} 기록 폴더', { label: a.label }));
    input.onchange = () => save({ agents: { [a.id]: { enabled: a.enabled, path: input.value.trim() } } }, '폴더를 바꿨어요');
    pr.append(input);
    if (api.desktop) { const b = el('button', 'btn'); b.type = 'button'; b.append(icon('folder')); b.title = t('폴더 고르기'); b.onclick = async () => { const p = await api.pickFolder(); if (p) save({ agents: { [a.id]: { enabled: a.enabled, path: p } } }, '폴더를 바꿨어요'); }; pr.append(b); }
    if (a.path) { const b = el('button', 'btn ghost', t('기본값')); b.type = 'button'; b.onclick = () => save({ agents: { [a.id]: { enabled: a.enabled, path: '' } } }, '기본 폴더로 되돌렸어요'); pr.append(b); }
    mid.append(pr);
    r.append(avatar(a.id), mid, toggle(a.enabled, v => save({ agents: { [a.id]: { enabled: v, path: a.path } } }, t(v ? '{label}를 켰어요' : '{label}를 껐어요', { label: a.label }))));
    return r;
  });
  group(c, t('연결할 에이전트'), rows, t('에이전트를 고치지 않고, 각 에이전트가 디스크에 남기는 세션 기록만 읽어요. 기록을 다른 곳에 두셨다면 폴더를 직접 지정하세요.'));
}

// ---- commentary: pick a provider, then how to reach it -------------------------------------------
const PROVIDER_ORDER = ['anthropic', 'google', 'openai', 'ollama', 'compatible'];
const LIMITS = [[10, '10'], [20, '20'], [50, '50'], [100, '100'], [null, '무제한']]; // labels go through t()
const shortLabel = p => `${p.label}${p.sub ? ` · ${p.sub}` : ''}`;
const LOGO = { anthropic: 'A', google: 'G', openai: 'O', ollama: 'OL', compatible: 'API' };
const patchProvider = (id, v) => save({ commentary: { providers: { [id]: v } } }, null);

async function runTest(id) {
  state.tests[id ?? '_active'] = 'running'; draw();
  const r = await api.testMic(id).catch(() => ({ ok: false, message: t('테스트를 실행하지 못했어요.') }));
  state.tests[id ?? '_active'] = r;
  state.mic = await api.micStatus().catch(() => state.mic);
  draw();
}
const testResult = (r, cls = '') => {
  if (!r || r === 'running') return null;
  const d = el('div', `result ${r.ok ? 'ok' : 'bad'} ${cls}`, r.ok ? `${t('잘 돼요. 응답까지 {s}초', { s: (r.ms / 1000).toFixed(1) })}${r.costUsd ? ` · ${t('비용 {cost}', { cost: `$${r.costUsd.toFixed(4)}` })}` : r.tokens ? ` · ${t('토큰 {n}개', { n: r.tokens })}` : ''}.` : r.message);
  return d;
};
const testButton = (id, label = '연결 테스트', disabled = false) => {
  const running = state.tests[id ?? '_active'] === 'running';
  const b = el('button', 'btn'); b.type = 'button'; b.textContent = t(running ? '테스트 중…' : label); b.disabled = running || disabled;
  b.onclick = () => runTest(id);
  return b;
};
const textInput = (value, placeholder, onCommit, { type = 'text', mono = false, label } = {}) => {
  const i = el('input', `input${mono ? ' mono' : ''}`); i.type = type; i.value = value ?? ''; i.placeholder = placeholder ?? ''; i.spellcheck = false; i.autocomplete = 'off';
  if (label) i.setAttribute('aria-label', label);
  if (onCommit) { i.onchange = () => onCommit(i.value.trim()); i.onkeydown = e => { if (e.key === 'Enter') i.blur(); }; }
  return i;
};

function modelPicker(p) {
  const wrap = el('div', 'pathrow');
  const options = [...(p.via === 'cli' && p.cliDefaultModel === '' ? [['', t('{cli} 기본 모델', { cli: p.cli.label })]] : []), ...p.models.map(m => [m.id, `${m.label}${m.note ? ` — ${m.note}` : ''}`])];
  if (p.id === 'ollama') options.push(...(p.ollama?.models ?? []).map(m => [m, m]));
  const known = options.some(([v]) => v === p.model);
  const custom = state.custom[p.id] || (p.model && !known && p.id !== 'ollama');
  if (p.id === 'compatible' || (p.id === 'ollama' && !options.length)) {
    wrap.append(textInput(p.model, t('예: {x}', { x: p.id === 'ollama' ? 'gemma3' : 'qwen/qwen3-8b' }), v => patchProvider(p.id, { model: v }), { mono: true, label: t('{label} 모델', { label: p.label }) }));
    return wrap;
  }
  const sel = el('select', 'select'); sel.setAttribute('aria-label', t('{label} 모델', { label: p.label }));
  for (const [v, label] of options) sel.append(new Option(label, v));
  sel.append(new Option(t('직접 입력…'), '__custom'));
  sel.value = custom ? '__custom' : known ? p.model : (options[0]?.[0] ?? '');
  sel.onchange = () => { if (sel.value === '__custom') { state.custom[p.id] = true; draw(); } else { state.custom[p.id] = false; patchProvider(p.id, { model: sel.value }); } };
  wrap.append(sel);
  if (custom) wrap.append(textInput(known ? '' : p.model, t('모델 이름'), v => patchProvider(p.id, { model: v }), { mono: true, label: t('{label} 모델 이름', { label: p.label }) }));
  return wrap;
}

function keyRow(p) {
  const mic = state.mic;
  const k = p.key ?? { has: false };
  const box = el('div'); box.style.cssText = 'display:grid;gap:8px';
  const now = el('div', 'ds', k.source === 'saved' ? t('저장된 키 {hint} · 이 컴퓨터의 키체인으로 암호화해서 보관해요.', { hint: k.hint ?? '' }) : k.source === 'env' ? t('환경 변수 {env}의 키를 쓰는 중 {hint}', { env: k.env, hint: k.hint ?? '' }) : t(p.id === 'compatible' ? '키가 필요 없는 서버(LM Studio 등)는 비워 두세요.' : '아직 키가 없어요.'));
  box.append(now);
  if (mic?.canSaveKeys) {
    const r = el('div', 'pathrow');
    const input = textInput('', k.source === 'saved' ? t('새 키로 바꾸기') : (p.keyHint || t('API 키')), null, { type: 'password', mono: true, label: t('{label} API 키', { label: p.label }) });
    const saveBtn = el('button', 'btn', t('저장')); saveBtn.type = 'button';
    saveBtn.onclick = async () => {
      if (!input.value.trim()) { input.focus(); return; }
      saveBtn.disabled = true;
      const res = await api.setSecret(p.id, input.value.trim()).catch(() => ({ ok: false, error: t('저장하지 못했어요.') }));
      input.value = '';
      if (res.ok) { toast(t('키를 저장했어요')); state.mic = await api.micStatus().catch(() => state.mic); state.info = await api.info().catch(() => state.info); draw(); }
      else { toast(res.error ?? t('저장하지 못했어요.'), 'bad'); saveBtn.disabled = false; }
    };
    input.onkeydown = e => { if (e.key === 'Enter') saveBtn.click(); };
    r.append(input, saveBtn);
    if (k.source === 'saved') { const del = el('button', 'btn ghost', t('지우기')); del.type = 'button'; del.onclick = async () => { await api.setSecret(p.id, null); toast(t('키를 지웠어요')); state.mic = await api.micStatus().catch(() => state.mic); state.info = await api.info().catch(() => state.info); draw(); }; r.append(del); }
    box.append(r);
  } else if (p.envKeys.length) box.append(el('div', 'ds', `${t(api.desktop ? '이 컴퓨터에는 키를 안전하게 저장할 키체인이 없어요. 환경 변수로 넣어 주세요.' : '브라우저 모드에서는 키를 저장할 수 없어요. 환경 변수로 넣어 주세요.')} ${t('변수 이름: {names}', { names: p.envKeys.join(t(' 또는 ')) })}`));
  if (p.keyUrl) { const a = el('button', 'link', t('키 발급 페이지 열기')); a.type = 'button'; a.onclick = () => api.openUrl(p.keyUrl); a.style.justifySelf = 'start'; box.append(a); }
  return box;
}

function providerCard(p, chosen, active) {
  const open = state.open[p.id] ?? (chosen || (state.s.commentary.provider === 'auto' && active));
  const card = el('section', `pcard provider${chosen ? ' chosen' : ''}${open ? ' open' : ''}`);
  const head = el('button', 'phead'); head.type = 'button'; head.setAttribute('aria-expanded', String(open));
  const name = el('div'); name.style.minWidth = '0';
  name.append(el('div', 'nm', p.label), el('div', 'ds', p.sub));
  const chip = active ? el('span', 'chip good', t('해설 중')) : p.ready ? el('span', 'chip', t('준비됨')) : el('span', 'chip warn', p.reason ?? t('설정 필요'));
  head.append(el('span', `plogo p-${p.id}`, LOGO[p.id] ?? p.label.slice(0, 1)), name, chip, el('span', `chev${open ? ' open' : ''}`));
  head.onclick = () => { state.open[p.id] = !open; draw(); };
  card.append(head);
  if (!open) return card;
  const body = el('div', 'pbody');
  const rows = [];
  if (p.methods.length > 1) rows.push(row(t('연결 방법'), p.via === 'cli' ? t('{cli}에 로그인돼 있으면 키 없이 그 계정으로 불러요.', { cli: p.cli.label }) : t('API 키로 바로 불러요. 쓴 만큼 키 주인 계정에 요금이 붙어요.'), seg(p.via, p.methods.map(m => [m, m === 'cli' ? t('{cli} 로그인', { cli: p.cli.label }) : t('API 키')]), v => patchProvider(p.id, { via: v }))));
  if (p.via === 'cli') rows.push(row(t(p.cli.installed ? '{cli}를 찾았어요' : '{cli}가 없어요', { cli: p.cli.label }), t(p.cli.installed ? '터미널에서 {bin}를 한 번 실행해 로그인해 두면 돼요.' : '{cli}를 설치하고 터미널에서 {bin}를 한 번 실행해 로그인하세요. 설치한 뒤에도 못 찾으면 앱을 완전히 껐다 켜세요.', { cli: p.cli.label, bin: p.cli.bin })));
  if (p.via === 'api') { const r = row(t(p.id === 'compatible' ? 'API 키 (선택)' : 'API 키'), null); r.classList.add('stack'); r.append(keyRow(p)); rows.push(r); }
  if (p.id === 'ollama' || p.id === 'compatible') {
    rows.push(row(t(p.id === 'ollama' ? '주소' : '서버 주소'), p.id === 'ollama' ? (p.ollama?.running ? t('켜져 있어요 · 모델 {n}개', { n: p.ollama.models.length }) : t('Ollama 앱이 꺼져 있거나 주소가 달라요.')) : t('예: LM Studio http://127.0.0.1:1234/v1 · OpenRouter https://openrouter.ai/api/v1'),
      textInput(p.url, p.id === 'ollama' ? 'http://127.0.0.1:11434' : 'https://…/v1', v => patchProvider(p.id, { url: v }), { mono: true, label: t('{label} 주소', { label: p.label }) })));
  }
  if (p.id === 'ollama' && !p.ollama?.running && p.setupUrl) { const a = el('button', 'link', t('Ollama 내려받기')); a.type = 'button'; a.onclick = () => api.openUrl(p.setupUrl); rows.push(row(t('Ollama가 없나요?'), t('설치하면 인터넷이나 크레딧 없이 이 컴퓨터에서 해설해요. 설치 뒤 터미널에서 `ollama pull gemma3`로 모델을 하나 받으세요.'), a)); }
  const mr = row(t('모델'), t(p.id === 'ollama' ? '설치된 모델 중에서 골라요. 한국어를 잘하는 모델일수록 해설이 자연스러워요.' : p.id === 'compatible' ? '서버에 있는 모델 이름을 그대로 넣으세요.' : '해설은 짧은 글이라 작은 모델로도 충분해요.'), null); mr.classList.add('stack'); mr.append(modelPicker(p)); rows.push(mr);
  const tr = el('div', 'srow');
  const tl = el('div'); tl.append(el('div', 'nm', t('이 AI로 테스트')), el('div', 'ds', t('아주 짧은 질문을 하나 보내 봐요.')));
  tr.append(tl, testButton(p.id, '테스트|버튼'));
  rows.push(tr);
  const res = testResult(state.tests[p.id]);
  if (res) rows.push(res);
  const box = el('div', 'sbox'); rows.forEach(r => box.append(r)); body.append(box);
  if (!chosen) { const use = el('button', 'btn primary', t('이 AI로 해설하기')); use.type = 'button'; use.onclick = () => save({ commentary: { provider: p.id } }, t('{label}로 해설해요', { label: p.label })); body.append(use); }
  card.append(body);
  return card;
}

function commentary(c) {
  const m = state.s.commentary;
  const st = state.mic;
  const active = st?.active;
  // What answers now, and does a real call work?
  const status = el('div', 'srow stack');
  const top = el('div'); top.style.cssText = 'display:flex;justify-content:space-between;gap:12px;align-items:center';
  const txt = el('div');
  txt.append(el('div', 'nm', active ? t('{label}로 해설해요', { label: active.label }) : t(m.provider === 'off' ? 'AI 해설을 껐어요' : '해설 AI가 연결되지 않았어요')),
    el('div', 'ds', t(active ? '결정적 장면에만 불러요. 장면 하나에 몇 초에서 10초 안팎 걸려요.' : m.provider === 'off' ? '정해진 문구로만 해설해요. 배움 카드는 그대로 나와요.' : '아래에서 AI를 하나 연결하세요. 그 전까지는 정해진 문구로 해설해요.')));
  top.append(txt, testButton(null, '연결 테스트', !active));
  status.append(top);
  const res = testResult(state.tests._active) ?? (st?.lastError ? testResult({ ok: false, message: st.lastError.message }) : null);
  if (res) { res.style.marginTop = '10px'; status.append(res); }
  if (st?.override) status.append(el('div', 'ds', t('실행할 때 지정한 값({value})이 이번 실행에만 우선 적용돼요.', { value: st.override })));
  group(c, t('지금 해설하는 AI'), [status]);

  const choice = select(m.provider, [['auto', t('자동 — 준비된 것 중 먼저 찾은 것')], ...PROVIDER_ORDER.map(id => [id, shortLabel(st?.providers?.find(p => p.id === id) ?? { label: id })]), ['off', t('끄기 — 정해진 문구만')]], v => save({ commentary: { provider: v } }));
  group(c, t('해설에 쓸 AI'), [row(t('프로바이더'), t('자동이면 Anthropic → Google → OpenAI → Ollama → 호환 서버 순서로, 준비된 것을 써요.'), choice)]);
  const list = el('div', 'providers');
  for (const p of st?.providers ?? []) list.append(providerCard(p, m.provider === p.id, active?.provider === p.id));
  if (!st?.providers) list.append(el('div', 'list-empty', t('프로바이더 정보를 불러오지 못했어요.')));
  c.append(list);

  const limits = (m.maxCalls == null || LIMITS.some(([v]) => v === m.maxCalls) ? LIMITS : [...LIMITS.slice(0, -1), [m.maxCalls, String(m.maxCalls)], LIMITS.at(-1)].sort((a, b) => (a[0] ?? Infinity) - (b[0] ?? Infinity))).map(([v, label]) => [v, t(label)]);
  group(c, t('해설 마이크'), [
    row(t('새 경기에서 자동으로 켜기'), t('경기를 열면 AI 해설을 바로 켜요. 끄면 경기마다 위쪽의 AI 해설 버튼을 눌러야 해요.'), toggle(m.autoOn, v => save({ commentary: { autoOn: v } }), !active)),
    row(t('말투'), t('매운맛은 시니컬한 농담을, 순한맛은 차분한 응원을 해요. 사실만 말하는 원칙은 같아요.'), seg(m.tone, [['spicy', t('매운맛')], ['mild', t('순한맛')]], v => save({ commentary: { tone: v } }))),
    row(t('도구·명령 설명'), t('중계 줄마다 "더보기"를 붙여 에이전트가 쓴 도구와 명령이 무슨 일을 하는지 한 단계씩 풀어 줘요. 위젯에서 선수 줄을 누르면 옆에 따로 보여 줘요.'), toggle(m.explain, v => save({ commentary: { explain: v } }, null))),
    row(t('파일 AI 설명'), t('파일 지도에서 파일을 누르면 AI가 그 파일이 프로젝트에서 맡은 역할을 설명해요. 파일 내용 앞부분(최대 200줄)이 고른 프로바이더로 전달돼요.'), toggle(m.fileExplain, v => save({ commentary: { fileExplain: v } }, null))),
    row(t('초보자 설명'), t('장면마다 일상 비유, 왜 중요한지, 에이전트에게 그대로 물어볼 말을 붙여 줘요. 자세히는 처음 보는 패턴을 펼쳐서 보여 줘요.'), seg(m.teach, [['full', t('자세히')], ['short', t('짧게')], ['off', t('끄기')]], v => save({ commentary: { teach: v } }))),
    row(t('경기당 해설 한도'), m.maxCalls == null ? t('한도 없이 결정적 장면마다 불러요. 긴 경기에서는 비용이 그만큼 늘어요.') : t('결정적 장면 한 번에 한 번 불러요. {n}번을 넘으면 정해진 문구로 해설해요.', { n: m.maxCalls }), seg(m.maxCalls, limits, v => save({ commentary: { maxCalls: v } }))),
  ], `${t('이번 실행에서 해설에 쓴 비용: {cost}', { cost: state.info.spentUsd ? `$${state.info.spentUsd.toFixed(4)}` : '$0' })}${state.info.tokens ? ` · ${t('API 토큰 {n}개', { n: state.info.tokens.toLocaleString() })}` : ''} · ${t('Claude Code(하이쿠) 기준 장면 하나에 약 $0.005예요. Ollama는 무료예요.')}`);
}

// Which key moments the engine marks. Each group can be switched on or off as a whole.
function moments(c) {
  const on = state.s.moments ?? {};
  if (!state.groups) { c.append(el('div', 'list-empty', t('장면 목록을 불러오지 못했어요.'))); return; }
  c.append(el('p', 'note', t('끈 장면은 중계, 해설, 알림, 위젯에 나오지 않아요. 이미 지나간 장면도 목록에서 빠져요.')));
  for (const g of state.groups) {
    const count = g.moments.filter(m => on[m.type] !== false).length;
    const all = count === g.moments.length;
    const box = el('div', 'sgroup');
    const hd = el('div', 'mhead');
    hd.append(el('span', 'label', g.label), el('span', 'faint', t('{on}/{total} 켜짐', { on: count, total: g.moments.length })));
    const b = el('button', 'btn ghost', t(all ? '모두 끄기' : '모두 켜기')); b.type = 'button';
    b.onclick = () => save({ moments: Object.fromEntries(g.moments.map(m => [m.type, !all])) }, t(all ? '{group} 장면을 모두 껐어요' : '{group} 장면을 모두 켰어요', { group: g.label }));
    hd.append(b);
    const list = el('div', 'sbox');
    for (const m of g.moments) list.append(row(m.label, m.description, toggle(on[m.type] !== false, v => save({ moments: { [m.type]: v } }, null))));
    box.append(hd, list);
    c.append(box);
  }
}

function notifications(c) {
  const n = state.s.notifications;
  const sub = (key, name, desc) => row(name, desc, toggle(n[key], v => save({ notifications: { [key]: v } }, null), !n.enabled));
  group(c, '', [row(t('알림 받기'), t(api.desktop ? '창을 닫아도 트레이에서 지켜보다가 알려 드려요.' : '브라우저 모드에서는 알림이 오지 않아요. 데스크톱 앱을 쓰세요.'), toggle(n.enabled, v => save({ notifications: { enabled: v } }, null), !api.desktop))]);
  group(c, t('이럴 때 알려 주세요'), [
    sub('decision', t('임의 기준 선택'), t('에이전트가 요청에 없던 기준을 혼자 정했을 때')),
    sub('trick', t('꼼수 의심 장면'), t('실패 직후 테스트 수정, 테스트 건너뛰기, 실패 덮기, 되돌리기 어려운 명령처럼 확인이 필요한 장면이 나올 때')),
    sub('stuck', t('연속 실패'), t('테스트가 3번 연속으로 실패했을 때')),
    sub('quiet', t('오랜 정적'), t('몇 분째 아무 신호가 없을 때')),
    sub('final', t('경기 종료'), t('작업이 끝났을 때, 평점과 확인할 것 하나와 함께')),
  ]);
  group(c, '', [sub('sound', t('소리'), t('알림이 올 때 소리를 내요'))]);
}

function widget(c) {
  const w = state.s.widget;
  const disabled = !api.desktop;
  group(c, '', [
    row(t('위젯 보이기'), t(disabled ? '데스크톱 앱에서만 쓸 수 있어요.' : '작은 전광판을 화면에 띄워요. 에이전트를 돌리는 창 옆에 두면 좋아요.'), toggle(w.visible, v => save({ widget: { visible: v } }, null), disabled)),
    row(t('항상 맨 위에'), t('다른 창에 가려지지 않게 해요.'), toggle(w.alwaysOnTop, v => save({ widget: { alwaysOnTop: v } }, null), disabled)),
    row(t('따라갈 경기'), t('자동이면 지금 뛰는 경기를 알아서 따라가요.'), seg(w.follow, [['auto', t('자동')], ['manual', t('직접 고르기')]], v => save({ widget: { follow: v } }, null))),
    (() => { const wrap = el('div'); wrap.style.cssText = 'display:flex;gap:10px;align-items:center'; const r = el('input', 'range'); r.type = 'range'; r.min = 40; r.max = 100; r.step = 5; r.value = Math.round(w.opacity * 100); r.disabled = disabled; const v = el('span', 'mono', `${r.value}%`); r.oninput = () => { v.textContent = `${r.value}%`; }; r.onchange = () => save({ widget: { opacity: Number(r.value) / 100 } }, null); wrap.append(r, v); return row(t('투명도'), '', wrap); })(),
  ]);
  if (api.desktop) { const b = el('button', 'btn', t('위젯 위치 초기화')); b.type = 'button'; b.onclick = () => save({ widget: { bounds: null, visible: true } }, '위젯을 오른쪽 아래로 옮겼어요'); c.append(b); b.style.justifySelf = 'start'; }
}

function privacy(c) {
  const m = state.s.commentary;
  group(c, t('이 컴퓨터 밖으로 나가는 것'), [
    row(t('AI 해설에 에이전트의 말 포함'), t('끄면 해설 AI에게 에이전트가 한 말과 마지막 보고를 보내지 않아요. 자막과 숫자만 보내요.'), toggle(m.includeSayings, v => save({ commentary: { includeSayings: v } }))),
  ], t('세션 기록은 이 컴퓨터 밖으로 나가지 않아요. AI 해설을 켰을 때만, 결정적 장면의 요약(최근 자막 몇 줄, 과제 앞부분, 숫자)이 고른 프로바이더로 전달돼요. Ollama를 고르면 이 컴퓨터 안에서만 처리돼요. 앱에 저장한 API 키는 운영체제 키체인으로 암호화해서 보관하고, 화면에는 끝 네 글자만 보여 줘요. 데스크톱 앱은 웹서버를 열지 않고, 화면과 엔진이 앱 안에서 직접 통신해요.'));
}

function about(c) {
  const a = state.appInfo;
  group(c, '', [
    row('coding live', `${t('버전 {v}', { v: a.version ?? '-' })}${a.browser ? ` · ${t('브라우저 모드')}` : a.platform ? ` · ${a.platform}` : ''}`),
    row(t('새 버전'), t('GitHub 릴리스 페이지에서 받을 수 있어요.'), (() => { const b = el('button', 'btn'); b.type = 'button'; b.append(icon('external'), document.createTextNode(t('릴리스 열기'))); b.onclick = () => api.openReleases(); return b; })()),
    row(t('데모 경기'), t('녹화된 경기 4개를 지금 뛰는 것처럼 재생해요. 크레딧이 들지 않아요.'), (() => { const b = el('button', 'btn'); b.type = 'button'; b.append(icon('play'), document.createTextNode(t('재생'))); b.onclick = async () => { await api.startDemo(); toast(t('데모 경기 4개를 시작했어요.')); close(); }; return b; })()),
  ]);
  group(c, t('단축키'), [row(t('경기 찾기'), '', el('span', 'kbd', /Mac/.test(navigator.platform) ? '⌘K' : 'Ctrl K')), row(t('설정'), '', el('span', 'kbd', /Mac/.test(navigator.platform) ? '⌘,' : 'Ctrl ,')), row(t('닫기'), '', el('span', 'kbd', 'Esc'))]);
}
