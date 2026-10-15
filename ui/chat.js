// The "지시" tab: talk to a coding agent (Claude Code, Codex, omp) from inside the app. The agent works in the open
// project's folder, so what it does shows up on the file map and in the feed like any other match.
// The chat is built once and kept across snapshot re-renders, so the typed text and the scroll position stay.

import { el, money, ago, avatar, store } from './shared.js';
import { t, language } from './i18n.js';
import { api } from './transport.js';

const RESUMABLE = ['claude-code', 'codex', 'omp'];
const OUTCOME = { once: '이번만 허락했어요', session: '계속 허락했어요', deny: '거절했어요' };

// Every director call either resolves to its result or throws with the server's reason.
const call = async promise => { const r = await promise; if (r?.error) throw new Error(r.error); return r; };

let ui = null; // the tab's DOM, built once
let st = null; // the chat of the open project

const fresh = key => ({ key, loaded: false, failed: null, all: [], agents: [], players: [], pick: store.get('cl-chat-agent') || '', resume: '', sig: null, lang: null, ...idle() });
const idle = () => ({ id: null, agent: null, busy: false, ended: false, sending: false, costUsd: null, tokens: null, log: [], reply: null, cards: new Map(), unwatch: null });

// Shows the chat for project `key` in the side panel `host`; `snap` (may be null) gives the players that can be continued.
export function showChat(host, key, snap) {
  if (!ui) build(host);
  const wasHidden = ui.root.hidden;
  ui.root.hidden = false;
  if (st?.key !== key) { leaveChat(); ui.root.hidden = false; st = fresh(key); if (snap) st.players = snap.players; load(); return; }
  if (snap) st.players = snap.players;
  if (st.lang !== language()) paint();
  else if (!st.id && st.loaded && sig() !== st.sig) bar();
  if (wasHidden) ui.log.scrollTop = ui.saved ?? ui.log.scrollHeight;
}
export function hideChat() {
  if (!ui || ui.root.hidden) return;
  ui.saved = ui.log.scrollTop;
  ui.root.hidden = true;
}
// The match closed or changed: stop listening and forget the chat (the agent keeps running on the server).
export function leaveChat() {
  st?.unwatch?.();
  st = null;
  flag();
  if (!ui) return;
  ui.ta.value = ''; ui.saved = null;
  hideChat();
}

function build(host) {
  ui = { root: el('section', 'chat'), bar: el('div', 'chat-bar'), log: el('div', 'chat-log'), ta: el('textarea', 'chat-input'), send: el('button', 'btn primary'), stop: el('button', 'btn warn'), hint: el('div', 'chat-hint'), saved: null };
  ui.send.type = 'button'; ui.stop.type = 'button';
  ui.ta.rows = 1;
  ui.ta.oninput = () => { autosize(); sync(); };
  ui.ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); } };
  ui.send.onclick = send;
  ui.stop.onclick = stop;
  const row = el('div', 'chat-row'); row.append(ui.ta, ui.stop, ui.send);
  const box = el('div', 'chat-compose'); box.append(row, ui.hint);
  ui.root.append(ui.bar, ui.log, box);
  host.append(ui.root);
}
const autosize = () => { ui.ta.style.height = 'auto'; ui.ta.style.height = `${Math.min(ui.ta.scrollHeight, 160)}px`; };
const label = id => st.all.find(a => a.id === id)?.label ?? id ?? '';
const tokens = n => (n < 1000 ? String(n) : n < 10_000 ? `${(n / 1000).toFixed(1)}k` : n < 1_000_000 ? `${Math.round(n / 1000)}k` : `${(n / 1_000_000).toFixed(1)}M`);

// Ended main sessions of this project whose agent can be continued here.
function resumable() {
  const installed = new Set(st.agents.map(a => a.id));
  return st.players.filter(p => !p.parent && p.role !== 'subagent' && p.live === false && p.sessionId && RESUMABLE.includes(p.agent) && installed.has(p.agent));
}
const sig = () => resumable().map(p => `${p.key}:${p.player}`).join('\n');

