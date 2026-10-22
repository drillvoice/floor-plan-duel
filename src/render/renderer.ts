// Draws game state onto a canvas: the arena, players, bullets, power-ups and
// effects, with the HUD (hud.ts) and overlays (overlay.ts) on top, and the
// title screen (title.ts). Reads state and events; never changes them.

import { POWER_UP_KINDS } from '../config';
import { fireCooldownFor, hitRadiusFor, maxDodgeCharges, ON_OPPONENT, STACKING } from '../sim/powerups';
import { dodgeDirection } from '../sim/step';
import type { Arena, GameEvent, GameState, Laser, PlayerIndex, PowerUp, PowerUpKind } from '../sim/types';
import { add, closestPointOnSegment, dist, distPointSegment, scale, type Vec2 } from '../sim/vec';
import { drawHud } from './hud';
import { CATEGORY_COLORS, drawPowerUpGlyph, powerUpColor } from './icons';
import { arenaLayout, toScreen, type MatchView } from './layout';
import { drawLook } from './looks';
import { drawOverlay, drawSuddenDeathBanner } from './overlay';
import { COLORS, hexAlpha, NEAR_MISS_COLOR } from './theme';
import { drawTitle } from './title';

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
// Seconds before a timed effect ends that its ring starts blinking.
const EFFECT_BLINK = 0.75;
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
  laser: { self: 'Laser!' },
  molasses: { self: 'Slowed them down!', victim: 'Slowed!' },
  topsyTurvy: { self: 'Flipped their controls!', victim: 'Controls flipped!' },
  bigTarget: { self: 'Made them huge!', victim: 'Big target!' },
};

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
  // Where the arena is on screen, worked out at the start of each match frame.
  private view: MatchView = { scale: 1, origin: { x: 0, y: 0 }, sideW: 0, width: 0, height: 0, compact: false, looks: ['', ''], names: ['', ''] };
  private hitFlash = [0, 0];
  private nearMissGlow = [0, 0];
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
  // Each player's chosen look (see looks.ts); set by the app.
  looks: [string, string] = ['', ''];
  // Names shown in the HUD and results (player names in hotseat).
  names: [string, string] = ['P1', 'P2'];
  matchOverHint = 'Enter for a rematch · Esc for title';
  pausedHint = 'Esc to resume · Q to quit to title';
  // Phone-only play: slim HUD, arena as big as the screen allows.
  compact = false;

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
          if (final) this.screenFlash = 0.35;
          this.burst(e.pos, COLORS.players[e.player], final ? 28 : 14, final ? 7 : 5);
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
        case 'laserFire':
          this.shake = Math.max(this.shake, 0.25);
          this.flashes.push({ pos: e.from, age: 0 });
          // A beam that stopped short of its range ended on a wall.
          if (!e.hit && dist(e.from, e.to) < state.cfg.powerUps.laser.range - 0.01) {
            this.burst(e.to, COLORS.players[e.player], 8, 3);
            this.flashes.push({ pos: e.to, age: 0 });
            this.splat(state, e.to, COLORS.players[e.player], 0.8);
          }
          break;
        case 'wallHit':
          this.burst(e.pos, COLORS.wall, 4, 2);
          this.flashes.push({ pos: e.pos, age: FLASH_LIFE / 2 });
          this.splat(state, e.pos, COLORS.players[e.owner], 1);
          break;
        case 'bounce':
          this.burst(e.pos, CATEGORY_COLORS.buff, 6, 3);
          this.splat(state, e.pos, COLORS.players[e.owner], 0.6);
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
            if (ON_OPPONENT.has(e.kind) && text.victim) this.callout(e.player === 0 ? 1 : 0, text.victim, color);
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
    const { width, height, compact, looks, names } = this;
    this.view = { ...arenaLayout(width, height, state.arena, compact), width, height, compact, looks, names };
  }

  private toScreen(p: Vec2): Vec2 {
    return toScreen(this.view, p);
  }

  drawMatch(state: GameState, paused: boolean): void {
    const ctx = this.ctx;
    this.layout(state);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.save();
    if (this.shake > 0) {
      const mag = this.shake * this.shake * this.view.scale * 0.5;
      ctx.translate((Math.random() * 2 - 1) * mag, (Math.random() * 2 - 1) * mag);
    }
    this.drawArena(state);
    this.drawTrails();
    for (const pu of state.powerUps) this.drawPowerUp(state, pu);
    for (const b of state.bullets) this.drawBullet(state, b.owner, b.pos, b.radius, b.age, b.lifetime, b.bounces > 0);
    for (const i of [0, 1] as const) this.drawPlayer(state, i);
    if (state.arena.dark) this.drawDarkness(state);
    // Lasers glow, so they show through Lights Out's darkness.
    for (const l of state.lasers) this.drawLaser(state, l);
    this.drawEffects();
    this.drawCallouts(state);
    ctx.restore();
    if (this.screenFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.screenFlash * 0.8})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    drawHud(ctx, this.view, state);
    drawSuddenDeathBanner(ctx, this.view, state, this.suddenDeathBanner);
    drawOverlay(ctx, this.view, state, paused, { paused: this.pausedHint, matchOver: this.matchOverHint });
  }

  private drawArena(state: GameState): void {
    const ctx = this.ctx;
    const { width: aw, height: ah } = state.arena;
    const s = this.view.scale;
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(this.view.origin.x, this.view.origin.y, aw * s, ah * s);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < aw; x++) {
      ctx.moveTo(this.view.origin.x + x * s, this.view.origin.y);
      ctx.lineTo(this.view.origin.x + x * s, this.view.origin.y + ah * s);
    }
    for (let y = 1; y < ah; y++) {
      ctx.moveTo(this.view.origin.x, this.view.origin.y + y * s);
      ctx.lineTo(this.view.origin.x + aw * s, this.view.origin.y + y * s);
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
    const key = `${this.canvas.width}x${this.canvas.height}:${this.view.origin.x},${this.view.origin.y},${this.view.scale}`;
    if (key === this.wallLayerKey) return layer;
    this.wallLayerKey = key;
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const ctx = layer.getContext('2d')!;
    const dpr = this.canvas.width / this.width;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = COLORS.wall;
    ctx.lineWidth = state.cfg.map.wallThickness * this.view.scale;
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
        ctx.moveTo(c.x + d.r * this.view.scale, c.y);
        ctx.arc(c.x, c.y, d.r * this.view.scale, 0, Math.PI * 2);
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
    ctx.fillRect(this.view.origin.x, this.view.origin.y, state.arena.width * this.view.scale, state.arena.height * this.view.scale);
    ctx.globalCompositeOperation = 'destination-out';
    const light = (pos: Vec2, reach: number, strength: number) => {
      const c = this.toScreen(pos);
      const r = reach * this.view.scale;
      const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      grad.addColorStop(0, `rgba(0,0,0,${strength})`);
      grad.addColorStop(0.5, `rgba(0,0,0,${strength * 0.75})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
    };
    for (const p of state.players) light(p.pos, PLAYER_LIGHT, 1);
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
    for (const i of [0, 1] as const) {
      const mine = this.callouts.filter((c) => c.player === i);
      mine.forEach((c, n) => {
        const t = c.age / CALLOUT_LIFE;
        const pop = Math.min(1, c.age / 0.12); // quick scale-in
        const at = this.toScreen(state.players[i].pos);
        const y = at.y - state.cfg.player.radius * this.view.scale - 20 - t * 26 - (mine.length - 1 - n) * 22;
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
      ctx.arc(c.x, c.y, p.size * this.view.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const r of this.rings) {
      const c = this.toScreen(r.pos);
      const t = r.age / 0.4;
      ctx.strokeStyle = hexAlpha(r.color, 1 - t);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.y, (0.5 + t * 1.5) * this.view.scale, 0, Math.PI * 2);
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
      grad.addColorStop(1, hexAlpha(COLORS.players[t.player], 0.55 * life));
      ctx.strokeStyle = grad;
      ctx.lineWidth = this.view.scale * 0.8 * life;
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
    ctx.fillStyle = hexAlpha(COLORS.players[owner], alpha);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * this.view.scale, 0, Math.PI * 2);
    ctx.fill();
    // Bouncy bullets get a blue rim.
    ctx.strokeStyle = bouncy ? hexAlpha(CATEGORY_COLORS.buff, alpha) : `rgba(255,255,255,${0.7 * alpha})`;
    ctx.lineWidth = bouncy ? 2.5 : 1.5;
    ctx.stroke();
  }

  // While charging, a thin flickering line that firms up as the zap nears;
  // once fired, a bright beam that fades out.
  private drawLaser(state: GameState, l: Laser): void {
    const ctx = this.ctx;
    const a = this.toScreen(l.from);
    const b = this.toScreen(l.to);
    const color = COLORS.players[l.owner];
    ctx.save();
    ctx.lineCap = 'round';
    if (!l.fired) {
      const t = Math.min(1, l.age / l.chargeTime);
      const flicker = 0.75 + 0.25 * Math.sin(state.tick * 1.3);
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -state.tick * 2;
      ctx.strokeStyle = hexAlpha(color, (0.3 + 0.6 * t) * flicker);
      ctx.lineWidth = 1.5 + 1.5 * t;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else {
      const life = Math.max(0, 1 - (l.age - l.chargeTime) / state.cfg.powerUps.laser.flashTime);
      const w = state.cfg.powerUps.laser.width * this.view.scale;
      ctx.strokeStyle = hexAlpha(color, 0.6 * life);
      ctx.lineWidth = w * 3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${life})`;
      ctx.lineWidth = w;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPlayer(state: GameState, i: PlayerIndex): void {
    const ctx = this.ctx;
    const p = state.players[i];
    const cfg = state.cfg;
    const c = this.toScreen(p.pos);
    // Drawn at hit size, so Big Target visibly grows.
    const r = hitRadiusFor(p, cfg) * this.view.scale;
    const color = COLORS.players[i];
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

    // A ring per timed effect, coloured by category, that drains clockwise as
    // it wears off and blinks in its last moments, so players can see when it
    // will end. Round-long ones from a modifier never run out, so get none.
    let ring = 0;
    for (const kind of POWER_UP_KINDS) {
      const left = p.effects[kind];
      if (STACKING.has(kind) || left <= 0 || !Number.isFinite(left)) continue;
      const frac = Math.min(1, left / (cfg.powerUps[kind] as { duration: number }).duration);
      const radius = r + 12 + ring * 5;
      ring++;
      if (left < EFFECT_BLINK && Math.floor(state.tick / 4) % 2 === 0) continue;
      ctx.strokeStyle = powerUpColor(kind);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(c.x, c.y, radius, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
      ctx.lineCap = 'butt';
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
      // Clamped: a long laser cooldown can outlast the laser itself.
      const frac = Math.max(0, 1 - p.fireCooldown / fireCooldownFor(p.effects, state));
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 4, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
    }

    // "Blocked" marker when the direct line to the opponent hits a wall.
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

  private drawPowerUp(state: GameState, pu: PowerUp): void {
    const ctx = this.ctx;
    const c = this.toScreen(pu.pos);
    const r = state.cfg.powerUps.radius * this.view.scale;
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

  // Plain background behind HTML screens such as the hotseat lobby.
  drawBackdrop(): void {
    this.ctx.fillStyle = COLORS.background;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  drawTitle(
    isHeld: (code: string) => boolean,
    slots: readonly string[],
    mapName: string,
    mapCount: number,
    modifiers: boolean,
    rotation: boolean,
  ): void {
    drawTitle(this.ctx, this.width, this.height, this.looks, isHeld, slots, mapName, mapCount, modifiers, rotation);
  }
}
