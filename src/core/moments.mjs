import { TEST_CMD, commandWords, shellSteps } from './caster.mjs';
import { t, renderMessage } from '../i18n/index.mjs';
const labels = types => Object.defineProperties({}, Object.fromEntries(types.split(' ').map(type => [type, { enumerable: true, get: () => t(`moment.label.${type}`) }])));
const noted = (type, key, vars = {}, extra = {}) => ({ type, ...extra, noteMessage: { key: `moment.note.${key}`, vars }, get note() { return renderMessage(this.noteMessage); } });
export const STEP_TWO_LABELS = labels('claim-mismatch delete clash publish secret');

const secretPath = p => /(?:^|[\\/])(?:\.env[^\\/]*|[^\\/]+\.(?:pem|key)|id_rsa[^\\/]*|credentials[^\\/]*|secrets[^\\/]*\.json|\.npmrc|\.netrc)$|(?:^|[\\/])\.ssh(?:[\\/]|$)/i.test(p);
const steps = command => {
  const out = []; let part = '', quote = '', escaped = false;
  for (const ch of String(command ?? '')) {
    if (escaped) { part += ch; escaped = false; continue; }
    if (ch === '\\' && quote !== "'") { part += ch; escaped = true; continue; }
    if (quote) { part += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; part += ch; continue; }
    if ('&;|'.includes(ch)) { if (part.trim()) out.push(part.trim()); part = ''; }
    else part += ch;
  }
  if (part.trim()) out.push(part.trim());
  return out;
};
const words = s => (s.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map(s => s.replace(/^(['"])(.*)\1$/, '$2'));
const disposable = p => /(?:^|\/)(?:node_modules|dist|build|out|coverage|\.next|\.cache|__pycache__|target|tmp|temp|\.venv|venv)(?:\/|$)|^\/tmp\//.test(p);
export function extraCallMoments(tool = {}, risky = false) {
  const found = [], cmd = String(tool.command ?? '');
  if (tool.kind === 'read') {
    if (secretPath(String(tool.path ?? ''))) found.push(noted('secret', 'secretRead'));
  }
  if (tool.kind === 'shell') for (const step of steps(cmd)) {
    const [name, ...args] = words(step);
    if (name === 'git' && ['commit', 'push'].includes(args[0]))
      found.push(noted('publish', args[0]));
    if (['env', 'printenv'].includes(name) || (['cat', 'head', 'tail', 'sed', 'grep', 'rg', 'less', 'more'].includes(name) && args.some(secretPath)))
      found.push(noted('secret', 'secretPrint'));
    if (!risky && (name === 'rm' || (name === 'git' && args[0] === 'rm'))) {
      const paths = (name === 'git' ? args.slice(1) : args).filter(a => !a.startsWith('-') && !disposable(a));
      if (paths.length) found.push(noted('delete', 'delete', { paths: paths.join(', ').slice(0, 160) }));
    }
  }
  const removed = String(tool.removed ?? '').replace(/\n$/, '');
  const added = String(tool.added ?? '').replace(/\n$/, '');
  if (!risky && (tool.deleted === true || /\*\*\* Delete File:/.test(tool.patch ?? '') ||
    (tool.kind === 'edit' && removed && removed.split('\n').length >= 40 && (added ? added.split('\n').length : 0) < removed.split('\n').length / 4)))
    found.push(noted('delete', 'deleteContent', { path: tool.path ?? { key: 'caster.file' } }));
  return found;
}

export function claimsSuccess(text) {
  return /(?:완료|다 했|통과|\bfixed\b|\bdone\b|\ball tests pass\b)/i.test(text)
    && !/(?:not|isn't|aren't|never)\s+(?:yet\s+)?(?:done|fixed|pass)|아직|미완료|통과하지|완료하지/i.test(text);
}

export const STEP_THREE_LABELS = labels('wrestle revert install config cost compact long-run waiting denied pipe-run first-run ignored-error squad first-test');
export const MOMENT_LABEL = labels(`decision first-fail again recovery var stuck quiet thinking skip weaken silence mask risky assign report abort instruction big-write ${Object.keys(STEP_TWO_LABELS).join(' ')} ${Object.keys(STEP_THREE_LABELS).join(' ')}`);

export const momentEnabled = (type, settings = {}) => Object.hasOwn(MOMENT_LABEL, type) && settings?.[type] !== false;
export const momentSettings = (settings = {}) => Object.fromEntries(Object.keys(MOMENT_LABEL).map(type => [type, momentEnabled(type, settings)]));

const group = (key, types) => ({
  get label() { return t(`moment.group.${key}`); },
  moments: types.split(' ').map(type => ({ type, get label() { return MOMENT_LABEL[type]; }, get description() { return t(`moment.description.${type}`); } })),
});
export const MOMENT_GROUPS = [
  group('tests', 'first-test first-fail again recovery stuck'),
  group('concerns', 'var skip weaken silence mask risky claim-mismatch secret pipe-run ignored-error'),
  group('agents', 'assign report abort squad'),
  group('files', 'big-write delete clash publish wrestle revert install config first-run'),
  group('progress', 'quiet thinking cost compact long-run'),
  group('user', 'decision instruction waiting denied'),
];

export const pipeRun = command => {
  const text = String(command ?? '');
  if (/^(?:bash\s+<\(\s*(?:curl|wget)\b|iex\s*\(\s*iwr\b)/i.test(text.trim())) return true;
  // Preserve operators but discard quoted arguments, so printed examples are not commands.
  const executable = text.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, 'ARG');
  return /(?:^|[;&|])\s*(?:curl|wget)\b[^;\n|]*\|\s*(?:sh|bash|zsh|python3?|node)\b/.test(executable);
};
const firstRun = command => /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve)\b|node\s+(?:\S*\/)?(?:server|app|index)\.[cm]?js\b|python3?\s+(?:(?:\S*\/)?app\.py\b|(?:\S*\/)?manage\.py\s+runserver\b|-m\s+(?:uvicorn|flask)\b)|uvicorn\b|flask\s+run\b|cargo\s+run\b|go\s+run\b|docker\s+(?:run\b|compose\s+up\b))/.test(command);
const configPath = (path, text) => /(?:^|\/)(?:Dockerfile(?:\.[^/]+)?|tsconfig[^/]*\.json|\.eslintrc(?:\.[^/]+)?|eslint\.config\.[^/]+|\.prettierrc(?:\.[^/]+)?|prettier\.config\.[^/]+|\.gitlab-ci\.ya?ml)$|(?:^|\/)\.github\/workflows\/|(?:^|\/)(?:\.gitlab-ci|\.circleci)\/.*\.ya?ml$/.test(path)
  || /(?:^|\/)package\.json$/.test(path) && /["']scripts["']\s*:/.test(text);
const commandFamily = command => commandWords(shellSteps(command).find(s => commandWords(s)[0] !== 'cd') ?? '').slice(0, 2).join(' ');
const failureWords = /\berror\b|\bfail(?:ed|ure|ures|s)?\b|실패|오류|에러/i;
function tolerated(command, output) {
  if (/2>\s*\/dev\/null|\|\|\s*(?:true\b|:\s*(?:$|;)|exit\s+0\b)/.test(command)) return true;
  const cmds = shellSteps(command).map(commandWords);
  if (cmds.some(([cmd, sub]) => ['test', '[', 'which'].includes(cmd) || cmd === 'command' && sub === '-v')) return true;
  const body = String(output).replace(/(?:Process exited with code 1|(?:Command )?exit(?:ed)? (?:with )?code[: ]+1|\[exit code: 1\])/ig, '').trim();
  return cmds.some(([cmd]) => ['grep', 'rg'].includes(cmd)) && !body;
}

// Per-player detector memory. Only recorded calls/results feed this state; tick is explicitly live-only.
export class MomentTracker {
  constructor() {
    this.edits = new Map(); this.packages = new Set(); this.costs = new Set(); this.compactCount = 0;
    this.assignments = []; this.started = false; this.testSeen = false; this.failure = null;
    this.longCalls = new WeakSet();
  }
  say(text) { if (failureWords.test(text)) this.failure = null; }
  end(text) {
    const f = this.failure; this.failure = null;
    return f && !f.laterCommand && !failureWords.test(text) ? [noted('ignored-error', 'ignoredEnd', { command: f.command.slice(0, 180) })] : [];
  }
  before(tool, at) {
    const found = [];
    if (tool.name === 'AskUserQuestion' || tool.name === 'ask')
      found.push(noted('waiting', 'waiting'));
    if (this.failure) {
      const retry = tool.kind === 'shell' && commandFamily(tool.command) === commandFamily(this.failure.command);
      const repair = ['edit', 'write'].includes(tool.kind) && tool.path && this.failure.output.includes(tool.path);
      if (tool.kind === 'shell') this.failure.laterCommand = true;
      if (retry || repair) this.failure = null;
      else if (++this.failure.actions >= 3) {
        found.push(noted('ignored-error', 'ignoredActions', { command: this.failure.command.slice(0, 180) }));
        this.failure = null;
      }
    }
    if (tool.kind === 'shell' && !this.started && steps(tool.command).some(firstRun)) {
      this.started = true; found.push(noted('first-run', 'firstRun'));
    }
    if (tool.kind === 'delegate' && tool.type !== 'send') {
      this.assignments = this.assignments.filter(x => at - x.at <= 120_000);
      this.assignments.push({ at, tag: tool.tag || tool.agent });
      if (this.assignments.length >= 3) found.push(noted('squad', 'squad', { count: this.assignments.length }, { since: this.assignments[0].at }));
    }
    return found;
  }
  action(tool, at, output, bad, isTest, testPath, confirmedFailure = bad) {
    const found = [], path = String(tool.path ?? '').replace(/^\.\//, '');
    if (bad && /The user doesn't want to proceed|permission denied|user (?:denied|rejected)|사용자.*(?:거절|거부)|권한.*거부/i.test(output))
      found.push(noted('denied', 'denied'));
    if (tool.kind === 'shell' && confirmedFailure && !/<tool_use_error>/i.test(output) && !isTest && !TEST_CMD.test(tool.command) && !tolerated(tool.command, output))
      this.failure = { command: tool.command, output, actions: 0 };
    if (!bad && ['write', 'edit'].includes(tool.kind) && !tool.deleted) {
      const history = (this.edits.get(path) ?? []);
      if (tool.kind === 'edit' && String(tool.removed ?? '').trim() && history.some(x => x.kind === 'edit' && String(x.added ?? '').trim() === String(tool.removed).trim()))
        found.push(noted('revert', 'revert', { path }));
      history.push({ at, added: tool.added, kind: tool.kind }); this.edits.set(path, history);
      if (history.filter(x => at - x.at <= 600_000).length >= 5) found.push(noted('wrestle', 'wrestle', { path }));
      if (configPath(path, String(tool.content ?? tool.added ?? '') + String(tool.removed ?? ''))) found.push(noted('config', 'config', { path }));
      if (tool.kind === 'write' && testPath && !this.testSeen) found.push(noted('first-test', 'firstTest', { path }));
    }
    if (testPath || isTest) this.testSeen = true;
    if (tool.kind === 'shell' && !bad) for (const step of steps(tool.command)) {
      const tokens = words(step);
      const prefix = /^(?:(?:npm|pnpm|yarn|bun)\s+(?:add|install)|pip3?\s+install|cargo\s+add|uv\s+add|go\s+get)\s+/.exec(step);
      if (!prefix) continue;
      // Only a leading, explicit package operand is evidence. Bare install and option values are not names.
      const added = [];
      for (let i = 2; i < tokens.length; i++) {
        const pkg = tokens[i];
        if (['--registry', '--index-url', '--extra-index-url', '-i', '-r', '--requirement', '--target', '--prefix', '--version', '--features'].includes(pkg)) { i++; continue; }
        if (pkg.startsWith('-') || pkg === '.' || pkg === '..') continue;
        const ecosystem = ['npm', 'pnpm', 'yarn', 'bun'].includes(tokens[0]) ? 'js' : /^pip/.test(tokens[0]) || tokens[0] === 'uv' ? 'python' : tokens[0];
        const key = `${ecosystem}:${pkg}`;
        if (!this.packages.has(key)) { this.packages.add(key); added.push(pkg); }
      }
      if (added.length) found.push(noted('install', 'install', { packages: added.join(', ') }));
    }
    return found;
  }
  usage(value) {
    const found = [];
    for (const threshold of [1, 5, 10]) if (value >= threshold && !this.costs.has(threshold)) {
      this.costs.add(threshold); found.push(noted('cost', 'cost', { threshold }, { threshold }));
    }
    return found;
  }
  compact(count) {
    if (!Number.isInteger(count) || count <= this.compactCount) return [];
    this.compactCount = count;
    return [noted('compact', 'compact', { count })];
  }
}

// Explicit on-disk compaction markers only. A boundary and its summary describe one compaction.
export function recordedCompactions(agent, records) {
  if (agent === 'mixdog') {
    const doc = records[0];
    const count = doc?.compaction?.compactCount;
    return Number.isInteger(count) && count > 0 ? [{ type: 'compact', count }] : [];
  }
  let found = [];
  if (agent === 'claude-code') {
    const boundaries = records.filter(r => r.type === 'system' && r.subtype === 'compact_boundary');
    found = boundaries.length ? boundaries : records.filter(r => r.isCompactSummary === true);
  } else if (agent === 'codex') found = records.filter(r => r.type === 'compacted' || (r.type === 'response_item' && r.payload?.type === 'compacted'));
  return found.map((r, i) => ({ type: 'compact', count: i + 1, at: Date.parse(r.timestamp ?? '') }));
}
