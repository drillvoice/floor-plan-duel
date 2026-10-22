// Draws game state onto a canvas. Reads state and events; never changes them.

import { KEY_BINDINGS, type PlayerKeys } from '../config';
import { fireCooldownFor, hitRadiusFor, maxDodgeCharges, ON_OPPONENT, STACKING } from '../sim/powerups';
import { dodgeDirection, suddenDeathMultiplier } from '../sim/step';
import { MODIFIER_IDS, POWER_UP_KINDS } from '../config';
import { MODIFIERS } from '../sim/modifiers';
import { MAX_PLAYERS, POWER_UP_CATEGORY, type Arena, type GameEvent, type GameState, type PlayerIndex, type PowerUp, type PowerUpKind } from '../sim/types';
import { CATEGORY_COLORS, drawPowerUpGlyph, powerUpColor } from './icons';
import { drawLook } from './looks';
import { add, closestPointOnSegment, distPointSegment, scale, type Vec2 } from '../sim/vec';

export const COLORS = {
  background: '#16181f',
  floor: '#262a35',
  grid: 'rgba(255,255,255,0.035)',
  wall: '#e9e4d8',
  text: '#f2efe8',
  muted: '#8b90a0',
  // P1-P4, kept clear of the power-up colours (gold, blue, red).
  players: ['#7ed957', '#c084fc', '#ff9a3c', '#3fd6cf'] as const,
};

const TIMER_AMBER = '#ffb020';
const TIMER_RED = '#ff4d4d';
const HUD_HEIGHT = 64;
const MARGIN = 24;
// Each player's status sits in a column beside the arena. The arena leaves at
// least this much room; on wide screens the columns take whatever is spare.
const SIDE_MIN = 150;
const SIDE_MAX = 260;
const SIDE_GAP = 16;
// Smallest window the title screen fits at full size.
const TITLE_MIN_H = 600;
const TITLE_MIN_W = 820;

interface Particle {
  pos: Vec2;
  vel: Vec2;
  age: number;
  life: number;
  color: string;
  size: number;
}

interface Ring {
  pos: Vec2;
  age: number;
  color: string;
}

// Short text that pops up over a player, e.g. "Faster bullets!".
interface Callout {
  player: PlayerIndex;
  text: string;
  color: string;
  age: number;
}

const CALLOUT_LIFE = 1.4;
const NEAR_MISS_GLOW = 0.3;
const NEAR_MISS_COLOR = '#ffe066';
const NEAR_MISS_TEXT = ['Close!', 'Whew!', 'Too close!', 'Not today!', 'Missed me!'];

// What a pickup says over the player who took it, and over the opponent for curses.
const PICKUP_TEXT: Record<PowerUpKind, { self: string; victim?: string }> = {
  swiftShot: { self: 'Faster bullets!' },
  longShot: { self: 'Longer range!' },
  triggerHappy: { self: 'Faster firing!' },
  fleetFoot: { self: 'Faster feet!' },
  spareDodge: { self: 'Extra dodge!' },
  shield: { self: 'Shield up!' },
  rapidFire: { self: 'Rapid fire!' },
  bouncer: { self: 'Bouncy bullets!' },
  ghost: { self: 'Ghost mode!' },
  leadShot: { self: 'Sharpshooter!' },
  molasses: { self: 'Slowed them down!', victim: 'Slowed!' },
  topsyTurvy: { self: 'Flipped their controls!', victim: 'Controls flipped!' },
  bigTarget: { self: 'Made them huge!', victim: 'Big target!' },
};

// Short power-up names for the side columns. Curses are named as the
// player carrying them feels them.
const HUD_NAMES: Record<PowerUpKind, string> = {
  swiftShot: 'Fast bullets',
  longShot: 'Long range',
  triggerHappy: 'Fire rate',
  fleetFoot: 'Speed',
  spareDodge: 'Extra dodge',
  shield: 'Shield',
  rapidFire: 'Rapid fire',
  bouncer: 'Bouncy',
  ghost: 'Ghost',
  leadShot: 'Sharpshooter',
  molasses: 'Slowed',
  topsyTurvy: 'Flipped',
  bigTarget: 'Big target',
};

// The round-modifier reel spins through names, slowing down, and lands on
// the round's modifier. These are the times (s into the countdown) at which
// it moves on to the next name; the last one is where it lands.
const REEL_STEPS: number[] = (() => {
  const times: number[] = [];
  let t = 0;
  for (let gap = 0.05; t < 1.3; gap *= 1.17) times.push((t += gap));
  return times;
})();

// Where the reel is `t` seconds into the countdown: how many names it has
// moved through, and whether it has landed.
export function modifierReel(t: number): { step: number; landed: boolean } {
  let step = 0;
  while (step < REEL_STEPS.length && t >= REEL_STEPS[step]) step++;
  return { step, landed: step === REEL_STEPS.length };
}

const MODIFIER_COLOR = '#ffd23f';

// Lights Out maps: how far each light reaches (units) and how bright it is.
const DARKNESS = 'rgba(4,5,9,0.95)';
const PLAYER_LIGHT = 3.2;
const FLASH_LIGHT = 4;
const FLASH_LIFE = 0.15;

// Paint marks where bullets hit walls, in the shooter's colour. They build up
// over a match (the oldest go once there are too many) and are drawn only on
// the walls themselves.
interface Splat {
  pos: Vec2; // on the wall's centre line
  color: string;
  dots: { dx: number; dy: number; r: number }[]; // units, relative to pos
  alpha: number;
}
const MAX_SPLATS = 800;

