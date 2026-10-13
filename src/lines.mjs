// How many lines of code a project has, split into tests and the rest, for the stats bar.
// The files Git tracks or would track (so .gitignore'd builds and dependencies stay out), also for repositories one or
// two folders down when the project folder itself is not one; otherwise a walk that skips the usual dependency and
// build folders and gives up on very large folders. Code files only (isCodePath), blank lines not counted. Files are
// re-read only when their size or time changes, and nothing leaves the computer.
import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { isCodePath, isTestPath } from './core/caster.mjs';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '.venv', 'venv', '__pycache__', '.next', '.cache', 'coverage']);
const MAX_FILES = 20_000, MAX_BYTES = 2_000_000;

const gitFiles = cwd => new Promise(resolve => {
  execFile('git', ['-C', cwd, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxBuffer: 64 * 1024 * 1024, timeout: 15_000 }, (error, stdout) => resolve(error ? null : stdout.split('\0').filter(Boolean)));
});
// Without Git: every file outside the usual dependency and build folders, or null when there are too many to count.
async function walk(root) {
  const out = [], dirs = [root];
  while (dirs.length) {
    const dir = dirs.pop();
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) { if (!SKIP.has(e.name)) dirs.push(join(dir, e.name)); }
      else if (e.isFile() && isCodePath(e.name)) { out.push(relative(root, join(dir, e.name)).split(sep).join('/')); if (out.length > MAX_FILES) return null; }
    }
  }
  return out;
}
// Git repositories one or two folders down (a project folder holding several repositories).
async function nestedRepos(root) {
  const found = [];
  const look = async (dir, depth) => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const sub = join(dir, e.name);
      if ((await stat(join(sub, '.git')).catch(() => null))) found.push(sub);
      else if (depth < 2) await look(sub, depth + 1);
    }
  };
  await look(root, 1);
  return found;
}
// The code files of the project, relative to it; null when they cannot all be counted.
async function codeFiles(cwd) {
  const own = await gitFiles(cwd);
  if (own) return own.filter(isCodePath);
  const repos = await nestedRepos(cwd);
  if (!repos.length) return walk(cwd);
  const all = [];
  for (const repo of repos) for (const f of (await gitFiles(repo)) ?? []) if (isCodePath(f)) all.push(`${relative(cwd, repo).split(sep).join('/')}/${f}`);
  return all;
}

export class LineCounter {
  constructor() { this.files = new Map(); } // absolute path -> { sig, lines }
  // { code, test }; { missing: true } when the project folder is not on this computer; { tooMany: true } when it is
  // too big to count without Git.
  async count(cwd) {
    if (!(await stat(cwd).catch(() => null))?.isDirectory()) return { missing: true };
    const list = await codeFiles(cwd);
    if (!list || list.length > MAX_FILES) return { tooMany: true };
    let code = 0, test = 0;
    for (const rel of list) {
      const file = join(cwd, rel);
      let st;
      try { st = await stat(file); } catch { continue; }
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      const sig = `${st.mtimeMs}:${st.size}`;
      let entry = this.files.get(file);
      if (entry?.sig !== sig) {
        let text;
        try { text = await readFile(file, 'utf8'); } catch { continue; }
        entry = { sig, lines: text.split('\n').filter(l => l.trim()).length };
        this.files.set(file, entry);
      }
      if (isTestPath(rel)) test += entry.lines; else code += entry.lines;
    }
    return { code, test };
  }
}
