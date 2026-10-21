# Floor Plan Duel

A top-down 1v1 shooter for two people sharing one laptop keyboard. Shots auto-aim at the opponent but travel slowly, so the game is about moving and dodging. See [DESIGN.md](DESIGN.md) for the full design.

## Run

```sh
npm install
npm run dev      # play at http://localhost:5173
npm test         # simulation tests
npm run build    # static build in dist/
```

## Controls

| Action | Player 1 | Player 2 |
| --- | --- | --- |
| Move | W A S D | Arrow keys |
| Dodge left | F | , (comma) |
| Shoot (hold) | G | . (full stop) |
| Dodge right | H | / (slash) |
| Pause | Esc | Esc |

Dodges are sideways relative to the way you face, and you always face your opponent. The title screen doubles as a key test: hold the keys you'd press together and check they all light up.

All tunable numbers are in `src/config.ts`.
