// The file map: a treemap of the project's files. Folders are big tiles, files are tiles inside them, and every
// file is shown. Tiles where a player is now are largest, recently touched ones shrink back over a few minutes,
// idle ones are small; the map grows taller rather than hiding files. Player chips glide to the file they are on,
// a small dot marks the last touched file, and a faint dotted trail keeps each player's last few hops.

import { el, avatar, laneLabel, playerLabel, isSub, everyone } from './shared.js';
import { t } from './i18n.js';

const MINW = 104, MINH = 30;   // smallest file tile: room for a short name, longer names end in "…"
const GAP = 2, HEAD = 22, PAD = 4;
const UNIT = MINW * MINH * 1.3; // area of an idle file
const FILE_ASPECT = 3, DIR_ASPECT = 1.4; // preferred width:height of file tiles (room for names) and folders
const DIR_MINW = MINW + 2 * PAD + 3 * GAP;
const HOPS = 4;
const RECENT_MS = 4 * 60_000;

// Row treemap: items (largest first, each with area `a`) fill rows across `width`; an item joins the row while that
// keeps the row's worst shape closer to `aspect` and every item at least `minW` wide. Rows are at least `minH` tall.
// Sets item.x and item.w; returns [{ items, h }].
function rows(items, width, aspect, minW, minH) {
  const shape = r => {
    const s = r.reduce((t, i) => t + i.a, 0), h = Math.max(minH, s / width);
    let worst = 0, narrow = false;
    for (const i of r) { const w = (width * i.a) / s; if (w < minW) narrow = true; const q = w / (h * aspect); worst = Math.max(worst, q, 1 / q); }
    return { h, worst, narrow };
  };
  const out = [];
  let row = [];
  for (const i of items) {
    if (row.length) { const now = shape(row), next = shape([...row, i]); if (next.narrow || next.worst > now.worst) { out.push(row); row = []; } }
    row.push(i);
  }
  if (row.length) out.push(row);
  return out.map(r => {
    const s = r.reduce((t, i) => t + i.a, 0);
    let x = 0;
    for (const i of r) { i.w = (width * i.a) / s; i.x = x; x += i.w; }
    return { items: r, h: shape(r).h };
  });
}

// Folders in rows across W, files in rows inside each folder; a folder row is as tall as its tallest folder and the
// others stretch their file rows to match. Every file tile ends up at least MINW × MINH. Returns the map height.
function layout(dirs, W) {
  for (const d of dirs) d.a = d.area + (HEAD + PAD + 2 * GAP) * Math.sqrt(d.area * DIR_ASPECT) + (2 * PAD + 2 * GAP) * Math.sqrt(d.area / DIR_ASPECT);
  let y = 0;
  for (const { items } of rows(dirs, W, DIR_ASPECT, Math.min(W, DIR_MINW), 0)) {
    for (const d of items) {
      d.fileRows = rows(d.files, Math.max(1, d.w - 2 * GAP - 2 * PAD), FILE_ASPECT, Math.min(MINW + GAP, d.w - 2 * GAP - 2 * PAD), MINH + GAP);
      d.need = HEAD + d.fileRows.reduce((t, r) => t + r.h, 0) + PAD + 2 * GAP;
    }
    const rowH = Math.max(...items.map(d => d.need));
    for (const d of items) {
      d.box = { x: d.x + GAP, y: y + GAP, w: d.w - 2 * GAP, h: rowH - 2 * GAP };
      const content = d.fileRows.reduce((t, r) => t + r.h, 0), stretch = (content + rowH - d.need) / content;
      let fy = HEAD;
      for (const r of d.fileRows) {
        const h = r.h * stretch;
        for (const f of r.items) f.box = { x: PAD + f.x + GAP / 2, y: fy + GAP / 2, w: f.w - GAP, h: h - GAP };
        fy += h;
      }
    }
    y += rowH;
  }
  return y;
}

const STATUS = { read: '읽음', write: '씀·고침', pass: '테스트 통과', fail: '실패|상태' };
const status = s => (STATUS[s] ? t(STATUS[s]) : s ?? '');
const edited = n => t('{n}번 고침', { n });
const stageOf = p => (p.finished && !p.lastTestFailed && p.lastScore ? 4 : p.lane ?? 0);
const setBox = (n, r) => { n.style.left = `${r.x}px`; n.style.top = `${r.y}px`; n.style.width = `${Math.max(0, r.w)}px`; n.style.height = `${Math.max(0, r.h)}px`; };

