import { CONFIG, type Config } from '../config';
import { buildArena, circleHitsWall } from '../sim/arena';
import { cellCenter, cellIndex } from '../sim/grid';
import { type MapData, MUSIC_STYLES } from '../sim/types';
import type { Vec2 } from '../sim/vec';

// Problems that would stop the map being playable; empty when it's fine.
export function validateMap(map: MapData, cfg: Config = CONFIG): string[] {
  const errors: string[] = [];
  const arena = buildArena(map, cfg);
  map.spawns.forEach((sp, i) => {
    if (sp.x <= 0 || sp.y <= 0 || sp.x >= map.width || sp.y >= map.height) errors.push(`Spawn ${i + 1} is outside the map.`);
    else if (circleHitsWall(sp, cfg.player.radius, arena, cfg)) errors.push(`Spawn ${i + 1} overlaps a wall.`);
  });
  if (errors.length) return errors;
  // The grid is flood-filled from spawn 1, so spawn 2 must land in an open cell.
  if (!arena.grid.open[cellIndex(arena.grid, map.spawns[1])]) {
    errors.push("The spawns can't reach each other.");
  }
  return errors;
}

// Place the spawns as far apart as possible (by walking distance), in open
// cells with some room around them. Returns null if the map has no floor.
export function autoSpawns(map: MapData, cfg: Config = CONFIG): [Vec2, Vec2] | null {
  const probe: MapData = { ...map, spawns: [{ x: map.width / 2, y: map.height / 2 }, map.spawns[1]] };
  // Find any roomy cell to start from: flood-fill from the most open spot.
  const arena = buildArena(probe, cfg);
  const g = arena.grid;
  let seed = -1;
  for (let i = 0; i < g.clearance.length; i++) if (seed < 0 || g.clearance[i] > g.clearance[seed]) seed = i;
  if (seed < 0 || g.clearance[seed] < cfg.player.radius) return null;
  const roomy = buildArena({ ...map, spawns: [cellCenter(g, seed), map.spawns[1]] }, cfg).grid;
  const ok = (i: number) => roomy.open[i] && roomy.clearance[i] >= cfg.player.radius * 2;

  const farthestFrom = (start: number): number => {
    const distTo = new Int32Array(roomy.open.length).fill(-1);
    distTo[start] = 0;
    const queue = [start];
    let far = start;
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      if (ok(i) && distTo[i] > distTo[far]) far = i;
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
  const a = farthestFrom(seed);
  const b = farthestFrom(a);
  if (a === b) return null;
  return [cellCenter(roomy, a), cellCenter(roomy, b)];
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
  if (!Array.isArray(data.spawns) || data.spawns.length !== 2 || !data.spawns.every(point))
    throw new Error('A map needs exactly two spawn points.');
  return {
    ...(typeof data.id === 'string' && data.id.length <= 64 ? { id: data.id } : {}),
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 40) : 'Imported map',
    width: data.width,
    height: data.height,
    walls: data.walls.map((w: { a: Vec2; b: Vec2 }) => ({ a: { x: w.a.x, y: w.a.y }, b: { x: w.b.x, y: w.b.y } })),
    spawns: [
      { x: data.spawns[0].x, y: data.spawns[0].y },
      { x: data.spawns[1].x, y: data.spawns[1].y },
    ],
    ...(data.dark === true ? { dark: true } : {}),
    ...(MUSIC_STYLES.includes(data.music) ? { music: data.music } : {}),
  };
}
