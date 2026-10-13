// Demo matches: recorded sessions replayed into a temp folder as if an agent were writing them right now,
// so the app can be tried without running (or paying for) a real agent.

import { mkdir, readFile, rm, appendFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles } from './adapters/fs-util.mjs';
import { adapters } from './adapters/index.mjs';
import { t } from './i18n/index.mjs';

const SOURCE = fileURLToPath(new URL('./demo/', import.meta.url));
export const DEMO_ROOT = join(tmpdir(), 'coding-live-demo');
const DEMOS = [
  // Three agents in one project (/demo/webshop) at once, plus a solo match.
  { file: 'claude-code-csv.jsonl', agent: 'claude-code', startAfter: 0 },
  { file: 'codex-slug.jsonl', agent: 'codex', startAfter: 1500 },
  { file: 'pi-dates.jsonl', agent: 'pi', startAfter: 3000 },
  { file: 'claude-code-rrule.jsonl', agent: 'claude-code', startAfter: 4500 },
];
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

let playing = null;
export function playDemo({ speed = 1 } = {}) {
  if (playing) return playing;
  playing = (async () => {
    await rm(DEMO_ROOT, { recursive: true, force: true });
    await Promise.all(DEMOS.map(async d => {
      await sleep(d.startAfter / speed);
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
        entry.timestamp = new Date().toISOString();
        await appendFile(target, JSON.stringify(entry) + '\n');
      }
    }));
  })().finally(() => { playing = null; });
  return playing;
}
export const demoPlaying = () => !!playing;
