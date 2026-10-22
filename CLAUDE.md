# Floor Plan Duel: notes for Claude

A browser game: a top-down 1v1 shooter with slow auto-aimed bullets. Read README.md for how it plays and the code layout, and DESIGN.md for the design, roadmap and open questions.

## Before committing

```sh
npm run typecheck
npm test
npm run build
```

CI (`.github/workflows/ci.yml`) runs the same checks on every pull request. For anything that changes game rules or numbers, also run the balance sim and compare against the targets it prints:

```sh
npm run sim -- --matches 300 --seed 1
```

## Rules that keep the foundation sound

- **The sim stays pure.** Nothing in `src/sim/` touches the DOM, `Math.random`, `Date` or `performance`. Randomness comes from the seeded RNG in `sim/rng.ts` on the game state, so a match is reproducible from its seed, maps and inputs. `step` updates the state in place.
- **The renderer and sound only read.** They react to `state.events` and draw the state, and never change either.
- **Every tunable number lives in `src/config.ts`**, with a comment saying what it does. Round modifiers change a copy of the config (`sim/modifiers.ts`) rather than adding special cases to the rules.
- **Every input is a `PlayerInput`.** Keyboard, touch, phone controllers and the bot all produce `{ move, dodge, shoot }` through `InputSource`, so the sim can't tell them apart.
- **Logic that can be tested without a browser is kept apart from the DOM**, as in `net/protocol.ts` (no networking), `hotseat/session.ts` and `maps/validate.ts`, and gets Vitest tests.
- **Browser storage goes through `src/prefs.ts`**, which copes with storage being unavailable. Keys are named `fpd.*`. Title-screen and phone-menu choices live in `src/settings.ts`.

## Style

- TypeScript, strict. Single quotes, semicolons, 2-space indent, trailing commas; lines can run long.
- Comments explain why, in plain English, in full sentences. Match the comment density of the surrounding code.
- British spelling in comments and on screen (colour, normalise, behaviour).
- Player-facing text is short and friendly, e.g. "Faster bullets!".

## Docs and commits

- When a feature changes how the game is played, update README.md (the player-facing guide) in the same change, and mark it done in DESIGN.md's roadmap if it was listed there.
- Commit messages: a short summary line, often `Area: what changed`, then a plain-language body saying what and why.
