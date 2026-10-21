export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function normalize(a: Vec2): Vec2 {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

// Perpendicular to the left of `a`, in screen coordinates (y points down):
// facing north (0,-1) gives west (-1,0).
export const leftOf = (a: Vec2): Vec2 => ({ x: a.y, y: -a.x });
export const rightOf = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return dist(p, closestPointOnSegment(p, a, b));
}

// Shortest distance between segments p1-q1 and p2-q2 (Ericson, Real-Time
// Collision Detection, 5.1.9).
export function distSegmentSegment(p1: Vec2, q1: Vec2, p2: Vec2, q2: Vec2): number {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  let s: number;
  let t: number;
  if (a < 1e-12 && e < 1e-12) return len(r);
  if (a < 1e-12) {
    s = 0;
    t = clamp(f / e);
  } else {
    const c = dot(d1, r);
    if (e < 1e-12) {
      t = 0;
      s = clamp(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? clamp((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a);
      }
    }
  }
  const c1 = add(p1, scale(d1, s));
  const c2 = add(p2, scale(d2, t));
  return dist(c1, c2);
}
