// Desktop app: the broadcast service runs in-process and the UI talks to it over IPC — no local web server,
// no port. Two windows: the full broadcast and an always-on-top widget that follows the live session.
// Closing either keeps coding live in the tray so alerts still arrive; quit from the tray menu.

import { app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, ipcMain, nativeImage, nativeTheme, protocol, safeStorage, screen, shell } from 'electron';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Live } from '../src/live.mjs';
import { PROVIDERS } from '../src/providers.mjs';
import { envSecrets, fileSecrets } from '../src/secrets.mjs';
import { MOMENT_GROUPS } from '../src/core/moments.mjs';
import { startUpdates } from './updater.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const UI = join(ROOT, 'ui');
const BUILD = join(ROOT, 'build');
const ORIGIN = 'app://ui';
const RELEASES = 'https://github.com/cronoboris/coding-live/releases';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// Text the app shell shows itself (tray menu, window titles, dialogs), in the language from settings general.language;
// 'system' follows app.getLocale() (Korean → ko, else en), like the UI (ui/i18n.js).
const SHELL_TEXT = {
  ko: {
    noKeychain: '이 컴퓨터에는 키를 안전하게 저장할 키체인이 없어요. 환경 변수로 넣어 주세요.',
    widgetTitle: 'coding live 위젯', explainTitle: 'coding live 설명',
    open: '중계석 열기', widget: '위젯 보기', demo: '데모 경기 보기', commentary: b => `해설: ${b ?? '정해진 문구'}`,
    notify: '알림 받기', quit: 'coding live 끄기', startFailed: 'coding live를 시작하지 못했어요',
    updateReady: v => `새 버전 ${v}이(가) 준비됐어요`, updateReadyBody: '눌러서 재시작하면 바로 적용돼요. 다음에 끌 때 적용해도 돼요.',
    updateOut: v => `새 버전 ${v}이(가) 나왔어요`, updateOutBody: '눌러서 다운로드 페이지를 여세요.',
    restartUpdate: v => `재시작해서 ${v}로 업데이트`, downloadUpdate: v => `${v} 다운로드 페이지 열기`,
  },
  en: {
    noKeychain: 'This computer has no keychain to store keys safely. Please use an environment variable.',
    widgetTitle: 'coding live widget', explainTitle: 'coding live explanation',
    open: 'Open coding live', widget: 'Show widget', demo: 'Watch a demo match', commentary: b => `Commentary: ${b ?? 'built-in lines'}`,
    notify: 'Get notifications', quit: 'Quit coding live', startFailed: 'coding live couldn’t start',
    updateReady: v => `coding live ${v} is ready`, updateReadyBody: 'Click to restart and update now, or it updates the next time you quit.',
    updateOut: v => `coding live ${v} is out`, updateOutBody: 'Click to open the download page.',
    restartUpdate: v => `Restart to update to ${v}`, downloadUpdate: v => `Download ${v}`,
  },
};
const shellLang = () => {
  const l = live?.settings.value.general?.language ?? 'system';
  return l === 'ko' || l === 'en' ? l : /^ko\b/i.test(app.getLocale()) ? 'ko' : 'en';
};
const tr = key => SHELL_TEXT[shellLang()][key];

