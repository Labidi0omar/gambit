# Gambit audit

Date: 2026-10-18. Method: automated checks first, unit tests for logic, then targeted reads only where a check pointed.

## Step 1: automated checks

| Check | Result |
| --- | --- |
| `npm run build` (tsc -b + vite) | pass |
| `tsc --noEmit` | pass, 0 errors |
| Lint | **typescript-eslint refuses TypeScript 7** (peer range < 6.1). Replaced with oxlint 1.88 (eslint-compatible: correctness + react-hooks). 2 errors |
| `validate-content.ts` (depth 18) | pass: 17 hand-written positions, 51 DB demos, 24 opening lines (exact ECO + name + PGN match with lichess-org/chess-openings), 11 video ids. 0 failures |
| Trap lines | none exist in the app (not checked) |
| `check-puzzles.ts` (200 per band, 1,000 total) | pass: legal FENs, side not to move never in check, moves playable, setup move by the right side, ratings inside bands, 15,000 unique ids |
| Videos | all ids match `[A-Za-z0-9_-]{11}` or a valid playlist id; there is no `videoSearchUrl` field |

## Step 2: logic tests (vitest, `tests/`)

30 tests written; 7 failed on the first run:

- bot cap above 2000
- spaced repetition counts 24 h, not local days (puzzles and openings)
- missing persist schema versions
- opening transpositions rejected (3 tests)
- weak-bot module missing (whole file)

Glicko, review mover/sign/mate handling, CCT detection and corrupted-JSON fallback passed.

## Step 3: engine and performance

- Worker loads `/stockfish/stockfish-18-lite-single.js`. The production build serves the `.js` (text/javascript) and `.wasm` (application/wasm). The bot moved in a production preview.
- Puzzle bands are fetched lazily (`/puzzles/*.json`), not bundled. Bundle: 544 KB raw, **174 KB gzipped** in total (under 500 KB).
- Chessground base, board and piece CSS are imported. Board is 324 px plus frame at 375 px width.

## Findings

