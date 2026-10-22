// Settings and saved data in this browser's localStorage, all under `fpd.*`
// keys. Storage can be unavailable (private windows, blocked site data), so
// every access is guarded: a read falls back to null and a failed write is
// ignored, leaving the choice in place for this visit only.

// The player's name on this phone, shared by phone play and the controller.
export const PHONE_NAME_KEY = 'fpd.pad.name';

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Returns false if it wasn't saved.
export function writePref(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removePref(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

// Parsed JSON, or null when missing or unreadable. Callers check the shape.
export function readJsonPref(key: string): unknown {
  const raw = readPref(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeJsonPref(key: string, value: unknown): boolean {
  return writePref(key, JSON.stringify(value));
}

// An on/off setting saved as 'on' or 'off'; missing means `fallback`.
export function readFlag(key: string, fallback: boolean): boolean {
  const saved = readPref(key);
  return saved === null ? fallback : saved !== 'off';
}

export function writeFlag(key: string, on: boolean): void {
  writePref(key, on ? 'on' : 'off');
}
