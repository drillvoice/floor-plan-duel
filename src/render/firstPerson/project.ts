// Projection for the first-person view: where a point in the arena lands in
// a view, given the camera. No DOM, so it's unit tested.
//
// Arena coordinates have y pointing down (south), so a camera facing `forward`
// has its right hand at rightOf(forward).

import { dot, rightOf, sub, type Vec2 } from '../../sim/vec';

export interface Camera {
  pos: Vec2;
  forward: Vec2; // unit vector the camera looks along
}

// A view's size in pixels and its focal length: how many pixels one unit
// sideways spans at one unit of depth.
export interface Lens {
  columns: number;
  rows: number;
  focal: number;
  horizon: number; // screen row level with the eye
}

export function lens(columns: number, rows: number, fovDegrees: number): Lens {
  const focal = columns / 2 / Math.tan((fovDegrees * Math.PI) / 360);
  return { columns, rows, focal, horizon: rows / 2 };
}

// A point relative to the camera: `depth` along the view, `side` to the right.
export function toCamera(cam: Camera, p: Vec2): { depth: number; side: number } {
  const rel = sub(p, cam.pos);
  return { depth: dot(rel, cam.forward), side: dot(rel, rightOf(cam.forward)) };
}

// Screen position of a point `height` above the floor, and how many pixels a
// unit spans there. Null when it's behind the near plane.
export function project(cam: Camera, l: Lens, p: Vec2, height: number, eyeHeight: number, near: number): { x: number; y: number; scale: number; depth: number } | null {
  const { depth, side } = toCamera(cam, p);
  if (depth < near) return null;
  const scale = l.focal / depth;
  return { x: l.columns / 2 + side * scale, y: l.horizon + (eyeHeight - height) * scale, scale, depth };
}

// The part of segment a-b in front of the near plane, or null if none is.
// Lines stay straight under perspective, so projecting the clipped ends is
// enough to draw one.
export function clipToNear(cam: Camera, a: Vec2, b: Vec2, near: number): [Vec2, Vec2] | null {
  const da = toCamera(cam, a).depth;
  const db = toCamera(cam, b).depth;
  if (da < near && db < near) return null;
  if (da >= near && db >= near) return [a, b];
  const t = (near - da) / (db - da);
  const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return da < near ? [cut, b] : [a, cut];
}
