// Widget: a small always-on-top board that follows whichever project match is playing right now.

import { $, el, clock, money, rich, store, momentLabel, avatar, icon, applyTheme, orderPlayers, playerLabel, subClass, explainCard, everyone, doneBadge } from './shared.js';
import { t, applyLanguage } from './i18n.js';
import { api } from './transport.js';

const AUTO = '__auto__';
let projects = [], follow = 'auto', teach = 'full', explainOn = true;
let shown = null; // { key, sent } — the player whose explanation is open beside the widget
let choice = store.get('cl-widget-project') || AUTO;
let watching = null; // { key, stop, snap }
const since = s => (s.startedAt == null ? 0 : ((s.finished ? s.lastAt : Date.now()) - s.startedAt) / 1000);

// Prefer a live match; keep the current one while it stays live so the widget doesn't flap.
function pickAuto() {
  const live = projects.filter(p => p.live);
  if (watching && live.some(p => p.key === watching.key)) return watching.key;
  return (live[0] ?? projects[0])?.key ?? null;
}
const target = () => (follow === 'manual' && choice !== AUTO ? choice : choice === AUTO ? pickAuto() : choice);

function watch(key) {
  if (watching?.key === key) return;
  watching?.stop?.();
  watching = key ? { key, stop: null, snap: null } : null;
  if (key) watching.stop = api.watchProject(key, snap => { if (watching?.key === key) { watching.snap = snap; render(); } });
  render();
}

async function refresh() {
  try { projects = await api.projects(); } catch { return; }
  const pick = $('wpick');
  pick.replaceChildren(new Option(t('지금 뛰는 경기 자동으로 따라가기'), AUTO), ...projects.slice(0, 25).map(p => new Option(`${p.live ? '● ' : ''}${p.name} · ${t('선수 {n}명', { n: p.players.length })}`, p.key)));
  if (choice !== AUTO && !projects.some(p => p.key === choice)) choice = AUTO;
  pick.value = choice;
  watch(target());
}

function render() {
  const s = watching?.snap;
  const board = $('wboard'), list = $('wplayers'), mo = $('wmoment');
  if (!s) {
    $('wav').replaceChildren(); $('who').textContent = t(projects.length ? '경기를 불러오는 중…' : '아직 찾은 경기가 없어요'); $('sub').textContent = ''; $('wstate').replaceChildren();
    board.replaceChildren(); list.replaceChildren(); mo.hidden = true;
    return;
  }
  const av = el('div', 'avatars'); s.players.slice(0, 3).forEach(p => av.append(avatar(p.agent)));
  $('wav').replaceChildren(av);
  $('who').textContent = s.name;
  $('sub').textContent = `${t('선수 {n}명', { n: s.players.length })} · ${s.players.map(p => p.player).join(', ')}`;
  const chip = el('span', `chip ${s.state === 'live' ? 'live' : s.state === 'quiet' ? 'warn' : ''}`);
  if (s.state === 'live' || s.state === 'timeout') chip.append(el('span', 'dot'));
  const word = { live: 'LIVE', timeout: '생각 중', quiet: '정적', final: '종료', waiting: '입장 중' }[s.state];
  chip.append(document.createTextNode(word ? t(word) : s.state));
  $('wstate').replaceChildren(chip);
  board.replaceChildren();
  const cell = (k, v, cls = '', id) => { const d = el('div'); d.append(el('span', null, t(k))); const b = el('b', cls, v); if (id) b.id = id; d.append(b); board.append(d); };
  cell('시간', clock(since(s)), '', 'wclock');
  cell('비용', Number.isFinite(s.costUsd) ? money(s.costUsd) : '—');
  cell('테스트', s.tests ? `${s.tests.pass}/${s.tests.pass + s.tests.fail}` : '—', s.tests ? (s.tests.fail ? 'bad' : 'good') : '');
  cell('실패', String(s.fails), s.fails ? 'bad' : '');
  list.replaceChildren();
  for (const p of orderPlayers(s.players).slice(0, 5)) {
    const can = explainOn && !!p.explain;
    const r = el('div', `wp${subClass(s.players, p)}${can ? ' can' : ''}${shown?.key === p.key ? ' open' : ''}${p.last && !p.now && (p.last.kind === 'test' || p.last.kind === 'try') ? (p.last.failed ? ' fail' : ' pass') : ''}`);
    const a = avatar(p.agent); a.classList.add('sm');
    const name = el('b', null, playerLabel(p)); name.title = playerLabel(p);
    const badge = doneBadge(p);
    if (badge) { const n = el('span', 'wname'); n.append(name, badge); r.append(a, n); } else r.append(a, name);
    if (p.now) r.append(el('span', 'spinner'));
    r.append(rich(p.finished ? (p.rating ? t('경기 종료 · {score}점', { score: p.rating.score }) : t('경기 종료')) : actionOf(p)));
    if (can) {
      r.tabIndex = 0; r.setAttribute('role', 'button'); r.title = t('눌러서 이 동작 설명 보기');
      r.onclick = () => openExplain(p, r);
      r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openExplain(p, r); } };
    }
    list.append(r);
  }
  if (s.left?.length) list.append(el('div', 'w-left', t('나간 선수 {n}명', { n: s.left.length })));
  refreshExplain(s);
  const m = s.moments.at(-1);
  mo.hidden = !m;
  if (m) {
    const p = everyone(s).find(x => x.key === m.player);
    const c = m.comment?.caster ? m.comment : m.auto;
    const ask = teach !== 'off' && m.lesson ? (m.comment?.ask || m.lesson.ask) : '';
    mo.className = `w-moment ${m.type}`;
    mo.replaceChildren(el('span', 'hd', `${momentLabel(m.type)} · ${p?.player ?? ''}`), el('p', null, m.type === 'decision' ? t('선수 본인 주장: “{text}”', { text: m.note }) : `${c.caster} ${c.line}`));
    if (ask) {
      const q = el('button', 'w-ask'); q.type = 'button'; q.title = t('눌러서 복사');
      q.append(el('b', null, t('물어보기')), rich(`“${ask}”`));
      q.onclick = async () => { const ok = await api.copy(ask).catch(() => false); q.firstChild.textContent = t(ok === false ? '복사 실패' : '복사했어요'); setTimeout(() => { q.firstChild.textContent = t('물어보기'); }, 1500); };
      mo.append(q);
    }
  }
}

