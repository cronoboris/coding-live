import { adapter as claudeCode } from './claude-code.mjs';
import { adapter as codex } from './codex.mjs';
import { adapter as gemini } from './gemini.mjs';
import { adapter as pi } from './pi.mjs';
import { adapter as omp } from './omp.mjs';
import { adapter as mixdog } from './mixdog.mjs';

// Every supported agent. Each adapter: { id, label, format: 'jsonl'|'document', roots(env), discover(env),
// createParser(file) (jsonl: one entry -> events[]) or parseDocument(text, file) (document: whole file -> events[]),
// and optionally project(file), related(file) (side files whose changes count) and live(file) (a running turn the mtime misses).
export const adapters = [claudeCode, codex, gemini, pi, omp, mixdog];
