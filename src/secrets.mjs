// API keys for commentary providers. A key saved in the app is encrypted with the operating system's
// keychain (Electron safeStorage) and kept in its own file; otherwise keys come from environment variables.
// Keys never go to a window: the settings screen only learns whether one exists and its last four characters.

import { readFileSync } from 'node:fs';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PROVIDERS } from './providers.mjs';
import { t } from './i18n/index.mjs';

const fromEnv = (id, env) => { for (const k of PROVIDERS[id]?.envKeys ?? []) if (env[k]?.trim()) return { key: env[k].trim(), name: k }; return null; };
const hint = key => (key.length > 8 ? `…${key.slice(-4)}` : '');
const valid = key => typeof key === 'string' && key.trim().length >= 8 && key.trim().length <= 400 && !/\s/.test(key.trim());

// Keys from the environment only (browser mode, or when the OS can't encrypt).
export function envSecrets(env = process.env, why = null) {
  return {
    canSave: false, get whyNot() { return why ?? t('secrets.browser'); },
    get: id => fromEnv(id, env)?.key ?? null,
    describe: id => { const e = fromEnv(id, env); return e ? { has: true, source: 'env', env: e.name, hint: hint(e.key) } : { has: false, source: null }; },
    set: async () => ({ ok: false, error: why ?? t('secrets.browser') }),
  };
}

// Saved keys, encrypted by `crypt` ({ encrypt(string) → Buffer, decrypt(Buffer) → string }); env as fallback.
export function fileSecrets(file, crypt, env = process.env) {
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')) ?? {}; } catch {}
  const read = id => { try { return saved[id] ? crypt.decrypt(Buffer.from(saved[id], 'base64')) : null; } catch { return null; } };
  return {
    canSave: true,
    get: id => read(id) ?? fromEnv(id, env)?.key ?? null,
    describe: id => {
      const k = read(id);
      if (k) return { has: true, source: 'saved', hint: hint(k) };
      const e = fromEnv(id, env);
      return e ? { has: true, source: 'env', env: e.name, hint: hint(e.key) } : { has: false, source: null };
    },
    async set(id, key) {
      if (!PROVIDERS[id]?.methods.includes('api')) return { ok: false, error: t('secrets.unsupported') };
      if (key != null && !valid(key)) return { ok: false, error: t('secrets.invalid') };
      const next = { ...saved };
      if (key == null) delete next[id]; else next[id] = crypt.encrypt(key.trim()).toString('base64');
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
      await rename(tmp, file);
      await chmod(file, 0o600).catch(() => {});
      saved = next;
      return { ok: true };
    },
  };
}
