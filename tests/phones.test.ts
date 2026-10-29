import { describe, expect, it } from 'vitest';
import {
  joinUrl,
  makeRoomCode,
  normalizeRoomCode,
  parseHost,
  parsePad,
  PhoneRoom,
  STALE_AFTER,
  StartCountdown,
  type PadMessage,
} from '../src/net/protocol';

const COLORS = ['#7ed957', '#c084fc'] as const;

function pad(id: string, over: Partial<PadMessage> = {}): PadMessage {
  return {
    t: 'pad',
    id,
    boot: 'b1',
    seq: 1,
    name: id,
    look: '',
    want: null,
    x: 0,
    y: 0,
    shoot: false,
    shots: 0,
    dodges: 0,
    pauses: 0,
    ready: false,
    ...over,
  };
}

describe('room codes', () => {
  it('makes four-letter codes that read back', () => {
    for (let i = 0; i < 50; i++) {
      const code = makeRoomCode();
      expect(code).toHaveLength(4);
      expect(normalizeRoomCode(code)).toBe(code);
    }
  });

  it('tidies typed codes and rejects bad ones', () => {
    expect(normalizeRoomCode(' bk mz ')).toBe('BKMZ');
    expect(normalizeRoomCode('BKM')).toBeNull();
    expect(normalizeRoomCode('BAMZ')).toBeNull(); // vowels never appear
  });

  it('builds the join link from the current page', () => {
    expect(joinUrl('https://example.com/game/?x=1#top', 'BKMZ')).toBe('https://example.com/game/?join=BKMZ');
  });
});