// state: { hops: Map(playerKey -> [path]) } kept per match by the caller.
export function renderFileMap(box, s, { sel = null, onSelect, onFile, state }) {
  box.classList.add('tm');
  if (!s.files.length) {
    box.replaceChildren(el('div', 'fm-empty', t('선수들이 아직 파일을 건드리지 않았어요.')));
    box.style.height = '';
    return;
  }
  box.querySelector('.fm-empty')?.remove();
  const W = box.clientWidth;
  if (!W) return; // hidden (narrow screens showing the commentary); laid out again when it shows

  // Where each player is: the file they are on now, else where they last were.
  const players = new Map(everyone(s).map(p => [p.key, p])); // left players keep their names in tooltips; only the roster gets chips
  const lastTouched = s.files.reduce((a, f) => ((f.lastAt ?? 0) > (a?.lastAt ?? 0) ? f : a), null);
  for (const p of s.players) {
    const hops = state.hops.get(p.key) ?? [];
    const mine = s.files.filter(f => f.players.some(x => x.key === p.key));
    const here = mine.filter(f => f.players.some(x => x.key === p.key && x.here)).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0];
    const at = here ?? (hops.length ? null : mine.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0]);
    if (at && hops.at(-1) !== at.path) hops.push(at.path);
    state.hops.set(p.key, hops.filter(h => s.files.some(f => f.path === h)).slice(-HOPS));
  }

  // Weights: a player on it now > recently touched (fading over a few minutes) > idle.
  const ref = s.finished ? (s.lastAt ?? Date.now()) : Date.now();
  const dirMap = new Map();
  for (const f of s.files) {
    const parts = f.path.split(/[\\/]/).filter(Boolean);
    const dir = parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : './';
    const here = f.players.some(x => x.here);
    const recent = f.lastAt ? 3 * Math.exp(-Math.max(0, ref - f.lastAt) / RECENT_MS) : 0;
    const writers = new Set(f.players.filter(x => x.status !== 'read').map(x => x.key));
    const item = { ...f, name: parts.at(-1) ?? f.path, dir, here, clash: writers.size > 1, weight: 1 + recent + (here ? 5 : 0) };
    if (!dirMap.has(dir)) dirMap.set(dir, { dir, files: [] });
    dirMap.get(dir).files.push(item);
  }
  const byWeight = (a, b) => b.weight - a.weight || (a.path ?? a.dir).localeCompare(b.path ?? b.dir);
  const dirs = [...dirMap.values()];
  for (const d of dirs) {
    d.files.sort(byWeight);
    d.here = d.files.some(f => f.here);
    d.weight = d.files.reduce((t, f) => t + f.weight, 0);
    const boost = d.here ? 1 + 3 / d.weight : 1; // a folder with a player in it grows as a whole
    for (const f of d.files) f.a = f.weight * UNIT * boost;
    d.area = d.weight * UNIT * boost;
  }
  dirs.sort((a, b) => b.area - a.area || a.dir.localeCompare(b.dir));
  const H = Math.ceil(layout(dirs, W));
  box.style.height = `${H}px`;

  // Folders and files, reused across renders so size changes animate.
  const seenDirs = new Set(), tiles = new Map();
  for (const d of dirs) {
    seenDirs.add(d.dir);
    let dn = [...box.children].find(n => n.dataset.dir === d.dir);
    if (!dn) {
      dn = el('div', 'tdir'); dn.dataset.dir = d.dir;
      const h = el('div', 'tdh'); h.append(el('b'), el('span'));
      dn.append(h);
      setBox(dn, d.box);
      box.prepend(dn);
    }
    setBox(dn, d.box);
    const edits = d.files.reduce((t, f) => t + (f.edits ?? 0), 0);
    dn.className = `tdir${d.here ? ' hot' : ''}${sel && !d.files.some(f => f.players.some(x => x.key === sel)) ? ' dim' : ''}`;
    dn.title = d.dir;
    dn.firstChild.firstChild.textContent = d.dir;
    dn.firstChild.lastChild.textContent = `${t('파일 {n}', { n: d.files.length })}${edits ? ` · ${t('고침 {n}', { n: edits })}` : ''}`;
    const seenFiles = new Set();
    for (const f of d.files) {
      seenFiles.add(f.path);
      let fn = [...dn.children].find(n => n.dataset.path === f.path);
      if (!fn) {
        fn = el('div', 'tf'); fn.dataset.path = f.path;
        fn.append(el('span', 'n'), el('span', 'm'));
        setBox(fn, f.box);
        dn.append(fn);
      }
      setBox(fn, f.box);
      fn.className = `tf f-${f.status}${f.here ? ' here' : ''}${f.clash ? ' clash' : ''}${f.box.h >= 46 ? ' tall' : ''}${sel && !f.players.some(x => x.key === sel) ? ' dim' : ''}`;
      fn.firstChild.textContent = f.name;
      fn.lastChild.textContent = f.status === 'write' ? (f.edits ? edited(f.edits) : t('씀')) : STATUS[f.status] ? status(f.status) : '';
      const who = [...new Set(f.players.map(x => players.get(x.key)?.name).filter(Boolean))];
      const facts = `${status(f.status)}${f.edits ? ` · ${edited(f.edits)}` : ''}${who.length ? ` · ${who.join(', ')}` : ''}${f.clash ? `\n${t('여러 선수가 이 파일을 고쳤어요')}` : ''}`;
      fn.title = `${f.path}\n${facts}`;
      if (onFile) { fn.setAttribute('role', 'button'); fn.tabIndex = 0; fn.onclick = () => onFile(f, fn, facts); fn.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFile(f, fn, facts); } }; }
      tiles.set(f.path, { x: d.box.x + f.box.x, y: d.box.y + f.box.y, w: f.box.w, h: f.box.h });
    }
    [...dn.querySelectorAll('.tf')].forEach(n => { if (!seenFiles.has(n.dataset.path)) n.remove(); });
  }
  box.querySelectorAll('.tdir').forEach(n => { if (!seenDirs.has(n.dataset.dir)) n.remove(); });

  // Overlay: trails, the last-touched dot, player chips.
  let svg = box.querySelector('svg.trails');
  if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'trails'); svg.setAttribute('aria-hidden', 'true'); box.append(svg); }
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
  const center = t => ({ x: t.x + t.w / 2, y: t.y + t.h / 2 });
  svg.replaceChildren(...s.players.flatMap(p => {
    const pts = (state.hops.get(p.key) ?? []).map(h => tiles.get(h)).filter(Boolean).map(center);
    if (pts.length < 2) return [];
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', pts.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '));
    line.setAttribute('class', `trail${sel === p.key ? ' on' : sel ? ' dim' : ''}`);
    return [line];
  }));

  let dot = box.querySelector('.lastdot');
  if (!dot) { dot = el('span', 'lastdot'); box.append(dot); }
  const lt = lastTouched && tiles.get(lastTouched.path);
  dot.hidden = !lt;
  if (lt) { dot.style.left = `${lt.x + lt.w - 9}px`; dot.style.top = `${lt.y + 9}px`; dot.title = t('마지막으로 만진 파일: {path}', { path: lastTouched.path }); }

  const stack = new Map(), seenRunners = new Set();
  for (const p of s.players) {
    const t = tiles.get((state.hops.get(p.key) ?? []).at(-1));
    if (!t) continue;
    seenRunners.add(p.key);
    let r = [...box.querySelectorAll('.runner')].find(n => n.dataset.key === p.key);
    if (!r) {
      r = el('button', 'runner'); r.type = 'button'; r.dataset.key = p.key;
      r.append(avatar(p.agent), el('span', 'rn'), el('span', 'stg'));
      box.append(r);
    }
    r.onclick = () => onSelect?.(p.key);
    const i = stack.get(t) ?? 0; stack.set(t, i + 1);
    const lane = stageOf(p);
    r.className = `runner${isSub(p) ? ' sub' : ''}${p.finished ? ' done' : ''}${sel && sel !== p.key ? ' dim' : ''}`;
    r.setAttribute('aria-pressed', String(sel === p.key));
    r.children[1].textContent = isSub(p) ? `↳ ${p.name}` : p.name;
    r.children[2].className = `stg s${lane}`;
    r.children[2].textContent = laneLabel(lane);
    r.title = `${playerLabel(p)}\n${(p.now ?? p.last?.text ?? '').replace(/`/g, '')}`;
    const half = Math.min(r.offsetWidth / 2, W / 2);
    const x = Math.min(Math.max(t.x + t.w / 2, half + 2), W - half - 2);
    const y = Math.min(Math.max(t.y + t.h * 0.6 + i * 26, 13), H - 13);
    r.style.left = `${x}px`; r.style.top = `${y}px`;
  }
  box.querySelectorAll('.runner').forEach(n => { if (!seenRunners.has(n.dataset.key)) n.remove(); });
}
