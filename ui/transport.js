// How the UI reaches the broadcast service: the desktop app's preload bridge (no network at all),
// or, in browser mode, the local HTTP server that served this page.

import { t } from './i18n.js';

const ipc = globalThis.codingLive;
const RELEASES = 'https://github.com/cronoboris/coding-live/releases';

const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-coding-live': '1' }, body: JSON.stringify(body ?? {}) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });

// Browser mode has no app shell to broadcast settings: tell this page directly and other tabs (the widget) over a channel.
const settingsListeners = new Set();
const settingsChannel = typeof BroadcastChannel === 'function' && !ipc ? new BroadcastChannel('coding-live-settings') : null;
if (settingsChannel) settingsChannel.onmessage = e => settingsListeners.forEach(fn => fn(e.data));
const settingsChanged = s => { settingsListeners.forEach(fn => fn(s)); settingsChannel?.postMessage(s); return s; };

const http = {
  desktop: false,
  locale: navigator.language,
  info: () => get('/api/info'),
  sessions: () => get('/api/sessions').then(j => j.sessions ?? []),
  projects: () => get('/api/projects').then(j => j.projects ?? []),
  watchProject(key, onSnap, onState) {
    const es = new EventSource(`/api/project/${key}/stream`);
    es.onmessage = e => onSnap(JSON.parse(e.data));
    es.addEventListener('gone', () => { es.close(); onState?.('gone'); });
    es.onerror = () => onState?.(es.readyState === EventSource.CLOSED ? 'gone' : 'reconnecting');
    return () => es.close();
  },
  setMicProject: (key, on) => post(`/api/project/${key}/mic`, { on }).catch(() => null),
  agents: () => get('/api/agents'),
  getSettings: () => get('/api/settings'),
  setSettings: patch => post('/api/settings', patch).then(settingsChanged),
  momentGroups: () => get('/api/moment-groups'),
  appInfo: async () => ({ version: (await get('/api/info')).version, browser: true }),
  watch(key, onSnap, onState) {
    const es = new EventSource(`/api/match/${key}/stream`);
    es.onmessage = e => onSnap(JSON.parse(e.data));
    es.addEventListener('gone', () => { es.close(); onState?.('gone'); });
    es.onerror = () => onState?.(es.readyState === EventSource.CLOSED ? 'gone' : 'reconnecting');
    return () => es.close();
  },
  setMic: (key, on) => post(`/api/match/${key}/mic`, { on }).catch(() => null),
  review: key => post(`/api/match/${key}/review`).catch(() => null),
  startDemo: () => post('/api/demo').catch(() => null),
  micStatus: () => get('/api/mic'),
  testMic: provider => post('/api/mic/test', { provider: provider ?? null }),
  setSecret: async () => ({ ok: false, error: t('브라우저 모드에서는 키를 저장할 수 없어요. 환경 변수로 넣어 주세요.') }),
  copy: text => navigator.clipboard.writeText(text).then(() => true, () => false),
  openUrl: url => window.open(url, '_blank', 'noopener'),
  openReleases: () => window.open(RELEASES, '_blank', 'noopener'),
  pickFolder: async () => null,
  openFull: () => {}, toggleWidget: () => {}, onOpenMatch: () => {}, onSettings: fn => settingsListeners.add(fn),
};

const desktop = ipc && {
  desktop: true,
  locale: ipc.locale || navigator.language, // the app's locale (app.getLocale())
  info: () => ipc.info(),
  sessions: () => ipc.sessions(),
  projects: () => ipc.projects(),
  watchProject: (key, onSnap, onState) => ipc.watchProject(key, onSnap, () => onState?.('gone')),
  setMicProject: (key, on) => ipc.setMicProject(key, on).then(r => (r?.error ? null : r)),
  agents: () => ipc.agents(),
  getSettings: () => ipc.getSettings(),
  setSettings: patch => ipc.setSettings(patch),
  momentGroups: () => ipc.momentGroups(),
  appInfo: () => ipc.appInfo(),
  watch: (key, onSnap, onState) => ipc.watch(key, onSnap, () => onState?.('gone')),
  setMic: (key, on) => ipc.setMic(key, on).then(r => (r?.error ? null : r)),
  review: key => ipc.review(key).then(r => (r?.error ? null : r)),
  startDemo: () => ipc.startDemo(),
  micStatus: () => ipc.micStatus(),
  testMic: provider => ipc.testMic(provider),
  setSecret: (provider, key) => ipc.setSecret(provider, key),
  copy: text => ipc.copy(text),
  openUrl: url => ipc.openUrl(url),
  openReleases: () => ipc.openReleases(),
  pickFolder: () => ipc.pickFolder(),
  openFull: key => ipc.openFull(key),
  toggleWidget: () => ipc.toggleWidget(),
  onOpenMatch: fn => ipc.onOpenMatch(fn),
  onSettings: fn => ipc.onSettings(fn),
  // The widget's explanation popup is its own small window in the desktop app.
  showExplain: data => ipc.showExplain(data),
  hideExplain: () => ipc.hideExplain(),
  onExplain: fn => ipc.onExplain(fn),
  fitExplain: height => ipc.fitExplain(height),
};

export const api = desktop || http;
