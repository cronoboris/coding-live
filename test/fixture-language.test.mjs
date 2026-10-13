import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setLanguage } from '../src/i18n/index.mjs';
import { Match, MOMENT_LABEL } from '../src/core/match.mjs';
import { adapters } from '../src/adapters/index.mjs';
import { demoAdapter } from '../src/demo.mjs';
import { Live } from '../src/live.mjs';

test('every session fixture and recorded demo has English engine-generated report fields', () => {
  try {
    setLanguage('en');
    for (const dir of ['test/fixtures', 'src/demo']) {
      for (const file of readdirSync(dir).filter(f => /\.(?:jsonl|json)$/.test(f))) {
        const agent = file.startsWith('claude') ? 'claude-code' : file.split('-')[0];
        const adapter = adapters.find(a => a.id === agent);
        assert.ok(adapter, file);
        const text = readFileSync(`${dir}/${file}`, 'utf8');
        const parse = adapter.format === 'document' ? null : adapter.createParser();
        const events = parse ? text.trim().split('\n').flatMap(line => parse(JSON.parse(line))) : adapter.parseDocument(text);
        const m = new Match({ id: file, agent });
        events.forEach(e => m.push(e));
        const rawNotes = events.filter(e => ['prompt', 'say', 'end'].includes(e.type)).map(e => String(e.text ?? '').replace(/\s+/g, ' ').slice(0, 160));
        const s = m.snapshot();
        const generated = {
          feed: s.feed.map(f => f.text),
          moments: s.moments.map(moment => ({
            label: MOMENT_LABEL[moment.type],
            note: rawNotes.includes(moment.note) ? '(recorded agent text)' : moment.note,
            auto: moment.auto, lesson: moment.lesson,
          })),
          modelLabel: s.modelLabel, player: s.player, state: s.state,
          rating: m.rating(), oneCheck: m.oneCheck(), learn: s.learn,
        };
        assert.doesNotMatch(JSON.stringify(generated), /[가-힣]/, `${dir}/${file}`);
        if (dir === 'src/demo') assert.doesNotMatch(demoAdapter.labelOf(`/demo/${agent}/${file}`), /[가-힣]/);
      }
    }
    // The remaining fixture is a worker registry, not a session transcript.
    const m = new Match();
    m.push({ type: 'role', at: 1, parent: 'parent' });
    const live = new Live({}, { value: { general: { language: 'en' } } });
    const file = fileURLToPath(new URL('./fixtures/worker-lifecycle/sessions/sess_error.json', import.meta.url));
    live.workerOutcome(Buffer.from(`mixdog\0${file}`).toString('base64url'), m);
    assert.equal(m.moments[0].type, 'abort');
    assert.doesNotMatch(MOMENT_LABEL.abort, /[가-힣]/);
    assert.equal(m.moments[0].note, '작업 실행 실패', 'worker-provided error text is preserved');
  } finally { setLanguage('ko'); }
});
