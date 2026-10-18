# Gambit

A personal chess trainer that takes a total beginner to 1200+. Runs entirely in the browser: no backend, no account; progress is saved in the browser.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Everything the app needs is in the repo, including the Stockfish engine (`public/stockfish`) and the prepared puzzle sets (`public/puzzles`).

## What's inside

- **First Steps**: onboarding and a 20-step beginner path (one idea per step, worked example, guided try, solo try), with a hint ladder, gentle feedback and a coached first game
- **Lessons** for Levels 1-2, with demo positions and practice from the Lichess puzzle database
- **Puzzles** with a Glicko-style rating and spaced repetition (1, 3, 7, 14 days)
- **Play** Stockfish from about 400 to 2000, with CCT mode (checks, captures, threats) and opening practice
- **Game review** at depth 14, with blunders labeled by the CCT step you skipped
- **Openings** drill with spaced repetition; **Progress** with rating graph and blind spots

## Rebuilding the data (optional)

The full puzzle database is attached to the [v0.1.0 release](https://github.com/Labidi0omar/gambit/releases/tag/v0.1.0) (`lichess_db_puzzle.csv.zst`, 307 MB). To rebuild the puzzle sets and lesson demos from it:

```bash
# put lichess_db_puzzle.csv.zst in data/, then:
npm run puzzles
npm run openings
```

## Checks

```bash
npm test               # unit tests (vitest)
npm run lint           # oxlint
npm run content:check  # every lesson position against chess.js and Stockfish depth 18
npm run puzzles:check  # samples the puzzle sets
```

`AUDIT.md` and `FIRST_30_MIN.md` document the last audit and the beginner walkthrough.

## Credits and licenses

- Puzzles: [Lichess puzzle database](https://database.lichess.org/#puzzles), CC0
- Openings: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), CC0
- Engine: [Stockfish](https://stockfishchess.org/) via the `stockfish` npm package, GPLv3
- Board: [chessground](https://github.com/lichess-org/chessground), GPLv3
