// Updates from GitHub Releases. Windows and Linux download a new version by themselves and say so; it is installed
// when the person restarts from that notice (or quits). macOS cannot install an unsigned update, so there the notice
// only says a version is out and opens its release page.
import updater from 'electron-updater';

const { autoUpdater } = updater;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

// onChange(status) after every step; status: { state: 'idle'|'checking'|'none'|'available'|'downloading'|'ready'|'error',
// version, percent, message, canInstall }. notify(status) once per version when it is ready (or out, on macOS).
export function startUpdates({ onChange = () => {}, notify = () => {} } = {}) {
  const canInstall = process.platform !== 'darwin';
  let status = { state: 'idle', canInstall };
  const told = new Set();
  const set = next => { status = { ...status, ...next, canInstall }; onChange(status); };
  autoUpdater.autoDownload = canInstall;
  autoUpdater.autoInstallOnAppQuit = canInstall;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: null }));
  autoUpdater.on('update-not-available', () => set({ state: 'none', version: null, percent: null }));
  autoUpdater.on('update-available', info => {
    set({ state: canInstall ? 'downloading' : 'available', version: info.version, percent: 0 });
    if (!canInstall && !told.has(info.version)) { told.add(info.version); notify(status); }
  });
  autoUpdater.on('download-progress', p => set({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', info => {
    set({ state: 'ready', version: info.version, percent: 100 });
    if (!told.has(info.version)) { told.add(info.version); notify(status); }
  });
  autoUpdater.on('error', e => set({ state: 'error', message: String(e?.message ?? e).split('\n')[0].slice(0, 200) }));
  const check = () => { if (!['downloading', 'ready'].includes(status.state)) autoUpdater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 15_000).unref?.();
  setInterval(check, CHECK_EVERY_MS).unref?.();
  return {
    status: () => status,
    check,
    install: () => { if (status.state === 'ready') autoUpdater.quitAndInstall(); },
  };
}
