// Phones as controllers: the messages between the desktop (the host, which
// runs the game) and each phone, plus the host's bookkeeping of who holds
// which player slot. No networking here, so it can be tested on its own.
//
// Messages travel over an unreliable channel, so each one is a full snapshot
// of the sender's state rather than a change. A lost message doesn't matter:
// the next one, a few milliseconds later, says the same thing. One-off
// actions (a dodge tap, the pause button) are counters that only go up, so
// the receiver can tell a new press from one it has already seen. Being
// ready to start is a state rather than a press, so it's just a flag.

import type { InputSource } from '../input/types';
import type { PlayerIndex, PlayerInput } from '../sim/types';

// Peer IDs on the shared signalling server are global, so prefix ours.
export const PEER_PREFIX = 'floor-plan-duel-';
// No vowels, so codes never spell words; no letters that look like digits.
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_LENGTH = 4;

export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)];
  return code;
}

// Tidies what someone typed (lower case, spaces) into a code, or null.
export function normalizeRoomCode(text: string): string | null {
  const code = text.toUpperCase().replace(/[^A-Z]/g, '');
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_LETTERS.includes(c)) ? code : null;
}

export function joinUrl(base: string, code: string): string {
  const url = new URL(base);
  url.search = `?join=${code}`;
  url.hash = '';
  return url.toString();
}

// Phone → host, about 30 times a second.
export interface PadMessage {
  t: 'pad';
  id: string; // stays the same across reconnects, so the phone gets its slot back
  boot: string; // new each time the phone page loads, when its counters restart
  seq: number; // goes up with every message
  name: string;
  look: string;
  want: PlayerIndex | null; // the side the phone asked for; null = any free side
  x: number; // joystick, -1..1 each way
  y: number;
  shoot: boolean; // held
  shots: number; // counters: each press adds one
  dodges: number;
  pauses: number;
  ready: boolean; // ready for the match to start (the phone clears it once one does)
}

export type HostScreen = 'lobby' | 'match' | 'paused' | 'over';

// Host → phone, about 10 times a second and whenever something changes.
export interface HostMessage {
  t: 'host';
  slot: PlayerIndex | null;
  colors: [string, string]; // each side's player colour
  taken: [string | null, string | null]; // name of whoever holds each side
  screen: HostScreen;
  canStart: boolean; // whether the Ready button does anything right now
  ready: [boolean, boolean]; // whether each side's phone is ready
  countdown: number | null; // seconds until the match starts, once every phone is ready
  buzz: number; // counter: goes up each time this phone's player is hit
}

const MAX_NAME = 16;

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isAxis = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// Checks a message from a phone. Anything malformed is dropped.
export function parsePad(data: unknown): PadMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.t !== 'pad' || typeof d.id !== 'string' || !d.id || d.id.length > 64) return null;
  if (typeof d.boot !== 'string' || d.boot.length > 64 || !isCount(d.seq)) return null;
  if (typeof d.name !== 'string' || typeof d.look !== 'string' || d.look.length > 16) return null;
  if (!(d.want === null || d.want === 0 || d.want === 1)) return null;
  if (!isAxis(d.x) || !isAxis(d.y) || typeof d.shoot !== 'boolean') return null;
  if (!isCount(d.shots) || !isCount(d.dodges) || !isCount(d.pauses) || typeof d.ready !== 'boolean') return null;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    t: 'pad',
    id: d.id,
    boot: d.boot,
    seq: d.seq,
    name: cleanName(d.name),
    look: d.look,
    want: d.want,
    x: clamp(d.x),
    y: clamp(d.y),
    shoot: d.shoot,
    shots: d.shots,
    dodges: d.dodges,
    pauses: d.pauses,
    ready: d.ready,
  };
}

