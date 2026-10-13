import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../src/core/glossary.mjs';
import { TEST_CMD, caster } from '../src/core/caster.mjs';
import { MomentTracker } from '../src/core/moments.mjs';
test('test launch flags and wrappers are recognized, printed examples are not', () => {
  for (const cmd of ['python3 -B -m unittest tests', 'PYTHONPATH=x timeout 600 python3 -m unittest', 'dotnet test', 'npx vitest', 'npx jest', 'make test'])
    assert.ok(TEST_CMD.test(cmd), cmd);
  assert.ok(!TEST_CMD.test('echo "python3 -m unittest"'));
});
test('shell explanations preserve redirections, scripts, wrappers and control flow', () => {
  for (const cmd of ['node app.js 2>&1', 'node app.js &> out', 'node app.js >&2'])
    assert.deepEqual(explain({kind:'shell',command:cmd}).steps.map(s=>s.term), ['node']);
  for (const cmd of ["python3 - <<'EOF'\na=1; print(a)\nEOF", 'python3 -c "a=1;\\nprint(a)"'])
    assert.equal(explain({kind:'shell',command:cmd}).steps.length, 1);
  assert.equal(explain({kind:'shell',command:'X=1 timeout 600 env Y=2 sudo nice -n 2 time python3 a.py'}).steps[0].term, 'python3');
  assert.equal(explain({kind:'shell',command:'for x in a; do echo x; done'}).steps.length, 1);
  assert.deepEqual(explain({kind:'shell',command:'cd /tmp; for x in a; do echo x; done; pwd'}).steps.map(s=>s.term), ['cd','for','pwd']);
  assert.equal(explain({kind:'shell',command:'A=1'}).steps.length,0);
  assert.deepEqual(explain({kind:'shell',command:'echo "<<EOF"\npwd'}).steps.map(s=>s.term),['echo','pwd']);
  assert.deepEqual(explain({kind:'shell',command:"L=$(grep -n 'x' file | cut -d: -f1); sed -n 2p file"}).steps.map(s=>s.term),['sed']);
  assert.equal(explain({kind:'shell',command:'unknown-command'}).steps[0].what, '');
});
test('subshells normalize their launching command and missing file targets have plain captions', () => {
  for (const command of ['(XDG_CONFIG_HOME=/tmp/x timeout 20 electron . > log 2>&1 &)', '$(env X=1 electron .)', '(electron .)'])
    assert.equal(explain({kind:'shell',command}).steps[0].term,'electron');
  assert.equal(caster({kind:'read'}).text,'파일을 읽습니다');
  assert.equal(caster({kind:'shell',command:'sed -i s/a/b/ "$TARGET"'}).text,'파일을 고칩니다');
  assert.equal(caster({kind:'shell',command:'echo data > "$TARGET"'}).text,'파일을 씁니다');
  assert.match(caster({kind:'read',path:'a.js'}).text,/`a.js`/);
});
test('ignored errors need three unaddressed actions or unacknowledged turn end; probes are excluded', () => {
  for (const command of ['test -f a', 'which x', 'command -v x', 'ls a 2>/dev/null', 'x || true', 'grep x a']) {
    const t=new MomentTracker(); t.action({kind:'shell',command},0,'',true,false,false);
    assert.deepEqual(t.end('done'), []);
  }
  const t=new MomentTracker(); t.action({kind:'shell',command:'node app.js'},0,'Error: broken',true,false,false);
  assert.equal(t.before({kind:'read',path:'a'},1).length,0);
  assert.equal(t.before({kind:'read',path:'b'},2).length,0);
  assert.equal(t.before({kind:'read',path:'c'},3)[0].type,'ignored-error');
  const log=new MomentTracker(); log.action({kind:'shell',command:'tail app.log'},0,'Error: broken',true,false,false,false);
  assert.deepEqual(log.end('done'),[]);
  const blocked=new MomentTracker(); blocked.action({kind:'shell',command:'sleep 100'},0,'<tool_use_error>Blocked</tool_use_error>',true,false,false);
  assert.deepEqual(blocked.end('done'),[]);
  const last=new MomentTracker(); last.action({kind:'shell',command:'node app.js'},0,'Error: broken',true,false,false);
  last.before({kind:'read',path:'unrelated'},1);
  assert.equal(last.end('done').length,1);
  for (const text of ['done','error remains']) {
    const n=new MomentTracker(); n.action({kind:'shell',command:'node app.js'},0,'Error: broken',true,false,false);
    assert.equal(n.end(text).length,text==='done'?1:0);
  }
});
test('all requested command names have explanations; unfamiliar names remain unknown', () => {
  for (const name of 'dotnet sort cut diff awk du df ps kill xxd objdump strings java sleep tar unzip zip jq which export source pwd date env xargs tee uniq tr file stat ln basename dirname realpath ssh scp rsync docker kubectl gh uv poetry bun deno yarn pnpm npx electron'.split(' '))
    assert.ok(explain({kind:'shell',command:name}).steps[0].what, name);
  assert.ok(explain({kind:'shell',command:'env -i X=1'}).steps[0].what);
  assert.equal(explain({kind:'shell',command:'never-seen-command'}).steps[0].what,'');
});
