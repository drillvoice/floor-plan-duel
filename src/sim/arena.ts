import type { Config } from '../config';
import { buildGrid } from './grid';
import { type Arena, type MapData, musicStyle, type Wall } from './types';
import { add, distPointSegment, distSegmentSegment, scale, type Vec2 } from './vec';

export function buildArena(map: MapData, cfg: Config): Arena {
  const { width: w, height: h } = map;
  const outer: Wall[] = [
    { a: { x: 0, y: 0 }, b: { x: w, y: 0 } },
    { a: { x: w, y: 0 }, b: { x: w, y: h } },
    { a: { x: w, y: h }, b: { x: 0, y: h } },
    { a: { x: 0, y: h }, b: { x: 0, y: 0 } },
  ];
  const walls = [...outer, ...map.walls.map((wl) => ({ a: { ...wl.a }, b: { ...wl.b } }))];
  return {
    name: map.name,
    width: w,
    height: h,
    walls,
    spawns: [{ ...map.spawns[0] }, { ...map.spawns[1] }],
    dark: !!map.dark,
    music: musicStyle(map),
    grid: buildGrid(w, h, walls, map.spawns[0], cfg),
  };
}

// The arena as a Ghost sees it: only the outer boundary (built first, so the
// first four walls). Cached per arena.
const ghostArenas = new WeakMap<Arena, Arena>();
export function ghostArena(arena: Arena): Arena {
  let g = ghostArenas.get(arena);
  if (!g) {
    g = { ...arena, walls: arena.walls.slice(0, 4) };
    ghostArenas.set(arena, g);
  }
  return g;
}

// Push a circle out of any walls it overlaps. Returns true if it touched one.
export function resolveCircle(pos: Vec2, radius: number, arena: Arena, cfg: Config): boolean {
  const minDist = radius + cfg.map.wallThickness / 2;
  let touched = false;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const wall of arena.walls) {
      const ab = { x: wall.b.x - wall.a.x, y: wall.b.y - wall.a.y };
      const l2 = ab.x * ab.x + ab.y * ab.y;
      const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((pos.x - wall.a.x) * ab.x + (pos.y - wall.a.y) * ab.y) / l2));
      const cx = wall.a.x + ab.x * t;
      const cy = wall.a.y + ab.y * t;
      let dx = pos.x - cx;
      let dy = pos.y - cy;
      const d = Math.hypot(dx, dy);
      if (d >= minDist) continue;
      if (d < 1e-9) {
        // Centre exactly on the wall line: push out along the wall's normal.
        const l = Math.sqrt(l2) || 1;
        dx = -ab.y / l;
        dy = ab.x / l;
      } else {
        dx /= d;
        dy /= d;
      }
      pos.x = cx + dx * minDist;
      pos.y = cy + dy * minDist;
      touched = moved = true;
    }
    if (!moved) break;
  }
  // Failsafe: never leave the map, whatever happens with the walls.
  pos.x = Math.max(minDist, Math.min(arena.width - minDist, pos.x));
  pos.y = Math.max(minDist, Math.min(arena.height - minDist, pos.y));
  return touched;
}

// Move a circle by `delta`, sliding along walls. Sub-steps so fast movement
// (dashes) can't tunnel through thin walls. Returns true if it touched a wall.
export function moveCircle(pos: Vec2, delta: Vec2, radius: number, arena: Arena, cfg: Config): boolean {
  const length = Math.hypot(delta.x, delta.y);
  const steps = Math.max(1, Math.ceil(length / 0.1));
  let touched = false;
  for (let i = 0; i < steps; i++) {
    pos.x += delta.x / steps;
    pos.y += delta.y / steps;
    if (resolveCircle(pos, radius, arena, cfg)) touched = true;
  }
  return touched;
}

export function circleHitsWall(pos: Vec2, radius: number, arena: Arena, cfg: Config): boolean {
  const minDist = radius + cfg.map.wallThickness / 2;
  return arena.walls.some((w) => distPointSegment(pos, w.a, w.b) < minDist);
}

// Whether a bullet could travel straight from a to b without touching a wall.
export function hasLineOfSight(a: Vec2, b: Vec2, arena: Arena, cfg: Config): boolean {
  const clearance = cfg.bullet.radius + cfg.map.wallThickness / 2;
  return !arena.walls.some((w) => distSegmentSegment(a, b, w.a, w.b) < clearance);
}

// How far a beam of half-width `radius` can travel from `from` along the unit
// vector `dir` before it touches a wall, up to `maxLength`.
export function castRay(from: Vec2, dir: Vec2, maxLength: number, radius: number, arena: Arena, cfg: Config): number {
  const clearance = radius + cfg.map.wallThickness / 2;
  const blocked = (l: number) => arena.walls.some((w) => distSegmentSegment(from, add(from, scale(dir, l)), w.a, w.b) < clearance);
  if (!blocked(maxLength)) return maxLength;
  // The first wall along the way: narrow it down by halving.
  let clear = 0;
  let hit = maxLength;
  for (let n = 0; n < 20; n++) {
    const mid = (clear + hit) / 2;
    if (blocked(mid)) hit = mid;
    else clear = mid;
  }
  return clear;
}