export function parseHost(data: unknown): HostMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.t !== 'host' || !(d.slot === null || d.slot === 0 || d.slot === 1)) return null;
  if (!Array.isArray(d.colors) || d.colors.length !== 2 || !d.colors.every((c) => typeof c === 'string')) return null;
  if (!Array.isArray(d.taken) || d.taken.length !== 2) return null;
  if (!d.taken.every((n) => n === null || typeof n === 'string')) return null;
  if (!['lobby', 'match', 'paused', 'over'].includes(d.screen as string)) return null;
  if (typeof d.canStart !== 'boolean' || !isCount(d.buzz)) return null;
  if (!Array.isArray(d.ready) || d.ready.length !== 2 || !d.ready.every((r) => typeof r === 'boolean')) return null;
  if (!(d.countdown === null || (typeof d.countdown === 'number' && d.countdown >= 0))) return null;
  return d as unknown as HostMessage;
}

// A phone's last word older than this counts as gone quiet: its player
// stops rather than running on with a stale joystick.
export const STALE_AFTER = 0.5; // seconds

interface Phone {
  pad: PadMessage;
  connected: boolean;
  heardAt: number; // seconds, host clock
  usedShots: number; // presses the game has already acted on
  usedDodges: number;
  seenPauses: number;
  buzz: number;
}

export type RoomEvent = { type: 'pause' } | { type: 'dropped'; slot: PlayerIndex };

// The host's view of the phones: who's connected and which slot each holds.
// Slots belong to a phone's id, not its connection, so a phone that drops
// and reconnects (screen lock, Wi-Fi blip) gets its player back. A slot held
// by a disconnected phone is free for another phone to take.
export class PhoneRoom {
  private phones = new Map<string, Phone>();
  private slots: [string | null, string | null] = [null, null];

  // A message from a phone, already parsed. Returns any one-off actions.
  receive(pad: PadMessage, now: number): RoomEvent[] {
    const known = this.phones.get(pad.id);
    const events: RoomEvent[] = [];
    if (!known || known.pad.boot !== pad.boot) {
      // A new phone, or one whose page reloaded: presses from before we
      // heard from it don't count.
      this.phones.set(pad.id, {
        pad,
        connected: true,
        heardAt: now,
        usedShots: pad.shots,
        usedDodges: pad.dodges,
        seenPauses: pad.pauses,
        buzz: known?.buzz ?? 0,
      });
    } else {
      // Messages can arrive out of order: ignore one older than what we have.
      if (pad.seq <= known.pad.seq) return events;
      if (pad.pauses > known.seenPauses) events.push({ type: 'pause' });
      known.seenPauses = pad.pauses;
      known.pad = pad;
      known.connected = true;
      known.heardAt = now;
    }
    this.seat(pad.id, pad.want);
    return events;
  }

  disconnect(id: string): RoomEvent[] {
    const phone = this.phones.get(id);
    if (!phone || !phone.connected) return [];
    phone.connected = false;
    const slot = this.slotOf(id);
    return slot === null ? [] : [{ type: 'dropped', slot }];
  }

  // Gives the phone the side it wants if it can, else keeps it where it is,
  // else any free side.
  private seat(id: string, want: PlayerIndex | null): void {
    const current = this.slotOf(id);
    if (want !== null && want !== current && this.isFree(want)) {
      if (current !== null) this.slots[current] = null;
      this.slots[want] = id;
      return;
    }
    if (current !== null) return;
    const free = ([0, 1] as const).find((i) => this.isFree(i));
    if (free !== undefined) this.slots[free] = id;
  }

  private isFree(slot: PlayerIndex): boolean {
    const holder = this.slots[slot];
    return holder === null || !this.phones.get(holder)?.connected;
  }

  slotOf(id: string): PlayerIndex | null {
    return this.slots[0] === id ? 0 : this.slots[1] === id ? 1 : null;
  }

  // The phone holding a slot, if it's connected.
  phoneIn(slot: PlayerIndex): { id: string; name: string; look: string } | null {
    const id = this.slots[slot];
    const phone = id === null ? undefined : this.phones.get(id);
    if (!phone || !phone.connected) return null;
    return { id: id!, name: phone.pad.name, look: phone.pad.look };
  }

