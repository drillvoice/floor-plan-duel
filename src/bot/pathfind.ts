// A* over the walkable grid (8-connected, no corner cutting). Cells near walls
// cost a little more so paths keep off the walls where there's room.

import { canStep, cellCenter, cellIndex, type Grid } from '../sim/grid';
import type { Vec2 } from '../sim/vec';

const SQRT2 = Math.SQRT2;

export function findPath(grid: Grid, from: Vec2, to: Vec2): Vec2[] | null {
  const start = nearestOpen(grid, cellIndex(grid, from));
  const goal = nearestOpen(grid, cellIndex(grid, to));
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [to];

  const { cols, rows } = grid;
  const n = cols * rows;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gc = goal % cols;
  const gr = (goal - gc) / cols;
  const h = (i: number) => {
    const c = i % cols;
    const r = (i - c) / cols;
    const dx = Math.abs(c - gc);
    const dy = Math.abs(r - gr);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };
  const heap = new MinHeap();
  g[start] = 0;
  heap.push(start, h(start));

  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const c = cur % cols;
    const r = (cur - c) / cols;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nc = c + dx;
        const nr = r + dy;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (!grid.open[ni] || closed[ni]) continue;
        if (!dx || !dy) {
          if (!canStep(grid, cur, ni)) continue;
        } else {
          // Diagonal moves need both L-shaped routes clear, or we'd clip a wall corner.
          const viaX = r * cols + nc;
          const viaY = nr * cols + c;
          if (!canStep(grid, cur, viaX) || !canStep(grid, viaX, ni)) continue;
          if (!canStep(grid, cur, viaY) || !canStep(grid, viaY, ni)) continue;
        }
        const wallPenalty = grid.clearance[ni] < 1 ? 1.5 : 0;
        const cost = g[cur] + (dx && dy ? SQRT2 : 1) + wallPenalty;
        if (cost < g[ni]) {
          g[ni] = cost;
          came[ni] = cur;
          heap.push(ni, cost + h(ni));
        }
      }
    }
  }
  if (came[goal] < 0) return null;
  const path: Vec2[] = [to];
  for (let i = came[goal]; i >= 0 && i !== start; i = came[i]) path.push(cellCenter(grid, i));
  return path.reverse();
}

function nearestOpen(grid: Grid, i: number): number {
  if (grid.open[i]) return i;
  const c0 = i % grid.cols;
  const r0 = (i - c0) / grid.cols;
  for (let radius = 1; radius < Math.max(grid.cols, grid.rows); radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        const c = c0 + dc;
        const r = r0 + dr;
        if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
        const j = r * grid.cols + c;
        if (grid.open[j]) return j;
      }
    }
  }
  return -1;
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    const items = this.items;
    const keys = this.keys;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      items[i] = items[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    items[i] = item;
    keys[i] = key;
  }

  pop(): number {
    const items = this.items;
    const keys = this.keys;
    const top = items[0];
    const lastItem = items.pop()!;
    const lastKey = keys.pop()!;
    if (items.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mk = lastKey;
        if (l < items.length && keys[l] < mk) {
          m = l;
          mk = keys[l];
        }
        if (r < items.length && keys[r] < mk) m = r;
        if (m === i) break;
        items[i] = items[m];
        keys[i] = keys[m];
        i = m;
      }
      items[i] = lastItem;
      keys[i] = lastKey;
    }
    return top;
  }
}
