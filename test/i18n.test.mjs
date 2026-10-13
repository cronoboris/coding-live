import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogs, resolveLanguage, setLanguage, t } from '../src/i18n/index.mjs';
import { sanitize, DEFAULTS } from '../src/settings.mjs';
import { explain } from '../src/core/glossary.mjs';
test('language catalog keys match and system locale resolves deterministically', () => {
  assert.deepEqual(Object.keys(catalogs.ko).sort(), Object.keys(catalogs.en).sort());
  assert.equal(resolveLanguage('system', 'ko-KR'), 'ko');
  assert.equal(resolveLanguage('system', 'en-US'), 'en');
  assert.equal(resolveLanguage('system', '', { LANG: 'ko_KR.UTF-8' }), 'ko');
  assert.equal(resolveLanguage('en', 'ko-KR'), 'en');
  assert.equal(DEFAULTS.general.language, 'system');
  assert.equal(sanitize({ general: { language: 'invalid' } }).general.language, 'system');
});
test('new glossary entries use the active language', () => {
  try {
    setLanguage('en');
    for (const command of ['flock', 'cmp', 'sh', 'bash', 'zsh', 'pgrep', 'free', '.', 'git show', 'ffmpeg', 'sha256sum', 'md5sum', 'systemctl', 'git worktree', '[', 'test', 'run', 'build(){ echo x; }']) {
      const steps = explain({ kind: 'shell', command }).steps;
      assert.ok(steps[0].what, command);
      assert.doesNotMatch(steps[0].what, /[가-힣]/);
    }
    assert.equal(t('language.name'), 'English');
  } finally { setLanguage('ko'); }
});