interface Trail {
  from: Vec2;
  to: Vec2;
  player: PlayerIndex;
  age: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private scale = 1;
  private origin = { x: 0, y: 0 };
  private sideW = SIDE_MIN;
  private hitFlash: number[] = new Array(MAX_PLAYERS).fill(0);
  private nearMissGlow: number[] = new Array(MAX_PLAYERS).fill(0);
  private trails: Trail[] = [];
  private pendingDash: { player: PlayerIndex; from: Vec2 }[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: { pos: Vec2; age: number }[] = []; // muzzle flashes and impacts, for Lights Out
  private darkLayer: HTMLCanvasElement | null = null;
  private splats: Splat[] = [];
  private splatsFor: Arena | null = null; // the map (in this match) the splats belong to
  // Walls with their splats, redrawn only when a splat lands or the layout changes.
  private wallLayer: HTMLCanvasElement | null = null;
  private wallLayerKey = '';
  private callouts: Callout[] = [];
  private shake = 0;
  private screenFlash = 0;
  private suddenDeathBanner = 0;
  // Per player in the match, set by the app: their look (see looks.ts), the
  // name shown in the HUD and results, and their colour (their seat's, so P3
  // keeps P3's colour even in a match where P2's seat is empty).
  looks: string[] = ['', '', '', ''];
  names: string[] = ['P1', 'P2', 'P3', 'P4'];
  colors: string[] = [...COLORS.players];
  matchOverHint = 'Enter for a rematch · Esc for title';

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Feed the events from each simulation step so effects can react.
  handleEvents(events: GameEvent[], state: GameState): void {
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const final = e.hits >= state.cfg.round.hitsToLose;
          this.hitFlash[e.player] = 0.18;
          this.shake = Math.max(this.shake, final ? 1 : 0.55);
          // The whole screen flashes for the knockout that ends the round.
          if (final && state.phase !== 'playing') this.screenFlash = 0.35;
          else if (final) this.callout(e.player, 'Knocked out!', this.colors[e.player]);
          this.burst(e.pos, this.colors[e.player], final ? 28 : 14, final ? 7 : 5);
          break;
        }
        case 'nearMiss': {
          // Several in quick succession for one player only say it once.
          if (!this.callouts.some((c) => c.player === e.player && c.color === NEAR_MISS_COLOR && c.age < 0.5)) {
            this.callout(e.player, NEAR_MISS_TEXT[Math.floor(Math.random() * NEAR_MISS_TEXT.length)], NEAR_MISS_COLOR);
          }
          this.nearMissGlow[e.player] = NEAR_MISS_GLOW;
          this.rings.push({ pos: { ...state.players[e.player].pos }, age: 0, color: NEAR_MISS_COLOR });
          break;
        }
        case 'shieldBlock':
          this.callout(e.player, 'Blocked!', CATEGORY_COLORS.buff);
          this.shake = Math.max(this.shake, 0.3);
          this.burst(e.pos, CATEGORY_COLORS.buff, 12, 4);
          break;
        case 'fire':
          this.flashes.push({ pos: e.pos, age: 0 });
          break;
        case 'wallHit':
          this.burst(e.pos, COLORS.wall, 4, 2);
          this.flashes.push({ pos: e.pos, age: FLASH_LIFE / 2 });
          this.splat(state, e.pos, this.colors[e.owner], 1);
          break;
        case 'bounce':
          this.burst(e.pos, CATEGORY_COLORS.buff, 6, 3);
          this.splat(state, e.pos, this.colors[e.owner], 0.6);
          break;
        case 'dodge':
          this.pendingDash.push({ player: e.player, from: e.from });
          break;
        case 'pickup': {
          this.rings.push({ pos: e.pos, age: 0, color: powerUpColor(e.kind) });
          const text = PICKUP_TEXT[e.kind];
          const color = powerUpColor(e.kind);
          if (STACKING.has(e.kind)) {
            const n = state.players[e.player].effects[e.kind];
            this.callout(e.player, `${text.self}${n > 1 ? ` ×${n}` : ''}`, color);
          } else {
            this.callout(e.player, text.self, color);
            if (ON_OPPONENT.has(e.kind) && text.victim) {
              state.players.forEach((p, i) => {
                if (i !== e.player && !p.out) this.callout(i, text.victim!, color);
              });
            }
          }
          break;
        }
        case 'suddenDeath':
          this.suddenDeathBanner = 2;
          break;
        case 'roundStart':
          this.flashes = [];
          this.callouts = [];
          this.trails = [];
          this.particles = [];
          break;
      }
    }
    // Close trails once the dash has finished.
    this.pendingDash = this.pendingDash.filter((d) => {
      if (state.players[d.player].dash) return true;
      this.trails.push({ from: d.from, to: { ...state.players[d.player].pos }, player: d.player, age: 0 });
      return false;
    });
  }

  // Advance purely visual effects by real elapsed time.
  update(dt: number): void {
    this.hitFlash = this.hitFlash.map((t) => Math.max(0, t - dt));
    this.nearMissGlow = this.nearMissGlow.map((t) => Math.max(0, t - dt));
    for (const t of this.trails) t.age += dt;
    this.trails = this.trails.filter((t) => t.age < 0.35);
    for (const p of this.particles) {
      p.age += dt;
      p.pos = add(p.pos, scale(p.vel, dt));
      p.vel = scale(p.vel, Math.pow(0.02, dt));
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const f of this.flashes) f.age += dt;
    this.flashes = this.flashes.filter((f) => f.age < FLASH_LIFE);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < 0.4);
    for (const c of this.callouts) c.age += dt;
    this.callouts = this.callouts.filter((c) => c.age < CALLOUT_LIFE);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.screenFlash = Math.max(0, this.screenFlash - dt);
    this.suddenDeathBanner = Math.max(0, this.suddenDeathBanner - dt);
  }

  // A paint mark on the wall nearest `pos`: a blob plus a couple of drips
  // spread along the wall. `size` scales it (bounces leave a lighter mark).
  private splat(state: GameState, pos: Vec2, color: string, size: number): void {
    if (this.splatsFor !== state.arena) {
      this.splats = [];
      this.splatsFor = state.arena;
    }
    let wall = state.arena.walls[0];
    for (const w of state.arena.walls) if (distPointSegment(pos, w.a, w.b) < distPointSegment(pos, wall.a, wall.b)) wall = w;
    const at = closestPointOnSegment(pos, wall.a, wall.b);
    const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y) || 1;
    const along = { x: (wall.b.x - wall.a.x) / len, y: (wall.b.y - wall.a.y) / len };
    const dots = [{ dx: 0, dy: 0, r: (0.22 + Math.random() * 0.1) * size }];
    for (let n = 0; n < 3; n++) {
      const d = (Math.random() * 2 - 1) * 0.55 * size;
      dots.push({ dx: along.x * d, dy: along.y * d, r: (0.06 + Math.random() * 0.08) * size });
    }
    this.splats.push({ pos: at, color, dots, alpha: 0.55 + 0.25 * size * Math.random() });
    if (this.splats.length > MAX_SPLATS) this.splats.shift();
    this.wallLayerKey = '';
  }

  // Visual-only randomness is fine here: the renderer never touches game state.
  private burst(pos: Vec2, color: string, count: number, speed: number): void {
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        pos: { ...pos },
        vel: { x: Math.cos(a) * v, y: Math.sin(a) * v },
        age: 0,
        life: 0.3 + Math.random() * 0.3,
        color,
        size: 0.06 + Math.random() * 0.08,
      });
    }
  }

  private layout(state: GameState): void {
    const { width: aw, height: ah } = state.arena;
    const availW = this.width - (SIDE_MIN + SIDE_GAP * 2) * 2;
    const availH = this.height - HUD_HEIGHT - MARGIN * 2;
    this.scale = Math.max(4, Math.min(availW / aw, availH / ah));
    this.origin = {
      x: (this.width - aw * this.scale) / 2,
      y: HUD_HEIGHT + MARGIN + (availH - ah * this.scale) / 2,
    };
    this.sideW = Math.max(SIDE_MIN * 0.75, Math.min(SIDE_MAX, this.origin.x - SIDE_GAP * 2));
  }

  private toScreen(p: Vec2): Vec2 {
    return { x: this.origin.x + p.x * this.scale, y: this.origin.y + p.y * this.scale };
  }

  drawMatch(state: GameState, paused: boolean): void {
    const ctx = this.ctx;
    this.layout(state);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.save();
    if (this.shake > 0) {
      const mag = this.shake * this.shake * this.scale * 0.5;
      ctx.translate((Math.random() * 2 - 1) * mag, (Math.random() * 2 - 1) * mag);
    }
    this.drawArena(state);
    this.drawTrails();
    for (const pu of state.powerUps) this.drawPowerUp(state, pu);
    for (const b of state.bullets) this.drawBullet(state, b.owner, b.pos, b.radius, b.age, b.lifetime, b.bounces > 0);
    state.players.forEach((p, i) => {
      if (p.out) this.drawKnockedOut(state, i);
    });
    state.players.forEach((p, i) => {
      if (!p.out) this.drawPlayer(state, i);
    });
    if (state.players.length > 2) this.drawTargets(state);
    if (state.arena.dark) this.drawDarkness(state);
    this.drawEffects();
    this.drawCallouts(state);
    ctx.restore();
    if (this.screenFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.screenFlash * 0.8})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    this.drawHud(state);
    if (this.suddenDeathBanner > 0 && state.phase === 'playing') {
      const a = Math.min(1, this.suddenDeathBanner / 0.5);
      ctx.fillStyle = `rgba(10,11,15,${0.6 * a})`;
      ctx.fillRect(0, this.height / 2 - 60, this.width, 124);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = hexAlpha(TIMER_RED, a);
      ctx.font = '900 64px system-ui, sans-serif';
      ctx.fillText('SUDDEN DEATH', this.width / 2, this.height / 2 - 10);
      ctx.fillStyle = `rgba(242,239,232,${a})`;
      ctx.font = '600 20px system-ui, sans-serif';
      ctx.fillText('Bullets speed up every 5 seconds', this.width / 2, this.height / 2 + 36);
    }
    this.drawOverlay(state, paused);
  }

  private drawArena(state: GameState): void {
    const ctx = this.ctx;
    const { width: aw, height: ah } = state.arena;
    const s = this.scale;
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(this.origin.x, this.origin.y, aw * s, ah * s);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < aw; x++) {
      ctx.moveTo(this.origin.x + x * s, this.origin.y);
      ctx.lineTo(this.origin.x + x * s, this.origin.y + ah * s);
    }
    for (let y = 1; y < ah; y++) {
      ctx.moveTo(this.origin.x, this.origin.y + y * s);
      ctx.lineTo(this.origin.x + aw * s, this.origin.y + y * s);
    }
    ctx.stroke();

    if (this.splatsFor !== state.arena) {
      this.splats = [];
      this.splatsFor = state.arena;
      this.wallLayerKey = '';
    }
    ctx.drawImage(this.wallsWithSplats(state), 0, 0, this.width, this.height);
  }

  // The walls, with splats painted only where they overlap a wall, on a
  // cached layer the size of the canvas.
  private wallsWithSplats(state: GameState): HTMLCanvasElement {
    const layer = (this.wallLayer ??= document.createElement('canvas'));
    const key = `${this.canvas.width}x${this.canvas.height}:${this.origin.x},${this.origin.y},${this.scale}`;
    if (key === this.wallLayerKey) return layer;
    this.wallLayerKey = key;
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const ctx = layer.getContext('2d')!;
    const dpr = this.canvas.width / this.width;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = COLORS.wall;
    ctx.lineWidth = state.cfg.map.wallThickness * this.scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const w of state.arena.walls) {
      const a = this.toScreen(w.a);
      const b = this.toScreen(w.b);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    // Paint only lands on wall that's already there.
    ctx.globalCompositeOperation = 'source-atop';
    for (const sp of this.splats) {
      ctx.fillStyle = hexAlpha(sp.color, sp.alpha);
      ctx.beginPath();
      for (const d of sp.dots) {
        const c = this.toScreen({ x: sp.pos.x + d.dx, y: sp.pos.y + d.dy });
        ctx.moveTo(c.x + d.r * this.scale, c.y);
        ctx.arc(c.x, c.y, d.r * this.scale, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    return layer;
  }

  // Lights Out: cover the arena in darkness, with soft holes where there's
  // light: around each player, on bullets and power-ups, and briefly at
  // muzzle flashes and impacts. Drawn on a layer of its own so the holes
  // don't cut into the arena underneath.
  private drawDarkness(state: GameState): void {
    const main = this.ctx;
    const layer = (this.darkLayer ??= document.createElement('canvas'));
    if (layer.width !== this.canvas.width || layer.height !== this.canvas.height) {
      layer.width = this.canvas.width;
      layer.height = this.canvas.height;
    }
    const ctx = layer.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, layer.width, layer.height);
    ctx.setTransform(main.getTransform()); // includes screen shake
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = DARKNESS;
    ctx.fillRect(this.origin.x, this.origin.y, state.arena.width * this.scale, state.arena.height * this.scale);
    ctx.globalCompositeOperation = 'destination-out';
    const light = (pos: Vec2, reach: number, strength: number) => {
      const c = this.toScreen(pos);
      const r = reach * this.scale;
      const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      grad.addColorStop(0, `rgba(0,0,0,${strength})`);
      grad.addColorStop(0.5, `rgba(0,0,0,${strength * 0.75})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
    };
    for (const p of state.players) if (!p.out) light(p.pos, PLAYER_LIGHT, 1);
    for (const b of state.bullets) light(b.pos, 1.1, 0.9);
    for (const pu of state.powerUps) light(pu.pos, pu.telegraph > 0 ? 1.4 : 1.2, 0.8);
    for (const f of this.flashes) light(f.pos, FLASH_LIGHT * (1 - f.age / FLASH_LIFE), 0.9);
    main.save();
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.drawImage(layer, 0, 0);
    main.restore();
  }

  private callout(player: PlayerIndex, text: string, color: string): void {
    this.callouts.push({ player, text, color, age: 0 });
  }

  // Callouts follow their player, rise and fade; several for one player stack.
  private drawCallouts(state: GameState): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '800 17px system-ui, sans-serif';
    ctx.lineJoin = 'round';
    for (let i = 0; i < state.players.length; i++) {
      const mine = this.callouts.filter((c) => c.player === i);
      mine.forEach((c, n) => {
        const t = c.age / CALLOUT_LIFE;
        const pop = Math.min(1, c.age / 0.12); // quick scale-in
        const at = this.toScreen(state.players[i].pos);
        const y = at.y - state.cfg.player.radius * this.scale - 20 - t * 26 - (mine.length - 1 - n) * 22;
        ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        ctx.save();
        ctx.translate(at.x, y);
        ctx.scale(pop, pop);
        ctx.strokeStyle = 'rgba(10,11,15,0.9)';
        ctx.lineWidth = 5;
        ctx.strokeText(c.text, 0, 0);
        ctx.fillStyle = c.color;
        ctx.fillText(c.text, 0, 0);
        ctx.restore();
      });
    }
    ctx.restore();
  }

  private drawEffects(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const c = this.toScreen(p.pos);
      ctx.fillStyle = hexAlpha(p.color, 1 - p.age / p.life);
      ctx.beginPath();
      ctx.arc(c.x, c.y, p.size * this.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const r of this.rings) {
      const c = this.toScreen(r.pos);
      const t = r.age / 0.4;
      ctx.strokeStyle = hexAlpha(r.color, 1 - t);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.y, (0.5 + t * 1.5) * this.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawTrails(): void {
    const ctx = this.ctx;
    for (const t of this.trails) {
      const a = this.toScreen(t.from);
      const b = this.toScreen(t.to);
      const life = 1 - t.age / 0.35;
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, hexAlpha(this.colors[t.player], 0.55 * life));
      ctx.strokeStyle = grad;
      ctx.lineWidth = this.scale * 0.8 * life;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  private drawBullet(
    state: GameState,
    owner: PlayerIndex,
    pos: Vec2,
    radius: number,
    age: number,
    lifetime: number,
    bouncy: boolean,
  ) {
    const ctx = this.ctx;
    const fade = state.cfg.bullet.fadeTime;
    const alpha = Math.max(0, Math.min(1, (lifetime - age) / fade));
    const p = this.toScreen(pos);
    ctx.fillStyle = hexAlpha(this.colors[owner], alpha);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * this.scale, 0, Math.PI * 2);
    ctx.fill();
    // Bouncy bullets get a blue rim.
    ctx.strokeStyle = bouncy ? hexAlpha(CATEGORY_COLORS.buff, alpha) : `rgba(255,255,255,${0.7 * alpha})`;
    ctx.lineWidth = bouncy ? 2.5 : 1.5;
    ctx.stroke();
  }

  private drawPlayer(state: GameState, i: PlayerIndex): void {
    const ctx = this.ctx;
    const p = state.players[i];
    const cfg = state.cfg;
    const c = this.toScreen(p.pos);
    // Drawn at hit size, so Big Target visibly grows.
    const r = hitRadiusFor(p, cfg) * this.scale;
    const color = this.colors[i];
    // A Ghost is see-through.
    ctx.save();
    if (p.effects.ghost > 0) ctx.globalAlpha = 0.4 + 0.15 * Math.sin(state.tick * 0.3);

    // Chevron showing where a dodge would go, dim while it recharges, with a
    // dot per charge when there's more than one.
    const ready = p.dodgeCharges > 0;
    const maxCharges = maxDodgeCharges(p.effects);
    if (maxCharges > 1) {
      for (let n = 0; n < maxCharges; n++) {
        ctx.fillStyle = hexAlpha(color, n < p.dodgeCharges ? 0.9 : 0.2);
        ctx.beginPath();
        ctx.arc(c.x - (maxCharges - 1) * 5 + n * 10, c.y + r + 9, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const dodgeDir = dodgeDirection(p);
    const perp = { x: -dodgeDir.y, y: dodgeDir.x };
    const tip = this.toScreen(add(p.pos, scale(dodgeDir, cfg.player.radius + 0.42)));
    const wingA = this.toScreen(add(add(p.pos, scale(dodgeDir, cfg.player.radius + 0.2)), scale(perp, 0.22)));
    const wingB = this.toScreen(add(add(p.pos, scale(dodgeDir, cfg.player.radius + 0.2)), scale(perp, -0.22)));
    ctx.strokeStyle = hexAlpha(color, ready ? 0.9 : 0.2);
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(wingA.x, wingA.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(wingB.x, wingB.y);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();

    if (p.effects.molasses > 0) {
      // Slowed: a dark goo coating and a dashed red ring.
      ctx.fillStyle = 'rgba(40,10,10,0.45)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = CATEGORY_COLORS.curse;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.effects.shield > 0) {
      const flicker = p.effects.shield < 2 && Math.floor(state.tick / 6) % 2 === 0;
      if (!flicker) {
        ctx.strokeStyle = CATEGORY_COLORS.buff;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (p.effects.topsyTurvy > 0) {
      // Flipped controls: the player wobbles.
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(Math.sin(state.tick * 0.35) * 0.5);
      drawLook(ctx, this.looks[i] || '😵', 0, 0, r);
      ctx.restore();
    } else {
      drawLook(ctx, this.looks[i], c.x, c.y, r);
    }

    // Facing nub.
    const nub = this.toScreen(add(p.pos, scale(p.facing, cfg.player.radius * 0.95)));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(nub.x, nub.y, r * 0.22, 0, Math.PI * 2);
    ctx.fill();

    if (this.nearMissGlow[i] > 0) {
      // A bright rim that flares out and fades after a near miss.
      const t = 1 - this.nearMissGlow[i] / NEAR_MISS_GLOW;
      ctx.strokeStyle = hexAlpha(NEAR_MISS_COLOR, 1 - t);
      ctx.lineWidth = 4 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 3 + t * 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (this.hitFlash[i] > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.hitFlash[i] / 0.18})`;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Fire cooldown ring.
    if (p.fireCooldown > 0) {
      const frac = 1 - p.fireCooldown / fireCooldownFor(p.effects, state);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 4, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
    }

    // "Blocked" marker when the direct line to the target hits a wall.
    if (!p.lineOfSight && state.phase === 'playing') {
      const m = { x: c.x, y: c.y - r - 12 };
      ctx.strokeStyle = COLORS.muted;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 6, 0, Math.PI * 2);
      ctx.moveTo(m.x - 4.2, m.y + 4.2);
      ctx.lineTo(m.x + 4.2, m.y - 4.2);
      ctx.stroke();
    }
  }

  // Where a knocked-out player went down: a faded circle with a cross.
  private drawKnockedOut(state: GameState, i: PlayerIndex): void {
    const ctx = this.ctx;
    const c = this.toScreen(state.players[i].pos);
    const r = state.cfg.player.radius * this.scale;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = this.colors[i];
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = COLORS.background;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const d = r * 0.45;
    ctx.beginPath();
    ctx.moveTo(c.x - d, c.y - d);
    ctx.lineTo(c.x + d, c.y + d);
    ctx.moveTo(c.x + d, c.y - d);
    ctx.lineTo(c.x - d, c.y + d);
    ctx.stroke();
    ctx.restore();
  }

  // With more than two players, who's aiming at whom: a dot in the shooter's
  // colour on the edge of their target, on the side the shooter is.
  private drawTargets(state: GameState): void {
    const ctx = this.ctx;
    state.players.forEach((p, i) => {
      if (p.out || p.target === null || state.phase !== 'playing') return;
      const t = state.players[p.target];
      const away = scale(p.facing, -(hitRadiusFor(t, state.cfg) + 0.32));
      const c = this.toScreen(add(t.pos, away));
      ctx.fillStyle = this.colors[i];
      ctx.strokeStyle = 'rgba(10,11,15,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(3, this.scale * 0.13), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  private drawPowerUp(state: GameState, pu: PowerUp): void {
    const ctx = this.ctx;
    const c = this.toScreen(pu.pos);
    const r = state.cfg.powerUps.radius * this.scale;
    const color = powerUpColor(pu.kind);
    if (pu.telegraph > 0) {
      // Shimmering ring that tightens onto the spot before the item appears.
      const progress = 1 - pu.telegraph / state.cfg.powerUps.telegraph;
      const spin = state.tick * 0.12;
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -spin * 10;
      ctx.strokeStyle = hexAlpha(color, 0.35 + 0.4 * Math.abs(Math.sin(state.tick * 0.3)));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * (2.4 - 1.2 * progress), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    // Soft glow, body, glyph.
    ctx.fillStyle = hexAlpha(color, 0.18);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    drawPowerUpGlyph(ctx, pu.kind, c.x, c.y, r * 1.2);
    // Lifespan ring shrinks as the item expires.
    const left = Math.max(0, pu.remaining / pu.lifespan);
    ctx.strokeStyle = hexAlpha(color, 0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 1.45, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
    ctx.stroke();
  }

  private drawHud(state: GameState): void {
    const ctx = this.ctx;
    const cfg = state.cfg;
    ctx.textBaseline = 'middle';
    // Odd players (P1, P3) down the left, even ones down the right; with more
    // than two, each column holds two panels, one above the other.
    const rows = state.players.length > 2 ? 2 : 1;
    const panelH = (this.height - this.origin.y) / rows;
    state.players.forEach((_, i) => {
      const top = this.origin.y + Math.floor(i / 2) * panelH;
      this.drawSidePanel(state, i, top, top + panelH - (rows > 1 ? 16 : 0));
    });

    // Round timer: a number, plus a bar across the top of the arena that
    // shrinks and turns amber, then red, as time runs out.
    const left = cfg.round.timeLimit - state.roundTime;
    const sudden = left <= 0;
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(state.tick * 0.12));
    const timerColor = sudden || left <= 10 ? TIMER_RED : left <= 30 ? TIMER_AMBER : COLORS.text;
    const barY = this.origin.y - 14;
    const barW = state.arena.width * this.scale;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(this.origin.x, barY, barW, 6);
    ctx.globalAlpha = sudden || left <= 10 ? pulse : 1;
    ctx.fillStyle = timerColor;
    const frac = sudden ? 1 : Math.max(0, left / cfg.round.timeLimit);
    ctx.fillRect(this.origin.x + (barW * (1 - frac)) / 2, barY, barW * frac, 6);
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.fillStyle = timerColor;
    ctx.font = '800 30px system-ui, sans-serif';
    const label = sudden ? `SUDDEN DEATH ×${suddenDeathMultiplier(state).toFixed(2)}` : `${Math.ceil(left)}`;
    ctx.fillText(label, this.width / 2, 24);
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillStyle = COLORS.muted;
    if (state.modifier && state.phase !== 'countdown') {
      ctx.fillStyle = MODIFIER_COLOR;
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillText(`Round ${state.roundIndex + 1} · ${MODIFIERS[state.modifier].name}`, this.width / 2, 50);
    } else {
      ctx.fillText(`Round ${state.roundIndex + 1}`, this.width / 2, 50);
    }
  }

  // One player's status in the column beside the arena, between `top` and
  // `bottom`, sized to read at a glance: name, health, round wins, then
  // active power-ups. The right-hand column mirrors the left. A player who's
  // been knocked out is greyed out until the next round.
  private drawSidePanel(state: GameState, i: PlayerIndex, top: number, bottom: number): void {
    const ctx = this.ctx;
    const cfg = state.cfg;
    const p = state.players[i];
    const left = i % 2 === 0;
    const dir = left ? 1 : -1;
    const w = this.sideW;
    const cx = left ? this.origin.x / 2 : this.width - this.origin.x / 2;
    const outer = cx - (dir * w) / 2;
    // The header (look to round wins) is about 230u tall; leave room below it.
    const u = Math.max(0.5, Math.min(1.8, w / 140, (bottom - top) / 290));
    let y = top;
    ctx.save();
    if (p.out) ctx.globalAlpha = 0.35;

    // Look and name, shrunk to fit long hotseat names.
    const r = 22 * u;
    ctx.fillStyle = this.colors[i];
    ctx.beginPath();
    ctx.arc(cx, y + r, r, 0, Math.PI * 2);
    ctx.fill();
    if (this.looks[i]) drawLook(ctx, this.looks[i], cx, y + r, r);
    y += r * 2 + 22 * u;
    const name = this.names[i];
    let size = 30 * u;
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    const nameW = ctx.measureText(name).width;
    if (nameW > w) size *= w / nameW;
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(name, cx, y);
    y += 30 * u;

    // Health: big pips, lost ones hollow.
    const hits = cfg.round.hitsToLose;
    const pipGap = 8 * u;
    const pipD = Math.min(36 * u, (w - pipGap * (hits - 1)) / hits);
    const rowW = hits * pipD + (hits - 1) * pipGap;
    for (let h = 0; h < hits; h++) {
      const alive = h < hits - p.hits;
      const px = cx - rowW / 2 + pipD / 2 + h * (pipD + pipGap);
      ctx.beginPath();
      ctx.arc(px, y + pipD / 2, pipD / 2 - 1.5, 0, Math.PI * 2);
      if (alive) {
        ctx.fillStyle = this.colors[i];
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
    y += pipD + 22 * u;

    // Round wins.
    const wins = cfg.round.roundsToWin;
    const winR = 8 * u;
    const winGap = 10 * u;
    const winsW = wins * winR * 2 + (wins - 1) * winGap;
    ctx.strokeStyle = COLORS.text;
    ctx.fillStyle = COLORS.text;
    ctx.lineWidth = 2;
    for (let n = 0; n < wins; n++) {
      ctx.beginPath();
      ctx.arc(cx - winsW / 2 + winR + n * (winR * 2 + winGap), y, winR, 0, Math.PI * 2);
      if (n < p.roundWins) ctx.fill();
      else ctx.stroke();
    }
    y += winR + 12 * u;
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 ${12 * u}px system-ui, sans-serif`;
    ctx.fillText('rounds', cx, y);
    y += 30 * u;

    // Active power-ups, one per row: icon at the outer edge, then stacks or
    // seconds left with the name beneath. Timed ones drain a ring.
    const iconR = 17 * u;
    const rowH = iconR * 2 + 12 * u;
    const iconX = outer + dir * iconR;
    const textX = iconX + dir * (iconR + 10 * u);
    for (const kind of POWER_UP_KINDS) {
      const amount = p.effects[kind];
      if (amount <= 0) continue;
      if (y + rowH > bottom) break;
      const iy = y + iconR;
      const color = CATEGORY_COLORS[POWER_UP_CATEGORY[kind]];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(iconX, iy, iconR, 0, Math.PI * 2);
      ctx.fill();
      drawPowerUpGlyph(ctx, kind, iconX, iy, iconR * 1.2);
      const duration = (cfg.powerUps[kind] as { duration?: number }).duration;
      if (!STACKING.has(kind) && duration) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3 * u;
        ctx.beginPath();
        ctx.arc(iconX, iy, iconR + 4 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, amount / duration));
        ctx.stroke();
      }
      ctx.textAlign = left ? 'left' : 'right';
      ctx.fillStyle = COLORS.text;
      ctx.font = `800 ${20 * u}px system-ui, sans-serif`;
      ctx.fillText(STACKING.has(kind) ? `×${amount}` : Number.isFinite(amount) ? `${Math.ceil(amount)}s` : '∞', textX, iy - 7 * u);
      ctx.fillStyle = COLORS.muted;
      ctx.font = `500 ${12 * u}px system-ui, sans-serif`;
      ctx.fillText(HUD_NAMES[kind], textX, iy + 11 * u);
      y += rowH;
    }
    ctx.restore();
  }

  private label(i: PlayerIndex): string {
    return `${this.looks[i]} ${this.names[i]}`.trim();
  }

  private drawOverlay(state: GameState, paused: boolean): void {
    let title = '';
    let sub = '';
    if (paused) {
      title = 'Paused';
      sub = 'Esc to resume · Q to quit to title';
    } else if (state.phase === 'countdown' && state.modifier) {
      this.drawModifierReel(state);
      return;
    } else if (state.phase === 'countdown') {
      title = `Round ${state.roundIndex + 1}`;
      sub = state.arenas.length > 1 ? `${state.arena.name}  ·  Get ready` : 'Get ready';
    } else if (state.phase === 'roundOver') {
      const w = state.lastRoundWinner;
      title = w === null ? 'Draw' : `${this.label(w)} takes the round`;
      sub = w === null ? 'Replaying the round' : '';
    } else if (state.phase === 'matchOver' && state.matchWinner !== null) {
      title = `${this.label(state.matchWinner)} wins!`;
      sub = this.matchOverHint;
    } else return;

    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(10,11,15,0.55)';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const winner = state.phase === 'matchOver' ? state.matchWinner : state.phase === 'roundOver' ? state.lastRoundWinner : null;
    ctx.fillStyle = winner !== null && !paused ? this.colors[winner] : COLORS.text;
    ctx.font = '800 52px system-ui, sans-serif';
    ctx.fillText(title, this.width / 2, this.height / 2 - 16);
    ctx.fillStyle = COLORS.text;
    ctx.font = '500 18px system-ui, sans-serif';
    ctx.fillText(sub, this.width / 2, this.height / 2 + 32);
    if (state.phase === 'matchOver' && !paused) {
      const tally = state.players.map((p, i) => `${this.names[i]} ${p.nearMisses}`).join(' · ');
      ctx.fillStyle = NEAR_MISS_COLOR;
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.fillText(`Clutch dodges: ${tally}`, this.width / 2, this.height / 2 + 68);
    }
  }

  // Countdown with a modifier: a slot-machine reel of modifier names that
  // slows down and lands on this round's, then says what it does.
  private drawModifierReel(state: GameState): void {
    const ctx = this.ctx;
    const id = state.modifier!;
    const { step, landed } = modifierReel(state.phaseTime);
    // Count back from the landing so the last name shown is the real one.
    const order = MODIFIER_IDS;
    const at = order.indexOf(id) - (REEL_STEPS.length - step);
    const shown = order[((at % order.length) + order.length) % order.length];
    const cx = this.width / 2;
    const cy = this.height / 2;
    ctx.fillStyle = 'rgba(10,11,15,0.6)';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.text;
    ctx.font = '800 28px system-ui, sans-serif';
    ctx.fillText(`Round ${state.roundIndex + 1}`, cx, cy - 110);
    if (state.arenas.length > 1) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.fillText(state.arena.name, cx, cy - 80);
    }

    // The reel window.
    const w = Math.min(560, this.width - 40);
    const h = 96;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = landed ? MODIFIER_COLOR : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = landed ? 4 : 2;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2 - 10, w, h, 14);
    ctx.fill();
    ctx.stroke();
    ctx.clip();
    // Between steps each name drifts up through the window and fades; once
    // landed it pops.
    const prev = step === 0 ? 0 : REEL_STEPS[step - 1];
    const next = REEL_STEPS[step] ?? prev;
    const slide = landed ? 0.5 : (state.phaseTime - prev) / Math.max(0.001, next - prev);
    const sinceLand = state.phaseTime - REEL_STEPS[REEL_STEPS.length - 1];
    const pop = landed ? 1 + 0.25 * Math.max(0, 1 - sinceLand / 0.2) : 1;
    ctx.translate(cx, cy - 10 + (0.5 - slide) * h * 0.4);
    ctx.scale(pop, pop);
    ctx.globalAlpha = landed ? 1 : 1 - Math.abs(slide - 0.5);
    ctx.fillStyle = landed ? MODIFIER_COLOR : COLORS.text;
    ctx.font = '900 48px system-ui, sans-serif';
    ctx.fillText(MODIFIERS[shown].name, 0, 0);
    ctx.restore();

    if (landed) {
      const a = Math.min(1, sinceLand / 0.25);
      ctx.fillStyle = hexAlpha(COLORS.text, a);
      ctx.font = '600 22px system-ui, sans-serif';
      ctx.fillText(MODIFIERS[id].blurb, cx, cy + 70);
      ctx.fillStyle = hexAlpha(COLORS.muted, a);
      ctx.font = '500 16px system-ui, sans-serif';
      ctx.fillText('Get ready', cx, cy + 104);
    }
  }

  // Plain background behind HTML screens such as the hotseat lobby.
  drawBackdrop(): void {
    this.ctx.fillStyle = COLORS.background;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  // Title screen with a live key test, so ghosting shows up before a match.
  drawTitle(
    isHeld: (code: string) => boolean,
    slots: readonly string[],
    mapName: string,
    mapCount: number,
    modifiers: boolean,
    rotation: boolean,
  ): void {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.width, this.height);
    // Sections flow down the page so they never overlap, spreading out on
    // tall windows. A window too small for them shrinks the whole screen.
    const s = Math.min(1, this.height / TITLE_MIN_H, this.width / TITLE_MIN_W);
    const w = this.width / s;
    const h = this.height / s;
    ctx.save();
    ctx.scale(s, s);
    const cx = w / 2;
    const footer = h - 30;
    const head = Math.max(50, Math.min(h * 0.2, footer - 520));
    const top = Math.max(head + 190, Math.min(h * 0.42, footer - 330));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.text;
    ctx.font = '800 56px system-ui, sans-serif';
    ctx.fillText('Floor Plan Duel', cx, head);
    ctx.font = '500 20px system-ui, sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.fillText('Press Enter to start  ·  B for full screen  ·  M to mute  ·  N for music', cx, head + 52);
    ctx.fillStyle = COLORS.text;
    ctx.font = '600 17px system-ui, sans-serif';
    ctx.fillText(rotation ? `Maps: ${mapName}, then a new one each round` : `Map: ${mapName}`, cx, head + 92);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '400 13px system-ui, sans-serif';
    ctx.fillText(
      `${mapCount > 1 ? 'Tab to change map  ·  ' : ''}E to open the map editor  ·  H for hotseat  ·  P to use phones as controllers`,
      cx,
      head + 114,
    );
    ctx.fillStyle = modifiers ? MODIFIER_COLOR : COLORS.muted;
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(`Round modifiers: ${modifiers ? 'ON' : 'OFF'}  (R to change)`, cx, head + 138);
    ctx.fillStyle = rotation ? COLORS.text : COLORS.muted;
    ctx.fillText(`Map rotation: ${rotation ? 'ON' : 'OFF'}  (T to change)`, cx, head + 158);

    const colW = Math.min(360, w / 2 - 20);
    this.drawKeyPanel(KEY_BINDINGS.p1, 0, cx - colW / 2 - 10, top, isHeld, slots[0]);
    this.drawKeyPanel(KEY_BINDINGS.p2, 1, cx + colW / 2 + 10, top, isHeld, slots[1]);
    // P3 and P4 have no keys: a bot, a phone, or nobody.
    this.drawExtraSlot(2, cx - colW / 2 - 10, top + 278, slots[2]);
    this.drawExtraSlot(3, cx + colW / 2 + 10, top + 278, slots[3]);

    ctx.font = '400 14px system-ui, sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    ctx.fillText(
      'Key test: hold every key you would use together. If a key fails to light up, your keyboard is ghosting.',
      cx,
      footer,
    );
    ctx.restore();
  }

  // A one-line row for P3 or P4: look, who plays it, and how to change that.
  private drawExtraSlot(i: PlayerIndex, cx: number, y: number, slot: string): void {
    const ctx = this.ctx;
    const on = slot !== 'off';
    ctx.save();
    if (!on) ctx.globalAlpha = 0.55;
    ctx.fillStyle = COLORS.players[i];
    ctx.beginPath();
    ctx.arc(cx - 120, y, 16, 0, Math.PI * 2);
    ctx.fill();
    if (on) drawLook(ctx, this.looks[i], cx - 120, y, 16);
    ctx.textAlign = 'left';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.fillText(`P${i + 1}`, cx - 96, y);
    ctx.fillStyle = COLORS.text;
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText(slotLabel(slot), cx - 58, y - 8);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '400 13px system-ui, sans-serif';
    const hint = slot.startsWith('📱') ? 'playing on a phone' : on ? `press ${i + 1} to change` : `press ${i + 1} to add a bot, or join by phone (P)`;
    ctx.fillText(hint, cx - 58, y + 11);
    ctx.restore();
  }

  private drawKeyPanel(
    keys: PlayerKeys,
    i: PlayerIndex,
    cx: number,
    top: number,
    isHeld: (code: string) => boolean,
    slot: string,
  ) {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.players[i];
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`P${i + 1}`, cx + 16, top);
    // Look preview, cycled with this player's dodge keys.
    ctx.beginPath();
    ctx.arc(cx - 24, top, 20, 0, Math.PI * 2);
    ctx.fill();
    drawLook(ctx, this.looks[i], cx - 24, top, 20);
    // A slot is 'human', a bot difficulty, or a phone's label ("📱 Name").
    const phone = slot.startsWith('📱');
    const who = slotLabel(slot);
    ctx.fillStyle = COLORS.text;
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText(who, cx, top + 190);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '400 13px system-ui, sans-serif';
    if (phone) {
      ctx.fillText('playing on a phone', cx, top + 212);
      ctx.fillText('the phone picks the look', cx, top + 232);
    } else {
      ctx.fillText(`press ${i + 1} to change`, cx, top + 212);
      ctx.fillText('dodge key changes your look', cx, top + 232);
    }
    if (slot !== 'human') ctx.globalAlpha = 0.3;
    const k = 42;
    const gap = 6;
    const cap = (code: string, x: number, y: number, caption?: string) => {
      const held = isHeld(code);
      ctx.fillStyle = held ? COLORS.players[i] : 'rgba(255,255,255,0.08)';
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x - k / 2, y - k / 2, k, k, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = held ? '#111' : COLORS.text;
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.fillText(keyLabel(code), x, y + 1);
      if (caption) {
        ctx.fillStyle = COLORS.muted;
        ctx.font = '400 12px system-ui, sans-serif';
        ctx.fillText(caption, x, y + k / 2 + 12);
      }
    };
    const moveX = cx - 80;
    const y0 = top + 50;
    cap(keys.up, moveX, y0);
    cap(keys.left, moveX - k - gap, y0 + k + gap);
    cap(keys.down, moveX, y0 + k + gap);
    cap(keys.right, moveX + k + gap, y0 + k + gap);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '400 12px system-ui, sans-serif';
    ctx.fillText('move', moveX, y0 + 2 * k + gap + 12);
    const ax = cx + 40;
    const step = k + 18;
    // In keyboard order: shoot is under the index finger, so it's on the
    // left for P1 (F G) and on the right for P2 (. /).
    const shootFirst = i === 0;
    cap(keys.shoot, ax + step * (shootFirst ? 0.5 : 1.5), y0 + k + gap, 'shoot');
    cap(keys.dodge, ax + step * (shootFirst ? 1.5 : 0.5), y0 + k + gap, 'dodge');
    ctx.globalAlpha = 1;
  }
}

// A slot is 'human', 'off', a bot difficulty, or a phone's label ("📱 Name").
function slotLabel(slot: string): string {
  if (slot.startsWith('📱')) return slot;
  if (slot === 'human') return 'Human';
  if (slot === 'off') return 'No player';
  return `Bot · ${slot[0].toUpperCase()}${slot.slice(1)}`;
}

function keyLabel(code: string): string {
  const named: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Comma: ',',
    Period: '.',
    Slash: '/',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  return code;
}

function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
