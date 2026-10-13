// The widget's explanation popup (desktop app): shows what the clicked player's latest action does, step by step.

import { $, explainCard, applyTheme } from './shared.js';
import { applyLanguage } from './i18n.js';
import { api } from './transport.js';

let last = null;
function show(data) {
  if (!data) return;
  last = data;
  $('pop').replaceChildren(explainCard(data, () => api.hideExplain()));
  requestAnimationFrame(() => api.fitExplain(Math.ceil($('pop').getBoundingClientRect().height) + 2));
}

api.onExplain(show);
const apply = s => { applyTheme(s.general?.theme); applyLanguage(s, api.locale); show(last); };
api.onSettings(apply);
document.addEventListener('keydown', e => { if (e.key === 'Escape') api.hideExplain(); });
api.getSettings().then(apply, () => {});
