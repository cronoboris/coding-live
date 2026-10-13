// User settings: one JSON file, deep-merged over defaults, validated on every write.

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PROVIDERS, LEGACY } from './providers.mjs';
import { momentSettings } from './core/moments.mjs';

export const DEFAULTS = Object.freeze({
  general: { theme: 'system', launchAtLogin: false, startHidden: false, nameStyle: 'pun', language: 'system' }, // nameStyle: see src/core/names.mjs
  agents: {}, // { [agentId]: { enabled: boolean, path: string } } — path '' means the agent's default folder
  moments: momentSettings(),
  // provider: 'auto' | 'off' | a PROVIDERS id. providers[id]: { via, model, url }. maxCalls: per match, null = unlimited.
  // teach: how much the commentary explains for beginners ('full' | 'short' | 'off').
  commentary: {
    provider: 'auto', autoOn: false, maxCalls: 20, tone: 'spicy', includeSayings: true, teach: 'full', explain: true,
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, { via: p.methods[0], model: '', url: '' }])),
  },
  notifications: { enabled: true, decision: true, trick: true, stuck: true, quiet: true, final: true, sound: true },
  widget: { visible: true, alwaysOnTop: true, opacity: 1, follow: 'auto', bounds: null },
});

const CHOICES = {
  'general.theme': ['system', 'dark', 'light'],
  'general.nameStyle': ['pun', 'meme', 'plain'],
  'general.language': ['system', 'ko', 'en'],
  'commentary.provider': ['auto', 'off', ...Object.keys(PROVIDERS)],
  'commentary.tone': ['spicy', 'mild'],
  'commentary.teach': ['full', 'short', 'off'],
  'widget.follow': ['auto', 'manual'],
};

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) out[k] = isObj(v) && isObj(base?.[k]) ? merge(base[k], v) : v;
  return out;
}

// Keep only known keys with the right types; anything else falls back to the default.
export function sanitize(s) {
  const out = structuredClone(DEFAULTS);
  for (const section of Object.keys(DEFAULTS)) {
    if (section === 'agents') continue;
    for (const [k, def] of Object.entries(DEFAULTS[section])) {
      if (section === 'commentary' && (k === 'providers' || k === 'maxCalls')) continue;
      const v = s?.[section]?.[k];
      const choices = CHOICES[`${section}.${k}`];
      if (choices) out[section][k] = choices.includes(v) ? v : def;
      else if (typeof def === 'boolean') out[section][k] = typeof v === 'boolean' ? v : def;
      else if (typeof def === 'number') out[section][k] = Number.isFinite(v) ? v : def;
      else if (k === 'bounds') out[section][k] = isObj(v) && ['x', 'y', 'width', 'height'].every(n => Number.isFinite(v[n])) ? v : null;
    }
  }
  const c = s?.commentary ?? {};
  if (!CHOICES['commentary.provider'].includes(c.provider) && LEGACY[c.backend]) out.commentary.provider = LEGACY[c.backend]; // settings from 0.3 and earlier
  else if (!CHOICES['commentary.provider'].includes(c.provider) && c.backend === 'off') out.commentary.provider = 'off';
  out.commentary.maxCalls = c.maxCalls === null ? null : Number.isFinite(c.maxCalls) ? Math.min(1000, Math.max(0, Math.round(c.maxCalls))) : DEFAULTS.commentary.maxCalls;
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const v = isObj(c.providers?.[id]) ? c.providers[id] : {};
    const text = (x, n) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f]/g, '').trim().slice(0, n) : '');
    const url = text(v.url, 500);
    out.commentary.providers[id] = {
      via: p.methods.includes(v.via) ? v.via : p.methods[0],
      model: text(v.model, 200),
      url: p.defaultUrl !== undefined && /^https?:\/\/[^\s]+$/i.test(url) ? url : '', // only local and compatible servers take an address
    };
  }
  out.widget.opacity = Math.min(1, Math.max(0.4, out.widget.opacity));
  for (const [id, a] of Object.entries(isObj(s?.agents) ? s.agents : {})) {
    if (!/^[\w-]{1,40}$/.test(id) || !isObj(a)) continue;
    out.agents[id] = { enabled: a.enabled !== false, path: typeof a.path === 'string' ? a.path.slice(0, 1000) : '' };
  }
  return out;
}

export class Settings extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    let raw = null;
    try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch {}
    this.value = sanitize(raw);
  }
  get() { return structuredClone(this.value); }
  async update(patch) {
    const before = this.value;
    this.value = sanitize(merge(before, patch));
    await this.save();
    this.emit('change', this.get(), before);
    return this.get();
  }
  // Written to a temp file and renamed, so a crash never leaves half a settings file.
  async save() {
    if (!this.file) return;
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(this.value, null, 2));
    await rename(tmp, this.file);
  }
}
