# Floor Plan Duel — Game Design Doc

Oct 21, 2026 · @Joel

## Concept

A top-down 1v1 shooter for two people sharing one laptop, played on maps drawn from real floor plans. Shots auto-aim at the opponent but travel slowly, so the game is about moving, dodging and timing rather than aiming. Random power-ups give it a zany, swingy feel. "Floor Plan Duel" is a working title.

Design pillars:

- **Dodging is the skill.** Every shot is readable and avoidable; a hit should feel like your mistake.
- **Short, swingy rounds.** About a minute each, best of 5, with power-ups that can turn a round around.
- **Your own space.** Any room you can draw or photograph becomes an arena.
- **One device, zero setup.** Open the page, two people play. No accounts, no network.

## Controls

Both players share one keyboard, split left and right so hands don't collide. Diagonal movement is normalised so it isn't faster.

| Action | Player 1 (left) | Player 2 (right) |
| --- | --- | --- |
| Move | W A S D | Arrow keys |
| Dodge | F | , (comma) |
| Shoot | G | . (full stop) |
| Pause | Esc | Esc |

Either player slot can be switched to the bot from the start screen. A Gamepad API mapping and mobile touch controls (left joystick, three right-thumb buttons) come later; the input layer is built so adding them doesn't touch game logic.

Open question: some laptop keyboards drop keys when several are held at once (ghosting). Test this combo early on your own laptop and remap if needed.

## Core mechanics

Shots fly straight at where the opponent is when fired, slowly enough to see and sidestep. All numbers below are starting values to tune in playtesting, kept in one config file. Distances are in "units", where a player is 1 unit across and a typical room is about 12 units wide.

| Mechanic | Starting value | Notes |
| --- | --- | --- |
| Player size | 1 unit diameter (circle) | Circle-vs-wall collision, slides along walls |
| Move speed | 5 units/s |  |
| Bullet speed | 8 units/s | Fast enough to threaten, slow enough to dodge at range |
| Bullet size | 0.3 units |  |
| Fire cooldown | 0.6 s | Holding shoot fires as fast as allowed |
| Bullet lifetime | 1 s max, so 8 units of range at base speed | Range = speed × lifetime, so faster bullets also reach further. Bullets fade over their last 0.2 s so the range is readable. Most shots hit a wall first. |
| Dodge distance | 2.5 units over 0.15 s | In the direction you're moving (or last moved), diagonals included |
| Dodge cooldown | 1.2 s per dodge | Prevents permanent invulnerability |
| Dodge invulnerability | None | Dodging moves you out of the way; it does not phase through bullets |
| Hits to lose a round | 3 |  |
| Round format | Best of 5 rounds | Players respawn at opposite spawn points each round |
| Round time limit | 90 s | Then sudden death: bullets speed up 10% every 5 s |

Rules:

- **Auto-aim** targets the opponent's current position, not a predicted one. Leading the target is a power-up.
- **Line of sight:** you can fire with no line of sight, but the bullet goes straight and hits the wall. A small "blocked" indicator shows when the direct line is obstructed, so walls become cover.
- **Dodges** are blocked by walls (you stop at the wall) and show a short dash trail.
- **Hit feedback:** screen shake, flash, a brief slow-motion frame on the third hit. These "juice" touches matter more than they sound.

## Power-ups

Power-ups appear at random spots, linger for a random time, and are either round-long upgrades or short bursts. The randomness is the point; telegraphs and visible timers keep it from feeling cheap.

**Spawning**

- A new power-up every 3–6 s (random), at most 3 on the map at once.
- Location: any open floor cell at least 1.5 units from walls and players. No bias toward either player in the MVP.
- Lifespan, picked per spawn: 1 s (20%), 3 s (20%), 10 s (35%), 30 s (25%).
- **Telegraph:** a shimmering ring shows the spot 0.75 s before the item appears.
- **Lifespan ring:** a ring around the item shrinks as it expires.
- **Colour code:** gold = round-long upgrade, blue = temporary buff, red = curse on the opponent.
- Pick up by touching. Round-long upgrades reset at the start of each round.
- A small icon row under each player's health shows what they currently have, with timers on temporary effects.

**Starter set**

