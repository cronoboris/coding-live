import test from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage } from '../src/i18n/index.mjs';
import ko from '../src/i18n/voice.ko.mjs';
import en from '../src/i18n/voice.en.mjs';
import { LESSONS, lessonFor, endLessons, TRICKS, MOMENT_LESSON } from '../src/core/lessons.mjs';

test('all lesson fields resolve from catalogs at access time', () => {
  try {
    const retained = LESSONS.test;
    for (const lang of ['ko', 'en', 'ko']) {
      setLanguage(lang);
      const catalog = lang === 'ko' ? ko : en;
      for (const [id, lesson] of Object.entries(LESSONS)) {
        for (const field of ['name', 'analogy', 'why', 'tell', 'ask']) {
          assert.equal(lesson[field], catalog[`lesson.${id}.${field}`]);
          assert.ok(lesson[field]);
        }
        if (lang === 'en') assert.doesNotMatch(JSON.stringify(lesson), /[가-힣]/);
      }
      assert.equal(retained.name, catalog['lesson.test.name']);
      for (const [type, id] of Object.entries(MOMENT_LESSON)) assert.deepEqual(lessonFor(type), { id, ...LESSONS[id] });
      assert.equal(endLessons({ lastTest: null })[0].name, catalog['lesson.no-test.name']);
      assert.equal(endLessons({ lastTest: {}, testsWrittenByAI: true })[0].name, catalog['lesson.self-test.name']);
    }
    assert.equal(lessonFor('unknown'), null);
    assert.deepEqual(TRICKS, ['pipe-run', 'answer-key', 'skip-test', 'weaker-test', 'silence', 'mask']);
  } finally { setLanguage('ko'); }
});
