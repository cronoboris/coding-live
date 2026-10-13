import test from 'node:test';
import assert from 'node:assert/strict';
import { persona, momentPrompt, reviewPrompt } from '../src/mic.mjs';
import { setLanguage } from '../src/i18n/index.mjs';

test('English prompts preserve settings, facts, privacy and JSON contracts', () => {
  const match = {
    player: 'Dario Anyday', request: 'Build a calculator', final: 'PRIVATE_REPORT',
    feed: [{ t: 1, text: 'A test failed', says: ['PRIVATE_STATEMENT'] }],
    moments: [{ type: 'decision', note: 'PRIVATE_DECISION' }],
    liveStats: () => ({ t: 1, runs: 2, runFails: 1, rate: 50, tries: 0 }),
    stats: () => ({ tests: 2, failedTests: 1, failedTries: 0, lastTest: { failed: false }, testsWrittenByAI: true }),
  };
  try {
    setLanguage('ko');
    const original = persona('mild');
    const originalPrompt = momentPrompt(match, { type: 'decision', at: 0, note: 'PRIVATE_DECISION' });
    setLanguage('en');
    for (const tone of ['mild', 'spicy']) for (const teach of ['full', 'short', 'off']) {
      const text = persona(tone, teach);
      assert.doesNotMatch(text, /[가-힣]/);
      assert.match(text, /Always answer in English/);
      assert.match(text, /parody nicknames only/);
      assert.match(text, /never bring up.*real person/);
      assert.match(text, /do not use goal, VAR, tackle, referee, coach, kickoff, timeout, or penalty/);
      assert.equal(text.includes('[Learning:'), teach !== 'off');
      assert.equal(text.includes('[Tone: mild]'), tone === 'mild');
      const prompt = momentPrompt(match, { type: 'decision', at: 0, note: 'PRIVATE_DECISION' }, [], { teach, includeSayings: false });
      assert.doesNotMatch(prompt, /[가-힣]|PRIVATE_/);
      assert.match(prompt, /Answer in English/);
      const shape = JSON.parse(prompt.slice(prompt.lastIndexOf('{"caster"')));
      assert.deepEqual(Object.keys(shape), teach === 'off' ? ['caster', 'line'] : ['caster', 'line', 'ask']);
      assert.equal(prompt.includes('Lesson ('), teach !== 'off');
    }
    const review = reviewPrompt(match, { includeSayings: false });
    assert.doesNotMatch(review, /[가-힣]|PRIVATE_/);
    assert.match(review, /last test passed/);
    assert.deepEqual(Object.keys(JSON.parse(review.slice(review.lastIndexOf('{"headline"')))), ['headline', 'highlights', 'trust', 'decisions']);
    assert.match(reviewPrompt(match), /PRIVATE_REPORT/);
    assert.match(momentPrompt(match, { type: 'decision', at: 0, note: 'PRIVATE_DECISION' }), /PRIVATE_STATEMENT/);
    setLanguage('ko');
    assert.equal(persona('mild'), original);
    assert.equal(momentPrompt(match, { type: 'decision', at: 0, note: 'PRIVATE_DECISION' }), originalPrompt);
  } finally { setLanguage('ko'); }
});
