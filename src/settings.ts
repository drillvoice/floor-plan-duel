// The choices made on the title screen and the phone menu, remembered in this
// browser. Each change is saved straight away.

import type { Difficulty } from './bot/bot';
import { cleanName } from './net/protocol';
import { PHONE_NAME_KEY, readFlag, readJsonPref, readPref, writeFlag, writeJsonPref, writePref } from './prefs';

// Each slot is a human on the keyboard or a bot at some difficulty.
export type Slot = 'human' | Difficulty;
export const SLOT_ORDER: Slot[] = ['human', 'easy', 'normal', 'hard'];

const SLOTS_KEY = 'fpd.slots';
const MODIFIERS_KEY = 'fpd.modifiers';
const ROTATION_KEY = 'fpd.mapRotation';
const MOBILE_BOT_KEY = 'fpd.mobile.bot';

function loadSlots(): [Slot, Slot] {
  const saved = readJsonPref(SLOTS_KEY);
  if (Array.isArray(saved) && saved.length === 2 && saved.every((s) => SLOT_ORDER.includes(s))) return saved as [Slot, Slot];
  return ['human', 'human'];
}

function loadMobileBot(): Difficulty {
  const saved = readPref(MOBILE_BOT_KEY);
  return saved === 'easy' || saved === 'normal' || saved === 'hard' ? saved : 'normal';
}

export class Settings {
  readonly slots = loadSlots();
  // Round modifiers (R on the title screen). On unless turned off.
  modifiers = readFlag(MODIFIERS_KEY, true);
  // Map rotation (T): a match starts on the chosen map and plays a different
  // built-in map each round. On unless turned off.
  rotation = readFlag(ROTATION_KEY, true);
  // Phone-only play: the bot's difficulty and the player's name.
  mobileBot = loadMobileBot();
  mobileName = cleanName(readPref(PHONE_NAME_KEY) ?? '');

  cycleSlot(i: 0 | 1): void {
    this.slots[i] = SLOT_ORDER[(SLOT_ORDER.indexOf(this.slots[i]) + 1) % SLOT_ORDER.length];
    writeJsonPref(SLOTS_KEY, this.slots);
  }

  toggleModifiers(): void {
    this.modifiers = !this.modifiers;
    writeFlag(MODIFIERS_KEY, this.modifiers);
  }

  toggleRotation(): void {
    this.rotation = !this.rotation;
    writeFlag(ROTATION_KEY, this.rotation);
  }

  setMobileBot(bot: Difficulty): void {
    this.mobileBot = bot;
    writePref(MOBILE_BOT_KEY, bot);
  }

  setMobileName(name: string): void {
    this.mobileName = cleanName(name);
    writePref(PHONE_NAME_KEY, this.mobileName);
  }
}
