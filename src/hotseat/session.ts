// Hotseat: a group takes turns at 1v1. The winner stays on their side of the
// keyboard, the loser goes to the back of the queue and the next person in
// line takes their place. Pure functions over a plain object, so a session
// can be saved as JSON.

export interface HotseatPlayer {
  id: string;
  name: string;
  look: string;
  wins: number;
  losses: number;
  streak: number; // current wins in a row
  bestStreak: number;
}

export interface HotseatResult {
  winner: string; // player ids
  loser: string;
  score: [number, number]; // rounds: winner, loser
}

export interface HotseatSession {
  players: HotseatPlayer[];
  // Player ids in order: [0] plays on the left keys, [1] on the right keys,
  // the rest wait in line.
  queue: string[];
  roundsToWin: number;
  last: HotseatResult | null;
}

export const MAX_PLAYERS = 12;

export function newSession(): HotseatSession {
  return { players: [], queue: [], roundsToWin: 2, last: null };
}

export function addPlayer(session: HotseatSession, name: string, look: string, id: string): HotseatSession {
  const clean = name.trim().slice(0, 20);
  if (!clean || session.players.length >= MAX_PLAYERS) return session;
  const player: HotseatPlayer = { id, name: clean, look, wins: 0, losses: 0, streak: 0, bestStreak: 0 };
  return { ...session, players: [...session.players, player], queue: [...session.queue, id] };
}

// Removing someone who was up next pulls the next person in line forward.
export function removePlayer(session: HotseatSession, id: string): HotseatSession {
  return {
    ...session,
    players: session.players.filter((p) => p.id !== id),
    queue: session.queue.filter((q) => q !== id),
  };
}

export function updatePlayer(session: HotseatSession, id: string, change: Partial<Pick<HotseatPlayer, 'name' | 'look'>>) {
  return { ...session, players: session.players.map((p) => (p.id === id ? { ...p, ...change } : p)) };
}

export function playerById(session: HotseatSession, id: string): HotseatPlayer | undefined {
  return session.players.find((p) => p.id === id);
}

// The two players up next, left keys first. Null until there are two.
export function upNext(session: HotseatSession): [HotseatPlayer, HotseatPlayer] | null {
  const a = playerById(session, session.queue[0]);
  const b = playerById(session, session.queue[1]);
  return a && b ? [a, b] : null;
}

// Record a finished match between the two players up next. `winnerSide` is
// 0 for the left keys, 1 for the right.
export function recordResult(session: HotseatSession, winnerSide: 0 | 1, score: [number, number]): HotseatSession {
  const pair = upNext(session);
  if (!pair) return session;
  const winner = pair[winnerSide];
  const loser = pair[winnerSide === 0 ? 1 : 0];
  const players = session.players.map((p) => {
    if (p.id === winner.id) {
      const streak = p.streak + 1;
      return { ...p, wins: p.wins + 1, streak, bestStreak: Math.max(p.bestStreak, streak) };
    }
    if (p.id === loser.id) return { ...p, losses: p.losses + 1, streak: 0 };
    return p;
  });
  // Winner keeps their side; the next in line takes the loser's side; the
  // loser goes to the back. With only two players, nobody moves.
  const queue = [...session.queue];
  const waiting = queue.slice(2);
  if (waiting.length > 0) {
    const loserSide = winnerSide === 0 ? 1 : 0;
    queue[loserSide] = waiting[0];
    queue.splice(2, queue.length - 2, ...waiting.slice(1), loser.id);
  }
  return { ...session, players, queue, last: { winner: winner.id, loser: loser.id, score } };
}

export function resetScores(session: HotseatSession): HotseatSession {
  return {
    ...session,
    players: session.players.map((p) => ({ ...p, wins: 0, losses: 0, streak: 0, bestStreak: 0 })),
    last: null,
  };
}

// Leaderboard order: most wins, then fewest losses, then best streak.
export function standings(session: HotseatSession): HotseatPlayer[] {
  return [...session.players].sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.bestStreak - a.bestStreak);
}

// Parse a saved session, dropping anything malformed.
export function parseSession(raw: unknown): HotseatSession {
  const s = newSession();
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Partial<HotseatSession>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const players = Array.isArray(r.players)
    ? r.players
        .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
        .slice(0, MAX_PLAYERS)
        .map((p) => ({
          id: p.id,
          name: p.name.slice(0, 20),
          look: typeof p.look === 'string' ? p.look : '',
          wins: num(p.wins),
          losses: num(p.losses),
          streak: num(p.streak),
          bestStreak: num(p.bestStreak),
        }))
    : [];
  const ids = new Set(players.map((p) => p.id));
  const queue = Array.isArray(r.queue) ? r.queue.filter((q): q is string => ids.has(q as string)) : [];
  // Anyone missing from the queue joins the back of it.
  for (const p of players) if (!queue.includes(p.id)) queue.push(p.id);
  const roundsToWin = [1, 2, 3].includes(r.roundsToWin as number) ? (r.roundsToWin as number) : 2;
  return { players, queue: [...new Set(queue)], roundsToWin, last: null };
}
