import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { cameraRelative } from '../src/input/relative';
import { FirstPersonCamera, turnToward } from '../src/render/firstPerson/camera';
import { clipToNear, lens, project, type Camera } from '../src/render/firstPerson/project';
import { castWalls, wallEdges } from '../src/render/firstPerson/raycast';
import { buildArena } from '../src/sim/arena';
import { createGame } from '../src/sim/step';
import type { MapData } from '../src/sim/types';

const NEAR = CONFIG.firstPerson.near;
const T = CONFIG.map.wallThickness;

// A 10x10 room with one wall across it at x = 7, from y = 2 to y = 8.
const ROOM: MapData = {
  name: 'Room',
  width: 10,
  height: 10,
  walls: [{ a: { x: 7, y: 2 }, b: { x: 7, y: 8 } }],
  spawns: [
    { x: 2, y: 5 },
    { x: 9, y: 5 },
  ],
};
const arena = buildArena(ROOM, CONFIG);
const edges = wallEdges(arena, T);

const EAST = { x: 1, y: 0 };
const WEST = { x: -1, y: 0 };
const NORTH = { x: 0, y: -1 };

// The depth seen straight ahead: a one-column view casts a single ray along
// the camera's forward direction.
function ahead(cam: Camera): number {
  return castWalls(cam, lens(1, 1, 70), edges, NEAR).depth[0];
}

describe('first-person raycasting', () => {
  it('stops at the near face of a wall, allowing for its thickness', () => {
    expect(ahead({ pos: { x: 5, y: 5 }, forward: EAST })).toBeCloseTo(2 - T / 2, 5);
  });

  it('sees the nearest of several walls, and the back of a wall from behind', () => {
    expect(ahead({ pos: { x: 3, y: 5 }, forward: EAST })).toBeCloseTo(4 - T / 2, 5);
    expect(ahead({ pos: { x: 8, y: 5 }, forward: WEST })).toBeCloseTo(1 - T / 2, 5);
  });

  it('reaches the outer walls past the end of an inner one', () => {
    // At y = 1 the ray passes above the inner wall (which starts at y = 2).
    expect(ahead({ pos: { x: 5, y: 1 }, forward: EAST })).toBeCloseTo(5 - T / 2, 5);
  });

  it("covers a wall's end, so walls that meet join up", () => {
    // Just short of the wall's end at y = 2, but within half a thickness.
    expect(ahead({ pos: { x: 5, y: 2 - T / 3 }, forward: EAST })).toBeCloseTo(2 - T / 2, 5);
  });

  it('has no fisheye: a flat wall facing the camera is the same depth across the view', () => {
    const cols = castWalls({ pos: { x: 3, y: 5 }, forward: EAST }, lens(64, 40, 60), edges, NEAR);
    for (const d of cols.depth) expect(d).toBeCloseTo(4 - T / 2, 4);
  });

  it('sees out of a wall it is standing inside (a Ghost)', () => {
    expect(ahead({ pos: { x: 7, y: 5 }, forward: EAST })).toBeCloseTo(3 - T / 2, 5);
  });

  it('measures how far along the wall each ray struck, for the wall grid', () => {
    // The outer wall along the right, at x = 10, runs from y = 0 to y = 10.
    const cols = castWalls({ pos: { x: 8, y: 1 }, forward: EAST }, lens(1, 1, 70), edges, NEAR);
    expect(cols.along[0]).toBeCloseTo(1, 5);
  });
});

describe('first-person projection', () => {
  const cam: Camera = { pos: { x: 0, y: 0 }, forward: EAST };
  const l = lens(100, 60, 90);

  it('puts a point straight ahead in the middle, lower the nearer the floor', () => {
    expect(l.focal).toBeCloseTo(50, 5);
    const eye = project(cam, l, { x: 2, y: 0 }, 1.2, 1.2, NEAR)!;
    expect(eye.x).toBeCloseTo(50, 5);
    expect(eye.y).toBeCloseTo(30, 5);
    expect(eye.scale).toBeCloseTo(25, 5);
    const floor = project(cam, l, { x: 2, y: 0 }, 0, 1.2, NEAR)!;
    expect(floor.y).toBeCloseTo(30 + 1.2 * 25, 5);
  });

  it('puts points on the right hand to the right of centre', () => {
    // Facing east with y pointing south, the right hand is south.
    expect(project(cam, l, { x: 2, y: 1 }, 0, 1.2, NEAR)!.x).toBeCloseTo(75, 5);
    expect(project({ pos: { x: 0, y: 0 }, forward: NORTH }, l, { x: 1, y: -2 }, 0, 1.2, NEAR)!.x).toBeCloseTo(75, 5);
  });

  it("doesn't draw what's behind the camera, and cuts lines at the near plane", () => {
    expect(project(cam, l, { x: -1, y: 0 }, 0, 1.2, NEAR)).toBeNull();
    expect(clipToNear(cam, { x: -2, y: 0 }, { x: -1, y: 1 }, NEAR)).toBeNull();
    const [a, b] = clipToNear(cam, { x: -1, y: 0 }, { x: 3, y: 4 }, NEAR)!;
    expect(a.x).toBeCloseTo(NEAR, 5);
    expect(a.y).toBeCloseTo(1 + NEAR, 5);
    expect(b).toEqual({ x: 3, y: 4 });
  });
});

describe('first-person camera', () => {
  it('turns the short way round', () => {
    expect(turnToward(3, -3, 0.5)).toBeCloseTo(3 + (Math.PI * 2 - 6) / 2, 5);
    expect(turnToward(0, 1, 1)).toBeCloseTo(1, 5);
  });

  it('snaps to face the opponent before a round, then turns smoothly', () => {
    const state = createGame(ROOM, 1);
    const cam = new FirstPersonCamera();
    cam.update(state, 0, 1 / 60);
    expect(cam.pos).toEqual(state.players[0].pos);
    expect(cam.forward.x).toBeCloseTo(state.players[0].facing.x, 5);
    expect(cam.forward.y).toBeCloseTo(state.players[0].facing.y, 5);

    state.phase = 'playing';
    state.players[0].facing = { x: 0, y: 1 };
    cam.update(state, 0, 1 / 60);
    // Part of the way from east toward south, not all of it.
    expect(cam.forward.y).toBeGreaterThan(0.05);
    expect(cam.forward.x).toBeGreaterThan(0.5);
    for (let n = 0; n < 120; n++) cam.update(state, 0, 1 / 60);
    expect(cam.forward.y).toBeCloseTo(1, 3);
  });
});

describe('camera-relative input', () => {
  const press = (x: number, y: number) => ({ move: { x, y }, dodge: true, shoot: false });

  it('walks forward, back and sideways relative to where the camera looks', () => {
    expect(cameraRelative(press(0, -1), EAST).move).toEqual({ x: 1, y: 0 });
    expect(cameraRelative(press(0, 1), EAST).move).toEqual({ x: -1, y: 0 });
    // Facing east, right is south (y points down).
    const right = cameraRelative(press(1, 0), EAST).move;
    expect(right.x).toBeCloseTo(0, 9);
    expect(right.y).toBeCloseTo(1, 9);
    expect(cameraRelative(press(1, 0), NORTH).move).toEqual({ x: 1, y: 0 });
    expect(cameraRelative(press(-1, 0), NORTH).move).toEqual({ x: -1, y: 0 });
  });

  it('passes dodge and shoot straight through', () => {
    expect(cameraRelative(press(0, 0), NORTH)).toMatchObject({ dodge: true, shoot: false });
  });
});
