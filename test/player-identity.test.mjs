import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/core/match.mjs';
import { sessionName, NAMES, setNameStyle, companyOf, nameList } from '../src/core/names.mjs';
import { sanitize } from '../src/settings.mjs';

test('name styles: pun by default, names follow the model company, meme and plain on request', t => {
  t.after(() => setNameStyle('pun'));
  assert.equal(sanitize({}).general.nameStyle, 'pun');
  assert.equal(sanitize({ general: { nameStyle: 'bogus' } }).general.nameStyle, 'pun');
  assert.deepEqual(['claude-opus-5-5', 'gpt-5', 'codex-mini', 'gemini-2.5-flash', 'grok-4.5', 'llama-4', 'devstral', 'deepseek-v4-pro', 'qwen3-coder-plus', 'kimi-k2', 'glm-5.2', ''].map(companyOf),
    ['anthropic', 'openai', 'openai', 'google', 'xai', 'meta', 'mistral', 'deepseek', 'alibaba', 'moonshot', 'common', 'common']);
  setNameStyle('pun');
  assert.equal(sessionName(new Set(), 'claude-opus-5-5'), '다리오 아무데이', 'the first player gets the top name');
  setNameStyle('meme');
  assert.equal(sessionName(new Set(), 'gpt-5'), '샘 알트만');
  setNameStyle('plain');
  assert.equal(sessionName(new Set(), 'gpt-5'), NAMES[0]);
  setNameStyle('pun');
  const one = nameList('deepseek-v4-pro');
  assert.equal(one.length, 1);
  assert.equal(sessionName(new Set(one), 'deepseek-v4-pro'), `${one[0]} 2`, 'a small company list numbers repeats');
});
import { groupProjects, buildProject } from '../src/project.mjs';

test('names go down the list in order and skip names already taken', () => {
  assert.ok(NAMES.length >= 40);
  const list = nameList('claude-haiku-5-5');
  assert.equal(sessionName(new Set([list[0]]), 'claude-haiku-5-5'), list[1]);
  assert.equal(sessionName(new Set([list[0], list[1]]), 'claude-haiku-5-5'), list[2]);
});

test('in a project the lead gets the top name and subagents follow by start time, whatever their keys', () => {
  const snap = (t0, parent) => { const m = new Match(); m.push({ type: 'model', at: t0, model: 'claude-haiku-5-5' }); if (parent) m.push({ type: 'role', at: t0, parent }); m.push({ type: 'prompt', at: t0, text: 'task' }); return m.snapshot(t0 + 1000); };
  const p = buildProject({ key: 'k', name: 'shop', cwd: '/w', players: [{ key: 'zz-lead' }, { key: 'aa-late', parent: 'zz-lead' }, { key: 'mm-early', parent: 'zz-lead' }] },
    [{ key: 'aa-late', snap: snap(3000, 'zz-lead') }, { key: 'mm-early', snap: snap(2000, 'zz-lead') }, { key: 'zz-lead', snap: snap(1000) }]);
  const list = nameList('claude-haiku-5-5');
  const name = key => p.players.find(x => x.key === key).name;
  assert.deepEqual([name('zz-lead'), name('mm-early'), name('aa-late')], list.slice(0, 3));
});

test('a lead with more subagents than the player limit stays in its match', () => {
  const records = [{ key: 'lead', sessionId: 'lead', agent: 'claude-code', cwd: '/w', project: 'w', updatedAt: 1000, live: false }];
  for (let i = 0; i < 12; i++) records.push({ key: `s${i}`, sessionId: `s${i}`, agent: 'claude-code', cwd: '/w/elsewhere', parent: 'lead', updatedAt: 2000 + i, live: false });
  const groups = groupProjects(records);
  assert.equal(groups.length, 1, 'subagents working in another folder still join the lead');
  assert.ok(groups[0].players.some(p => p.key === 'lead'));
  assert.ok(groups[0].players.filter(p => p.parent).every(p => groups[0].players.some(x => x.key === p.parent)));
});

test('live match roster: working and just-finished subagents play, older ones have left', () => {
  const now = Date.now();
  const records = [
    { key: 'lead', sessionId: 'lead', agent: 'mixdog', cwd: '/w', project: 'w', model: 'claude-opus-5-5', updatedAt: now, live: true },
    { key: 'busy', sessionId: 'busy', agent: 'mixdog', parent: 'lead', model: 'claude-haiku-5-5', name: 'engine', updatedAt: now, live: true },
    { key: 'just', sessionId: 'just', agent: 'mixdog', parent: 'lead', model: 'claude-haiku-5-5', updatedAt: now - 60_000, live: false },
    { key: 'gone', sessionId: 'gone', agent: 'mixdog', parent: 'lead', model: 'gpt-6-astra', name: 'voice', role: 'worker', updatedAt: now - 30 * 60_000, live: false },
  ];
  const [g] = groupProjects(records);
  assert.deepEqual(g.players.map(p => p.key).sort(), ['busy', 'just', 'lead']);
  assert.deepEqual(g.left.map(p => p.key), ['gone']);
  const lead = new Match({ id: 'lead' }), busy = new Match({ id: 'busy' });
  const s = buildProject(g, [{ key: 'lead', snap: lead.snapshot() }, { key: 'busy', snap: busy.snapshot() }]);
  assert.ok(s.players.every(p => !p.left));
  assert.equal(s.left.length, 1);
  assert.equal(s.left[0].name, 'voice', 'a recorded name is kept for an unwatched subagent');
  assert.equal(s.left[0].role, 'worker');
  assert.equal(s.left[0].parentName, s.players.find(p => p.key === 'lead').name);
});

test('subagent without cwd joins parent, exposes parent name and file focus', () => {
  const records = [
    { key: 'p', sessionId: 'parent', agent: 'mixdog', cwd: '/work', project: 'work', updatedAt: 1000, live: true },
    { key: 'c', sessionId: 'child', agent: 'mixdog', parent: 'parent', updatedAt: 1000, live: true },
  ];
  const groups = groupProjects(records);
  assert.equal(groups.length, 1);
  const p = new Match({ id: 'p' }), c = new Match({ id: 'c' });
  c.push({ type: 'role', at: 1000, parent: 'parent', role: 'worker', tag: 'tools', name: 'tools' });
  c.push({ type: 'call', at: 2000, id: 'x', tool: { kind: 'write', path: 'main.js', content: 'x' } });
  c.push({ type: 'result', at: 3000, id: 'x', output: '' });
  const s = buildProject(groups[0], [{ key: 'p', snap: p.snapshot() }, { key: 'c', snap: c.snapshot() }]);
  const child = s.players.find(p => p.key === 'c');
  assert.equal(child.name, 'tools');
  assert.equal(child.parent, 'p');
  assert.equal(child.parentName, s.players.find(p => p.key === 'p').name);
  assert.equal(s.files[0].edits, 1);
  assert.equal(s.files[0].lastAt, 2000);
});
