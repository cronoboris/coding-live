// Lessons: what a scene means for someone who can't read code. Each one is a fixed, reviewed explanation — an
// everyday analogy, why it matters, how to tell an honest move from a trick, and one question to paste into the
// agent. Commentary (fixed lines or AI) builds on these, so what a viewer learns never depends on what a model
// happened to say. Detectors here are rules over the tool calls the adapters record; they only flag, never judge.

import { base, isTestPath, TEST_CMD } from './caster.mjs';
import { pipeRun, MOMENT_LABEL } from './moments.mjs';
import { t, catalogs, language } from '../i18n/index.mjs';

// kind: 'trick' = a shortcut an AI may take to look done, 'signal' = something to act on, 'rule' = how the game works.
export const LESSONS = {
  'pipe-run': {
    kind: 'trick',
  },
  test: {
    kind: 'rule',
  },
  retry: {
    kind: 'rule',
  },
  loop: {
    kind: 'signal',
  },
  'answer-key': {
    kind: 'trick',
  },
  'pass-meaning': {
    kind: 'rule',
  },
  assumption: {
    kind: 'signal',
  },
  'long-think': {
    kind: 'rule',
  },
  stall: {
    kind: 'signal',
  },
  'skip-test': {
    kind: 'trick',
  },
  'weaker-test': {
    kind: 'trick',
  },
  silence: {
    kind: 'trick',
  },
  mask: {
    kind: 'trick',
  },
  risky: {
    kind: 'signal',
  },
  'self-test': {
    kind: 'signal',
  },
  'no-test': {
    kind: 'signal',
  },
};
for (const [id, lesson] of Object.entries(LESSONS)) {
  for (const field of ['name', 'analogy', 'why', 'tell', 'ask']) {
    Object.defineProperty(lesson, field, { enumerable: true, get: () => t(`lesson.${id}.${field}`) });
  }
}
export const KIND_LABEL = Object.fromEntries(['trick', 'signal', 'rule'].map(kind => [kind, null]));
for (const kind of Object.keys(KIND_LABEL)) Object.defineProperty(KIND_LABEL, kind, { enumerable: true, get: () => t(`kind.${kind}`) });
export const TRICKS = Object.keys(LESSONS).filter(id => LESSONS[id].kind === 'trick');

// Which lesson a key moment teaches.
export const MOMENT_LESSON = {
  'pipe-run': 'pipe-run',
  'first-fail': 'test', again: 'retry', stuck: 'loop', var: 'answer-key', recovery: 'pass-meaning', decision: 'assumption',
  thinking: 'long-think', quiet: 'stall', skip: 'skip-test', weaken: 'weaker-test', silence: 'silence', mask: 'mask', risky: 'risky',
};
export const lessonFor = type => { const id = MOMENT_LESSON[type]; return id ? { id, ...LESSONS[id] } : null; };

// Lessons for the end of a match, from what never happened during it.
export function endLessons(st) {
  const out = [];
  if (!st.lastTest) out.push('no-test');
  else if (st.testsWrittenByAI) out.push('self-test');
  return out.map(id => ({ id, ...LESSONS[id] }));
}

