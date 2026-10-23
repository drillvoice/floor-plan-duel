// The first-person view's walls: one ray per screen column, Wolfenstein
// style, against the arena's wall segments. No DOM, so it's unit tested.

import type { Arena } from '../../sim/types';
import { rightOf, type Vec2 } from '../../sim/vec';
import type { Camera, Lens } from './project';

// One side of a wall. Walls are drawn as thin boxes of the wall thickness,
// running half a thickness past each end so walls that meet join up, much as
// the sim's round-ended collision shape does.
export interface WallEdge {
  a: Vec2;
  b: Vec2;
  wall: number; // index into arena.walls
  along: number; // distance along the wall at `a`, for the wall grid
  alongStep: 1 | -1 | 0; // whether `along` grows or shrinks toward `b` (0 on a wall's end)
  normal: Vec2; // facing out of the wall, for shading
}

// Built once per arena and wall thickness.
const edgeCache = new WeakMap<Arena, { thickness: number; edges: WallEdge[] }>();

export function wallEdges(arena: Arena, thickness: number): WallEdge[] {
  const cached = edgeCache.get(arena);
  if (cached && cached.thickness === thickness) return cached.edges;
  const h = thickness / 2;
  const edges: WallEdge[] = [];
  arena.walls.forEach((w, wall) => {
    const length = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    // A wall of no length is just a post; give it any direction.
    const u = length > 1e-9 ? { x: (w.b.x - w.a.x) / length, y: (w.b.y - w.a.y) / length } : { x: 1, y: 0 };
    const n = rightOf(u);
    const corner = (t: number, side: number) => ({ x: w.a.x + u.x * t + n.x * side, y: w.a.y + u.y * t + n.y * side });
    const a1 = corner(-h, h);
    const b1 = corner(length + h, h);
    const b2 = corner(length + h, -h);
    const a2 = corner(-h, -h);
    const back = { x: -n.x, y: -n.y };
    edges.push({ a: a1, b: b1, wall, along: -h, alongStep: 1, normal: n });
    edges.push({ a: b2, b: a2, wall, along: length + h, alongStep: -1, normal: back });
    edges.push({ a: b1, b: b2, wall, along: length + h, alongStep: 0, normal: u });
    edges.push({ a: a2, b: a1, wall, along: -h, alongStep: 0, normal: { x: -u.x, y: -u.y } });
  });
  edgeCache.set(arena, { thickness, edges });
  return edges;
}

// What each column of the view sees: the depth to the nearest wall (along
// the view direction, so a flat wall facing you stays flat, with no fisheye),
// which wall edge, and how far along the wall the ray struck it. Columns that
// see no wall get Infinity and edge -1.
export interface WallColumns {
  depth: Float32Array;
  edge: Int32Array;
  along: Float32Array;
}

export function castWalls(cam: Camera, l: Lens, edges: readonly WallEdge[], near: number, out?: WallColumns): WallColumns {
  const n = l.columns;
  const res = out && out.depth.length === n ? out : { depth: new Float32Array(n), edge: new Int32Array(n), along: new Float32Array(n) };
  const f = cam.forward;
  const r = rightOf(f);
  for (let i = 0; i < n; i++) {
    // The ray through this column's centre, scaled so its forward part is 1:
    // then the distance along it is the depth.
    const k = (i + 0.5 - n / 2) / l.focal;
    const dx = f.x + r.x * k;
    const dy = f.y + r.y * k;
    let best = Infinity;
    let bestEdge = -1;
    let bestAlong = 0;
    for (let e = 0; e < edges.length; e++) {
      const { a, b, normal } = edges[e];
      // Only faces turned toward the camera, so a Ghost inside a wall sees
      // out of it rather than a screen full of wall.
      if (normal.x * dx + normal.y * dy >= 0) continue;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const px = a.x - cam.pos.x;
      const py = a.y - cam.pos.y;
      const t = (px * ey - py * ex) / denom;
      if (t < near || t >= best) continue;
      const s = (px * dy - py * dx) / denom;
      if (s < 0 || s > 1) continue;
      best = t;
      bestEdge = e;
      bestAlong = edges[e].along + edges[e].alongStep * s * Math.hypot(ex, ey);
    }
    res.depth[i] = best;
    res.edge[i] = bestEdge;
    res.along[i] = bestAlong;
  }
  return res;
}
