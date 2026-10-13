import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Settings, sanitize } from '../src/settings.mjs';
import { Live } from '../src/live.mjs';
import { Booth } from '../src/mic.mjs';
import { DEMO_CWD, DEMO_ROOT, playDemo, stopDemo } from '../src/demo.mjs';

test('first-run setup shows for new installs only', t => {
  const dir = mkdtempSync(join(tmpdir(), 'coding-live-onboard-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(new Settings(join(dir, 'none.json')).value.general.onboarded, false, 'no settings yet');
  writeFileSync(join(dir, 'old.json'), JSON.stringify({ general: { theme: 'dark' } }));
  assert.equal(new Settings(join(dir, 'old.json')).value.general.onboarded, true, 'settings from before first-run setup');
  writeFileSync(join(dir, 'new.json'), JSON.stringify({ general: { onboarded: false } }));
  assert.equal(new Settings(join(dir, 'new.json')).value.general.onboarded, false);
});

test('the example match stays out of the match list and alerts, and has its own role map and line counts', async () => {
  const sessions = [
    { key: 'real', agent: 'codex', cwd: '/w/shop', project: 'shop', updatedAt: Date.now(), live: true },
    { key: 'ex', agent: 'claude-code', cwd: DEMO_CWD, project: 'webshop', updatedAt: Date.now(), live: true, demo: true },
  ];
  const hub = Object.assign(new EventEmitter(), { tails: new Map(), sessions, async watch() { return null; } });
  const live = new Live(hub, { value: sanitize({}) });
  assert.deepEqual(live.listProjects().map(p => p.name), ['shop']);
  assert.equal(live.projects().length, 2, 'the tutorial can still open it');

  const watched = [];
  live.subscribe = async key => { watched.push(key); return () => {}; };
  live.startAlerts(() => {});
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(watched, ['real'], 'no alerts from the example match');

  live.booth = new Booth({ provider: 'compatible', via: 'api' });
  const example = live.projects().find(p => p.cwd === DEMO_CWD);
  const roles = live.roleMap(example, ['src/exports.mjs'], () => {});
  assert.equal(roles.files['src/exports.mjs'], 'logic');
  assert.ok(roles.areas.logic);
  assert.ok(live.codeLines(example, () => {}).test > 0);
});

test('stopping the tutorial ends the replay and removes the example match', async () => {
  const run = playDemo({ speed: 1000 });
  await new Promise(r => setTimeout(r, 30));
  await stopDemo();
  await run;
  assert.ok(!existsSync(DEMO_ROOT) || readdirSync(DEMO_ROOT).length === 0);
});
