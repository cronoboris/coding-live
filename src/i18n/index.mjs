import ko from './ko.mjs';
import en from './en.mjs';
import voiceKo from './voice.ko.mjs';
import voiceEn from './voice.en.mjs';

export const catalogs = { ko: { ...ko }, en: { ...en } };
export function register(lang, entries) {
  if (!Object.hasOwn(catalogs, lang)) throw new Error(`Unsupported language: ${lang}`);
  Object.assign(catalogs[lang], entries);
}
register('ko', voiceKo);
register('en', voiceEn);
export function resolveLanguage(value = 'system', locale = Intl.DateTimeFormat().resolvedOptions().locale, env = process.env) {
  if (value === 'ko' || value === 'en') return value;
  return /^ko(?:[-_.@]|$)/i.test(locale || env.LC_ALL || env.LANG || '') ? 'ko' : 'en';
}
// Standalone engine callers retain the legacy language until the application applies its settings.
let active = 'ko';
export const language = () => active;
export const setLanguage = (value, locale) => { active = resolveLanguage(value, locale); return active; };
export function t(key, vars = {}) {
  const message = catalogs[active][key];
  if (message === undefined) throw new Error(`Unknown message key: ${key}`);
  return message.replace(/\{(\w+)\}/g, (token, name) => Object.hasOwn(vars, name) ? String(vars[name]) : token);
}
export function renderMessage(message) {
  if (typeof message === 'function') return renderMessage(message());
  if (typeof message === 'string') return message;
  if (!message?.key) return String(message ?? '');
  const vars = Object.fromEntries(Object.entries(message.vars ?? {}).map(([key, value]) => [key, value?.key ? renderMessage(value) : value]));
  return t(message.key, vars);
}
