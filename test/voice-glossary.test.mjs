import test from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../src/core/glossary.mjs';
import { setLanguage } from '../src/i18n/index.mjs';

test('glossary covers commands, warnings and tool kinds in English at call time', () => {
  const commands = 'electron dotnet sort cut diff awk du df ps kill xxd objdump strings java sleep tar unzip zip jq which export source pwd date env xargs tee uniq tr file stat ln basename dirname realpath ssh scp rsync docker kubectl gh uv poetry bun deno yarn pnpm npx node python python3 pip pip3 ls cat head tail grep rg find mkdir rm cp mv cd echo printf sed curl wget chmod touch wc cargo go make tsc eslint pytest flock cmp sh bash zsh pgrep free ffmpeg sha256sum md5sum systemctl test run'.split(' ');
  const git = 'status diff log add commit push pull checkout switch branch clone reset stash restore clean show worktree'.split(' ').map(s => `git ${s}`);
  const packages = ['npm', 'pnpm', 'yarn', 'bun'].flatMap(p => ['install', 'add', 'test', 'run', 'build'].map(s => `${p} ${s}`));
  const extra = ['rm -rf data', 'git push --force', 'git reset --hard', 'git clean -f', 'chmod 777 file', 'for x in a; do echo x; done', 'if true; then echo yes; fi', 'node <<EOF\nconsole.log(1)\nEOF'];
  try {
    for (const command of [...commands, ...git, ...packages, ...extra]) {
      setLanguage('ko');
      const before = explain({ kind: 'shell', command });
      setLanguage('en');
      const result = explain({ kind: 'shell', command });
      assert.ok(result.steps.length, command);
      for (const step of result.steps) {
        assert.ok(step.what, command);
        assert.doesNotMatch(step.what, /[가-힣]/, command);
      }
      setLanguage('ko');
      assert.deepEqual(explain({ kind: 'shell', command }), before);
    }
    setLanguage('en');
    for (const kind of ['read', 'write', 'edit', 'search', 'plan', 'delegate', 'other']) {
      assert.doesNotMatch(JSON.stringify(explain({ kind })), /[가-힣]/);
    }
    assert.equal(explain({ kind: 'shell', command: 'unknown-command' }).steps[0].what, '');
    assert.match(explain({ kind: 'shell', command: 'git push --force' }).steps[0].what, /Warning:.*remote history/);
    assert.equal(explain({ kind: 'shell', command: 'git commit' }).steps[0].what, "Saves everything you've changed as one step in the project's history. Like a save point in a game.");
  } finally { setLanguage('ko'); }
});