| Power-up | Kind | Effect | Duration | In MVP |
| --- | --- | --- | --- | --- |
| Swift Shot | Round-long | Bullet speed +25% (range grows with it), stacks to 3 | Round | Yes |
| Long Shot | Round-long | Bullet lifetime +40% (more range, same speed), stacks to 3 | Round | v2 |
| Trigger Happy | Round-long | Fire cooldown −20%, stacks to 3 | Round | Yes |
| Fleet Foot | Round-long | Move speed +15%, stacks to 3 | Round | v2 |
| Spare Dodge | Round-long | One extra dodge charge | Round | v2 |
| Shield | Temporary | Absorbs the next hit | Until hit or 10 s | Yes |
| Rapid Fire | Temporary | Fire cooldown halved | 5 s | v2 |
| Bouncer | Temporary | Bullets bounce off walls once | 8 s | v2 |
| Ghost | Temporary | Walk through walls (not out of the map) | 4 s | v2 |
| Lead Shot | Temporary | Auto-aim predicts the opponent's movement | 6 s | v2 |
| Molasses | Curse | Opponent move speed −40% | 4 s | Yes |
| Topsy-Turvy | Curse | Opponent's movement controls reversed | 3 s | v2 |
| Big Target | Curse | Opponent grows 50% bigger (easier to hit) | 5 s | v2 |

If round-long stacking proves to snowball, try spawning power-ups slightly closer to whoever is losing.

## Maps and editor

A map is a list of wall line segments plus two spawn points, saved as JSON. The MVP ships one built-in map and a simple editor; photo import comes in v2 and produces the same JSON.

**Map format**

- Arena bounds in units (default 24 × 16), always enclosed by an outer wall.
- Walls: line segments with a thickness of 0.3 units.
- Two spawn points, placed by hand or auto-placed as far apart as possible with a clear path between.
- A derived walkable grid (0.5-unit cells) for power-up placement and bot pathfinding.
- Saved to localStorage and exportable/importable as a .json file.

**Built-in map: "The Flat"** — a simple apartment-like layout: two rooms joined by a hallway, a doorway into each, and a couple of free-standing walls ("kitchen island", "couch") for cover.

**Editor (MVP)**

- Click-drag to draw a wall; walls snap to a 0.5-unit grid and to existing endpoints.
- Click a wall to select, Delete to remove; undo/redo.
- Place or move the two spawn points.
- "Test play" button jumps straight into a match on the current map.

**Photo import (v2)**

- Upload a photo of a floor plan or line drawing.
- A vision model returns wall segments as JSON; the result opens in the editor for clean-up.
- Door arcs on plans become gaps; text, dimensions and furniture are ignored.
- The map is rescaled so the longest side is about 24 units, keeping proportions.
- Requires an API key, so it's opt-in; everything else works offline.

## Bot opponent

The bot exists for two jobs: a sparring partner when you're alone, and an automated playtester for balancing. It plays through the same input interface as a human (move vector + three buttons), so it can't cheat and can fill either slot.

**Behaviour (MVP)**

- **Dodge:** each frame, check incoming bullets; if one will hit within \~0.4 s, dodge in whichever direction is clear of walls. A reaction delay and miss chance set difficulty.
- **Fight:** keep a preferred distance (about 7 units), strafe sideways, fire whenever off cooldown with line of sight.
- **Grab power-ups** when one is closer to the bot than to the opponent and its lifespan allows the trip.
- **Navigate** with A\* on the walkable grid; seek line of sight when it has none.

| Difficulty | Reaction delay | Chance to miss a needed dodge |
| --- | --- | --- |
| Easy | 0.35 s | 40% |
| Normal | 0.2 s | 20% |
| Hard | 0.08 s | 5% |

**Headless simulation**

- Bot vs bot can run with no rendering, faster than real time, from a command (e.g. `npm run sim -- --matches 500`).
- Outputs a summary: win rate by slot, average round length, hits per round, how often each power-up was picked up and by the eventual round winner.
- Target signals: rounds averaging 40–70 s, neither spawn winning more than 55%, no power-up whose pickup wins the round more than 70% of the time.

## Tech stack and architecture

A static TypeScript web app with a pure simulation core, so the same rules run for humans, the bot, headless tests and (later) network play.

- **Language and build:** TypeScript, Vite.
- **Rendering:** HTML canvas 2D, no game framework. The visuals are simple shapes, and a plain canvas keeps the simulation independent of rendering. Phaser is a fallback if this gets painful.
- **Hosting:** static files (GitHub Pages or similar); installable as a PWA so it works offline.
- **Tests:** Vitest for the simulation (collision, dodges, power-up timers, round scoring).

**Layers**

