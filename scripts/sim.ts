// Headless bot-vs-bot matches for balancing.
//
//   npm run sim -- --matches 500 --difficulty normal --seed 1
//
// Options: --matches N, --difficulty easy|normal|hard (both bots), --p1 / --p2
// to set each bot separately, --seed S, --json for machine-readable output,
// and --set path=value (repeatable) to try a config change without editing
// config.ts, e.g. --set bullet.aimLead=0 --set fire.cooldown=0.5
// --modifiers plays every round under a random round modifier and adds a
// breakdown by modifier.

import { BotPlayer, type Difficulty } from '../src/bot/bot';
import { CONFIG, type Config } from '../src/config';
import { THE_FLAT } from '../src/maps/theFlat';
import { createGame, spawnFor, step } from '../src/sim/step';
import { MODIFIERS, type ModifierId } from '../src/sim/modifiers';
import type { PlayerIndex, PowerUpKind } from '../src/sim/types';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const matches = Number(arg('matches', '100'));
const difficulty = arg('difficulty', 'normal') as Difficulty;
const d1 = arg('p1', difficulty) as Difficulty;
const d2 = arg('p2', difficulty) as Difficulty;
const baseSeed = Number(arg('seed', '1'));
const asJson = process.argv.includes('--json');
const overrides: string[] = [];
process.argv.forEach((a, i) => {
  if (a === '--set' && process.argv[i + 1]) overrides.push(process.argv[i + 1]);
});
const cfg: Config = structuredClone(CONFIG);
for (const o of overrides) {
  const [path, raw] = o.split('=');
  const keys = path.split('.');
  let obj = cfg as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) {
    if (typeof obj[k] !== 'object') throw new Error(`Unknown config path: ${path}`);
    obj = obj[k] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (!(last in obj)) throw new Error(`Unknown config path: ${path}`);
  obj[last] = JSON.parse(raw);
}
if (process.argv.includes('--modifiers')) cfg.modifiers.enabled = true;
const MAX_TICKS = CONFIG.tickRate * 60 * 30; // safety cap: 30 minutes per match

interface RoundRecord {
  modifier: ModifierId | null;
  winner: PlayerIndex | null;
  winnerSpawn: number | null;
  length: number;
  suddenDeath: boolean;
  hits: number;
  shots: number;
  dodges: number;
  shieldBlocks: number;
  pickups: { kind: PowerUpKind; player: PlayerIndex }[];
}

const rounds: RoundRecord[] = [];
const matchWins = [0, 0];
let unfinished = 0;
let totalTicks = 0;
const started = Date.now();

for (let m = 0; m < matches; m++) {
  const seed = baseSeed * 100003 + m;
  const state = createGame(THE_FLAT, seed, cfg);
  const bots = [new BotPlayer(d1, seed * 2 + 1), new BotPlayer(d2, seed * 2 + 2)] as const;
  const newRound = (): RoundRecord => ({ modifier: state.modifier, winner: null, winnerSpawn: null, length: 0, suddenDeath: false, hits: 0, shots: 0, dodges: 0, shieldBlocks: 0, pickups: [] });
  let current = newRound();
  let ticks = 0;
  while (state.phase !== 'matchOver' && ticks < MAX_TICKS) {
    step(state, [bots[0].sample(state, 0), bots[1].sample(state, 1)]);
    ticks++;
    for (const e of state.events) {
      if (e.type === 'hit') current.hits++;
      else if (e.type === 'fire') current.shots++;
      else if (e.type === 'dodge') current.dodges++;
      else if (e.type === 'shieldBlock') current.shieldBlocks++;
      else if (e.type === 'pickup') current.pickups.push({ kind: e.kind, player: e.player });
      else if (e.type === 'roundStart') current.modifier = e.modifier;
      else if (e.type === 'roundEnd') {
        current.winner = e.winner;
        current.winnerSpawn = e.winner === null ? null : THE_FLAT.spawns.findIndex((sp) => {
          const at = spawnFor(state, e.winner!);
          return sp.x === at.x && sp.y === at.y;
        });
        current.length = state.roundTime;
        current.suddenDeath = state.roundTime > state.cfg.round.timeLimit;
        rounds.push(current);
        current = newRound();
      }
    }
  }
  totalTicks += ticks;
  if (state.matchWinner === null) unfinished++;
  else matchWins[state.matchWinner]++;
}

const decided = rounds.filter((r) => r.winner !== null);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const kinds = CONFIG.powerUps.pool;
const pickupStats = kinds.map((kind) => {
  const all = decided.flatMap((r) => r.pickups.filter((p) => p.kind === kind).map((p) => p.player === r.winner));
  return { kind, pickups: all.length, perRound: all.length / Math.max(1, rounds.length), byWinner: mean(all.map(Number)) };
});

