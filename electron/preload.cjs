// The only bridge between the UI and the app: a fixed set of calls, no Node access in the page.
const { contextBridge, ipcRenderer } = require('electron');

let seq = 0;
contextBridge.exposeInMainWorld('codingLive', {
  locale: (process.argv.find(a => a.startsWith('--cl-locale=')) ?? '').slice('--cl-locale='.length), // app.getLocale(), for language 'system'
  info: () => ipcRenderer.invoke('cl:info'),
  sessions: () => ipcRenderer.invoke('cl:sessions'),
  projects: () => ipcRenderer.invoke('cl:projects'),
  watchProject(key, onSnap, onGone) {
    const id = `p${Date.now().toString(36)}-${++seq}`;
    const handler = (_e, msg) => { if (msg.id !== id) return; if (msg.gone) onGone?.(); else onSnap(msg.snap); };
    ipcRenderer.on('cl:snap', handler);
    ipcRenderer.invoke('cl:watch-project', id, String(key));
    return () => { ipcRenderer.removeListener('cl:snap', handler); ipcRenderer.invoke('cl:unwatch', id); };
  },
  setMicProject: (key, on) => ipcRenderer.invoke('cl:mic-project', String(key), !!on),
  agents: () => ipcRenderer.invoke('cl:agents'),
  getSettings: () => ipcRenderer.invoke('cl:settings:get'),
  setSettings: patch => ipcRenderer.invoke('cl:settings:set', patch),
  appInfo: () => ipcRenderer.invoke('cl:app-info'),
  watch(key, onSnap, onGone) {
    const id = `${Date.now().toString(36)}-${++seq}`;
    const handler = (_e, msg) => { if (msg.id !== id) return; if (msg.gone) onGone?.(); else onSnap(msg.snap); };
    ipcRenderer.on('cl:snap', handler);
    ipcRenderer.invoke('cl:watch', id, String(key));
    return () => { ipcRenderer.removeListener('cl:snap', handler); ipcRenderer.invoke('cl:unwatch', id); };
  },
  setMic: (key, on) => ipcRenderer.invoke('cl:mic', String(key), !!on),
  review: key => ipcRenderer.invoke('cl:review', String(key)),
  explainFile: (key, path) => ipcRenderer.invoke('cl:explain-file', String(key), String(path)),
  startDemo: () => ipcRenderer.invoke('cl:demo'),
  micStatus: () => ipcRenderer.invoke('cl:mic-status'),
  testMic: provider => ipcRenderer.invoke('cl:mic-test', provider == null ? null : String(provider)),
  setSecret: (provider, key) => ipcRenderer.invoke('cl:secret-set', String(provider), key == null ? null : String(key)),
  copy: text => ipcRenderer.invoke('cl:copy', String(text)),
  openUrl: url => ipcRenderer.invoke('cl:open-url', String(url)),
  openSettings: fn => ipcRenderer.on('cl:open-settings', (_e, section) => fn(section)),
  pickFolder: () => ipcRenderer.invoke('cl:pick-folder'),
  openReleases: () => ipcRenderer.invoke('cl:open-releases'),
  openFull: key => ipcRenderer.invoke('cl:open-full', key == null ? null : String(key)),
  toggleWidget: () => ipcRenderer.invoke('cl:toggle-widget'),
  onOpenMatch: fn => ipcRenderer.on('cl:open-match', (_e, key) => fn(key)),
  onSettings: fn => ipcRenderer.on('cl:settings', (_e, s) => fn(s)),
  momentGroups: () => ipcRenderer.invoke('cl:moment-groups'),
  // Widget explanation popup: the widget shows or updates it, the popup receives what to show and asks to fit or close.
  showExplain: data => ipcRenderer.invoke('cl:explain-show', data),
  hideExplain: () => ipcRenderer.invoke('cl:explain-hide'),
  fitExplain: height => ipcRenderer.invoke('cl:explain-fit', Number(height)),
  onExplain: fn => ipcRenderer.on('cl:explain', (_e, data) => fn(data)),
});