describe('message checks', () => {
  it('accepts a good pad message and clamps the stick', () => {
    expect(parsePad({ ...pad('a'), x: 3, y: -2 })).toMatchObject({ x: 1, y: -1 });
  });

  it('drops malformed messages', () => {
    expect(parsePad(null)).toBeNull();
    expect(parsePad({ ...pad('a'), shots: -1 })).toBeNull();
    expect(parsePad({ ...pad('a'), want: 2 })).toBeNull();
    expect(parsePad({ ...pad('a'), x: Number.NaN })).toBeNull();
    expect(parsePad({ ...pad('a'), t: 'host' })).toBeNull();
  });

  it('round-trips a host message', () => {
    const room = new PhoneRoom();
    room.receive(pad('a'), 0);
    const msg = room.messageFor('a', 'lobby', true, COLORS, null);
    expect(parseHost(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
    expect(parseHost({ ...msg, screen: 'nope' })).toBeNull();
  });
});

describe('phone room', () => {
  it('seats phones in the first free side, a third phone waits', () => {
    const room = new PhoneRoom();
    room.receive(pad('a'), 0);
    room.receive(pad('b'), 0);
    room.receive(pad('c'), 0);
    expect(room.slotOf('a')).toBe(0);
    expect(room.slotOf('b')).toBe(1);
    expect(room.slotOf('c')).toBeNull();
    expect(room.messageFor('c', 'lobby', true, COLORS, null).taken).toEqual(['a', 'b']);
  });

  it('moves a phone to the side it asks for, only if free', () => {
    const room = new PhoneRoom();
    room.receive(pad('a'), 0);
    room.receive(pad('a', { seq: 2, want: 1 }), 0);
    expect(room.slotOf('a')).toBe(1);
    room.receive(pad('b', { want: 1 }), 0); // taken: b gets the other side
    expect(room.slotOf('b')).toBe(0);
  });

  it('keeps a dropped phone\'s side for it, unless another phone takes it', () => {
    const room = new PhoneRoom();
    room.receive(pad('a'), 0);
    expect(room.disconnect('a')).toEqual([{ type: 'dropped', slot: 0 }]);
    expect(room.phoneIn(0)).toBeNull();
    expect(room.isWaitingFor(0)).toBe(true);
    room.receive(pad('a', { seq: 2 }), 1);
    expect(room.phoneIn(0)?.id).toBe('a');

    room.disconnect('a');
    room.receive(pad('b', { want: 0 }), 2);
    expect(room.slotOf('b')).toBe(0);
    expect(room.slotOf('a')).toBeNull();
  });

  it('turns stick and button counters into game input, each press once', () => {
    const room = new PhoneRoom();
    room.receive(pad('a'), 0);
    room.receive(pad('a', { seq: 2, x: 0.5, y: -1, dodges: 1 }), 0);
    expect(room.sample(0, 0)).toEqual({ move: { x: 0.5, y: -1 }, dodge: true, shoot: false });
    expect(room.sample(0, 0).dodge).toBe(false);
    // A shoot tap that came and went between two ticks still fires.
    room.receive(pad('a', { seq: 3, shots: 1, shoot: false }), 0);
    expect(room.sample(0, 0).shoot).toBe(true);
    expect(room.sample(0, 0).shoot).toBe(false);
    // Held shoot keeps firing.
    room.receive(pad('a', { seq: 4, shots: 2, shoot: true }), 0);
    expect(room.sample(0, 0).shoot).toBe(true);
    expect(room.sample(0, 0).shoot).toBe(true);
  });

  it('ignores messages that arrive out of order', () => {
    const room = new PhoneRoom();
    room.receive(pad('a', { seq: 5, x: 1 }), 0);
    room.receive(pad('a', { seq: 4, x: -1, dodges: 3 }), 0);
    expect(room.sample(0, 0)).toEqual({ move: { x: 1, y: 0 }, dodge: false, shoot: false });
  });

  it('stops a player whose phone has gone quiet', () => {
    const room = new PhoneRoom();
    room.receive(pad('a', { x: 1, shoot: true }), 0);
    expect(room.sample(0, STALE_AFTER / 2).move.x).toBe(1);
    expect(room.sample(0, STALE_AFTER * 2)).toEqual({ move: { x: 0, y: 0 }, dodge: false, shoot: false });
  });

  it('does not replay presses from before it knew the phone, or after a reload', () => {
    const room = new PhoneRoom();
    expect(room.receive(pad('a', { dodges: 4, pauses: 2 }), 0)).toEqual([]);
    expect(room.sample(0, 0).dodge).toBe(false);
    // The phone page reloaded: counters restart, and its side is kept.
    expect(room.receive(pad('a', { boot: 'b2', seq: 1 }), 0)).toEqual([]);
    expect(room.slotOf('a')).toBe(0);
    expect(room.receive(pad('a', { boot: 'b2', seq: 2, pauses: 1 }), 0)).toEqual([{ type: 'pause' }]);
    expect(room.receive(pad('a', { boot: 'b2', seq: 3, pauses: 1 }), 0)).toEqual([]);
  });

  it('counts hits for the phone to buzz', () => {
    const room = new PhoneRoom();
    room.receive(pad('a'), 0);
    room.buzz(0);
    room.buzz(0);
    room.buzz(1); // nobody there
    expect(room.messageFor('a', 'match', false, COLORS, null).buzz).toBe(2);
  });
});

describe('ready to start', () => {
  it('waits for every phone on a side to be ready', () => {
    const room = new PhoneRoom();
    expect(room.everyoneReady()).toBe(false); // no phones at all
    room.receive(pad('a', { ready: true }), 0);
    expect(room.phonesOnBothSides()).toBe(false);
    expect(room.everyoneReady()).toBe(true); // one phone against a bot or the keyboard
    room.receive(pad('b'), 0);
    expect(room.phonesOnBothSides()).toBe(true);
    expect(room.everyoneReady()).toBe(false);
    expect(room.messageFor('a', 'lobby', true, COLORS, null).ready).toEqual([true, false]);
    room.receive(pad('b', { seq: 2, ready: true }), 0);
    expect(room.everyoneReady()).toBe(true);
  });

  it('does not count a phone that is reconnecting as ready', () => {
    const room = new PhoneRoom();
    room.receive(pad('a', { ready: true }), 0);
    room.receive(pad('b', { ready: true }), 0);
    room.disconnect('b');
    expect(room.phonesOnBothSides()).toBe(true);
    expect(room.everyoneReady()).toBe(false);
  });

  it('counts down once everyone is ready, and starts over if someone backs out', () => {
    const count = new StartCountdown(3);
    expect(count.update(true, 10)).toBe(false);
    expect(count.left(11)).toBe(2);
    expect(count.update(false, 11)).toBe(false);
    expect(count.left(11)).toBeNull();
    expect(count.update(true, 12)).toBe(false);
    expect(count.update(true, 14.9)).toBe(false);
    expect(count.update(true, 15)).toBe(true);
    // Done: it doesn't fire again until it has counted down afresh.
    expect(count.left(15)).toBeNull();
    expect(count.update(true, 15.1)).toBe(false);
  });

  it('checks the ready fields', () => {
    const room = new PhoneRoom();
    room.receive(pad('a'), 0);
    const msg = room.messageFor('a', 'lobby', true, COLORS, 2.5);
    expect(parseHost(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
    expect(parseHost({ ...msg, ready: [true] })).toBeNull();
    expect(parseHost({ ...msg, countdown: -1 })).toBeNull();
    expect(parsePad({ ...pad('a'), ready: 'yes' })).toBeNull();
  });
});
