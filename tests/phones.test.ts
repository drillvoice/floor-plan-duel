import { describe, expect, it } from 'vitest';
import {
  joinUrl,
  makeRoomCode,
  normalizeRoomCode,
  parseHost,
  parsePad,
  PhoneRoom,
  STALE_AFTER,
  type PadMessage,
} from '../src/net/protocol';

const COLORS = ['#7ed957', '#c084fc', '#ff9a3c', '#3fd6cf'] as const;

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
    starts: 0,
    pauses: 0,
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
    expect(parsePad({ ...pad('a'), want: 3 })).not.toBeNull();
    expect(parsePad({ ...pad('a'), want: 4 })).toBeNull();
    expect(parsePad({ ...pad('a'), want: 1.5 })).toBeNull();
    expect(parsePad({ ...pad('a'), x: Number.NaN })).toBeNull();
    expect(parsePad({ ...pad('a'), t: 'host' })).toBeNull();
  });

  it('round-trips a host message', () => {
    const room = new PhoneRoom();
    room.receive(pad('a'), 0);
    const msg = room.messageFor('a', 'lobby', true, COLORS);
    expect(parseHost(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
    expect(parseHost({ ...msg, screen: 'nope' })).toBeNull();
    expect(parseHost({ ...msg, slot: 4 })).toBeNull();
    expect(parseHost({ ...msg, colors: msg.colors.slice(0, 2) })).toBeNull();
  });
});

describe('phone room', () => {
  it('seats phones in the first free side, a fifth phone waits', () => {
    const room = new PhoneRoom();
    for (const id of ['a', 'b', 'c', 'd', 'e']) room.receive(pad(id), 0);
    expect(['a', 'b', 'c', 'd'].map((id) => room.slotOf(id))).toEqual([0, 1, 2, 3]);
    expect(room.slotOf('e')).toBeNull();
    expect(room.messageFor('e', 'lobby', true, COLORS).taken).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lets a phone take P3 or P4 straight away', () => {
    const room = new PhoneRoom();
    room.receive(pad('a', { want: 3 }), 0);
    expect(room.slotOf('a')).toBe(3);
    expect(room.phoneIn(0)).toBeNull();
    room.receive(pad('a', { seq: 2, x: 1 }), 0);
    expect(room.sample(3, 0).move.x).toBe(1);
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
    expect(room.receive(pad('a', { dodges: 4, starts: 2 }), 0)).toEqual([]);
    expect(room.sample(0, 0).dodge).toBe(false);
    // The phone page reloaded: counters restart, and its side is kept.
    expect(room.receive(pad('a', { boot: 'b2', seq: 1 }), 0)).toEqual([]);
    expect(room.slotOf('a')).toBe(0);
    expect(room.receive(pad('a', { boot: 'b2', seq: 2, starts: 1 }), 0)).toEqual([{ type: 'start' }]);
    expect(room.receive(pad('a', { boot: 'b2', seq: 3, starts: 1, pauses: 1 }), 0)).toEqual([{ type: 'pause' }]);
  });

  it('counts hits for the phone to buzz', () => {
    const room = new PhoneRoom();
    room.receive(pad('a'), 0);
    room.buzz(0);
    room.buzz(0);
    room.buzz(1); // nobody there
    expect(room.messageFor('a', 'match', false, COLORS).buzz).toBe(2);
  });
});
