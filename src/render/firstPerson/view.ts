// Draws one player's first-person view: ceiling and floor, wall columns from
// the raycaster, then the opponent, bullets and power-ups as sprites, each
// hidden behind any wall nearer than it. Drawn small on its own canvas and
// scaled up unsmoothed, for a chunky retro look. Reads state; never changes it.

import { hitRadiusFor } from '../../sim/powerups';
import type { GameState, PlayerIndex } from '../../sim/types';
import { dot, type Vec2 } from '../../sim/vec';
import { drawPowerUpGlyph, powerUpColor } from '../icons';
import { drawLook } from '../looks';
import { COLORS, hexAlpha } from '../theme';
import { clipToNear, lens, project, type Camera, type Lens } from './project';
import { castWalls, wallEdges, type WallColumns } from './raycast';

type Rgb = [number, number, number];

const WALL: Rgb = [233, 228, 216];
const FOG: Rgb = [22, 24, 31]; // the page background, so the distance melts into it
const DARK_FOG: Rgb = [4, 5, 9];
const CEILING = '#20232c';
const CRATE_COLOR = '#ffffff';
const CRATE_CROSS = '#e8333a';
// Walls are lit from one fixed direction, so each face of a box has its own
// shade, as Wolfenstein's light and dark sides do.
const LIGHT: Vec2 = { x: 0.45, y: -0.89 };
// On dark maps the opponent's own light keeps them at least this visible.
const CARRIED_LIGHT = 0.45;
// Your own bullets fade in between these depths (units).
const OWN_SHOT_FADE_FROM = 0.8;
const OWN_SHOT_FADE_OVER = 3;

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Sprite {
  depth: number;
  left: number; // screen columns it covers
  right: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

const mix = (a: Rgb, b: Rgb, t: number): string =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;

export class FirstPersonView {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private walls: WallColumns | undefined;

  draw(target: CanvasRenderingContext2D, rect: ViewRect, state: GameState, player: PlayerIndex, cam: Camera, looks: readonly [string, string]): void {
    const fp = state.cfg.firstPerson;
    const columns = fp.columns;
    const rows = Math.max(1, Math.round((columns * rect.height) / rect.width));
    if (this.canvas.width !== columns || this.canvas.height !== rows) {
      this.canvas.width = columns;
      this.canvas.height = rows;
    }
    const ctx = this.ctx;
    const l = lens(columns, rows, fp.fov);
    const dark = state.arena.dark;
    const fogColor = dark ? DARK_FOG : FOG;
    const fogDistance = dark ? fp.darkFogDistance : fp.fogDistance;

    this.drawFloorAndCeiling(ctx, state, cam, l, fogColor, fogDistance);
    const walls = (this.walls = castWalls(cam, l, wallEdges(state.arena, state.cfg.map.wallThickness), fp.near, this.walls));
    this.drawWalls(ctx, state, l, walls, fogColor, fogDistance);

    const sprites: Sprite[] = [];
    this.addOpponent(sprites, state, player, cam, l, looks, fogColor, fogDistance);
    this.addPowerUps(sprites, state, cam, l);
    this.addBullets(sprites, state, player, cam, l);
    sprites.sort((a, b) => b.depth - a.depth);
    for (const s of sprites) drawBehindWalls(ctx, s, walls.depth);
    // Lasers glow, so like the top-down view they show through the dark.
    this.drawLasers(ctx, state, cam, l);

    target.save();
    target.imageSmoothingEnabled = false;
    target.drawImage(this.canvas, rect.x, rect.y, rect.width, rect.height);
    target.restore();
  }

  private drawFloorAndCeiling(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera, l: Lens, fogColor: Rgb, fogDistance: number): void {
    const fp = state.cfg.firstPerson;
    const { columns, rows, horizon } = l;
    ctx.fillStyle = CEILING;
    ctx.fillRect(0, 0, columns, horizon);
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, horizon, columns, rows - horizon);

    // A grid on the floor, so distance and movement read at a glance. Walls
    // are drawn over it, which hides the grid beyond them.
    const g = fp.floorGrid;
    const { width: w, height: h } = state.arena;
    ctx.strokeStyle = state.arena.dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const line = (a: Vec2, b: Vec2) => {
      const clipped = clipToNear(cam, a, b, fp.near);
      if (!clipped) return;
      const pa = project(cam, l, clipped[0], 0, fp.eyeHeight, fp.near);
      const pb = project(cam, l, clipped[1], 0, fp.eyeHeight, fp.near);
      if (!pa || !pb) return;
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    };
    for (let x = g; x < w; x += g) line({ x, y: 0 }, { x, y: h });
    for (let y = g; y < h; y += g) line({ x: 0, y }, { x: w, y });
    ctx.stroke();

    // Fog over the floor and ceiling, thickening toward the horizon. A
    // floor row's depth goes as 1 / (its distance below the horizon), so
    // the gradient gets a stop per slice of depth.
    const fog = (height: number, from: number, to: number) => {
      const grad = ctx.createLinearGradient(0, from, 0, to);
      grad.addColorStop(0, `rgb(${fogColor.join(',')})`);
      for (const frac of [1, 0.75, 0.5, 0.3, 0.15, 0.05]) {
        const offset = (height * l.focal) / (fogDistance * frac) / Math.abs(to - from);
        if (offset <= 1) grad.addColorStop(offset, `rgba(${fogColor[0]},${fogColor[1]},${fogColor[2]},${frac})`);
      }
      grad.addColorStop(1, `rgba(${fogColor[0]},${fogColor[1]},${fogColor[2]},0)`);
      return grad;
    };
    ctx.fillStyle = fog(fp.eyeHeight, horizon, rows);
    ctx.fillRect(0, horizon, columns, rows - horizon);
    ctx.fillStyle = fog(fp.wallHeight - fp.eyeHeight, horizon, 0);
    ctx.fillRect(0, 0, columns, horizon);
  }

  private drawWalls(ctx: CanvasRenderingContext2D, state: GameState, l: Lens, walls: WallColumns, fogColor: Rgb, fogDistance: number): void {
    const fp = state.cfg.firstPerson;
    const edges = wallEdges(state.arena, state.cfg.map.wallThickness);
    for (let i = 0; i < l.columns; i++) {
      const e = walls.edge[i];
      if (e < 0) continue;
      const depth = walls.depth[i];
      const scale = l.focal / depth;
      const top = l.horizon - (fp.wallHeight - fp.eyeHeight) * scale;
      const bottom = l.horizon + fp.eyeHeight * scale;
      let shade = 0.68 + 0.32 * Math.max(0, dot(edges[e].normal, LIGHT));
      // Darker columns where one face of a wall meets another (outlines),
      // and every `wallGrid` units along a wall.
      const prev = i > 0 ? walls.edge[i - 1] : e;
      if (prev !== e) shade *= 0.6;
      else if (Math.floor(walls.along[i] / fp.wallGrid) !== Math.floor(walls.along[i - 1] / fp.wallGrid)) shade *= 0.85;
      const lit: Rgb = [WALL[0] * shade, WALL[1] * shade, WALL[2] * shade];
      ctx.fillStyle = mix(lit, fogColor, Math.min(1, depth / fogDistance));
      ctx.fillRect(i, top, 1, bottom - top);
    }
  }

  private addOpponent(
    sprites: Sprite[],
    state: GameState,
    player: PlayerIndex,
    cam: Camera,
    l: Lens,
    looks: readonly [string, string],
    fogColor: Rgb,
    fogDistance: number,
  ): void {
    const fp = state.cfg.firstPerson;
    const i: PlayerIndex = player === 0 ? 1 : 0;
    const p = state.players[i];
    const foot = project(cam, l, p.pos, 0, fp.eyeHeight, fp.near);
    if (!foot) return;
    const r = hitRadiusFor(p, state.cfg) * foot.scale;
    const height = fp.playerHeight * foot.scale;
    let fog = Math.min(1, foot.depth / fogDistance);
    if (state.arena.dark) fog = Math.min(fog, CARRIED_LIGHT);
    const rgb = hexRgb(COLORS.players[i]);
    const body = mix(rgb, fogColor, fog);
    const face = mix([255, 255, 255], fogColor, fog);
    sprites.push({
      depth: foot.depth,
      left: foot.x - r,
      right: foot.x + r,
      draw: (ctx) => {
        ctx.save();
        // A Ghost is see-through, as from above.
        if (p.effects.ghost > 0) ctx.globalAlpha = 0.4 + 0.15 * Math.sin(state.tick * 0.3);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(foot.x, foot.y, r * 1.1, Math.max(0.5, r * 0.3), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.roundRect(foot.x - r, foot.y - height, r * 2, height, [r, r, r * 0.3, r * 0.3]);
        ctx.fill();
        // A head: the player's look on a pale disc, like the circle from above.
        const headR = r * 0.8;
        const headY = foot.y - height + r;
        ctx.fillStyle = looks[i] ? face : body;
        ctx.beginPath();
        ctx.arc(foot.x, headY, headR, 0, Math.PI * 2);
        ctx.fill();
        drawLook(ctx, looks[i], foot.x, headY, headR);
        if (p.effects.shield > 0) {
          ctx.strokeStyle = hexAlpha('#3d9bff', 0.8);
          ctx.lineWidth = Math.max(1, r * 0.12);
          ctx.beginPath();
          ctx.roundRect(foot.x - r * 1.2, foot.y - height * 1.08, r * 2.4, height * 1.08, r);
          ctx.stroke();
        }
        ctx.restore();
      },
    });
  }

  private addBullets(sprites: Sprite[], state: GameState, player: PlayerIndex, cam: Camera, l: Lens): void {
    const fp = state.cfg.firstPerson;
    for (const b of state.bullets) {
      const at = project(cam, l, b.pos, fp.bulletHeight, fp.eyeHeight, fp.near);
      if (!at) continue;
      const floor = l.horizon + fp.eyeHeight * at.scale;
      const r = Math.max(0.8, b.radius * at.scale);
      let fade = Math.min(1, (b.lifetime - b.age) / state.cfg.bullet.fadeTime);
      // Your own shots start just in front of your eyes, where they'd fill
      // the screen, so they fade in as they leave.
      if (b.owner === player) fade *= Math.min(1, Math.max(0, (at.depth - OWN_SHOT_FADE_FROM) / OWN_SHOT_FADE_OVER));
      const color = COLORS.players[b.owner];
      sprites.push({
        depth: at.depth,
        left: at.x - r * 2,
        right: at.x + r * 2,
        draw: (ctx) => {
          ctx.save();
          ctx.globalAlpha = Math.max(0, fade);
          // The shadow on the floor shows how far away a bullet is far better
          // than its size does.
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.beginPath();
          ctx.ellipse(at.x, floor, r, Math.max(0.5, (r * fp.eyeHeight) / at.depth), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = hexAlpha(color, 0.3);
          ctx.beginPath();
          ctx.arc(at.x, at.y, r * 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(at.x, at.y, r * 0.45, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        },
      });
    }
  }

  private addPowerUps(sprites: Sprite[], state: GameState, cam: Camera, l: Lens): void {
    const fp = state.cfg.firstPerson;
    const pc = state.cfg.powerUps;
    for (const pu of state.powerUps) {
      const color = pu.kind === 'healthCrate' ? CRATE_COLOR : powerUpColor(pu.kind);
      const ground = project(cam, l, pu.pos, 0, fp.eyeHeight, fp.near);
      if (!ground) continue;
      if (pu.telegraph > 0) {
        // A shimmering ring on the floor where it's about to appear.
        const progress = 1 - pu.telegraph / pc.telegraph;
        const rx = pc.radius * (2.4 - 1.2 * progress) * ground.scale;
        sprites.push({
          depth: ground.depth,
          left: ground.x - rx,
          right: ground.x + rx,
          draw: (ctx) => {
            ctx.strokeStyle = hexAlpha(color, 0.35 + 0.4 * Math.abs(Math.sin(state.tick * 0.3)));
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(ground.x, ground.y, rx, Math.max(0.5, (rx * fp.eyeHeight) / ground.depth), 0, 0, Math.PI * 2);
            ctx.stroke();
          },
        });
        continue;
      }
      // Floating items bob gently, as power-ups do.
      const bob = 0.08 * Math.sin(state.tick * 0.08 + pu.id);
      const at = project(cam, l, pu.pos, fp.powerUpHeight + bob, fp.eyeHeight, fp.near)!;
      const r = pc.radius * at.scale;
      const left = Math.max(0, pu.remaining / pu.lifespan);
      sprites.push({
        depth: at.depth,
        left: at.x - r * 1.7,
        right: at.x + r * 1.7,
        draw: (ctx) => {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.beginPath();
          ctx.ellipse(ground.x, ground.y, r, Math.max(0.5, (r * fp.eyeHeight) / ground.depth), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = hexAlpha(color, 0.2);
          ctx.beginPath();
          ctx.arc(at.x, at.y, r * 1.7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = color;
          ctx.beginPath();
          if (pu.kind === 'healthCrate') {
            ctx.roundRect(at.x - r, at.y - r, r * 2, r * 2, r * 0.25);
            ctx.fill();
            ctx.fillStyle = CRATE_CROSS;
            const arm = r * 0.28;
            ctx.fillRect(at.x - arm, at.y - r * 0.7, arm * 2, r * 1.4);
            ctx.fillRect(at.x - r * 0.7, at.y - arm, r * 1.4, arm * 2);
          } else {
            ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
            ctx.fill();
            if (r > 4) drawPowerUpGlyph(ctx, pu.kind, at.x, at.y, r * 1.2);
          }
          // The lifespan ring shrinks as the item expires.
          ctx.strokeStyle = hexAlpha(color, 0.9);
          ctx.lineWidth = Math.max(1, r * 0.12);
          ctx.beginPath();
          ctx.arc(at.x, at.y, r * 1.45, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
          ctx.stroke();
        },
      });
    }
  }

  private drawLasers(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera, l: Lens): void {
    const fp = state.cfg.firstPerson;
    for (const laser of state.lasers) {
      const clipped = clipToNear(cam, laser.from, laser.to, fp.near);
      if (!clipped) continue;
      const a = project(cam, l, clipped[0], fp.bulletHeight, fp.eyeHeight, fp.near);
      const b = project(cam, l, clipped[1], fp.bulletHeight, fp.eyeHeight, fp.near);
      if (!a || !b) continue;
      const color = COLORS.players[laser.owner];
      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (!laser.fired) {
        // The lock-on line: the lane to get out of before it fires.
        const t = Math.min(1, laser.age / laser.chargeTime);
        ctx.setLineDash([3, 3]);
        ctx.lineDashOffset = -state.tick;
        ctx.strokeStyle = hexAlpha(color, 0.35 + 0.6 * t);
        ctx.lineWidth = 1 + t;
        ctx.stroke();
      } else {
        const life = Math.max(0, 1 - (laser.age - laser.chargeTime) / state.cfg.powerUps.laser.flashTime);
        ctx.strokeStyle = hexAlpha(color, 0.6 * life);
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${life})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

// Draw a sprite only in the columns where it's nearer than the wall there,
// clipping to each run of such columns.
function drawBehindWalls(ctx: CanvasRenderingContext2D, s: Sprite, wallDepth: Float32Array): void {
  const first = Math.max(0, Math.floor(s.left));
  const last = Math.min(wallDepth.length - 1, Math.ceil(s.right));
  let start = -1;
  const flush = (end: number) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(start, 0, end - start, ctx.canvas.height);
    ctx.clip();
    s.draw(ctx);
    ctx.restore();
    start = -1;
  };
  for (let c = first; c <= last; c++) {
    const visible = s.depth < wallDepth[c];
    if (visible && start < 0) start = c;
    else if (!visible && start >= 0) flush(c);
  }
  if (start >= 0) flush(last + 1);
}

function hexRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