async function load() {
  const c = st;
  c.loaded = false; c.failed = null;
  paint();
  try {
    const [a, d] = await Promise.all([call(api.director.agents()), call(api.director.find(c.key))]);
    if (st !== c) return;
    c.all = a.agents; c.agents = a.agents.filter(x => x.installed);
    c.loaded = true;
    if (d.id) watch(d.id);
  } catch (e) { if (st !== c) return; c.loaded = true; c.failed = e.message; }
  paint();
}

function watch(id) {
  const c = st;
  c.unwatch?.();
  c.id = id;
  c.live = c.sawState = false;
  c.unwatch = api.director.watch(id, ev => receive(c, ev));
}
function receive(c, ev) {
  if (st !== c) return;
  // The server sends the state, the history, then the state again: from the second state on, events are new.
  if (ev.type === 'state') { c.live = c.sawState; c.sawState = true; }
  if (ev.type === 'state') { c.agent = ev.agent ?? c.agent; c.busy = !!ev.busy; c.costUsd = ev.costUsd ?? null; c.tokens = ev.tokens ?? null; bar(); sync(); return; }
  if (ev.type === 'turn_end') c.busy = false;
  if (ev.type === 'exit') { c.ended = true; c.busy = false; }
  c.log.push(ev);
  draw(ev);
  if (ev.type === 'turn_end' || ev.type === 'exit') bar();
  sync();
  flag();
  if (ev.type === 'approval' && c.live) notify(ev);
}

