import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Files under `root` up to `depth` levels deep that pass `match`, with their mtime. Missing roots yield []. */
export async function listFiles(root, { depth = 1, match = () => true } = {}) {
  const out = [];
  async function walk(dir, level) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (level < depth) await walk(p, level + 1); }
      else if (e.isFile() && match(p)) {
        try { const s = await stat(p); out.push({ file: p, mtimeMs: s.mtimeMs, size: s.size }); } catch {}
      }
    }
  }
  await walk(root, 1);
  return out;
}