  // A slot held by a phone that has dropped and may come back.
  isWaitingFor(slot: PlayerIndex): boolean {
    const id = this.slots[slot];
    return id !== null && !this.phones.get(id)?.connected;
  }

  // Whether both sides are played from phones (counting one that's
  // reconnecting). Then the match only starts when both are ready, so
  // neither player can start it on their own.
  phonesOnBothSides(): boolean {
    return ([0, 1] as const).every((i) => this.phoneIn(i) !== null || this.isWaitingFor(i));
  }

  isReady(slot: PlayerIndex): boolean {
    const id = this.slots[slot];
    const phone = id === null ? undefined : this.phones.get(id);
    return !!phone?.connected && phone.pad.ready;
  }

  // Whether there's a phone on a side and every phone on a side is ready.
  // A phone that's reconnecting counts as not ready.
  everyoneReady(): boolean {
    const sides = ([0, 1] as const).filter((i) => this.phoneIn(i) !== null || this.isWaitingFor(i));
    return sides.length > 0 && sides.every((i) => this.isReady(i));
  }

  // Free a slot held by a phone that left, so the keyboard or a bot plays it.
  release(slot: PlayerIndex): void {
    if (this.isWaitingFor(slot)) this.slots[slot] = null;
  }

  buzz(slot: PlayerIndex): void {
    const id = this.slots[slot];
    const phone = id === null ? undefined : this.phones.get(id);
    if (phone) phone.buzz++;
  }

  // What the host tells a phone.
  messageFor(id: string, screen: HostScreen, canStart: boolean, colors: readonly [string, string], countdown: number | null): HostMessage {
    const slot = this.slotOf(id);
    const taken = ([0, 1] as const).map((i) => this.phoneIn(i)?.name ?? null) as [string | null, string | null];
    return {
      t: 'host',
      slot,
      colors: [colors[0], colors[1]],
      taken,
      screen,
      canStart,
      ready: [this.isReady(0), this.isReady(1)],
      countdown,
      buzz: this.phones.get(id)?.buzz ?? 0,
    };
  }

  // The input for a slot this tick, using up any new presses.
  sample(slot: PlayerIndex, now: number): PlayerInput {
    const id = this.slots[slot];
    const phone = id === null ? undefined : this.phones.get(id);
    if (!phone || !phone.connected) return { move: { x: 0, y: 0 }, dodge: false, shoot: false };
    const { pad } = phone;
    const fresh = now - phone.heardAt <= STALE_AFTER;
    const dodge = pad.dodges > phone.usedDodges;
    const tapped = pad.shots > phone.usedShots;
    phone.usedDodges = pad.dodges;
    phone.usedShots = pad.shots;
    return {
      move: fresh ? { x: pad.x, y: pad.y } : { x: 0, y: 0 },
      dodge,
      // A tap counts even if press and release both landed between ticks.
      shoot: (fresh && pad.shoot) || tapped,
    };
  }
}

// The few seconds between everyone being ready and the match starting, so
// nobody is caught looking away. It starts over if anyone stops being ready.
export class StartCountdown {
  private since: number | null = null;

  constructor(private length: number) {}

  // Called every frame with whether everyone is ready. True on the frame
  // the countdown runs out, when the match should start.
  update(allReady: boolean, now: number): boolean {
    if (!allReady) {
      this.since = null;
      return false;
    }
    this.since ??= now;
    if (now - this.since < this.length) return false;
    this.since = null;
    return true;
  }

  // Seconds until the start, or null when not counting down.
  left(now: number): number | null {
    return this.since === null ? null : Math.max(0, this.length - (now - this.since));
  }
}

// Drives a player from whichever phone holds its slot.
export class PhonePlayer implements InputSource {
  readonly kind = 'human';

  constructor(
    private room: PhoneRoom,
    private clock: () => number,
  ) {}

  sample(_state: unknown, player: PlayerIndex): PlayerInput {
    return this.room.sample(player, this.clock());
  }
}