| # | Severity | Area | File | Problem | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | critical | Content | content/level1.json (l1-pin) | "Pinned to the king, the piece cannot legally move at all" is false: it can move along the pin line or capture the pinner | Reword |
| 2 | critical | Content | content/level2.json (l2-kp-k) | "King on the sixth rank in front of the pawn, you always win" is false for rook pawns (a/h-file draws) | Add the exception |
| 3 | major | Bot | engine/bot.ts, engine/stockfish.ts | Below 1320 there is no Skill 0 + MultiPV layer; it picks a random legal move or plays depth-limited best. No test | New `engine/weak.ts`: Skill 0, depth 1-4, MultiPV 6, Elo-scaled blunder chance and softmax pick; engine `candidates()` |
| 4 | major | Bot | store/settings.ts | `BOT_MAX = 2800`; spec caps at 2000 | Cap 2000 |
| 5 | major | SRS | store/puzzles.ts, store/openings.ts | Due = now + n×24 h; missed at 23:30 is due 23:30 next day instead of the next local day | Due at local midnight + n days (`lib/days.ts`) |
| 6 | major | Storage | store/*.ts | 5 persisted stores have no schema version; a wrong-shaped saved state can crash screens | `version: 1` + migrate + shape-checking merge |
| 7 | major | Openings | screens/Openings.tsx | Recall only accepts the exact line move; transpositions rejected | `acceptLineMove()` compares FEN after swapping your own move order |
| 8 | major | Openings | lib/openings.ts, screens/Openings.tsx | No "advanced openings at 1200" unlock | Mark 4 repertoires advanced; lock below 1200 puzzle rating |
| 9 | major | Engine | engine/stockfish.ts, screens/Play.tsx | `stop` never sent; a search from an abandoned game blocks the queue. Worker never terminated (leaks on hot reload) | `stop` before every search and on new game; terminate on pagehide / HMR dispose |
| 10 | major | Content | content/level0.json | Castling, en passant, threefold and 50-move rule never taught, yet "castle early" and those draw reasons appear | Two new Level 0 lessons with validated positions |
| 11 | major | Content | content/level0.json, level2.json | "rank", "file" and "quiet move" used but never taught | Define ranks/files in the rook lesson; reword "quiet move" |
| 12 | major | Content | content/level0.json (l0-pawn-king), level1.json (l1-smothered) | "becomes a queen" (any piece is allowed); "so the king is lost" (the knight can sometimes be captured) | Reword |
| 13 | major | UX | screens/Today.tsx, Progress.tsx | "You play like a X" presents puzzle-based guesswork as a rating | Label "rough estimate", note puzzle ≠ game rating and that Lichess and Chess.com differ |
| 14 | major | UX | index.css | Touch targets under 44 px on phones (logo 32, color picks 36, chips 43, "Mark watched" 20, checkbox 16) | 44 px minimum on coarse pointers |
| 15 | major | Lint | screens/Puzzles.tsx:83 | `useCallback` missing dependency `first` | Add it |
| 16 | minor | Lint | scripts/validate-content.ts:126 | Regex `/#$/` instead of `endsWith` | Fixed in passing |
| 17 | minor | UX | index.css | No light theme; dark only (readable) | List only |
| 18 | minor | UX | screens/Openings.tsx | Drill has no keyboard shortcuts (Review and Puzzles do) | List only |
| 19 | minor | Engine | engine/stockfish.ts | Worker path is absolute `/stockfish/...`; breaks if deployed under a sub-path | List only |
| 20 | minor | UX | App.tsx | Page exit animation can stall while the tab is hidden (requestAnimationFrame paused) | List only |
| 21 | minor | Content | content/level2.json (l2-kr-k) | "check from the side" is vague wording for the rook's rank/file check | List only |
| 22 | minor | Tooling | package.json | ESLint replaced by oxlint until typescript-eslint supports TS 7 | List only |

## Fixes applied (critical + major)

| # | Fix | Where |
| --- | --- | --- |
| 1 | Pin explanation: a pinned piece may still slide along the pin line or capture the pinner | content/level1.json |
| 2 | K+P vs K: added the rook-pawn (a/h-file) exception | content/level2.json |
| 3 | Weak-bot layer below 1320: Skill 0, depth 1-4, MultiPV 4-8, Elo-scaled blunder chance (38% at 400 → 3% at 1300) and softmax pick over candidates. UCI_Elo used only at or above 1320 | engine/weak.ts, engine/bot.ts, engine/stockfish.ts (`candidates()`) |
| 4 | `BOT_MAX` 2000 (slider, auto-raise and manual setting all clamp) | store/settings.ts |
| 5 | SRS due dates = local midnight + 1/3/7/14 days (DST-safe) for puzzles, game puzzles and opening lines | lib/days.ts, store/puzzles.ts, store/openings.ts |
| 6 | All 9 persisted stores: `version: 1` with a pass-through migration from v0 (no data loss), shape-checked merge, corrupted JSON dropped | lib/storage.ts (`persistOptions`) |
| 7 | Opening recall accepts transpositions: your own later line move played first, if the line's replies stay legal and the FEN matches | lib/openings.ts (`acceptLineMove`), screens/Openings.tsx |
| 8 | Ruy Lopez, Queen's Gambit, French, Queen's Gambit Declined locked below 1200 puzzle rating, in the picker and in bot opening practice | scripts/build-openings.ts, Openings.tsx, Play.tsx |
| 9 | `stop` before every search, on new game and at game end; worker terminated on `pagehide` and hot reload | engine/stockfish.ts, Play.tsx |
| 10 | New Level 0 lessons "Castling" and "En passant and draws" (threefold, 50-move, insufficient material), each with 3 DB demos validated at depth 18 plus practice. Puzzle builder now reserves 60 puzzles per lesson theme per band, still max 3,000 per band | content/level0.json, scripts/build-puzzles.ts, build-demos.ts |
| 11 | Ranks and files defined in the rook lesson; "quiet move" replaced with plain words | content |
| 12 | "promote to a queen, rook, bishop or knight"; smothered mate: "if no piece can capture the knight, it is mate" | content |
| 13 | Strength shown as "rough estimate", with a note that puzzle rating isn't a game rating and that Lichess and Chess.com differ | Today.tsx, Progress.tsx |
| 14 | 44 px minimum for buttons, selects and checkboxes on touch screens | index.css |
| 15 | Missing `first` dependency; redundant spread | Puzzles.tsx, lib/openings.ts |

Not fixed (minor, listed above): #17-#22.

## Re-run after fixes

| Check | Result |
| --- | --- |
| `npm run build` | pass; 178 KB gzipped JS, 11 KB CSS |
| `tsc --noEmit` | pass, 0 errors |
| `npm run lint` (oxlint) | 0 errors, 0 warnings |
| `npm run content:check` (depth 18) | 110 items ok, 0 failures, 0 warnings: 17 hand-written positions, 57 DB demos (28 lessons), 24 opening lines, 11 videos |
| `npm run puzzles:check` | 1,000 sampled, 15,000 unique, 0 failures |
| `npm test` (vitest) | **37/37 pass**: Glicko (6), stores and SRS and storage (14), review/CCT/openings logic (11), weak bot params (4), engine simulation (2): a 400 bot lost material in most of 8 games against random moves, and a 1300 bot lost material less often |
| Browser, production build at 375 px | no horizontal scroll, every control 44 px or taller, advanced openings locked at 500 rating, weak bot moves, resign + new game doesn't stall |

Thin data note: the Lichess DB has few popular castling puzzles under 1000, so the castling demos are rated 991-1205 and castling practice at low ratings may run out after a few puzzles.
