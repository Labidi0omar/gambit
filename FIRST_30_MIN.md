# A brand-new user's first 30 minutes

Persona: has never played chess and chose **30 minutes a day** in onboarding. Times are estimates for a careful first-timer. For each screen:

- **New ideas** counts chess or app concepts the user hasn't met before.
- **Choices** counts the things they can pick between. Navigation (the back arrow) isn't counted.

| # | Time | Screen | What they see | What they do | New ideas | Choices |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0:00 | Splash | Brass knight seal and "Gambit" for about a second | Nothing (tap skips) | 0 | 0 |
| 2 | 0:02 | Onboarding 1/3 | "Do you know how the chess pieces move?" and "No wrong answers" | Taps "No, not yet" | 0 | **3** |
| 3 | 0:10 | Onboarding 3/3 | "How much time do you want to spend each day?" (question 2 is skipped for people who don't know the pieces) | Taps "30 minutes" | 0 | **3** |
| 4 | 0:15 | Step intro: The board | A rook icon. "A chessboard has 64 squares, light and dark. Always turn it so the bottom-right corner square is light." | Taps Start | 1 (board orientation) | 2 (Start, Watch first) |
| 5 | 0:30 | Watch | Empty board; two captions, the second highlights h1 | Watches (about 6 s) | 0 (same idea) | 1 |
| 6 | 0:45 | Try it with help | "Tap the light square in the bottom-right corner." Nudge already shown | Taps h1 (succeeds first try) | 0 | 2 (board, Hint) |
| 7 | 1:00 | Your turn | "Tap the top-left corner." | Taps a8 | 0 | 2 |
| 8 | 1:10 | You learned | "The board goes with a light square in the bottom-right corner." | Continue | 0 | 1 |
| 9 | 1:20 | Step intro: Square names | "Columns are called files... rows are called ranks..." | Start | 1 (square names; *file* and *rank* defined here) | 1 |
| 10 | 1:40 | Watch | a1 named; then file e and rank 4 cross at e4 | Watches | 0 | 1 |
| 11 | 2:00 | Try it with help | "Tap e4." Nudge: "Find file e, the fifth from the left..." | Taps; a miss shows "Not quite: that's e3. You want file e, rank 4." No red, no sound | 0 | 2 |
| 12 | 2:45 | Your turn | "Tap d5, then b7, then g2." | Taps three squares | 0 | 2 |
| 13 | 3:30 | You learned | "Every square has a name: its file letter, then its rank number, like e4." | Continue | 0 | 1 |
| 14 | 3:40 | Step intro: The rook | "The rook moves in straight lines..." | Start | 1 (rook movement) | 1 |
| 15 | 3:55 | Watch | The rook slides to two stars by itself | Watches | 0 | 1 |
| 16 | 4:10 | Try it with help | One star straight above the rook | Drags the rook (can't miss: only legal squares light up) | 0 | 2 |
| 17 | 4:30 | Your turn | Three stars; "as few moves as you can" | Collects them; "3 moves: the fewest possible" (or "it can be done in 3, try again any time") | 0 | 2 |
| 18 | 5:30 | You learned | "The rook moves in straight lines." | Continue | 0 | 1 |
| 19 | 5:40 | Bishop (intro, watch, help, your turn, learned) | Same shape: diagonals, then "stays on one color" in the intro | Same | 1 | ≤ 2 |
| 20 | 8:30 | Queen (same shape) | "Rook and bishop together" | Same | 1 | ≤ 2 |
| 21 | 11:30 | Knight (same shape) | "L shape... jumps over others" | Same | 1 | ≤ 2 |
| 22 | 15:00 | Practice | Two solo tasks drawn from today's steps (e.g. bishop stars, tap squares) | Solves them, hints available | 0 | 2 |
| 23 | 17:30 | Finish card | "Done for today. Today you learned: [six lines]. Tomorrow: the king." | Finish | 0 | 1 |
| 24 | 18:00 | Home | One big "Continue: the king", the path (done steps ticked, current glowing, next two visible, rest blurred) and "1 day" streak | Taps Continue | 0 | 1 |
| 25 | 18:10 | Second session | Warm-up (one solo task from a finished step), then king, pawn, capturing, pawns capture | Same step shape | 1 per step | ≤ 2 |
| 26 | ~30:00 | Finish card or mid-step | Path shows about 9-10 of 20 steps done | | | |

Nothing on these screens shows a rating, Elo or eval. The only numbers are counts the user can read: moves made, the streak in days, "new step 1 of 6".

## Flags

| Moment | Problem | Status |
| --- | --- | --- |
| Old step 1 "The board" | Two new ideas in one step: board orientation and square names | **Fixed:** split into "The board" (orientation) and "Square names" (files, ranks) |
| Old "How pawns capture" (reached in session 2) | Two ideas: what a capture is, and the pawn's diagonal rule | **Fixed:** "Capturing" now comes first and defines capture; "How pawns capture" only teaches the diagonal |
| Step 1 intro | "Watch first" and "Mark watched" plus Start made 3 choices on the very first screen | **Fixed:** "Mark watched" appears only after the video is opened |
| Onboarding questions 1 and 3 | 3 choices each | **Kept on purpose:** the brief specifies these exact answers (no/some/yes, 10/20/30). They are one-tap answers with no wrong choice, and question 2 is skipped for total beginners |
| "The pawn" (session 2) | Forward one step and the first-move double step | Judged one idea ("how a pawn moves"). The guided task is one square only, and the solo task introduces the double step with a nudge |
| "Checkmate or stalemate" (after 30 min) | Compares two ideas side by side and defines *draw* | Outside the first 30 minutes. Kept because the brief asks for a side-by-side comparison; each term gets a one-line definition in the intro |

## How the principles are enforced

- **One idea, at most 3 sentences per intro:** `validate-content.ts` fails a step with more than 3 intro sentences, or one that uses a glossary term (file, rank, capture, protected, check, checkmate, stalemate, draw, castling, en passant, promotion) before the step that defines it.
- **I do, we do, you do:** every step starts with an example and contains a solo task (validator and `tests/firststeps.test.ts`).
- **The first try succeeds:** each guided task is a single move or tap with the nudge already showing.
- **Hint ladder:** text nudge, then highlight the piece or square, then arrow, then "Do it for me" with an explanation. Hints never count as a miss.
- **Gentle mistakes:** "Not quite: [reason]" with a soft brass highlight, no red flash, no buzzer. Normal feedback starts at Level 1.
- **End on success:** two misses insert an easier guided task first, then return. A lost or drawn first game offers "Play again". A session ends only on a finish card, reached after a success.