// Apps started from the Dock or Start menu don't get the shell's environment, so `claude`, `gemini` or `codex`
// (used for commentary) would not be found, nor API keys exported in a shell profile. Ask the login shell once
// for PATH and the commentary providers' key variables, and add the usual install places.
const KEY_VARS = [...new Set(Object.values(PROVIDERS).flatMap(p => p.envKeys))];
function fixPath() {
  if (process.platform === 'win32') return;
  const extra = [join(homedir(), '.local', 'bin'), join(homedir(), '.npm-global', 'bin'), join(homedir(), '.bun', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  let fromShell = [];
  try { fromShell = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', `printf '%s\\0' "$PATH" ${KEY_VARS.map(k => `"$${k}"`).join(' ')}`], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0'); } catch {}
  process.env.PATH = [...new Set([...(fromShell[0] ?? '').split(delimiter), ...(process.env.PATH ?? '').split(delimiter), ...extra].filter(Boolean))].join(delimiter);
  KEY_VARS.forEach((k, i) => { if (!process.env[k] && fromShell[i + 1]?.trim()) process.env[k] = fromShell[i + 1].trim(); });
}

// Keys saved in the app are encrypted by the OS keychain. Linux without a keyring only offers a fixed
// obfuscation key, which is not real protection, so there keys stay in environment variables.
function makeSecrets() {
  const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend?.() : null;
  if (!safeStorage.isEncryptionAvailable() || backend === 'basic_text') return Object.defineProperty(envSecrets(process.env), 'whyNot', { get: () => tr('noKeychain'), enumerable: true });
  return fileSecrets(join(app.getPath('userData'), 'secrets.json'), { encrypt: s => safeStorage.encryptString(s), decrypt: b => safeStorage.decryptString(b) }, process.env);
}

// ---- app:// serves the UI folder only ------------------------------------------------------
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
function serveUi() {
  protocol.handle('app', async req => {
    const url = new URL(req.url);
    const file = normalize(join(UI, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
    if (url.host !== 'ui' || !file.startsWith(UI + sep)) return new Response('not found', { status: 404 });
    try { return new Response(await readFile(file), { headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' } }); }
    catch { return new Response('not found', { status: 404 }); }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.cronoboris.codinglive'); // Windows toast notifications need it

let live = null, win = null, widget = null, tray = null, quitting = false, updates = null;
const settings = () => live.settings.value;

function guard(w) {
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
}
const basePreferences = { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), contextIsolation: true, sandbox: true, nodeIntegration: false };
// The preload hands the app locale to the page (for language 'system').
const prefs = () => ({ ...basePreferences, additionalArguments: [`--cl-locale=${app.getLocale()}`] });
const surface = () => (nativeTheme.shouldUseDarkColors ? '#111113' : '#fcfcfd');

function showWindow(openKey = null) {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    if (openKey) win.webContents.send('cl:open-match', openKey);
    return;
  }
  win = new BrowserWindow({ width: 1320, height: 860, minWidth: 380, minHeight: 520, title: 'coding live', backgroundColor: surface(), show: false, icon: join(BUILD, 'icon.png'), autoHideMenuBar: true, webPreferences: prefs() });
  win.removeMenu?.();
  guard(win);
  win.once('ready-to-show', () => win.show());
  if (openKey) win.webContents.once('did-finish-load', () => win.webContents.send('cl:open-match', openKey));
  win.on('closed', () => { win = null; }); // closing frees the renderer; the tray and alerts keep running
  win.loadURL(`${ORIGIN}/index.html`);
}

function defaultWidgetBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 380, height = 300;
  return { width, height, x: workArea.x + workArea.width - width - 16, y: workArea.y + workArea.height - height - 16 };
}
const onScreen = b => b && screen.getAllDisplays().some(d => b.x >= d.bounds.x - 40 && b.y >= d.bounds.y - 40 && b.x < d.bounds.x + d.bounds.width && b.y < d.bounds.y + d.bounds.height);

function syncWidget() {
  const w = settings().widget;
  if (!w.visible) { widget?.hide(); return; }
  if (widget) {
    widget.setAlwaysOnTop(w.alwaysOnTop, 'floating');
    widget.setOpacity(w.opacity);
    if (!w.bounds) widget.setBounds(defaultWidgetBounds());
    if (!widget.isVisible()) widget.showInactive();
    return;
  }
  widget = new BrowserWindow({ ...(onScreen(w.bounds) ? w.bounds : defaultWidgetBounds()), minWidth: 280, minHeight: 170, frame: false, transparent: true, resizable: true,
    alwaysOnTop: w.alwaysOnTop, skipTaskbar: true, fullscreenable: false, maximizable: false, minimizable: false, show: false, title: tr('widgetTitle'), webPreferences: prefs() });
  widget.setAlwaysOnTop(w.alwaysOnTop, 'floating');
  widget.setOpacity(w.opacity);
  if (process.platform === 'darwin') widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  guard(widget);
  widget.once('ready-to-show', () => widget.showInactive());
  let t = null;
  const remember = () => { clearTimeout(t); t = setTimeout(() => { if (widget) live.updateSettings({ widget: { bounds: widget.getBounds() } }); }, 400); };
  widget.on('moved', remember); widget.on('resized', remember);
  widget.on('moved', placeExplain); widget.on('resized', placeExplain); widget.on('hide', hideExplain);
  widget.on('close', e => { if (!quitting) { e.preventDefault(); live.updateSettings({ widget: { visible: false } }); } });
  widget.on('closed', () => { widget = null; });
  widget.loadURL(`${ORIGIN}/widget.html`);
}

// ---- widget explanation popup: a small window beside the widget (right side, or left if no room) ----
let explainWin = null, explainData = null, explainHeight = 220;
const EXPLAIN_W = 320;
function placeExplain() {
  if (!explainWin || !widget) return;
  const wb = widget.getBounds();
  const { workArea } = screen.getDisplayMatching(wb);
  const height = Math.min(explainHeight, workArea.height);
  const right = wb.x + wb.width + 8;
  const x = right + EXPLAIN_W <= workArea.x + workArea.width ? right : Math.max(workArea.x, wb.x - EXPLAIN_W - 8);
  const y = Math.min(Math.max(wb.y, workArea.y), workArea.y + workArea.height - height);
  explainWin.setBounds({ x, y, width: EXPLAIN_W, height });
}
const clip = (v, n) => String(v ?? '').slice(0, n);
function cleanExplain(d) {
  const e = d?.explain;
  return {
    update: d?.update === true, agent: clip(d?.agent, 40), player: clip(d?.player, 200), action: clip(d?.action, 500),
    explain: { raw: clip(e?.raw, 2000), steps: (Array.isArray(e?.steps) ? e.steps : []).slice(0, 20).map(s => ({ term: clip(s?.term, 120), what: clip(s?.what, 400) })) },
  };
}
function showExplain(data) {
  const d = cleanExplain(data);
  if (!widget?.isVisible() || !settings().commentary.explain) return false;
  if (d.update && !explainWin?.isVisible()) return false; // live updates never reopen a popup the person closed
  explainData = d;
  if (explainWin) { explainWin.webContents.send('cl:explain', d); placeExplain(); if (!explainWin.isVisible()) explainWin.showInactive(); return true; }
  explainWin = new BrowserWindow({ width: EXPLAIN_W, height: explainHeight, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    fullscreenable: false, maximizable: false, minimizable: false, focusable: true, show: false, title: tr('explainTitle'), webPreferences: prefs() });
  explainWin.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') explainWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  guard(explainWin);
  explainWin.webContents.on('did-finish-load', () => explainWin?.webContents.send('cl:explain', explainData));
  explainWin.once('ready-to-show', () => { placeExplain(); explainWin?.showInactive(); });
  explainWin.on('close', e => { if (!quitting) { e.preventDefault(); explainWin.hide(); } });
  explainWin.on('closed', () => { explainWin = null; });
  placeExplain();
  explainWin.loadURL(`${ORIGIN}/explain.html`);
  return true;
}
const hideExplain = () => { explainWin?.hide(); };

function refreshTray() {
  if (!tray) return;
  const s = settings();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: tr('open'), click: () => showWindow() },
    { label: tr('widget'), type: 'checkbox', checked: s.widget.visible, click: item => live.updateSettings({ widget: { visible: item.checked } }) },
    { label: tr('demo'), click: () => { live.startDemo(); showWindow(); } },
    { type: 'separator' },
    { label: tr('commentary')(live.backend), enabled: false },
    { label: tr('notify'), type: 'checkbox', checked: s.notifications.enabled, click: item => live.updateSettings({ notifications: { enabled: item.checked } }) },
    ...(updateItem() ? [{ type: 'separator' }, updateItem()] : []),
    { type: 'separator' },
    { label: tr('quit'), click: () => { quitting = true; app.quit(); } },
  ]));
}

// Settings that belong to the app shell rather than the engine.
function applyShell(s) {
  nativeTheme.themeSource = s.general.theme;
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.general.launchAtLogin, openAsHidden: true });
  syncWidget();
  if (!s.commentary.explain) hideExplain();
  refreshTray();
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('cl:settings', s);
}

