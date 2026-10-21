// Draws game state onto a canvas. Reads state and events; never changes them.

import { KEY_BINDINGS, type PlayerKeys } from '../config';
import { fireCooldownFor, hitRadiusFor, maxDodgeCharges, ON_OPPONENT, STACKING } from '../sim/powerups';
import { dodgeDirection, suddenDeathMultiplier } from '../sim/step';
import { POWER_UP_KINDS } from '../config';
import { POWER_UP_CATEGORY, type GameEvent, type GameState, type PlayerIndex, type PowerUp, type PowerUpKind } from '../sim/types';
import { CATEGORY_COLORS, drawPowerUpGlyph, powerUpColor } from './icons';
import { drawLook } from './looks';
import { add, scale, type Vec2 } from '../sim/vec';

export const COLORS = {
  background: '#16181f',
  floor: '#262a35',
  grid: 'rgba(255,255,255,0.035)',
  wall: '#e9e4d8',
  text: '#f2efe8',
  muted: '#8b90a0',
  players: ['#7ed957', '#c084fc'] as const,
};

const PLAYER_NAMES = ['P1', 'P2'] as const;
const TIMER_AMBER = '#ffb020';
const TIMER_RED = '#ff4d4d';
const HUD_HEIGHT = 64;
const MARGIN = 24;

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
  private hitFlash = [0, 0];
  private trails: Trail[] = [];
  private pendingDash: { player: PlayerIndex; from: Vec2 }[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private callouts: Callout[] = [];
  private shake = 0;
  private screenFlash = 0;
  private suddenDeathBanner = 0;
  // Each player's chosen look (see looks.ts); set by the app.
  looks: [string, string] = ['', ''];

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
        case 'shieldBlock':
          this.callout(e.player, 'Blocked!', CATEGORY_COLORS.buff);
          this.shake = Math.max(this.shake, 0.3);
          this.burst(e.pos, CATEGORY_COLORS.buff, 12, 4);
          break;
        case 'wallHit':
          this.burst(e.pos, COLORS.wall, 4, 2);
          break;
        case 'bounce':
          this.burst(e.pos, CATEGORY_COLORS.buff, 6, 3);
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
    for (const t of this.trails) t.age += dt;
    this.trails = this.trails.filter((t) => t.age < 0.35);
    for (const p of this.particles) {
      p.age += dt;
      p.pos = add(p.pos, scale(p.vel, dt));
      p.vel = scale(p.vel, Math.pow(0.02, dt));
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < 0.4);
    for (const c of this.callouts) c.age += dt;
    this.callouts = this.callouts.filter((c) => c.age < CALLOUT_LIFE);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.screenFlash = Math.max(0, this.screenFlash - dt);
    this.suddenDeathBanner = Math.max(0, this.suddenDeathBanner - dt);
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
    const availW = this.width - MARGIN * 2;
    const availH = this.height - HUD_HEIGHT - MARGIN * 2;
    this.scale = Math.max(4, Math.min(availW / aw, availH / ah));
    this.origin = {
      x: (this.width - aw * this.scale) / 2,
      y: HUD_HEIGHT + MARGIN + (availH - ah * this.scale) / 2,
    };
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
    for (const i of [0, 1] as const) this.drawPlayer(state, i);
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

    ctx.strokeStyle = COLORS.wall;
    ctx.lineWidth = state.cfg.map.wallThickness * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const w of state.arena.walls) {
      const a = this.toScreen(w.a);
      const b = this.toScreen(w.b);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
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
      grad.addColorStop(1, hexAlpha(COLORS.players[t.player], 0.55 * life));
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
    ctx.fillStyle = hexAlpha(COLORS.players[owner], alpha);
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
    for (const i of [0, 1] as const) {
      const p = state.players[i];
      const left = i === 0;
      const x = left ? MARGIN : this.width - MARGIN;
      const dir = left ? 1 : -1;
      ctx.fillStyle = COLORS.players[i];
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.textAlign = left ? 'left' : 'right';
      ctx.fillText(PLAYER_NAMES[i], x, 24);
      // Health pips.
      for (let h = 0; h < cfg.round.hitsToLose; h++) {
        const alive = h < cfg.round.hitsToLose - p.hits;
        const px = x + dir * (52 + h * 22);
        ctx.fillStyle = alive ? COLORS.players[i] : 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.arc(px, 24, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      // Round wins.
      for (let w = 0; w < cfg.round.roundsToWin; w++) {
        const px = x + dir * (6 + w * 16);
        ctx.strokeStyle = COLORS.text;
        ctx.fillStyle = COLORS.text;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, 50, 5, 0, Math.PI * 2);
        if (w < p.roundWins) ctx.fill();
        else ctx.stroke();
      }
      // Active power-ups, with stacks or seconds left.
      const active: [PowerUpKind, string][] = POWER_UP_KINDS.filter((k) => p.effects[k] > 0).map((k) => [
        k,
        STACKING.has(k) ? `×${p.effects[k]}` : `${Math.ceil(p.effects[k])}s`,
      ]);
      active.forEach(([kind, label], n) => {
        const px = x + dir * (68 + n * 44);
        ctx.fillStyle = CATEGORY_COLORS[POWER_UP_CATEGORY[kind]];
        ctx.beginPath();
        ctx.arc(px, 50, 9, 0, Math.PI * 2);
        ctx.fill();
        drawPowerUpGlyph(ctx, kind, px, 50, 11);
        ctx.fillStyle = COLORS.text;
        ctx.font = '600 12px system-ui, sans-serif';
        // Labels sit on the side away from the screen edge.
        ctx.textAlign = left ? 'left' : 'right';
        ctx.fillText(label, px + dir * 12, 51);
      });
    }

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
    ctx.fillText(`Round ${state.roundIndex + 1}`, this.width / 2, 50);
  }

  private label(i: PlayerIndex): string {
    return `${this.looks[i]} ${PLAYER_NAMES[i]}`.trim();
  }

  private drawOverlay(state: GameState, paused: boolean): void {
    let title = '';
    let sub = '';
    if (paused) {
      title = 'Paused';
      sub = 'Esc to resume · Q to quit to title';
    } else if (state.phase === 'countdown') {
      title = `Round ${state.roundIndex + 1}`;
      sub = 'Get ready';
    } else if (state.phase === 'roundOver') {
      const w = state.lastRoundWinner;
      title = w === null ? 'Draw' : `${this.label(w)} takes the round`;
      sub = w === null ? 'Replaying the round' : '';
    } else if (state.phase === 'matchOver' && state.matchWinner !== null) {
      title = `${this.label(state.matchWinner)} wins!`;
      sub = 'Enter for a rematch · Esc for title';
    } else return;

    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(10,11,15,0.55)';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const winner = state.phase === 'matchOver' ? state.matchWinner : state.phase === 'roundOver' ? state.lastRoundWinner : null;
    ctx.fillStyle = winner !== null && !paused ? COLORS.players[winner] : COLORS.text;
    ctx.font = '800 52px system-ui, sans-serif';
    ctx.fillText(title, this.width / 2, this.height / 2 - 16);
    ctx.fillStyle = COLORS.text;
    ctx.font = '500 18px system-ui, sans-serif';
    ctx.fillText(sub, this.width / 2, this.height / 2 + 32);
  }

  // Title screen with a live key test, so ghosting shows up before a match.
  drawTitle(isHeld: (code: string) => boolean, slots: readonly string[], mapName: string, mapCount: number): void {
    const ctx = this.ctx;
    const cx = this.width / 2;
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.text;
    ctx.font = '800 56px system-ui, sans-serif';
    ctx.fillText('Floor Plan Duel', cx, this.height * 0.2);
    ctx.font = '500 20px system-ui, sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.fillText('Press Enter to start  ·  M to mute  ·  N for music on/off', cx, this.height * 0.2 + 52);
    ctx.fillStyle = COLORS.text;
    ctx.font = '600 17px system-ui, sans-serif';
    ctx.fillText(`Map: ${mapName}`, cx, this.height * 0.2 + 92);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '400 13px system-ui, sans-serif';
    ctx.fillText(`${mapCount > 1 ? 'Tab to change map  ·  ' : ''}E to open the map editor`, cx, this.height * 0.2 + 114);

    const top = this.height * 0.42;
    const colW = Math.min(360, this.width / 2 - 20);
    this.drawKeyPanel(KEY_BINDINGS.p1, 0, cx - colW / 2 - 10, top, isHeld, slots[0]);
    this.drawKeyPanel(KEY_BINDINGS.p2, 1, cx + colW / 2 + 10, top, isHeld, slots[1]);

    ctx.font = '400 14px system-ui, sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    ctx.fillText(
      'Key test: hold every key you would use together. If a key fails to light up, your keyboard is ghosting.',
      cx,
      this.height - 40,
    );
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
    ctx.fillText(PLAYER_NAMES[i], cx + 16, top);
    // Look preview, cycled with this player's dodge keys.
    ctx.beginPath();
    ctx.arc(cx - 24, top, 20, 0, Math.PI * 2);
    ctx.fill();
    drawLook(ctx, this.looks[i], cx - 24, top, 20);
    const who = slot === 'human' ? 'Human' : `Bot · ${slot[0].toUpperCase()}${slot.slice(1)}`;
    ctx.fillStyle = COLORS.text;
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText(who, cx, top + 190);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '400 13px system-ui, sans-serif';
    ctx.fillText(`press ${i + 1} to change`, cx, top + 212);
    ctx.fillText('dodge key changes your look', cx, top + 232);
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
    cap(keys.dodge, ax + step / 2, y0 + k + gap, 'dodge');
    cap(keys.shoot, ax + step * 1.5, y0 + k + gap, 'shoot');
    ctx.globalAlpha = 1;
  }
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
