import test from 'node:test';
import assert from 'node:assert/strict';
import ko from '../src/i18n/voice.ko.mjs';
import en from '../src/i18n/voice.en.mjs';
import { setLanguage } from '../src/i18n/index.mjs';
import { autoComment, KIND_LABEL } from '../src/core/lessons.mjs';

test('fixed commentary and kind labels resolve at call time', () => {
  try {
    for (const key of Object.keys(ko).filter(k => k.startsWith('auto.') && !k.includes('fallback'))) {
      const type = key.slice(5);
      setLanguage('ko');
      assert.equal(autoComment({}, { type }).line, ko[key]);
      setLanguage('en');
      const comment = autoComment({}, { type });
      assert.equal(comment.line, en[key]);
      assert.doesNotMatch(JSON.stringify(comment), /[가-힣]/);
    }
    for (const lang of ['en', 'ko', 'en']) {
      setLanguage(lang);
      const catalog = lang === 'ko' ? ko : en;
      for (const kind of ['trick', 'signal', 'rule']) assert.equal(KIND_LABEL[kind], catalog[`kind.${kind}`]);
      assert.deepEqual(autoComment({}, { type: 'unknown-moment' }), {
        caster: catalog['auto.fallbackCaster'], line: catalog['auto.fallbackLine'],
      });
    }
  } finally { setLanguage('ko'); }
});
