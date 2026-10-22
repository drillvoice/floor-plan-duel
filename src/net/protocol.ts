// Phones as controllers: the messages between the desktop (the host, which
// runs the game) and each phone, plus the host's bookkeeping of who holds
// which of the MAX_PLAYERS player slots (P1-P4). No networking here, so it can be tested on its own.
//
// Messages travel over an unreliable channel, so each one is a full snapshot
// of the sender's state rather than a change. A lost message doesn't matter:
// the next one, a few milliseconds later, says the same thing. One-off
// actions (a dodge tap, the start button) are counters that only go up, so
// the receiver can tell a new press from one it has already seen.

import type { InputSource } from '../input/types';
import { MAX_PLAYERS, type PlayerIndex, type PlayerInput } from '../sim/types';

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
  starts: number;
  pauses: number;
}

export type HostScreen = 'lobby' | 'match' | 'paused' | 'over';

// Host → phone, about 10 times a second and whenever something changes.
export interface HostMessage {
  t: 'host';
  slot: PlayerIndex | null;
  colors: string[]; // each side's player colour, MAX_PLAYERS of them
  taken: (string | null)[]; // name of whoever holds each side
  screen: HostScreen;
  canStart: boolean; // whether the start button does anything right now
  buzz: number; // counter: goes up each time this phone's player is hit
}

const MAX_NAME = 16;

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isAxis = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isSlot = (v: unknown): v is PlayerIndex => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < MAX_PLAYERS;

// Checks a message from a phone. Anything malformed is dropped.
export function parsePad(data: unknown): PadMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.t !== 'pad' || typeof d.id !== 'string' || !d.id || d.id.length > 64) return null;
  if (typeof d.boot !== 'string' || d.boot.length > 64 || !isCount(d.seq)) return null;
  if (typeof d.name !== 'string' || typeof d.look !== 'string' || d.look.length > 16) return null;
  if (!(d.want === null || isSlot(d.want))) return null;
  if (!isAxis(d.x) || !isAxis(d.y) || typeof d.shoot !== 'boolean') return null;
  if (!isCount(d.shots) || !isCount(d.dodges) || !isCount(d.starts) || !isCount(d.pauses)) return null;
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
    starts: d.starts,
    pauses: d.pauses,
  };
}

export function parseHost(data: unknown): HostMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.t !== 'host' || !(d.slot === null || isSlot(d.slot))) return null;
  if (!Array.isArray(d.colors) || d.colors.length !== MAX_PLAYERS || !d.colors.every((c) => typeof c === 'string')) return null;
  if (!Array.isArray(d.taken) || d.taken.length !== MAX_PLAYERS) return null;
  if (!d.taken.every((n) => n === null || typeof n === 'string')) return null;
  if (!['lobby', 'match', 'paused', 'over'].includes(d.screen as string)) return null;
  if (typeof d.canStart !== 'boolean' || !isCount(d.buzz)) return null;
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
  seenStarts: number;
  seenPauses: number;
  buzz: number;
}

export type RoomEvent = { type: 'start' } | { type: 'pause' } | { type: 'dropped'; slot: PlayerIndex };

// The host's view of the phones: who's connected and which slot each holds.
// Slots belong to a phone's id, not its connection, so a phone that drops
// and reconnects (screen lock, Wi-Fi blip) gets its player back. A slot held
// by a disconnected phone is free for another phone to take.
export class PhoneRoom {
  private phones = new Map<string, Phone>();
  private slots: (string | null)[] = new Array(MAX_PLAYERS).fill(null);

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
        seenStarts: pad.starts,
        seenPauses: pad.pauses,
        buzz: known?.buzz ?? 0,
      });
    } else {
      // Messages can arrive out of order: ignore one older than what we have.
      if (pad.seq <= known.pad.seq) return events;
      if (pad.starts > known.seenStarts) events.push({ type: 'start' });
      if (pad.pauses > known.seenPauses) events.push({ type: 'pause' });
      known.seenStarts = pad.starts;
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
    const free = this.slots.findIndex((_, i) => this.isFree(i));
    if (free >= 0) this.slots[free] = id;
  }

  private isFree(slot: PlayerIndex): boolean {
    const holder = this.slots[slot];
    return holder === null || !this.phones.get(holder)?.connected;
  }

  slotOf(id: string): PlayerIndex | null {
    const slot = this.slots.indexOf(id);
    return slot < 0 ? null : slot;
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
  messageFor(id: string, screen: HostScreen, canStart: boolean, colors: readonly string[]): HostMessage {
    const slot = this.slotOf(id);
    const taken = this.slots.map((_, i) => this.phoneIn(i)?.name ?? null);
    return {
      t: 'host',
      slot,
      colors: colors.slice(0, MAX_PLAYERS),
      taken,
      screen,
      canStart,
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

// Drives a player from whichever phone holds a slot. The slot is the phone's
// seat (P1-P4), which can differ from the player's number in the match when
// a seat in between is empty.
export class PhonePlayer implements InputSource {
  readonly kind = 'human';

  constructor(
    private room: PhoneRoom,
    private clock: () => number,
    readonly slot: PlayerIndex,
  ) {}

  sample(): PlayerInput {
    return this.room.sample(this.slot, this.clock());
  }
}