// A new version: restart into it where it can install itself (Windows, Linux), else open its release page (macOS).
const releasePage = v => `${RELEASES}/tag/v${v}`;
function updateItem() {
  const u = updates?.status();
  if (u?.state === 'ready') return { label: tr('restartUpdate')(u.version), click: () => updates.install() };
  if (u?.state === 'available') return { label: tr('downloadUpdate')(u.version), click: () => shell.openExternal(releasePage(u.version)) };
  return null;
}
function notifyUpdate(u) {
  if (!Notification.isSupported()) return;
  const ready = u.state === 'ready';
  const n = new Notification({ title: tr(ready ? 'updateReady' : 'updateOut')(u.version), body: tr(ready ? 'updateReadyBody' : 'updateOutBody'), icon: join(BUILD, 'icon.png') });
  n.on('click', () => (ready ? updates.install() : shell.openExternal(releasePage(u.version))));
  n.show();
}

function notify(a) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: `${a.label} · ${a.title}`, body: a.body, silent: !a.sound, icon: join(BUILD, 'icon.png') });
  n.on('click', () => showWindow(a.key));
  n.show();
}

// ---- IPC: only our own pages may call ------------------------------------------------------
const subs = new Map(); // id -> stop
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!e.senderFrame?.url.startsWith(ORIGIN + '/')) throw new Error('forbidden');
    return fn(e, ...args);
  });
}
function wireIpc() {
  handle('cl:info', () => live.info());
  handle('cl:sessions', () => live.sessions());
  handle('cl:projects', () => live.projects());
  handle('cl:mic-project', (_e, key, on) => live.setMicProject(key, on));
  handle('cl:watch-project', async (e, id, key) => {
    const sender = e.sender;
    const send = msg => { if (!sender.isDestroyed()) sender.send('cl:snap', { id, ...msg }); };
    const stop = await live.subscribeProject(key, snap => send({ snap }));
    if (!stop) { send({ gone: true }); return false; }
    subs.set(id, stop);
    sender.once('destroyed', () => { subs.get(id)?.(); subs.delete(id); });
    return true;
  });
  handle('cl:agents', () => live.agentStatus());
  handle('cl:settings:get', () => live.getSettings());
  handle('cl:settings:set', (_e, patch) => live.updateSettings(patch));
  handle('cl:app-info', () => ({ version: app.getVersion(), platform: `${process.platform} ${process.arch}`, electron: process.versions.electron }));
  handle('cl:watch', async (e, id, key) => {
    const sender = e.sender;
    const send = msg => { if (!sender.isDestroyed()) sender.send('cl:snap', { id, ...msg }); };
    const stop = await live.subscribe(key, snap => send({ snap }));
    if (!stop) { send({ gone: true }); return false; }
    subs.set(id, stop);
    sender.once('destroyed', () => { subs.get(id)?.(); subs.delete(id); });
    return true;
  });
  handle('cl:unwatch', (_e, id) => { subs.get(id)?.(); subs.delete(id); });
  handle('cl:mic', (_e, key, on) => live.setMic(key, on));
  handle('cl:review', (_e, key) => live.review(key));
  handle('cl:explain-file', (_e, key, path) => live.explainFile(String(key), String(path)));
  handle('cl:demo', () => live.startDemo());
  handle('cl:mic-status', () => live.micStatus());
  handle('cl:mic-test', (_e, provider) => live.testMic(typeof provider === 'string' ? provider : null));
  handle('cl:secret-set', (_e, provider, key) => live.setSecret(String(provider), typeof key === 'string' ? key : null));
  handle('cl:copy', (_e, text) => { clipboard.writeText(String(text ?? '').slice(0, 4000)); return true; });
  handle('cl:open-url', (_e, url) => { if (Object.values(PROVIDERS).some(p => p.keyUrl === url || p.setupUrl === url)) shell.openExternal(url); });
  handle('cl:pick-folder', async e => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openDirectory', 'showHiddenFiles'] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  handle('cl:open-releases', () => shell.openExternal(RELEASES));
  handle('cl:update-status', () => updates?.status() ?? null); // null: not an installed app, no updates
  handle('cl:update-check', () => { updates?.check(); return updates?.status() ?? null; });
  handle('cl:update-install', () => { const u = updates?.status(); if (u?.state === 'ready') updates.install(); else if (u?.state === 'available') shell.openExternal(releasePage(u.version)); });
  handle('cl:open-full', (_e, key) => showWindow(key));
  handle('cl:toggle-widget', () => live.updateSettings({ widget: { visible: !(widget?.isVisible()) } }));
  handle('cl:moment-groups', () => MOMENT_GROUPS);
  handle('cl:explain-show', (_e, data) => showExplain(data));
  handle('cl:explain-hide', () => hideExplain());
  handle('cl:explain-fit', (_e, height) => { if (Number.isFinite(height)) { explainHeight = Math.round(Math.min(480, Math.max(120, height))); placeExplain(); } });
}

app.on('second-instance', () => live && showWindow());
app.on('activate', () => live && showWindow());
app.on('before-quit', () => { quitting = true; for (const stop of subs.values()) stop(); live?.close(); });
app.on('window-all-closed', () => {}); // stay in the tray

app.whenReady().then(async () => {
  fixPath();
  serveUi();
  try { live = await Live.create({ mic: process.env.CODING_LIVE_MIC, settingsFile: join(app.getPath('userData'), 'settings.json'), secrets: makeSecrets(), locale: app.getLocale() }); }
  catch (e) { dialog.showErrorBox(tr('startFailed'), String(e.message ?? e)); app.exit(1); return; }
  wireIpc();
  tray = new Tray(nativeImage.createFromPath(join(BUILD, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png')));
  tray.setToolTip('coding live');
  tray.on('click', () => showWindow());
  live.settings.on('change', s => applyShell(s));
  applyShell(settings());
  live.startAlerts(notify);
  if (app.isPackaged) updates = startUpdates({ notify: notifyUpdate, onChange: u => { refreshTray(); for (const w of BrowserWindow.getAllWindows()) w.webContents.send('cl:update', u); } });
  const hidden = settings().general.startHidden || app.getLoginItemSettings().wasOpenedAsHidden || process.argv.includes('--hidden');
  if (!hidden) showWindow();
});
