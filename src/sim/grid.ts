// Walkable grid derived from a map's walls, for power-up placement and bot
// pathfinding. Cells are cfg.map.gridCell units square.

import type { Config } from '../config';
import type { Wall } from './types';
import { distPointSegment, type Vec2 } from './vec';

export interface Grid {
  cell: number;
  cols: number;
  rows: number;
  // Distance from each cell centre to the nearest wall surface.
  clearance: number[];
  // Walkable for a player and reachable from the first spawn point.
  open: boolean[];
}

export function buildGrid(width: number, height: number, walls: Wall[], spawn: Vec2, cfg: Config): Grid {
  const cell = cfg.map.gridCell;
  const cols = Math.round(width / cell);
  const rows = Math.round(height / cell);
  const half = cfg.map.wallThickness / 2;
  const clearance: number[] = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: (c + 0.5) * cell, y: (r + 0.5) * cell };
      let d = Infinity;
      for (const w of walls) d = Math.min(d, distPointSegment(p, w.a, w.b) - half);
      clearance[r * cols + c] = d;
    }
  }

  // Flood fill from the spawn so sealed-off pockets never count as floor.
  const open: boolean[] = new Array(cols * rows).fill(false);
  const walkable = (i: number) => clearance[i] >= cfg.player.radius;
  const start = nearestWalkable(cellIndex({ cell, cols, rows }, spawn), cols, rows, walkable);
  if (start >= 0) {
    const queue = [start];
    open[start] = true;
    while (queue.length) {
      const i = queue.pop()!;
      const c = i % cols;
      const r = (i - c) / cols;
      const neighbours = [
        c > 0 ? i - 1 : -1,
        c < cols - 1 ? i + 1 : -1,
        r > 0 ? i - cols : -1,
        r < rows - 1 ? i + cols : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && !open[n] && walkable(n)) {
          open[n] = true;
          queue.push(n);
        }
      }
    }
  }
  return { cell, cols, rows, clearance, open };
}

function nearestWalkable(start: number, cols: number, rows: number, walkable: (i: number) => boolean): number {
  if (walkable(start)) return start;
  const sc = start % cols;
  const sr = (start - sc) / cols;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < cols * rows; i++) {
    if (!walkable(i)) continue;
    const c = i % cols;
    const r = (i - c) / cols;
    const d = (c - sc) ** 2 + (r - sr) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function cellIndex(grid: Pick<Grid, 'cell' | 'cols' | 'rows'>, p: Vec2): number {
  const c = Math.max(0, Math.min(grid.cols - 1, Math.floor(p.x / grid.cell)));
  const r = Math.max(0, Math.min(grid.rows - 1, Math.floor(p.y / grid.cell)));
  return r * grid.cols + c;
}

export function cellCenter(grid: Grid, i: number): Vec2 {
  const c = i % grid.cols;
  const r = (i - c) / grid.cols;
  return { x: (c + 0.5) * grid.cell, y: (r + 0.5) * grid.cell };
}
