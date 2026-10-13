import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adapter as claude, normalizeTool as claudeTool } from '../src/adapters/claude-code.mjs';
import { adapter as codex, normalizeTool as codexTool } from '../src/adapters/codex.mjs';
import { adapter as omp, normalizeTool as ompTool } from '../src/adapters/omp.mjs';
import { Match } from '../src/core/match.mjs';
import { groupProjects, buildProject } from '../src/project.mjs';

for (const [adapter, fixture, file] of [
  [claude, 'claude-subagent', '/projects/shop/parent/subagents/agent-worker.jsonl'],
  [codex, 'codex-subagent', '/sessions/rollout-child.jsonl'],
  [omp, 'omp-subagent', '/sessions/parent/Scout.jsonl'],
]) test(`${adapter.id} subagent joins its parent project`, () => {
  const parse = adapter.createParser(file);
  const child = new Match({ agent: adapter.id });
  for (const line of readFileSync(new URL(`./fixtures/${fixture}.jsonl`, import.meta.url), 'utf8').trim().split('\n')) {
    for (const e of parse(JSON.parse(line))) child.push(e);
  }
  const parentId = adapter === omp ? '/sessions/parent.jsonl' : 'parent';
  assert.equal(child.parent, parentId);
  const parent = new Match({ agent: adapter.id });
  const project = groupProjects([
    { key: 'p', sessionId: parentId, agent: adapter.id, cwd: '/work/shop', updatedAt: 1 },
    { key: 'c', agent: adapter.id, parent: child.parent, cwd: '/elsewhere', updatedAt: 1 },
  ])[0];
  const result = buildProject(project, [{ key: 'p', snap: parent.snapshot() }, { key: 'c', snap: child.snapshot() }]);
  assert.equal(result.players.find(p => p.key === 'c').parent, 'p');
});

test('delegate tools retain recorded identity and bounded summaries', () => {
  for (const tool of [
    claudeTool('Agent', { subagent_type: 'scout', description: 'Inspect', prompt: 'x '.repeat(200) }),
    claudeTool('Task', { subagent_type: 'scout', description: 'Inspect', prompt: 'x '.repeat(200) }),
    codexTool('spawn_agent', { agent_type: 'scout', nickname: 'Inspect', message: 'x '.repeat(200) }),
    ompTool('task', { tasks: [{ agent: 'scout', name: 'Inspect', task: 'x '.repeat(200) }] }),
  ]) {
    assert.equal(tool.kind, 'delegate');
    assert.equal(tool.agent, 'scout');
    assert.equal(tool.tag, 'Inspect');
    assert.equal(tool.prompt.length, 160);
  }
});
