// The caster: turns one finished tool call into a short ticker line. Rules only, no model,
// so it can't make anything up.

import { t as msg } from '../i18n/index.mjs';
export const base = p => (p ? String(p).split(/[\\/]/).filter(Boolean).at(-1) : msg('caster.file'));
const text = (key, vars = {}) => ({ text: msg(`caster.${key}`, vars) });
export const isCodePath = p => /\.(?:[cm]?[jt]sx?|py|rs|go|c|h|cc|cpp|hpp|cs|java|kt|swift|rb|php|sh|bash|zsh|sql|html|css|scss|vue|svelte)$/i.test(String(p ?? ''));
const fileKind = (path, test) => msg(test ? 'caster.testFile' : isCodePath(path) ? 'caster.code' : 'caster.file');
// Test folders, names like cart.test.js / cart_tests.cpp / cart-spec.ts, and names starting with test_ in any folder.
export const isTestPath = p => /(^|[\\/])(test|tests|__tests__|spec|specs)[\\/]|[._-](test|tests|spec|specs)\.|(^|[\\/])test_/.test(String(p ?? ''));

export function testScore(text) {
  const tap = { pass: /# pass (\d+)/.exec(text)?.[1], fail: /# fail (\d+)/.exec(text)?.[1] };
  if (tap.pass != null && tap.fail != null) return { pass: Number(tap.pass), fail: Number(tap.fail) };
  const jest = /Tests?:\s+(?:(\d+) failed, )?(?:\d+ skipped, )?(\d+) passed/.exec(text);
  if (jest) return { pass: Number(jest[2]), fail: Number(jest[1] ?? 0) };
  const vitest = /Tests\s+(?:(\d+) failed \| )?(\d+) passed/.exec(text);
  if (vitest) return { pass: Number(vitest[2]), fail: Number(vitest[1] ?? 0) };
  const py = /^=+ (.*\b(?:passed|failed)\b.*) in [\d.]+s/m.exec(text);
  if (py) return { pass: Number(/(\d+) passed/.exec(py[1])?.[1] ?? 0), fail: Number(/(\d+) failed/.exec(py[1])?.[1] ?? 0) + Number(/(\d+) errors?/.exec(py[1])?.[1] ?? 0) };
  const cargo = /test result: \w+\. (\d+) passed; (\d+) failed/.exec(text);
  if (cargo) return { pass: Number(cargo[1]), fail: Number(cargo[2]) };
  return null;
}

export const looksFailed = (output, error) => !!error
  || /\bnot ok \d|# fail [1-9]|^\S*Error:|\n\S*Error:|npm ERR!|Command failed|exit code [1-9]|Traceback \(most recent call last\)|\bFAILED\b|error\[E\d+\]/m.test(String(output ?? ''));

export function shellSteps(raw) {
  const lines = String(raw).split('\n'), cleaned = [];
  let headerQuote = '', headerEscape = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; cleaned.push(line);
    const docs = [];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (headerEscape) { headerEscape = false; continue; }
      if (ch === '\\' && headerQuote !== "'") { headerEscape = true; continue; }
      if (headerQuote) { if (ch === headerQuote) headerQuote = ''; continue; }
      if (ch === '<' && line[j - 1] !== '<') {
        const doc = /^<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(line.slice(j));
        if (doc) { docs.push(doc[2]); j += doc[0].length - 1; continue; }
      }
      if (ch === '"' || ch === "'") headerQuote = ch;
    }
    for (const delimiter of docs) { while (++i < lines.length && lines[i].trim() !== delimiter) {} }
  }
  const text = cleaned.join('\n');
  const out = []; let part = '', quote = '', escape = false, depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { part += ch; escape = false; continue; }
    if (ch === '\\' && quote !== "'") { part += ch; escape = true; continue; }
    if (quote) { part += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; part += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (!depth && /[;&|\n]/.test(ch) && !(ch === '&' && (/[<>]/.test(text[i - 1] ?? '') || text[i + 1] === '>'))) {
      if (part.trim()) out.push(part.trim()); part = '';
    } else part += ch;
  }
  if (part.trim()) out.push(part.trim());
  const grouped = [];
  for (let i = 0; i < out.length; i++) {
    let step = out[i];
    if (/^(?:for|while|until|if|case)\b/.test(step)) {
      let level = 1;
      while (level && ++i < out.length) {
        const next = out[i];
        if (/^(?:for|while|until|if|case)\b/.test(next)) level++;
        if (/^(?:done|fi|esac)\b/.test(next)) level--;
        step += `; ${next}`;
      }
    }
    if (!/^(?:[{}]|\/\/.*|\d+|\\)$/.test(step) && commandWords(step).length) grouped.push(step);
  }
  return grouped;
}
export function commandWords(step) {
  step = step.trim().replace(/^(?:\$\(|\()+\s*/, '');
  const tokens = []; let word = '', quote = '', depth = 0, escaped = false;
  for (const ch of step) {
    if (escaped) { word += ch; escaped = false; continue; }
    if (ch === '\\' && quote !== "'") { word += ch; escaped = true; continue; }
    if (quote) { word += ch; if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"') { quote = ch; word += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && !depth) { if (word) tokens.push(word); word = ''; } else word += ch;
  }
  if (word) tokens.push(word);
  for (let i = 0; i < tokens.length; i++) tokens[i] = tokens[i].replace(/^(['"])(.*)\1$/s, '$2');
  let environment = false;
  while (tokens.length) {
    if (/^[A-Za-z_]\w*=/.test(tokens[0])) { tokens.shift(); continue; }
    const wrapper = tokens[0];
    if (!['env', 'sudo', 'nice', 'time', 'timeout'].includes(wrapper) || tokens.length === 1) break;
    tokens.shift();
    if (wrapper === 'env') environment = true;
    while (tokens[0]?.startsWith('-')) {
      const opt = tokens.shift();
      if (['-u', '-g', '-k', '-s', '--signal', '--kill-after', '--adjustment', '--unset'].includes(opt) || opt === '-n' && wrapper === 'nice') tokens.shift();
    }
    if (wrapper === 'timeout') tokens.shift();
  }
  return tokens.length || !environment ? tokens : ['env'];
}
export const TEST_CMD = { test: command => shellSteps(command).some(step => {
  const c = commandWords(step).join(' ');
  return /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|node\s+(?:--[\w=-]+\s+)*--test\b|(?:npx\s+)?(?:vitest|jest|mocha|pytest|tox)\b|python3?\s+(?:(?:-[BEIsSuOqv]+|-(?:W|X)\s+\S+)\s+)*-m\s+(?:pytest|unittest)\b|(?:cargo|go|deno|dotnet|make)\s+test\b)/.test(c);
}) };
const PATH_RE = /(?:^|[\s'"=(])((?:~?\/|\.{1,2}\/)?[\w.@+-]+(?:\/[\w.@+-]+)*\.(?:m?[jt]sx?|cjs|json|py|md|csv|txt|html|css|scss|ya?ml|toml|sh|go|rs|java|kt|rb|php|c|h|cpp|hpp|cs|swift|sql|vue|svelte))(?=$|[\s'";|&)<>,])/g;
export const pathsIn = cmd => [...new Set([...String(cmd).matchAll(PATH_RE)].map(m => m[1]))].slice(0, 4);

/** @returns {{kind: string, text: string, paths: string[], score?: {pass:number, fail:number}|null}} */
export function caster(tool, output = '', error = false) {
  const t = tool ?? {};
  const name = t.name ?? msg('caster.tool');
  if (t.kind === 'write' || t.kind === 'edit') {
    const target = String(t.path ?? '');
    const test = isTestPath(target);
    const lines = t.kind === 'write' && t.content != null ? String(t.content).split('\n').length : null;
    if (!target) return { kind: 'write', paths: [], ...text(t.kind === 'write' ? 'write' : 'edit') };
    return { kind: test ? 'write-test' : 'write', paths: [target], ...text(t.kind === 'write' ? 'writeNamed' : 'editNamed', { kind: fileKind(target, test), file: base(target), lines: lines ? msg('caster.lines', { count: lines }) : '' }) };
  }
  if (t.kind === 'read') return { kind: 'look', paths: t.path ? [String(t.path)] : [], ...text(t.path ? 'readNamed' : 'read', { file: base(t.path) }) };
  if (t.kind === 'search') return { kind: 'look', paths: [], ...text('search', { pattern: String(t.pattern ?? '').slice(0, 30) }) };
  if (t.kind === 'plan') return { kind: 'other', paths: [], ...text('plan') };
  if (t.kind === 'delegate') return { kind: 'other', paths: [], ...text('delegate') };
  if (t.kind !== 'shell') return { kind: 'other', paths: [], ...text('other', { name }) };

  let cmd = String(t.command ?? '');
  cmd = cmd.replace(/^\s*cd\s+\S+\s*(&&|;)\s*/, '');
  const out = String(output ?? '');
  const failed = looksFailed(out, error);
  const paths = pathsIn(cmd);
  if (/\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b|\bpip3?\s+install\b|\bcargo\s+add\b|\buv\s+(add|pip)\b/.test(cmd))
    return { kind: 'install', paths: [], ...text('install', { name: cmd.replace(/.*\b(?:install|add|i)\s+/, '').split(/\s|&&/)[0] || msg('caster.dependencies') }) };
  if (TEST_CMD.test(cmd)) {
    const s = testScore(out);
    if (!s && /\|\s*(grep|head|tail)\b/.test(cmd)) return { kind: 'look', paths: [], ...text(/not ok|FAIL|failed/i.test(out) ? 'inspectFail' : 'inspectTest') };
    const names = [...new Set([...out.matchAll(/not ok \d+ - ([^\n#]+)/g)].map(m => m[1].trim()).filter(x => !/\.m?js$|^test\//.test(x)))].slice(0, 2);
    if (s) return { kind: 'test', score: s, paths: [], ...text(s.fail ? 'testFail' : 'testPass', { ...s, total: s.pass + s.fail, names: names.length ? msg('caster.testNames', { names: names.map(x => `\`${x.slice(0, 40)}\``).join(', ') }) : '' }) };
    return { kind: 'test', score: null, paths: [], ...text(failed ? 'testError' : 'testRun') };
  }
  const redirect = /(?:cat|tee)\s+(?:-a\s+)?>{0,2}\s*(\S+\.\w+)\s*<<|(?:cat|echo|printf)[^|]*?>{1,2}\s*(\S+\.\w+)/.exec(cmd);
  const writing = !!redirect || /(?:^|[;&|]\s*)(?:cat|echo|printf|tee)\b[^|]*?>{1,2}\s*\S+/.test(cmd);
  if (writing || /\bsed\s+-i|\bpython3?\s+-\s*<<|\bapply_patch\b|\bpatch\s+-p/.test(cmd)) {
    const target = redirect?.[1] ?? redirect?.[2] ?? paths[0] ?? '';
    const test = isTestPath(target);
    return { kind: test ? 'write-test' : 'write', paths: target ? [target] : [], ...text(target ? writing ? 'writeNamed' : 'editNamed' : writing ? 'write' : 'edit', { kind: fileKind(target, test), file: base(target), lines: '' }) };
  }
  if (/\bnode\s+(-e|\S+\.m?[jt]s)|\bpython3?\s+(-c|\S+\.py)|\b(deno|bun|tsx|ts-node)\s+(run\s+)?\S+\.[jt]sx?|\bcargo\s+run\b|\bgo\s+run\b/.test(cmd)) {
    const script = /\b(?:node|python3?|deno|bun|tsx|ts-node)\s+(?:run\s+)?(\S+\.(?:m?[jt]sx?|py))/.exec(cmd)?.[1];
    return { kind: 'try', paths: script ? [script] : [], ...text(failed ? 'tryError' : 'tryRun') };
  }
  if (/^\s*mkdir\b/.test(cmd)) return { kind: 'other', paths: [], ...text('mkdir') };
  if (/^\s*(ls|find|tree|fd)\b/.test(cmd)) return { kind: 'look', paths: [], ...text('browse') };
  if (/^\s*git\s+(status|diff|log|show)/.test(cmd)) return { kind: 'look', paths: [], ...text('changes') };
  if (/^\s*git\s+commit\b/.test(cmd)) return { kind: 'other', paths: [], ...text('commit') };
  if (/^\s*git\s+push\b/.test(cmd)) return { kind: 'other', paths: [], ...text('push') };
  if (/^\s*(cat|head|tail|sed -n|less|bat|nl)\b/.test(cmd)) return { kind: 'look', paths: paths.slice(0, 1), ...text('readNamed', { file: base(paths[0]) }) };
  if (/^\s*(grep|rg|ag)\b/.test(cmd)) return { kind: 'look', paths: [], ...text('clues') };
  if (/\b(pkill|kill)\b/.test(cmd)) return { kind: 'other', paths: [], ...text('stop') };
  if (/\b(npm|pnpm|yarn)\s+run\s+(build|lint|typecheck)|\btsc\b|\beslint\b|\bcargo\s+(build|check|clippy)\b/.test(cmd))
    return { kind: 'try', paths: [], ...text(failed ? 'buildError' : 'build') };
  return { kind: 'other', paths: [], ...text(failed ? 'commandError' : 'command') };
}

// Stadium lanes: where on the pitch the play happened.
export const LANES = Array(5);
for (let i = 0; i < 5; i++) Object.defineProperty(LANES, i, { enumerable: true, get: () => msg(`lane.${i}`) });
export function lane(c, prevFailed) {
  if (c.kind === 'test' || c.kind === 'try') return c.failed ? 3 : (c.kind === 'test' ? 4 : 2);
  if (c.kind === 'write' || c.kind === 'write-test') return prevFailed ? 3 : 1;
  if (c.kind === 'install') return 1;
  return 0;
}
