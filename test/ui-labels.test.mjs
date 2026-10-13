import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { LABEL, LANES, MOMENT_CHIP, orderPlayers, playerLabel, leftLine, everyone, laneLabel, momentLabel } from '../ui/shared.js';
import { EN, setLanguage } from '../ui/i18n.js';
import { catalogs } from '../src/i18n/index.mjs';
import { MOMENT_LABEL } from '../src/core/moments.mjs';
import { LANES as ENGINE_LANES } from '../src/core/caster.mjs';

test('UI moment labels and lanes follow the engine', () => {
  assert.deepEqual(LABEL, MOMENT_LABEL);
  assert.deepEqual(LANES, ENGINE_LANES);
  assert.deepEqual(Object.keys(MOMENT_CHIP).sort(), Object.keys(MOMENT_LABEL).sort());
});

test('English stage and moment labels use the engine\'s English words', () => {
  try {
    setLanguage('en');
    LANES.forEach((_, i) => assert.equal(laneLabel(i), catalogs.en[`lane.${i}`]));
    for (const type of Object.keys(LABEL)) assert.equal(momentLabel(type), catalogs.en[`moment.label.${type}`], type);
  } finally { setLanguage('ko'); }
});

// Every Korean text in ui/ is a dictionary key: string literals in the scripts and the marked text and attributes in the pages.
test('every Korean UI text has an English translation without Hangul', () => {
  const dir = new URL('../ui/', import.meta.url);
  const keys = new Set();
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'i18n.js')) {
    const src = readFileSync(new URL(f, dir), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    for (const [, s] of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) if (/[가-힣]/.test(s)) keys.add(s);
  }
  for (const f of ['index.html', 'widget.html', 'explain.html']) {
    const html = readFileSync(new URL(f, dir), 'utf8');
    for (const [, attrs, text] of html.matchAll(/<[a-z0-9]+\b([^<>]*)>(?=([^<>]*)<)/g)) {
      if (/data-i18n(?![-\w])/.test(attrs) && text.trim()) keys.add(text.trim());
      const list = /data-i18n-attr="([^"]+)"/.exec(attrs)?.[1].split(',') ?? [];
      for (const a of list) keys.add(new RegExp(`\\s${a}="([^"]*)"`).exec(attrs)[1]);
    }
    assert.equal(html.replace(/<[^>]*data-i18n[^>]*>[^<]*/g, '').match(/[가-힣]+/g), null, `${f}: Korean text outside data-i18n`);
  }
  const notInEnglish = new Set(['한국어']); // the language selector names Korean in Korean
  const missing = [...keys].filter(k => !notInEnglish.has(k) && !Object.hasOwn(EN, k) && !Object.hasOwn(EN, `${k}|단계`));
  assert.deepEqual(missing, []);
  const hangul = Object.entries(EN).filter(([, v]) => /[가-힣]/.test(typeof v === 'function' ? v({ n: 2, live: 1 }) : v));
  assert.deepEqual(hangul, []);
});

test('sub-players are listed under their parent with a plain label', () => {
  const players = [
    { key: 'a', player: '다리오 아무데이 (오퍼스 5.5)', name: '다리오 아무데이' },
    { key: 'c', name: 'engine', parent: 'a', parentName: '다리오 아무데이', role: 'heavy-worker' },
    { key: 'b', player: '샘 알트탭 (코덱스)', name: '샘 알트탭' },
    { key: 'd', name: 'tools', parent: 'a', parentName: '다리오 아무데이' },
  ];
  assert.deepEqual(orderPlayers(players).map(p => p.key), ['a', 'c', 'd', 'b']);
  assert.equal(playerLabel(players[1]), 'engine ↳ 다리오 아무데이의 보조 · heavy-worker');
  assert.equal(playerLabel(players[0]), '다리오 아무데이 (오퍼스 5.5)');
  const gone = { key: 'e', name: '잭 클락션', modelLabel: '하이쿠 4.5', parent: 'a', parentName: '다리오 아무데이', role: 'explorer', left: true, finished: true, lastAt: Date.now() - 3 * 60_000 };
  assert.equal(leftLine(gone), '잭 클락션 (하이쿠 4.5) · explorer · ↳ 다리오 아무데이의 보조 · 3분 전');
  assert.deepEqual(everyone({ players, left: [gone] }).map(p => p.key), ['a', 'c', 'b', 'd', 'e']);
});
