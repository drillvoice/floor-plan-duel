import { describe, expect, it } from 'vitest';
import { emptyTouchState, TouchPlayer } from '../src/input/touch';
import { BUILT_IN_MAPS } from '../src/maps/builtin';
import { arenaLayout } from '../src/render/renderer';

describe('touch player', () => {
  it('passes the joystick and held shoot straight through', () => {
    const state = emptyTouchState();
    const player = new TouchPlayer(state);
    state.x = 0.5;
    state.y = -1;
    state.shoot = true;
    expect(player.sample()).toEqual({ move: { x: 0.5, y: -1 }, dodge: false, shoot: true });
  });

  it('acts on each dodge or shot tap exactly once, even between ticks', () => {
    const state = emptyTouchState();
    const player = new TouchPlayer(state);
    // Pressed and released before the game looked.
    state.dodges++;
    state.shots++;
    expect(player.sample()).toMatchObject({ dodge: true, shoot: true });
    expect(player.sample()).toMatchObject({ dodge: false, shoot: false });
  });

  it('forgets presses made before a reset', () => {
    const state = emptyTouchState();
    const player = new TouchPlayer(state);
    state.dodges = 3;
    state.shots = 2;
    player.reset();
    expect(player.sample()).toMatchObject({ dodge: false, shoot: false });
  });
});

describe('compact arena layout', () => {
  const phones = [
    [844, 390],
    [667, 375],
    [932, 430],
  ];

  it('fits every built-in map on a sideways phone, bigger than the normal layout', () => {
    for (const [w, h] of phones) {
      for (const map of BUILT_IN_MAPS) {
        const arena = { width: map.width, height: map.height };
        const l = arenaLayout(w, h, arena, true);
        expect(l.origin.x).toBeGreaterThanOrEqual(0);
        expect(l.origin.y).toBeGreaterThanOrEqual(30);
        expect(l.origin.x + map.width * l.scale).toBeLessThanOrEqual(w);
        expect(l.origin.y + map.height * l.scale).toBeLessThanOrEqual(h);
        expect(l.scale).toBeGreaterThan(arenaLayout(w, h, arena, false).scale);
      }
    }
  });

  it('leaves the normal layout as it was', () => {
    const l = arenaLayout(1920, 900, { width: 18, height: 12 }, false);
    // (900 - 64 - 48) / 12 tall, with room for both side columns.
    expect(l.scale).toBeCloseTo(788 / 12);
    expect(l.origin.y).toBe(88);
    expect(l.sideW).toBeGreaterThan(0);
  });
});
