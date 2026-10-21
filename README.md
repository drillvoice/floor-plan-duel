# Floor Plan Duel

A top-down 1v1 shooter for two people sharing one laptop keyboard. Shots auto-aim at the opponent but travel slowly, so the game is about moving and dodging. Power-ups appear at random to swing rounds. See [DESIGN.md](DESIGN.md) for the full design.

## Run

Needs Node.js 22 or newer.

```sh
npm install
npm run dev      # play at http://localhost:5173
npm test         # simulation, power-up, bot and map tests
npm run build    # static site in dist/ (works from any folder, e.g. GitHub Pages)
npm run preview  # serve the build locally
```

The built site works offline after the first visit and can be installed as an app from the browser.

## Play

On the title screen:

- **Enter** starts a match, best of 5 rounds, 3 hits to lose a round.
- **1 / 2** switch each player between Human and Bot (Easy, Normal, Hard). Two bots will play each other.
- Each player's **dodge key** cycles their look: a plain circle or a cute icon inside it.
- **H** opens hotseat mode, for a group taking turns (see below).
- **R** turns round modifiers on or off (see below). They start on.
- **Tab** changes the map; **E** opens the map editor (on a saved map, or the one you edited last).
- **M** mutes all sound; **N** turns the music on or off (also works mid-match). The music speeds up as the round goes on and gets busier near the end.
- **B** toggles full screen (also works mid-match), or use the button in the top-right corner of the menus. Esc leaves full screen too.
- The key caps light up while held: use this to check your keyboard can register everyone's keys at once.

| Action | Player 1 | Player 2 |
| --- | --- | --- |
| Move | W A S D | Arrow keys |
| Shoot (hold) | F | / (slash) |
| Dodge | G | . (full stop) |
| Pause | Esc | Esc |

Dodge is a quick dash in the direction you're moving, diagonals included; standing still, it goes the way you last moved. It has a 1.2 s cooldown: the little arrow beside your player shows where a dodge will go, and dims while it recharges. After 90 s a round goes to sudden death and bullets speed up every 5 s.

A bullet that only just misses you pops up a "Close!" and counts as a clutch dodge; the results screen shows each player's total.

Power-ups flash a ring where they're about to appear, and a ring around each one shrinks as it expires:

- **Gold** (lasts the round, stacks): Swift Shot (faster bullets), Long Shot (more range), Trigger Happy (faster firing), Fleet Foot (faster movement), Spare Dodge (a second dodge charge).
- **Blue** (temporary): Shield (absorbs the next hit), Rapid Fire (fire twice as fast), Bouncer (bullets bounce off a wall once), Ghost (walk through walls), Lead Shot (aim predicts where your opponent is going).
- **Red** (curse on your opponent): Molasses (slows them), Topsy-Turvy (reverses their controls), Big Target (makes them easier to hit).

A label pops up saying what each one did, and the icons under each player's health show what's active.

## Round modifiers

With modifiers on, a slot-machine reel spins before each round and picks a rule for that round only, never the same one twice in a row:

| Modifier | What changes |
| --- | --- |
| Giant Bullets | Bullets twice the size, but slower |
| Power-up Storm | A power-up every 1-2 s, twice as many on the map |
| One-Hit Wonder | The first hit wins the round |
| Speed Demons | Players and bullets move faster |
| Bullet Hell | Fire 2.5 times as fast, slightly shorter range |
| Sniper Duel | Fast, long-range shots with a slow reload |
| Bouncy Castle | Every shot bounces twice |
| Ghost Town | Everyone walks through walls; bullets still stop at them |
| Dodge Frenzy | Dodge recharges three times as fast |

The modifier's name stays under the round number while you play.

## Hotseat

For a group sharing one laptop. Press **H** on the title screen, add everyone's names (and click a look to change it), choose how many rounds each match is, and press Enter.

- Two players are up at a time: the first on the left keys, the second on the right keys.
- The winner stays on their side. The loser goes to the back of the line and the next person takes their keys.
- The table tracks everyone's wins, losses and best winning streak, with a 🏆 for the leader. Players can be added or removed between matches.
- The session is saved in the browser, so a reload doesn't lose the scores. **Reset scores** starts afresh with the same people.

## Map editor

Press **E** on the title screen.

- Drag to draw a wall. Ends snap to a half-unit grid and to existing wall ends; hold Shift for straight lines.
- Click a wall to select it, Delete or Backspace to remove it. Ctrl+Z / Ctrl+Shift+Z undo and redo.
- Drag the 1 and 2 markers to move the spawns, or use **Auto spawns** to place them as far apart as possible.
- Every change is saved in this browser straight away (the toolbar shows ✓ Saved), and saved maps appear on the title screen (Tab). **Delete** removes the current map. **Export** / **Import** move maps around as `.json` files.
- **Test play** (or T) starts a match on the map; leaving the match brings you back to the editor.

The status line at the bottom warns if a spawn overlaps a wall or the spawns can't reach each other.

## Balancing with the simulator

```sh
npm run sim -- --matches 500 --difficulty normal --seed 1
```

Runs bot-vs-bot matches headlessly, much faster than real time, and prints win rates by slot and spawn, round length, hits, shots and dodges per round, and how often each power-up's picker goes on to win the round, checked against the targets in DESIGN.md.

- `--p1 hard --p2 easy` sets each bot separately.
- `--set path=value` tries a config change without editing any files, and can be repeated: `--set round.hitsToLose=5 --set fire.cooldown=0.9`.
- `--modifiers` plays every round under a random modifier and adds a table of round length, hits, shots and sudden-death rate per modifier. Narrow it down with `--set 'modifiers.pool=["giantBullets"]'`.
- `--json` prints machine-readable output.

All tunable numbers live in `src/config.ts`.

## Code layout

- `src/sim/`: the game rules. A pure fixed 60 Hz `step(state, inputs)` with a seeded RNG and no DOM or clock, so a match is reproducible from its seed and inputs.
- `src/input/`: keyboard input. `src/bot/`: the bot and A* pathfinding. Both produce the same `{ move, dodge, shoot }` input.
- `src/render/`: canvas drawing, effects and synthesised sound. Never changes game state.
- `src/screens/editor.ts`, `src/maps/`: the editor, the built-in map, validation and storage.
- `scripts/sim.ts`: the headless simulator.

For tuning in the browser, `fpd.state` in the developer console is the live match state.
