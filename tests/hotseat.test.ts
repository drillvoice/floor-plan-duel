import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  newSession,
  parseSession,
  recordResult,
  removePlayer,
  resetScores,
  standings,
  upNext,
  type HotseatSession,
} from '../src/hotseat/session';

function withPlayers(...names: string[]): HotseatSession {
  return names.reduce((s, n) => addPlayer(s, n, '', n.toLowerCase()), newSession());
}

const names = (s: HotseatSession) => s.queue.map((id) => s.players.find((p) => p.id === id)!.name);

describe('hotseat queue', () => {
  it('the first two players are up next', () => {
    const s = withPlayers('Ann', 'Ben', 'Cat');
    expect(upNext(s)!.map((p) => p.name)).toEqual(['Ann', 'Ben']);
    expect(upNext(withPlayers('Ann'))).toBeNull();
  });

  it('winner stays on their side, next in line takes the loser\'s side, loser goes to the back', () => {
    let s = withPlayers('Ann', 'Ben', 'Cat', 'Dan');
    s = recordResult(s, 0, [2, 1]); // Ann (left) beats Ben
    expect(names(s)).toEqual(['Ann', 'Cat', 'Dan', 'Ben']);
    s = recordResult(s, 1, [2, 0]); // Cat (right) beats Ann
    expect(names(s)).toEqual(['Dan', 'Cat', 'Ben', 'Ann']);
  });

  it('with two players nobody moves', () => {
    let s = withPlayers('Ann', 'Ben');
    s = recordResult(s, 1, [2, 0]);
    expect(names(s)).toEqual(['Ann', 'Ben']);
  });

  it('tracks wins, losses and streaks', () => {
    let s = withPlayers('Ann', 'Ben', 'Cat');
    s = recordResult(s, 0, [2, 0]); // Ann beats Ben
    s = recordResult(s, 0, [2, 1]); // Ann beats Cat
    s = recordResult(s, 1, [2, 1]); // Ben beats Ann
    const ann = s.players.find((p) => p.name === 'Ann')!;
    expect(ann).toMatchObject({ wins: 2, losses: 1, streak: 0, bestStreak: 2 });
    expect(standings(s)[0].name).toBe('Ann');
    expect(s.last).toEqual({ winner: 'ben', loser: 'ann', score: [2, 1] });
    expect(resetScores(s).players.every((p) => p.wins === 0 && p.losses === 0)).toBe(true);
  });

  it('removing someone up next pulls the queue forward', () => {
    const s = removePlayer(withPlayers('Ann', 'Ben', 'Cat'), 'ann');
    expect(upNext(s)!.map((p) => p.name)).toEqual(['Ben', 'Cat']);
  });

  it('ignores blank names', () => {
    expect(addPlayer(newSession(), '   ', '', 'x').players).toHaveLength(0);
  });

  it('round-trips through JSON and repairs bad data', () => {
    let s = withPlayers('Ann', 'Ben', 'Cat');
    s = recordResult(s, 0, [2, 0]);
    const back = parseSession(JSON.parse(JSON.stringify(s)));
    expect(back.players).toEqual(s.players);
    expect(back.queue).toEqual(s.queue);
    expect(parseSession({ players: [{ id: 'a', name: 'A' }], queue: ['zz'] }).queue).toEqual(['a']);
    expect(parseSession('nonsense').players).toEqual([]);
  });
});