1. **Inputs:** keyboard player 1, keyboard player 2, bot. Each produces `{ move: {x, y}, dodge, shoot }` per tick.
2. **Simulation:** a fixed 60 Hz tick, `step(state, inputs) → state`. No DOM, no `Math.random` (use a seeded RNG), no wall-clock time. This makes matches reproducible from a seed plus inputs, which gives replays and network play almost for free later.
3. **Renderer:** draws the latest state on the canvas, plus effects (shake, trails, rings). Never changes game state.
4. **Screens:** title, map select, editor, match, results.

All tunable numbers live in one `config.ts`, so balancing never means hunting through code.

## Scope and roadmap

The MVP proves one thing: dodging slow auto-aimed bullets on a shared laptop is fun. Everything else waits until that's true.

**v1 — MVP**

- [ ] Two players on one keyboard, or one player vs bot
- [ ] Movement, wall collision, auto-aimed bullets, fire cooldown, dodges with cooldown
- [ ] 3 hits per round, best of 5, 90 s limit with sudden death
- [ ] Four power-ups (Swift Shot, Trigger Happy, Shield, Molasses) with telegraphs and lifespan rings
- [ ] Built-in map "The Flat" and the basic wall editor
- [ ] Bot at three difficulties, plus headless bot-vs-bot simulation
- [ ] Basic juice: hit flash, screen shake, dash trail, simple synthesised sound effects

**v2** — the rest of the power-up set (done), photo/line-drawing import, a few more built-in maps, a "make it a LOT more fun" polish pass, and:

- **Hotseat mode (done):** still 1v1, but for a group taking turns. Players enter their names, the loser of each match swaps out for the next person in the queue, and a scoreboard tracks who's playing and everyone's wins.
- **Photo looks:** use a picture of your face inside your player circle, alongside the icon looks.

**v3** — mobile touch controls and two-phone play over a small relay server; maybe a first-person mode rendered from the same walls.

**Open questions**

- Does auto-aim at the current position make bullets too easy to dodge at range? (Lead Shot may need to be the default at Hard.)
- Should there be any reason to shoot without line of sight, such as Bouncer?
- Do round-long upgrades snowball? Decide after bot simulations.
- Laptop key ghosting with this layout (see Controls).

## First prompt for Claude Code

Export this doc as Markdown, save it as `DESIGN.md` in an empty repo, then paste the prompt below. It asks for a short critique before building, so you can veto anything before code is written.

```
We're building a browser game called Floor Plan Duel (working title). The full design is in DESIGN.md: read it end to end first.

Summary: a top-down 1v1 shooter for two people sharing one laptop keyboard. Bullets auto-aim at the opponent but are slow, so the game is about moving and dodging. Players can dodge left/right relative to the line to the opponent, fire rate is limited, and random power-ups appear around a map made of wall segments. There's a bot opponent that also lets us run headless bot-vs-bot simulations for balancing.

Build the v1 MVP described in the "Scope and roadmap" section, and nothing from v2 or v3.

Key requirements:
- TypeScript + Vite, plain canvas 2D rendering, static site that works as an offline PWA.
- A pure simulation core: fixed 60 Hz tick, step(state, inputs) -> state, seeded RNG, no DOM or wall-clock time in the sim.
- Humans and the bot drive players through the same input interface: { move, dodgeLeft, dodgeRight, shoot }.
- Every tunable number in one config.ts, using the starting values from DESIGN.md.
- Controls exactly as in the Controls table. Either player slot can be human or bot (Easy/Normal/Hard).
- The four MVP power-ups, with spawn telegraph, shrinking lifespan ring, and gold/blue/red colour coding.
- The built-in map "The Flat", plus the simple wall editor with save/load to localStorage and JSON export/import.
- Juice: hit flash, screen shake, dash trail, synthesised sound effects (Web Audio, no audio files).
- Vitest tests for collision, dodging, cooldowns, power-up timers and round scoring.
- A headless simulation command (npm run sim) that runs N bot-vs-bot matches and prints the balance stats listed in DESIGN.md.

Before writing code: give me a short critique of the design (anything that looks unfun, unclear or likely to cause trouble) and your build plan, then wait for my go-ahead.

When building: commit in small steps, get a playable match working first and build outward from there. When v1 is done, run 500 bot-vs-bot matches on Normal, report the stats, and suggest config changes, but don't apply them without asking. Finish with a README explaining how to run, play and run the sim.
```