// ---- explanation of a player's latest action: its own window in the desktop app, a popover in browser mode ----
const actionOf = p => p.now ?? p.last?.text ?? t('시작을 기다리는 중');
const explainData = p => ({ key: p.key, agent: p.agent, player: playerLabel(p), action: actionOf(p), explain: p.explain });
function openExplain(p, row) {
  if (shown?.key === p.key && !api.desktop) { closeExplain(); return; }
  const data = explainData(p);
  shown = { key: p.key, sent: JSON.stringify(data) };
  if (api.desktop) api.showExplain(data);
  else showPopover(data, row);
  document.querySelectorAll('.wp').forEach(x => x.classList.toggle('open', x === row));
}
function closeExplain() {
  shown = null;
  if (api.desktop) api.hideExplain();
  else $('wexplain')?.remove();
  document.querySelectorAll('.wp.open').forEach(x => x.classList.remove('open'));
}
// Keep an open explanation in step with the player's latest action; close it when it no longer applies.
function refreshExplain(s) {
  if (!shown) return;
  const p = s.players.find(x => x.key === shown.key);
  if (!explainOn || !p?.explain) { closeExplain(); return; }
  const data = explainData(p), sent = JSON.stringify(data);
  if (sent === shown.sent) return;
  shown.sent = sent;
  if (api.desktop) api.showExplain({ ...data, update: true });
  else showPopover(data, [...document.querySelectorAll('.wp')].find(x => x.classList.contains('open')));
}
// Browser mode: beside the widget on the right, or the left if there is no room, else over the widget under the row.
function showPopover(data, row) {
  let pop = $('wexplain');
  if (!pop) { pop = el('div', 'ex-pop popover'); pop.id = 'wexplain'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', t('동작 설명')); document.body.append(pop); }
  pop.replaceChildren(explainCard(data, closeExplain));
  const W = 320, gap = 8, w = $('w').getBoundingClientRect(), r = row?.getBoundingClientRect() ?? w;
  const h = Math.min(pop.offsetHeight, innerHeight - 2 * gap);
  const left = innerWidth - w.right >= W + 2 * gap ? w.right + gap : w.left >= W + 2 * gap ? w.left - W - gap : Math.max(gap, Math.min(r.left + 12, innerWidth - W - gap));
  const beside = left >= w.right || left + W <= w.left;
  const top = beside ? Math.max(gap, Math.min(w.top, innerHeight - h - gap)) : Math.max(gap, Math.min(r.bottom + 4, innerHeight - h - gap));
  pop.style.cssText = `left:${left}px;top:${top}px;width:${W}px;max-height:${innerHeight - 2 * gap}px`;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && shown) closeExplain(); });

document.body.classList.toggle('web', !api.desktop); // browser mode: leave room beside the widget for the popover
$('wfull').append(icon('external', 14));
$('wclose').append(icon('x', 14));
$('wpick').onchange = e => { choice = e.target.value; store.set('cl-widget-project', choice); watch(target()); };
$('wfull').onclick = () => api.openFull(watching?.key ?? null);
$('wclose').onclick = () => api.toggleWidget();
setInterval(() => { const s = watching?.snap, c = $('wclock'); if (s && c && !s.finished) c.textContent = clock(since(s)); }, 1000);
let shownLang = 'ko';
const applySettings = s => {
  const lang = applyLanguage(s, api.locale);
  if (lang !== shownLang) { shownLang = lang; if (projects.length) refresh(); if (shown && !api.desktop) closeExplain(); }
  applyTheme(s.general?.theme); follow = s.widget?.follow ?? 'auto'; teach = s.commentary?.teach ?? 'full'; explainOn = s.commentary?.explain !== false; };
api.onSettings(s => { applySettings(s); render(); });

(async () => {
  try { applySettings(await api.getSettings()); } catch { applySettings({ general: {}, widget: {} }); }
  $('who').textContent = t('경기를 찾는 중…');
  await refresh();
  setInterval(refresh, 4000);
})();
