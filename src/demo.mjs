// The tutorial's example match: recorded sessions replayed into a temp folder as if agents were writing them right
// now, for someone who hasn't run an agent yet. It never shows in the match list or raises alerts, and is removed
// when the tutorial ends.

import { mkdir, readFile, rm, appendFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles } from './adapters/fs-util.mjs';
import { adapters } from './adapters/index.mjs';
import { t } from './i18n/index.mjs';

const SOURCE = fileURLToPath(new URL('./demo/', import.meta.url));
export const DEMO_ROOT = join(tmpdir(), 'coding-live-demo');
export const DEMO_CWD = '/demo/webshop';
const DEMOS = [
  // Three agents in one project (/demo/webshop) at once.
  { file: 'claude-code-csv.jsonl', agent: 'claude-code', startAfter: 0 },
  { file: 'codex-slug.jsonl', agent: 'codex', startAfter: 1500 },
  { file: 'pi-dates.jsonl', agent: 'pi', startAfter: 3000 },
];
// The example project's folder isn't on this computer, so its role map and line counts are given here
// (the tutorial says the numbers are an example).
const ROLE_FILES = { 'package.json': 'tooling', 'src/exports.mjs': 'logic', 'src/slug.mjs': 'shared', 'src/dates.mjs': 'shared', 'test/exports.test.mjs': 'tests', 'test/slug.test.mjs': 'tests' };
const ROLE_AREAS = {
  ko: { tooling: '프로그램을 설치하고 실행하는 설정이에요.', logic: '주문을 표(CSV)로 내보내는 핵심 기능이에요.', shared: '날짜와 주소 이름처럼 여러 곳에서 쓰는 작은 도구예요.', tests: '기능이 제대로 도는지 시험하는 곳이에요.' },
  en: { tooling: 'Settings to install and run the program.', logic: 'The core feature: exporting orders as a table (CSV).', shared: 'Small helpers used in many places, like dates and web-address names.', tests: 'Checks that the features work.' },
};
export const demoRoles = lang => ({ files: { ...ROLE_FILES }, areas: { ...(ROLE_AREAS[lang] ?? ROLE_AREAS.en) }, pending: false, error: null });
export const DEMO_LINES = { code: 260, test: 310, base: { code: 0, test: 0 } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Reads demo files with the parser of the agent that recorded them (the folder name).
export const demoAdapter = {
  id: 'demo',
  get label() { return t('agent.demo'); },
  format: 'jsonl',
  roots: () => [DEMO_ROOT],
  project: () => t('agent.demo'),
  // Show the agent that recorded the match, marked as a demo.
  agentOf: file => file.split(/[\\/]/).at(-2),
  labelOf(file) { const a = adapters.find(x => x.id === this.agentOf(file)); return t('agent.demoLabel', { agent: a?.label ?? t('agent.demo') }); },
  async discover() { return listFiles(DEMO_ROOT, { depth: 2, match: f => f.endsWith('.jsonl') }); },
  createParser(file) {
    const agent = file.split(/[\\/]/).at(-2);
    return (adapters.find(a => a.id === agent) ?? adapters[0]).createParser(file);
  },
};

let playing = null, stopped = false;
export function playDemo({ speed = 1 } = {}) {
  if (playing) return playing;
  stopped = false;
  playing = (async () => {
    await rm(DEMO_ROOT, { recursive: true, force: true });
    await Promise.all(DEMOS.map(async d => {
      await sleep(d.startAfter / speed);
      if (stopped) return;
      const lines = (await readFile(join(SOURCE, d.file), 'utf8')).split('\n').filter(Boolean);
      const dir = join(DEMO_ROOT, d.agent);
      await mkdir(dir, { recursive: true });
      const target = join(dir, d.file);
      await writeFile(target, '');
      let prev = null;
      for (const line of lines) {
        let entry; try { entry = JSON.parse(line); } catch { continue; }
        const was = Date.parse(entry.timestamp ?? '');
        // Keep the rhythm of the recording but squeeze long waits so a match takes about a minute.
        const gap = Number.isFinite(was) && Number.isFinite(prev) ? was - prev : 700;
        if (Number.isFinite(was)) prev = was;
        await sleep(Math.min(2500, Math.max(250, gap * 0.25)) / speed);
        if (stopped) return;
        entry.timestamp = new Date().toISOString();
        await appendFile(target, JSON.stringify(entry) + '\n');
      }
    }));
  })().finally(() => { playing = null; });
  return playing;
}
export const demoPlaying = () => !!playing;
// Ends the replay and removes the example match.
export async function stopDemo() {
  stopped = true;
  await playing;
  await rm(DEMO_ROOT, { recursive: true, force: true });
}
