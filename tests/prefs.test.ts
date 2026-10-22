import { beforeEach, describe, expect, it } from 'vitest';
import { readFlag, readJsonPref, readPref, writeFlag, writePref } from '../src/prefs';
import { Settings } from '../src/settings';

// A minimal in-memory localStorage for the node test environment.
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const blocked = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
  removeItem() {
    throw new Error('blocked');
  },
};

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe('prefs', () => {
  it('reads back what was written, and null for corrupt JSON', () => {
    expect(writePref('fpd.x', 'hello')).toBe(true);
    expect(readPref('fpd.x')).toBe('hello');
    expect(readJsonPref('fpd.x')).toBeNull();
    expect(readJsonPref('fpd.missing')).toBeNull();
  });

  it('keeps flags on unless turned off', () => {
    expect(readFlag('fpd.flag', true)).toBe(true);
    writeFlag('fpd.flag', false);
    expect(readFlag('fpd.flag', true)).toBe(false);
    writeFlag('fpd.flag', true);
    expect(readFlag('fpd.flag', false)).toBe(true);
  });

  it('copes with storage being unavailable', () => {
    (globalThis as { localStorage?: unknown }).localStorage = blocked;
    expect(readPref('fpd.x')).toBeNull();
    expect(writePref('fpd.x', 'y')).toBe(false);
    expect(readFlag('fpd.flag', true)).toBe(true);
  });
});

describe('settings', () => {
  it('start from the defaults', () => {
    const s = new Settings();
    expect(s.slots).toEqual(['human', 'human']);
    expect([s.modifiers, s.rotation, s.mobileBot, s.mobileName]).toEqual([true, true, 'normal', '']);
  });

  it('are remembered for the next visit', () => {
    const s = new Settings();
    s.cycleSlot(1);
    s.toggleModifiers();
    s.toggleRotation();
    s.setMobileBot('hard');
    s.setMobileName('  Ada   Lovelace  ');
    const next = new Settings();
    expect(next.slots).toEqual(['human', 'easy']);
    expect([next.modifiers, next.rotation, next.mobileBot, next.mobileName]).toEqual([false, false, 'hard', 'Ada Lovelace']);
  });

  it('ignore saved values that make no sense', () => {
    localStorage.setItem('fpd.slots', JSON.stringify(['human', 'godlike']));
    localStorage.setItem('fpd.mobile.bot', 'godlike');
    const s = new Settings();
    expect(s.slots).toEqual(['human', 'human']);
    expect(s.mobileBot).toBe('normal');
  });

  it('still work when storage is unavailable', () => {
    (globalThis as { localStorage?: unknown }).localStorage = blocked;
    const s = new Settings();
    s.cycleSlot(0);
    s.toggleModifiers();
    expect(s.slots[0]).toBe('easy');
    expect(s.modifiers).toBe(false);
  });
});
