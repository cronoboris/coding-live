import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Live } from '../src/live.mjs';
import { Booth } from '../src/mic.mjs';
import { sanitize } from '../src/settings.mjs';

test('a file note explains project files only, sends the start of the file, and is reused per file version', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'coding-live-project-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'cart.js'), 'export const total = items => items.reduce((a, i) => a + i.price, 0);\n');
  writeFileSync(join(dir, 'src', 'cart.test.js'), 'test');
  writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  writeFileSync(join(dir, '..', 'outside.txt'), 'secret');
  t.after(() => rmSync(join(dir, '..', 'outside.txt'), { force: true }));
  const settings = { value: sanitize({}) };
  const live = new Live(Object.assign(new EventEmitter(), { tails: new Map(), sessions: [] }), settings);
  live.projects = () => [{ key: 'p', name: 'shop', cwd: dir }];

  assert.deepEqual(await live.explainFile('p', 'src/cart.js'), { error: 'nomic' });
  live.booth = new Booth({ provider: 'compatible', via: 'api', url: 'http://127.0.0.1:9/v1', model: 'm' });
  settings.value = sanitize({ commentary: { fileExplain: false } });
  assert.deepEqual(await live.explainFile('p', 'src/cart.js'), { error: 'off' });
  settings.value = sanitize({});

  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '{"part":"데이터","text":"장바구니 합계를 계산하는 파일이에요."}' } }] }) };
  });
  // Windows may refuse to create links without extra rights; the check then covers the other paths.
  let linked = true;
  try { symlinkSync(join(dir, '..', 'outside.txt'), join(dir, 'src', 'link.txt')); } catch (error) { if (error.code !== 'EPERM') throw error; linked = false; }
  writeFileSync(join(dir, 'blob.bin'), Buffer.from([0xff, 0xfe, 0x81, 0x41, 0x42]));
  for (const path of ['../outside.txt', '/etc/hostname', 'src', 'nope.js', ...(linked ? ['src/link.txt'] : [])]) assert.deepEqual(await live.explainFile('p', path), { error: 'missing' }, path);
  assert.equal(calls.length, 0, 'nothing outside the project is sent');

  const note = await live.explainFile('p', 'src/cart.js');
  assert.equal(note.part, '데이터'); assert.match(note.text, /장바구니/);
  const prompt = calls[0].messages[1].content;
  assert.match(prompt, /src\/cart\.js/); assert.match(prompt, /items\.reduce/); assert.match(prompt, /cart\.test\.js/);
  await live.explainFile('p', 'src/cart.js');
  assert.equal(calls.length, 1, 'the same file version is not asked twice');
  writeFileSync(join(dir, 'src', 'cart.js'), 'export const total = () => 0; // changed\n');
  await live.explainFile('p', 'src/cart.js');
  assert.equal(calls.length, 2, 'a changed file is asked again');
  await live.explainFile('p', 'logo.png');
  assert.doesNotMatch(calls[2].messages[1].content, /\u0000/, 'binary contents are not sent');
  await live.explainFile('p', 'blob.bin');
  assert.match(calls[3].messages[1].content, /not a text file|글자가 아닌 파일/, 'invalid UTF-8 counts as binary');
  assert.doesNotMatch(calls[3].messages[1].content, /AB/);
});