// A waiting permission request marks the 지시 tab, so it is not missed while another tab is open.
function flag() {
  const pending = !!st && !st.ended && [...st.cards.values()].some(card => !card.classList.contains('done'));
  const tab = document.querySelector('.side [data-t="chat"]');
  tab?.classList.toggle('ask', pending);
  if (tab) tab.title = pending ? t('허락이 필요해요') : '';
}
// And a system notification when the app window is not in front.
function notify(ev) {
  if (document.hasFocus() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const n = new Notification(t('허락이 필요해요'), { body: `${label(st.agent)}: ${ev.summary ?? ev.tool ?? ''}`, silent: false });
  n.onclick = () => { window.focus(); document.querySelector('.side [data-t="chat"]')?.click(); };
}

// ---- drawing ---------------------------------------------------------------------------------
function paint() {
  st.lang = language();
  bar(); paintLog(); sync();
}
function paintLog() {
  ui.log.replaceChildren();
  st.reply = null; st.cards.clear();
  if (!st.loaded) { const w = el('div', 'chat-empty'); const s = el('span', 'faint'); s.append(el('span', 'spinner'), document.createTextNode(t('지시 기능을 불러오는 중…'))); w.append(s); ui.log.append(w); return; }
  if (st.failed) { ui.log.append(empty([t('지시 기능을 불러오지 못했어요.'), st.failed], t('다시 시도'), load)); return; }
  if (!st.id && !st.agents.length) { ui.log.append(empty([t('Claude Code, Codex, omp 중 하나가 이 컴퓨터에 설치돼 있어야 지시할 수 있어요.'), t('설치한 뒤 다시 확인을 눌러 주세요.')], t('다시 확인'), load)); return; }
  if (!st.id) { ui.log.append(empty([t('여기서 에이전트에게 직접 일을 시킬 수 있어요.'), t('여기서 시킨 일도 다른 경기처럼 파일 지도와 중계에 나와요.')])); return; }
  for (const ev of st.log) draw(ev);
  ui.log.scrollTop = ui.log.scrollHeight;
}
function empty(lines, action, onClick) {
  const w = el('div', 'chat-empty');
  lines.forEach((l, i) => w.append(el('p', i ? 'faint' : null, l)));
  if (action) { const b = el('button', 'btn', action); b.type = 'button'; b.onclick = onClick; w.append(b); }
  return w;
}
const add = node => { ui.log.querySelector('.chat-empty')?.remove(); ui.log.append(node); };

function draw(ev) {
  const stick = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 80;
  switch (ev.type) {
    case 'user': st.reply = null; add(el('div', 'msg user', ev.text)); break;
    case 'text': if (!st.reply) { st.reply = el('div', 'msg agent'); add(st.reply); } st.reply.append(ev.delta); break;
    case 'message_end': case 'turn_end': st.reply = null; break;
    case 'tool': {
      st.reply = null;
      const r = el('div', 'chat-tool'); r.append(el('b', null, ev.name), document.createTextNode(ev.summary ? ` ${ev.summary}` : ''));
      r.title = `${ev.name}${ev.summary ? ` ${ev.summary}` : ''}`;
      add(r); break;
    }
    case 'approval': st.reply = null; add(approval(ev)); break;
    case 'approval_resolved': resolved(ev.requestId, ev.decision); break;
    case 'error': st.reply = null; add(el('div', 'chat-err', ev.message)); break;
    case 'exit': {
      st.reply = null;
      const n = el('div', 'chat-note'); n.append(el('span', null, t('에이전트가 끝났어요.')));
      const b = el('button', 'btn', t('새로 시작하기')); b.type = 'button'; b.onclick = newChat; n.append(b);
      add(n); break;
    }
  }
  if (stick) ui.log.scrollTop = ui.log.scrollHeight;
}
function approval(ev) {
  const card = el('div', 'chat-approval');
  const hd = el('div', 'hd'); hd.append(el('b', null, t('허락이 필요해요')));
  if (ev.tool) hd.append(el('span', 'chip', ev.tool));
  card.append(hd, el('p', null, ev.summary));
  if (ev.detail) { const d = el('details'); d.append(el('summary', null, t('자세히 보기')), el('pre', null, typeof ev.detail === 'string' ? ev.detail : JSON.stringify(ev.detail, null, 2))); card.append(d); }
  const acts = el('div', 'acts');
  const choices = [['once', '이번만 허락', 'primary'], ...(ev.canAlways ? [['session', '계속 허락', '']] : []), ['deny', '거절', 'ghost']];
  for (const [decision, text, cls] of choices) {
    const b = el('button', `btn ${cls}`, t(text)); b.type = 'button';
    b.onclick = () => answer(ev.requestId, decision, acts);
    acts.append(b);
  }
  card.append(acts);
  st.cards.set(ev.requestId, card);
  return card;
}
function resolved(requestId, decision) {
  const card = st.cards.get(requestId);
  if (!card) return;
  card.classList.add('done');
  card.querySelector('.acts')?.replaceWith(el('div', `outcome ${decision}`, t(OUTCOME[decision] ?? '처리했어요')));
  flag();
}
const fail = (key, e) => { const ev = { type: 'error', message: t(key, { message: e.message }) }; st.log.push(ev); draw(ev); };

// The top bar: the agent and what this chat cost, or the pickers before a chat starts.
function bar() {
  const b = ui.bar;
  b.replaceChildren();
  b.hidden = !st.loaded || !!st.failed || (!st.id && !st.agents.length);
  if (b.hidden) return;
  if (st.id) {
    const who = el('div', 'who'); who.append(avatar(st.agent), el('b', null, label(st.agent)));
    const chip = st.ended ? el('span', 'chip', t('끝남')) : st.busy ? el('span', 'chip accent') : el('span', 'chip good', t('지시를 기다려요'));
    if (st.busy && !st.ended) chip.append(el('span', 'spinner'), document.createTextNode(t('일하는 중')));
    who.append(chip);
    b.append(who);
    const usage = st.costUsd > 0 ? money(st.costUsd) : Number.isFinite(st.tokens) && st.tokens > 0 ? t('토큰 {n}', { n: tokens(st.tokens) }) : '';
    if (usage) { const u = el('span', 'chip mono', usage); u.title = t('이 대화에 쓴 비용'); b.append(u); }
    const nb = el('button', 'btn ghost', t('새 대화')); nb.type = 'button'; nb.onclick = newChat; b.append(nb);
    return;
  }
  const res = resumable();
  st.sig = sig();
  if (!res.some(p => p.key === st.resume)) st.resume = '';
  if (!st.agents.some(a => a.id === st.pick)) st.pick = st.agents[0].id;
  const chosen = res.find(p => p.key === st.resume);
  const ag = el('select', 'chat-select'); ag.setAttribute('aria-label', t('에이전트 고르기'));
  ag.append(...st.agents.map(a => new Option(a.label, a.id)));
  ag.value = chosen ? chosen.agent : st.pick; ag.disabled = !!chosen;
  ag.onchange = () => { st.pick = ag.value; store.set('cl-chat-agent', st.pick); };
  b.append(ag);
  if (res.length) {
    const how = el('select', 'chat-select'); how.setAttribute('aria-label', t('대화 고르기'));
    how.append(new Option(t('새 대화'), ''), ...res.map(p => new Option(t('이어서: {player}', { player: `${p.player} · ${ago(p.lastAt ?? p.updatedAt)}` }), p.key)));
    how.value = st.resume;
    how.onchange = () => { st.resume = how.value; bar(); };
    b.append(how);
  }
}
function sync() {
  const ready = st.loaded && !st.failed && !st.ended && !!(st.id || st.agents.length);
  ui.ta.disabled = !ready;
  ui.ta.placeholder = t(st.id ? '다음 지시를 적어 주세요' : '에이전트에게 시킬 일을 적어 주세요');
  ui.send.textContent = t('보내기');
  ui.send.disabled = !ready || st.busy || st.sending || !ui.ta.value.trim();
  ui.stop.textContent = t('멈추기');
  ui.stop.hidden = !(st.id && st.busy && !st.ended);
  ui.hint.textContent = t('Enter로 보내고, Shift+Enter로 줄을 바꿔요.');
  ui.root.setAttribute('aria-label', t('에이전트에게 지시'));
}

// ---- actions ---------------------------------------------------------------------------------
async function send() {
  const text = ui.ta.value.trim();
  if (ui.send.disabled || !text) return;
  const c = st;
  c.sending = true; sync();
  try {
    if (!c.id) {
      const p = resumable().find(x => x.key === c.resume);
      const agent = p ? p.agent : c.pick;
      let r;
      try { r = await call(api.director.start({ project: c.key, agent, ...(p ? { resume: p.sessionId } : {}) })); }
      catch (e) { if (st === c) fail('시작하지 못했어요: {message}', e); return; }
      if (st !== c) return;
      c.agent = agent;
      watch(r.id);
      paint();
    }
    await call(api.director.send(c.id, text));
    if (st === c) { ui.ta.value = ''; autosize(); }
  } catch (e) { if (st === c) fail('보내지 못했어요: {message}', e); }
  finally { c.sending = false; if (st === c) sync(); }
}
async function answer(requestId, decision, acts) {
  const c = st;
  acts.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try { await call(api.director.approve(c.id, requestId, decision)); }
  catch (e) { if (st !== c) return; acts.querySelectorAll('button').forEach(b => { b.disabled = false; }); fail('응답하지 못했어요: {message}', e); }
}
async function stop() {
  const c = st;
  ui.stop.disabled = true;
  try { await call(api.director.stop(c.id)); }
  catch (e) { if (st === c) fail('멈추지 못했어요: {message}', e); }
  finally { ui.stop.disabled = false; }
}
async function newChat() {
  const c = st;
  if (c.busy && !confirm(t('지금 하던 일을 멈추고 대화를 닫을까요?'))) return;
  try { await call(api.director.close(c.id)); }
  catch (e) { if (!c.ended) { if (st === c) fail('대화를 닫지 못했어요: {message}', e); return; } }
  if (st !== c) return;
  c.unwatch?.();
  Object.assign(c, idle(), { resume: '' });
  paint();
  flag();
}