// ---- detectors -------------------------------------------------------------------------------
const SKIP = /\b(?:it|test|describe|context|suite)\.(?:skip|todo)\s*\(|\bx(?:it|test|describe|context)\s*\(|@pytest\.mark\.(?:skip|skipif|xfail)\b|\bpytest\.skip\s*\(|@unittest\.(?:skip\w*|expectedFailure)\b|#\[ignore\]|\bt\.Skip(?:Now|f)?\s*\(/;
const ONLY = /\b(?:it|test|describe|context)\.only\s*\(|\bf(?:it|describe)\s*\(/;
const SKIP_FLAGS = /\s(--passWithNoTests|--testPathIgnorePatterns\S*|--deselect\s+\S+|--ignore[=\s]\S+|-k\s+['"]?not\b[^'"]*['"]?|--skip\s+\S+)/;
const ASSERT = /\b(?:expect|assert(?:Equal|Equals|True|False|Raises|That|In|Is\w*)?|should|t\.(?:equal|deepEqual|strictEqual|ok|is|true|false|throws)|assert\.\w+)\s*\(|^\s*assert\s/gm;
const SILENCE = /eslint-disable(?:-next-line|-line)?|@ts-ignore|@ts-nocheck|@ts-expect-error|#\s*type:\s*ignore|#\s*noqa|#\s*pylint:\s*disable|\/\/\s*nolint|#!?\[allow\(|@SuppressWarnings|biome-ignore/;
const MASK = /\|\|\s*(?:true|:|exit\s+0)\b|;\s*exit\s+0\b|\bset\s+\+e\b|continue-on-error:\s*true/;
const CHECK_CMD = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|check)\b|\btsc\b|\beslint\b|\bcargo\s+(?:build|check|clippy|test)\b/;
const RISKY = [
  [/\bgit\s+push\b[^;&|]*?\s(?:-f|--force|--force-with-lease)(?=\s|$)/, 'git push --force', '저장소 기록을 강제로 덮어쓰는'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard', '저장하지 않은 변경을 모두 버리는'],
  [/\bgit\s+clean\s+-\w*f/, 'git clean -f', '기록에 없는 파일을 지우는'],
  [/\bgit\s+(?:checkout|restore)\s+(?:--\s+)?\.(?=\s|$)/, 'git checkout .', '바꾼 내용을 통째로 되돌리는'],
  [/\b(?:npm|pnpm|yarn)\s+(?:i|install|add)\b[^;&|]*\s(?:--force|-f|--legacy-peer-deps)(?=\s|$)/, '--force 설치', '버전 충돌 검사를 끄고 설치하는'],
  [/\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b|\bTRUNCATE\s+TABLE\b/i, 'DROP TABLE', '데이터베이스를 지우는'],
  [/\bchmod\s+(?:-R\s+)?0?777\b/, 'chmod 777', '누구나 파일을 고칠 수 있게 여는'],
];
// Things that are fine to delete: rebuilt or downloaded again on the next run.
const DISPOSABLE = /(?:^|\/)(?:node_modules|dist|build|out|coverage|\.next|\.nuxt|\.cache|\.turbo|\.parcel-cache|\.pytest_cache|__pycache__|target|tmp|temp|\.venv|venv)\/?\*?$|^\/tmp\/|^\$\{?TMPDIR/;

const count = (re, s) => (String(s ?? '').match(re) ?? []).length;
const firstMatch = (re, s) => re.exec(String(s ?? ''))?.[0]?.trim();
const deleted = cmd => {
  const out = [];
  for (const m of String(cmd).matchAll(/(?:^|[;&|(]\s*|\s)(?:git\s+)?rm\s+((?:-[a-zA-Z]+\s+)*)([^;&|)]+)/g))
    out.push({ recursive: /r/i.test(m[1]), targets: m[2].trim().split(/\s+/).filter(t => t && !t.startsWith('-')) });
  return out;
};

/** One tool call → the trick-ish patterns it shows, as moments to add: [{ type, note }]. */
export function detectTricks(tool, output = '', error = false) {
  const t = tool ?? {}, found = [];
  if (t.kind === 'write' || t.kind === 'edit') {
    const path = String(t.path ?? ''), name = base(path);
    const added = t.kind === 'write' ? t.content : t.added;
    if (isTestPath(path)) {
      if (SKIP.test(added ?? '')) found.push({ type: 'skip', note: `테스트 파일 \`${name}\`에 건너뛰기 표시(\`${firstMatch(SKIP, added)}\`)를 넣었어요.` });
      else if (ONLY.test(added ?? '')) found.push({ type: 'skip', note: `테스트 파일 \`${name}\`에 "이것만 돌리기" 표시(\`${firstMatch(ONLY, added)}\`)를 넣었어요. 나머지 테스트는 건너뛰어요.` });
      const lost = t.kind === 'edit' && t.removed != null ? count(ASSERT, t.removed) - count(ASSERT, added) : 0;
      if (lost > 0) found.push({ type: 'weaken', note: `테스트 파일 \`${name}\`에서 검사 문장 ${lost}개가 줄었어요.` });
    }
    const quiet = firstMatch(SILENCE, added);
    if (quiet) found.push({ type: 'silence', note: `\`${name}\` 파일에 경고 끄기(\`${quiet}\`)를 넣었어요.` });
    if (/(?:^|[\\/])(?:package\.json|Makefile|[^\\/]+\.ya?ml)$/.test(path) && MASK.test(added ?? '')) found.push({ type: 'mask', note: `\`${name}\`에 실패를 무시하는 설정(\`${firstMatch(MASK, added)}\`)을 넣었어요.` });
    return found;
  }
  if (t.kind !== 'shell') return found;
  const cmd = String(t.command ?? '');
  if (pipeRun(cmd)) found.push({ type: 'pipe-run', note: '외부에서 받은 코드를 내용 확인 없이 바로 실행하는 명령입니다.' });
  const removedTests = deleted(cmd).flatMap(d => d.targets).filter(isTestPath);
  if (removedTests.length) found.push({ type: 'weaken', note: `테스트 파일 \`${base(removedTests[0])}\`${removedTests.length > 1 ? ` 등 ${removedTests.length}개` : ''}을(를) 지웠어요.` });
  if (TEST_CMD.test(cmd)) { const f = SKIP_FLAGS.exec(cmd); if (f) found.push({ type: 'skip', note: `테스트 명령에 일부 테스트를 빼는 옵션(\`${f[1].trim()}\`)을 붙였어요.` }); }
  if ((TEST_CMD.test(cmd) || CHECK_CMD.test(cmd)) && MASK.test(cmd)) found.push({ type: 'mask', note: `검사 명령 뒤에 실패를 무시하는 \`${firstMatch(MASK, cmd)}\`를 붙였어요. 실패해도 성공으로 보여요.` });
  if (/\bgit\s+commit\b[^;&|]*--no-verify\b/.test(cmd)) found.push({ type: 'silence', note: '커밋 전 검사를 건너뛰는 옵션(`--no-verify`)을 썼어요.' });
  if (!removedTests.length) {
    const risky = RISKY.find(([re]) => re.test(cmd));
    const wiped = deleted(cmd).filter(d => d.recursive).flatMap(d => d.targets).filter(x => !DISPOSABLE.test(x.replace(/^\.\//, '')));
    if (risky) found.push({ type: 'risky', note: `되돌리기 어려운 명령 \`${risky[1]}\`을(를) 썼어요. ${risky[2]} 명령이에요.` });
    else if (wiped.length) found.push({ type: 'risky', note: `되돌리기 어려운 명령 \`rm -r ${wiped[0]}\`을(를) 썼어요. 파일을 휴지통 없이 바로 지우는 명령이에요.` });
  }
  return found;
}

// ---- fixed commentary (no model) -------------------------------------------------------------
// `c` gives the player's name, season record and running stats; only those numbers are used.
export function autoComment(c, m) {
  const key = `auto.${m.type}`;
  return { caster: MOMENT_LABEL[m.type] ?? t('auto.fallbackCaster'), line: t(Object.hasOwn(catalogs[language()], key) ? key : 'auto.fallbackLine') };
}
