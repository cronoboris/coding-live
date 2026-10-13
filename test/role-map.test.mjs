import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Live } from '../src/live.mjs';
import { Booth } from '../src/mic.mjs';
import { sanitize } from '../src/settings.mjs';
import { routes, links, roleOf } from '../ui/filemap.js';

const hub = () => Object.assign(new EventEmitter(), { tails: new Map(), sessions: [] });
const settle = () => new Promise(r => setTimeout(r, 20));

test('the role map sorts touched paths into the fixed areas, one call at a time, and keeps them on disk', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'coding-live-roles-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cwd = join(dir, 'game');
  mkdirSync(join(cwd, 'ui'), { recursive: true });
  writeFileSync(join(cwd, 'ui', 'editor.tsx'), 'secret contents');
  const settingsFile = join(dir, 'settings.json');
  const settings = { value: sanitize({}), file: settingsFile };
  const p = { key: 'p', name: 'game', cwd };
  const live = new Live(hub(), settings);
  const changed = [];
  const onChange = () => changed.push(1);

  assert.deepEqual(live.roleMap(p, ['ui/editor.tsx'], onChange), { nomic: true });
  live.booth = new Booth({ provider: 'compatible', via: 'api', url: 'http://127.0.0.1:9/v1', model: 'm' });
  settings.value = sanitize({ commentary: { roleMap: false } });
  assert.deepEqual(live.roleMap(p, ['ui/editor.tsx'], onChange), { off: true });
  settings.value = sanitize({});

  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      files: { 'ui/editor.tsx': 'screen', 'data/items.json': 'data', 'src/combat.cpp': 'brain' },
      areas: { screen: '레벨 에디터 화면이에요.', data: '아이템 목록이에요.', bogus: 'x' },
    }) } }] }) };
  });
  const paths = ['ui/editor.tsx', 'data/items.json', 'src/combat.cpp', '/home/me/notes.txt', '../outside.js'];
  const first = live.roleMap(p, paths, onChange);
  assert.equal(first.pending, true);
  assert.equal(first.files['/home/me/notes.txt'], 'other');
  assert.equal(first.files['../outside.js'], 'other');
  live.roleMap(p, paths, onChange);
  await settle();
  assert.equal(calls.length, 1, 'one call while the first is in flight');
  const prompt = calls[0].messages[1].content;
  assert.match(prompt, /ui\/editor\.tsx/);
  assert.doesNotMatch(prompt, /notes\.txt|outside\.js|secret contents/, 'outside paths and file contents are not sent');
  assert.equal(changed.length, 1, 'the map redraws when the answer lands');

  const done = live.roleMap(p, paths, onChange);
  assert.equal(done.pending, false);
  assert.equal(done.files['ui/editor.tsx'], 'screen');
  assert.equal(done.files['src/combat.cpp'], 'other', 'an unknown area id becomes "other"');
  assert.deepEqual(Object.keys(done.areas).sort(), ['data', 'screen']);
  assert.equal(calls.length, 1, 'known paths are not asked again');

  const again = new Live(hub(), { value: sanitize({}), file: settingsFile });
  again.booth = live.booth;
  assert.equal(again.roleMap(p, paths, onChange).files['data/items.json'], 'data', 'restored from disk');
  await settle();
  assert.equal(calls.length, 1);
});

test('routes fold repeats and links join areas a player wrote in one after the other', () => {
  const roles = { files: { 'ui/a.tsx': 'screen', 'data/b.json': 'data', 'src/c.cpp': 'logic' }, pending: false };
  const s = { cwd: '/w', feed: [
    { player: 'x', kind: 'look', paths: ['/w/ui/a.tsx'] },
    { player: 'x', kind: 'write', paths: ['ui/a.tsx'] },
    { player: 'x', kind: 'write', paths: ['data/b.json'] },
    { player: 'y', kind: 'write', paths: ['src/c.cpp'] },
    { player: 'x', kind: 'look', paths: ['data/b.json'] },
    { player: 'x', kind: 'write', paths: ['ui/a.tsx'] },
    { player: 'x', kind: 'test', paths: [] },
  ] };
  assert.deepEqual(routes(s, roles).get('x'), ['screen', 'data', 'screen']);
  assert.deepEqual(routes(s, roles).get('y'), ['logic']);
  assert.deepEqual(links(s, roles), [{ a: 'data', b: 'screen', n: 2 }], 'reading does not link; another player\'s write does not link');
  assert.equal(roleOf({ files: {}, pending: true }, 'new.js'), 'pending');
  assert.equal(roleOf({ files: {}, pending: false }, 'new.js'), 'other');
});