const modifierStats = cfg.modifiers.enabled
  ? cfg.modifiers.pool.map((id) => {
      const rs = rounds.filter((r) => r.modifier === id);
      return {
        id,
        rounds: rs.length,
        avgRoundLength: mean(rs.map((r) => r.length)),
        hitsPerRound: mean(rs.map((r) => r.hits)),
        shotsPerRound: mean(rs.map((r) => r.shots)),
        suddenDeathRate: rs.filter((r) => r.suddenDeath).length / Math.max(1, rs.length),
      };
    })
  : [];

const spawnWins = [0, 1].map((s) => decided.filter((r) => r.winnerSpawn === s).length / Math.max(1, decided.length));
const summary = {
  matches,
  difficulty: { p1: d1, p2: d2 },
  seed: baseSeed,
  unfinished,
  matchWinRate: matchWins.map((w) => w / Math.max(1, matches - unfinished)),
  rounds: rounds.length,
  draws: rounds.length - decided.length,
  roundWinRateBySlot: [0, 1].map((p) => decided.filter((r) => r.winner === p).length / Math.max(1, decided.length)),
  roundWinRateBySpawn: spawnWins,
  avgRoundLength: mean(rounds.map((r) => r.length)),
  suddenDeathRate: rounds.filter((r) => r.suddenDeath).length / Math.max(1, rounds.length),
  hitsPerRound: mean(rounds.map((r) => r.hits)),
  overrides,
  shotsPerRound: mean(rounds.map((r) => r.shots)),
  dodgesPerRound: mean(rounds.map((r) => r.dodges)),
  hitRate: rounds.reduce((a, r) => a + r.hits, 0) / Math.max(1, rounds.reduce((a, r) => a + r.shots, 0)),
  shieldBlocksPerRound: mean(rounds.map((r) => r.shieldBlocks)),
  powerUps: pickupStats,
  modifiers: modifierStats,
  simSeconds: totalTicks / CONFIG.tickRate,
  wallSeconds: (Date.now() - started) / 1000,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const ok = (good: boolean) => (good ? '✓' : '✗');
  const lines = [
    `Floor Plan Duel sim: ${matches} matches, P1 ${d1} vs P2 ${d2}, seed ${baseSeed}`,
    ...(overrides.length ? [`  config overrides: ${overrides.join(', ')}`] : []),
    `  ran ${(summary.simSeconds / 60).toFixed(0)} min of play in ${summary.wallSeconds.toFixed(1)} s`,
    '',
    `Match wins          P1 ${pct(summary.matchWinRate[0])}  P2 ${pct(summary.matchWinRate[1])}${unfinished ? `  (${unfinished} hit the time cap)` : ''}`,
    `Round wins by slot  P1 ${pct(summary.roundWinRateBySlot[0])}  P2 ${pct(summary.roundWinRateBySlot[1])}`,
    `Round wins by spawn A ${pct(spawnWins[0])}  B ${pct(spawnWins[1])}`,
    `Rounds              ${rounds.length} (${summary.draws} draws)`,
    `Avg round length    ${summary.avgRoundLength.toFixed(1)} s`,
    `Reached sudden death ${pct(summary.suddenDeathRate)}`,
    `Hits per round      ${summary.hitsPerRound.toFixed(2)} (+${summary.shieldBlocksPerRound.toFixed(2)} blocked by shields)`,
    `Shots per round     ${summary.shotsPerRound.toFixed(1)}  (${pct(summary.hitRate)} hit)`,
    `Dodges per round    ${summary.dodgesPerRound.toFixed(1)}`,
    '',
    'Power-up        pickups/round   picked by round winner',
    ...pickupStats.map((p) => `  ${p.kind.padEnd(14)} ${p.perRound.toFixed(2).padStart(8)}        ${pct(p.byWinner).padStart(6)}`),
    ...(modifierStats.length
      ? [
          '',
          'Modifier          rounds   avg length   hits   shots   sudden death',
          ...modifierStats.map(
            (m) =>
              `  ${MODIFIERS[m.id].name.padEnd(16)} ${String(m.rounds).padStart(5)}   ${m.avgRoundLength.toFixed(1).padStart(8)} s   ${m.hitsPerRound.toFixed(2).padStart(4)}  ${m.shotsPerRound.toFixed(1).padStart(6)}   ${pct(m.suddenDeathRate).padStart(8)}`,
          ),
        ]
      : []),
    '',
    'Targets',
    `  ${ok(summary.avgRoundLength >= 40 && summary.avgRoundLength <= 70)} rounds average 40-70 s`,
    `  ${ok(Math.max(...spawnWins) <= 0.55)} neither spawn wins more than 55%`,
    `  ${ok(pickupStats.every((p) => p.pickups < 20 || p.byWinner <= 0.7))} no power-up's picker wins the round more than 70%`,
  ];
  console.log(lines.join('\n'));
}
