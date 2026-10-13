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
// `space` is the margin around each folder (areas in the role view stand apart like islands); a map shorter than
// `minH` reaches it by spacing its folder rows further apart, not by making them taller.
const areaOf = (d, space) => d.area + (HEAD + PAD + 2 * space) * Math.sqrt(d.area * DIR_ASPECT) + (2 * PAD + 2 * space) * Math.sqrt(d.area / DIR_ASPECT);
// File rows inside a folder of width d.w, and the height they need.
function measure(d, space) {
  d.fileRows = rows(d.files, Math.max(1, d.w - 2 * space - 2 * PAD), FILE_ASPECT, Math.min(MINW + GAP, d.w - 2 * space - 2 * PAD), MINH + GAP);
  d.need = HEAD + d.fileRows.reduce((t, r) => t + r.h, 0) + PAD + 2 * space;
}
// The folder at (x, y), `h` tall; its file rows stretch to fill it.
function place(d, x, y, h, space) {
  d.box = { x: x + space, y: y + space, w: d.w - 2 * space, h: h - 2 * space };
  const content = d.fileRows.reduce((t, r) => t + r.h, 0), stretch = (content + h - d.need) / content;
  let fy = HEAD;
  for (const r of d.fileRows) {
    const rh = r.h * stretch;
    for (const f of r.items) f.box = { x: PAD + f.x + GAP / 2, y: fy + GAP / 2, w: f.w - GAP, h: rh - GAP };
    fy += rh;
  }
}
// Folders in rows across W: each row is a band as tall as its tallest folder.
function rowBands(dirs, W, space) {
  return rows(dirs, W, DIR_ASPECT, Math.min(W, DIR_MINW + 2 * space), 0).map(({ items }) => {
    for (const d of items) measure(d, space);
    const h = Math.max(...items.map(d => d.need));
    return { h, put: y => { for (const d of items) place(d, d.x, y, h, space); } };
  });
}
// Bands top to bottom; a map shorter than `minH` spreads them apart (islands keep their size). Returns the height.
function stackBands(bands, minH) {
  const total = bands.reduce((t, b) => t + b.h, 0);
  const extra = total < minH && bands.length ? (minH - total) / bands.length : 0;
  let y = 0;
  for (const b of bands) { y += extra / 2; b.put(y); y += b.h + extra / 2; }
  return y;
}
function layout(dirs, W, space = GAP, minH = 0) {
  for (const d of dirs) d.a = areaOf(d, space);
  return stackBands(rowBands(dirs, W, space), minH);
}
// Role view: the areas keep fixed places. Three columns on top (what people see and use, the working parts, what is
// kept), each column's areas stacked; tests, docs and the rest in rows underneath. When the columns can't each fit
// two files across, the areas go in rows instead (same order), so no area turns into a tall one-file-wide strip.
const COLUMNS = [['screen', 'assets', 'network'], ['logic', 'shared', 'tooling'], ['data', 'storage']];
function roleLayout(dirs, W, space, minH) {
  const minCol = 2 * (MINW + GAP) + 2 * PAD + 2 * space;
  const cols = COLUMNS.map(ids => dirs.filter(d => ids.includes(d.dir.slice(5)))).filter(c => c.length);
  if (W < Math.max(1, cols.length) * minCol) return layout(dirs, W, space, minH);
  for (const d of dirs) d.a = areaOf(d, space);
  const sums = cols.map(c => c.reduce((t, d) => t + d.a, 0)), all = sums.reduce((t, n) => t + n, 0);
  let x = 0;
  cols.forEach((c, i) => {
    const w = minCol + ((W - cols.length * minCol) * sums[i]) / all;
    for (const d of c) { d.x = x; d.w = w; measure(d, space); }
    x += w;
  });
  const top = cols.length ? [{
    h: Math.max(...cols.map(c => c.reduce((t, d) => t + d.need, 0))),
    put: y => { for (const c of cols) { let cy = y; for (const d of c) { place(d, d.x, cy, d.need, space); cy += d.need; } } },
  }] : [];
  return stackBands([...top, ...rowBands(dirs.filter(d => !cols.some(c => c.includes(d))), W, space)], minH);
}

