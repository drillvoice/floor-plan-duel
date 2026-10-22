import { CONFIG, type Config } from '../config';
import { buildArena, circleHitsWall } from '../sim/arena';
import { cellCenter, cellIndex } from '../sim/grid';
import { MAX_PLAYERS, type MapData } from '../sim/types';
import { dist, type Vec2 } from '../sim/vec';

// Problems that would stop the map being playable; empty when it's fine.
export function validateMap(map: MapData, cfg: Config = CONFIG): string[] {
  const errors: string[] = [];
  const arena = buildArena(map, cfg);
  map.spawns.forEach((sp, i) => {
    if (sp.x <= 0 || sp.y <= 0 || sp.x >= map.width || sp.y >= map.height) errors.push(`Spawn ${i + 1} is outside the map.`);
    else if (circleHitsWall(sp, cfg.player.radius, arena, cfg)) errors.push(`Spawn ${i + 1} overlaps a wall.`);
    const twin = map.spawns.findIndex((other, j) => j < i && dist(other, sp) < cfg.player.radius * 2);
    if (twin >= 0) errors.push(`Spawns ${twin + 1} and ${i + 1} overlap.`);
  });
  if (errors.length) return errors;
  // The grid is flood-filled from spawn 1, so every other spawn must land in an open cell.
  if (map.spawns.some((sp) => !arena.grid.open[cellIndex(arena.grid, sp)])) {
    errors.push("The spawns can't reach each other.");
  }
  if (map.spawns.length !== MAX_PLAYERS) errors.push(`A map needs ${MAX_PLAYERS} spawn points.`);
  return errors;
}

// Spawn points spread as far apart as possible (by walking distance), in open
// cells with some room around them: the first two as far from each other as
// they can be, then each next one as far as possible from all before it.
// Keeps the spawns in `keep` and adds to them up to `count`. Returns null if
// the map has no room for them.
export function autoSpawns(map: MapData, cfg: Config = CONFIG, keep: readonly Vec2[] = [], count = MAX_PLAYERS): Vec2[] | null {
  const probe: MapData = { ...map, spawns: [{ x: map.width / 2, y: map.height / 2 }] };
  // Find any roomy cell to start from: flood-fill from the most open spot.
  const arena = buildArena(probe, cfg);
  const g = arena.grid;
  let seed = -1;
  for (let i = 0; i < g.clearance.length; i++) if (seed < 0 || g.clearance[i] > g.clearance[seed]) seed = i;
  if (seed < 0 || g.clearance[seed] < cfg.player.radius) return null;
  const roomy = buildArena({ ...map, spawns: [cellCenter(g, seed)] }, cfg).grid;
  const ok = (i: number) => roomy.open[i] && roomy.clearance[i] >= cfg.player.radius * 2;

  // The roomy cell furthest from all of `from` (by walking), and how far.
  const farthestFrom = (from: number[]): { cell: number; steps: number } => {
    const distTo = new Int32Array(roomy.open.length).fill(-1);
    const queue: number[] = [];
    for (const f of from) {
      if (distTo[f] < 0) {
        distTo[f] = 0;
        queue.push(f);
      }
    }
    let far = { cell: from[0], steps: 0 };
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      if (ok(i) && distTo[i] > far.steps) far = { cell: i, steps: distTo[i] };
      const c = i % roomy.cols;
      for (const n of [c > 0 ? i - 1 : -1, c < roomy.cols - 1 ? i + 1 : -1, i - roomy.cols, i + roomy.cols]) {
        if (n >= 0 && n < roomy.open.length && roomy.open[n] && distTo[n] < 0) {
          distTo[n] = distTo[i] + 1;
          queue.push(n);
        }
      }
    }
    return far;
  };

  const spawns = keep.slice(0, count).map((p) => ({ ...p }));
  const chosen = spawns.map((p) => cellIndex(roomy, p));
  if (chosen.length === 0) chosen.push(farthestFrom([seed]).cell);
  else if (spawns.length < count) {
    // Kept spawns may sit off the grid; start from the nearest floor.
    for (let k = 0; k < chosen.length; k++) if (!roomy.open[chosen[k]]) chosen[k] = seed;
  }
  if (spawns.length === 0) spawns.push(cellCenter(roomy, chosen[0]));
  while (spawns.length < count) {
    const next = farthestFrom(chosen);
    if (next.steps === 0) return null;
    chosen.push(next.cell);
    spawns.push(cellCenter(roomy, next.cell));
  }
  return spawns;
}

// Parse and sanity-check an imported map file.
export function parseMapJson(text: string): MapData {
  const data = JSON.parse(text);
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const point = (p: unknown): p is Vec2 =>
    typeof p === 'object' && p !== null && num((p as Vec2).x) && num((p as Vec2).y);
  if (typeof data !== 'object' || data === null) throw new Error('Not a map file.');
  if (!num(data.width) || !num(data.height) || data.width < 4 || data.height < 4 || data.width > 200 || data.height > 200)
    throw new Error('Map size is missing or out of range.');
  if (!Array.isArray(data.walls) || !data.walls.every((w: unknown) => w && point((w as { a: unknown }).a) && point((w as { b: unknown }).b)))
    throw new Error('Walls are missing or malformed.');
  if (!Array.isArray(data.spawns) || data.spawns.length < 2 || data.spawns.length > MAX_PLAYERS || !data.spawns.every(point))
    throw new Error(`A map needs two to ${MAX_PLAYERS} spawn points.`);
  const map: MapData = {
    ...(typeof data.id === 'string' && data.id.length <= 64 ? { id: data.id } : {}),
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 40) : 'Imported map',
    width: data.width,
    height: data.height,
    walls: data.walls.map((w: { a: Vec2; b: Vec2 }) => ({ a: { x: w.a.x, y: w.a.y }, b: { x: w.b.x, y: w.b.y } })),
    spawns: data.spawns.map((p: Vec2) => ({ x: p.x, y: p.y })),
    ...(data.dark === true ? { dark: true } : {}),
  };
  // Maps from before 4-player matches have two spawns: add the rest, as far
  // from the others as they can be (or, on a map with no room, doubled up).
  if (map.spawns.length < MAX_PLAYERS) {
    const have = map.spawns;
    map.spawns = autoSpawns(map, CONFIG, have) ?? Array.from({ length: MAX_PLAYERS }, (_, i) => ({ ...have[i % have.length] }));
  }
  return map;
}
