import test from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage } from '../src/i18n/index.mjs';
import { nameList, sessionName } from '../src/core/names.mjs';

test('English company names and Korean lists survive runtime language changes', () => {
  const cases = [
    ['claude', 10, 'Dario Amodei', 'Dario Anyday', '다리오 아무데이'],
    ['gpt', 10, 'Sam Altman', 'Sam Alt-Tab', '샘 알트탭'],
    ['gemini', 10, 'Demis Hassabis', 'Demis Hassabiscuit', '데미스 하사비스킷'],
    ['grok', 5, 'Elon Musk', 'Elon Muskmelon', '일롱 머스크멜론'],
    ['llama', 6, 'Mark Zuckerberg', 'Mark Zuckerburger', '마크 저커피'],
    ['mistral', 3, 'Arthur Mensch', 'Arthur Mention', '아서 멘션'],
    ['deepseek', 1, 'Liang Wenfeng', 'Liang Wenfun', '량원펑펑'],
    ['qwen', 2, 'Lin Junyang', 'Lin Junyang-Yang', '린 쥔양갱'],
    ['kimi', 1, 'Yang Zhilin', 'Yang Zhilinks', '양즈린스'],
    ['unknown', 20, 'Geoffrey Hinton', 'Geoffrey Hintern', '제프리 힌트언'],
  ];
  try {
    for (const [model, count, real, pun, korean] of cases) {
      setLanguage('ko');
      const original = nameList(model);
      assert.equal(original[0], korean);
      setLanguage('en');
      assert.equal(nameList(model, 'meme')[0], real);
      assert.equal(nameList(model, 'pun')[0], pun);
      for (const style of ['pun', 'meme']) {
        const names = nameList(model, style);
        assert.equal(names.length, count);
        assert.equal(new Set(names).size, count);
        assert.doesNotMatch(names.join(''), /[가-힣]/);
      }
      assert.doesNotMatch(nameList(model, 'plain').join(''), /[가-힣]/);
      assert.equal(sessionName(new Set(), model), nameList(model)[0]);
      const used = new Set();
      for (let i = 0; i < count + 2; i++) {
        const name = sessionName(used, model);
        assert.ok(!used.has(name));
        used.add(name);
      }
      setLanguage('ko');
      assert.deepEqual(nameList(model), original);
    }
  } finally {
    setLanguage('ko');
  }
});