// The role map's areas, in their fixed order (same ids as ROLES in src/mic.mjs; the AI sorts files into them).
export const ROLE = {
  screen: ['🖥️', '화면|구역'], logic: ['🧠', '규칙·두뇌'], shared: ['🧩', '공용 부품'], data: ['📦', '데이터|구역'], storage: ['🗄️', '저장소'],
  network: ['🔌', '연결|구역'], assets: ['🎨', '그림·소리'], tooling: ['⚙️', '준비·도구'], tests: ['🧪', '테스트|구역'], docs: ['📄', '문서'], other: ['❓', '기타'],
  pending: ['⏳', '분류 중'],
};
const ROLE_ORDER = Object.keys(ROLE);
const roleName = id => `${ROLE[id][0]} ${t(ROLE[id][1])}`;
// The area a file is in: what the AI said, "being sorted" while it is asked, else "other".
export const roleOf = (roles, path) => roles.files?.[path] ?? (roles.pending ? 'pending' : 'other');
const pathOf = (s, raw) => { const p = String(raw).replace(/^\.\//, ''); const c = (s.cwd ?? '').replace(/[\\/]+$/, ''); return c && (p.startsWith(`${c}/`) || p.startsWith(`${c}\\`)) ? p.slice(c.length + 1) : p; };
// Each player's areas in order of play, repeats folded: [{ key, zones: [role] }].
export function routes(s, roles) {
  const out = new Map();
  for (const c of s.feed) {
    if (!c.paths?.length || !c.player) continue;
    const zone = roleOf(roles, pathOf(s, c.paths[0]));
    const z = out.get(c.player) ?? [];
    if (z.at(-1) !== zone) z.push(zone);
    out.set(c.player, z);
  }
  return out;
}
// Areas fixed together: a player who writes in one area and next writes in another links the two. Real moves only,
// never a guessed dependency. "Other" and "being sorted" are not real areas, so they never link. Returns [{ a, b, n }].
const linkable = z => z !== 'pending' && z !== 'other';
const pairKey = (a, b) => [a, b].sort().join('\0');
export function links(s, roles) {
  const last = new Map(), count = new Map();
  for (const c of s.feed) {
    if (!['write', 'write-test'].includes(c.kind) || !c.paths?.length || !c.player) continue;
    const zone = roleOf(roles, pathOf(s, c.paths[0]));
    const prev = last.get(c.player);
    if (prev && prev !== zone && linkable(zone) && linkable(prev)) { const k = pairKey(prev, zone); count.set(k, (count.get(k) ?? 0) + 1); }
    last.set(c.player, zone);
  }
  return [...count].map(([k, n]) => { const [a, b] = k.split('\0'); return { a, b, n }; });
}
// What the player last said it is doing: the first sentence of its latest words, short.
const intent = (s, key) => {
  const said = s.feed.findLast(c => c.player === key && c.says?.length)?.says.at(-1);
  if (!said) return '';
  const first = said.replace(/[`*#>]/g, '').split(/(?<=[.!?。])\s+|\n+/).map(x => x.trim()).find(Boolean) ?? '';
  return first.length > 70 ? `${first.slice(0, 69)}…` : first;
};

const STATUS = { read: '읽음', write: '씀·고침', pass: '테스트 통과', fail: '실패|상태' };
const status = s => (STATUS[s] ? t(STATUS[s]) : s ?? '');
const edited = n => t('{n}번 고침', { n });
const stageOf = p => (p.finished && !p.lastTestFailed && p.lastScore ? 4 : p.lane ?? 0);
const FLASH_MS = 8000; // as long as the move caption stays
const focusLinks = (box, role) => box.querySelectorAll('svg.trails .zlink').forEach(n => n.classList.toggle('on', role != null && (n.dataset.a === role || n.dataset.b === role)));
const setBox = (n, r) => { n.style.left = `${r.x}px`; n.style.top = `${r.y}px`; n.style.width = `${Math.max(0, r.w)}px`; n.style.height = `${Math.max(0, r.h)}px`; };

// state: { hops: Map(playerKey -> [path]), zones: Map(playerKey -> role) } kept per match by the caller.
// roles: the AI's areas ({ files, areas, pending }) for the role view, or null for the folder view.
// noteFor(path): the AI note already fetched for a file, shown when hovering it. minH: the least height the map takes.
export function renderFileMap(box, s, { sel = null, onSelect, onFile, state, roles = null, noteFor = () => null, minH = 0 }) {
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
    const dir = roles ? `role:${roleOf(roles, f.path)}` : parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : './';
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
    // "Other" is the leftovers drawer: every file at the smallest size, so it never looks like the main part.
    if (d.dir === 'role:other') { for (const f of d.files) f.a = UNIT; d.area = d.files.length * UNIT; }
  }
  // Folders by size; areas keep their fixed order, so each area stays in the same place.
  if (roles) dirs.sort((a, b) => ROLE_ORDER.indexOf(a.dir.slice(5)) - ROLE_ORDER.indexOf(b.dir.slice(5)));
  else dirs.sort((a, b) => b.area - a.area || a.dir.localeCompare(b.dir));
  const H = Math.ceil(roles ? roleLayout(dirs, W, 14, minH) : layout(dirs, W, GAP, minH));
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
    dn.className = `tdir${roles ? ' island' : ''}${d.here ? ' hot' : ''}${sel && !d.files.some(f => f.players.some(x => x.key === sel)) ? ' dim' : ''}`;
    const counts = `${t('파일 {n}', { n: d.files.length })}${edits ? ` · ${t('고침 {n}', { n: edits })}` : ''}`;
    if (roles) {
      const role = d.dir.slice(5), area = roles.areas?.[role] ?? '';
      dn.dataset.role = role;
      // Hovering an area brings up only its own lines.
      dn.onmouseenter = () => { state.focus = role; focusLinks(box, role); };
      dn.onmouseleave = () => { state.focus = null; focusLinks(box, null); };
      dn.title = `${roleName(role)} · ${counts}${area ? `\n${area}` : ''}`;
      dn.firstChild.firstChild.textContent = roleName(role);
      dn.firstChild.lastChild.textContent = area || counts;
    } else {
      dn.title = d.dir;
      dn.firstChild.firstChild.textContent = d.dir;
      dn.firstChild.lastChild.textContent = counts;
    }
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
      const note = noteFor(f.path);
      fn.title = `${f.path}\n${facts}${note ? `\n\n${note.text}` : ''}`;
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
  // Role view: a line between two areas a player fixed one after the other, thicker the more often it happened.
  // Almost hidden until wanted: it lights up when its area is hovered, and flashes when a player just made that move.
  const areaBox = new Map(roles ? dirs.map(d => [d.dir.slice(5), d.box]) : []);
  const flash = (state.flash ??= new Map()), now = Date.now();
  const linkLines = (roles ? links(s, roles) : []).filter(l => areaBox.has(l.a) && areaBox.has(l.b)).map(l => {
    const a = center(areaBox.get(l.a)), b = center(areaBox.get(l.b));
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    for (const [k, v] of [['x1', a.x], ['y1', a.y], ['x2', b.x], ['y2', b.y]]) line.setAttribute(k, v.toFixed(1));
    line.dataset.a = l.a; line.dataset.b = l.b;
    const since = now - (flash.get(pairKey(l.a, l.b)) ?? -Infinity);
    line.setAttribute('class', `zlink${state.focus === l.a || state.focus === l.b ? ' on' : ''}${since < FLASH_MS ? ' flash' : ''}`);
    if (since < FLASH_MS) line.style.animationDelay = `-${since}ms`; // a redraw carries on the same flash
    line.style.strokeWidth = String(2 + Math.min(6, l.n * 1.5));
    const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    tip.textContent = t('{a} ↔ {b}: 한 구역을 고치다 다른 구역으로 넘어가 고친 횟수 {n}번', { a: roleName(l.a), b: roleName(l.b), n: l.n });
    line.append(tip);
    return line;
  });
  // Dotted trails in the folder view only; the role view has the route list under the map instead.
  svg.replaceChildren(...linkLines, ...(roles ? [] : s.players).flatMap(p => {
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
    const tile = tiles.get((state.hops.get(p.key) ?? []).at(-1));
    if (!tile) continue;
    seenRunners.add(p.key);
    let r = [...box.querySelectorAll('.runner')].find(n => n.dataset.key === p.key);
    if (!r) {
      r = el('button', 'runner'); r.type = 'button'; r.dataset.key = p.key;
      r.append(avatar(p.agent), el('span', 'rn'), el('span', 'stg'));
      box.append(r);
    }
    r.onclick = () => onSelect?.(p.key);
    const i = stack.get(tile) ?? 0; stack.set(tile, i + 1);
    const lane = stageOf(p);
    r.className = `runner${isSub(p) ? ' sub' : ''}${p.finished ? ' done' : ''}${sel && sel !== p.key ? ' dim' : ''}`;
    r.setAttribute('aria-pressed', String(sel === p.key));
    r.children[1].textContent = isSub(p) ? `↳ ${p.name}` : p.name;
    r.children[2].className = `stg s${lane}`;
    r.children[2].textContent = laneLabel(lane);
    r.title = `${playerLabel(p)}\n${(p.now ?? p.last?.text ?? '').replace(/`/g, '')}`;
    const half = Math.min(r.offsetWidth / 2, W / 2);
    const x = Math.min(Math.max(tile.x + tile.w / 2, half + 2), W - half - 2);
    const y = Math.min(Math.max(tile.y + tile.h * 0.6 + i * 26, 13), H - 13);
    r.style.left = `${x}px`; r.style.top = `${y}px`;
    // Role view: moving to another area shows where from and where to, with the player's own latest words.
    const zone = roles ? roleOf(roles, (state.hops.get(p.key) ?? []).at(-1)) : null;
    const was = state.zones.get(p.key);
    state.zones.set(p.key, zone);
    if (zone && was && was !== zone && zone !== 'pending' && was !== 'pending') {
      if (linkable(zone) && linkable(was)) {
        flash.set(pairKey(was, zone), Date.now());
        svg.querySelectorAll('.zlink').forEach(n => { if (pairKey(n.dataset.a, n.dataset.b) === pairKey(was, zone)) { n.classList.add('flash'); n.style.animationDelay = '0ms'; } });
      }
      box.querySelector(`.hopcap[data-key="${CSS.escape(p.key)}"]`)?.remove();
      const cap = el('div', 'hopcap'); cap.dataset.key = p.key;
      const why = intent(s, p.key);
      cap.textContent = `${ROLE[was][0]} → ${ROLE[zone][0]} ${t(ROLE[zone][1])}${why ? ` · "${why}"` : ''}`;
      cap.style.left = `${Math.min(Math.max(x, 140), W - 140)}px`; cap.style.top = `${Math.max(y - 30, 4)}px`;
      box.append(cap);
      setTimeout(() => cap.remove(), 8000);
    }
  }
  box.querySelectorAll('.runner').forEach(n => { if (!seenRunners.has(n.dataset.key)) n.remove(); });
}

// Pointing at a route lights its areas on the map one after another, in the order the player went.
const STEP_MS = 450;
let replay = [];
function replayRoute(map, chips) {
  for (const id of replay) clearTimeout(id);
  replay = chips.map((c, i) => setTimeout(() => {
    for (const n of [c, map.querySelector(`.tdir.island[data-role="${c.dataset.role}"]`)]) {
      if (!n) continue;
      n.removeAttribute('data-lit'); void n.offsetWidth; n.setAttribute('data-lit', ''); // restart the glow
      setTimeout(() => n.removeAttribute('data-lit'), 1200);
    }
  }, i * STEP_MS));
}

// Under the role map: each player's areas in the order they went, the last few moves. `map` is the map they light up.
export function renderRoutes(box, s, roles, map) {
  box.replaceChildren();
  if (!roles) { box.hidden = true; return; }
  const all = routes(s, roles);
  const rowsOut = s.players.map(p => [p, all.get(p.key) ?? []]).filter(([, z]) => z.length);
  box.hidden = !rowsOut.length;
  if (!rowsOut.length) return;
  box.append(el('div', 'label', t('이번 경기 이동 기록 · 선수가 어느 구역을 거쳐 갔는지')));
  for (const [p, zones] of rowsOut) {
    const r = el('div', 'route');
    const who = el('span', 'who'); who.append(avatar(p.agent), el('span', null, isSub(p) ? `↳ ${p.name}` : p.name));
    const path = el('span', 'zones');
    const shown = zones.slice(-8);
    if (zones.length > shown.length) path.append(el('span', 'faint', '… '));
    shown.forEach((z, i) => { if (i) path.append(el('span', 'arrow', '→')); const c = el('span', 'zone', roleName(z)); c.dataset.role = z; if (i === shown.length - 1) c.classList.add('now'); path.append(c); });
    r.append(who, path);
    r.tabIndex = 0;
    r.title = t('마우스를 올리면 지도에서 이 순서대로 구역이 켜져요');
    r.onmouseenter = r.onfocus = () => replayRoute(map, [...path.querySelectorAll('.zone')]);
    box.append(r);
  }
}
