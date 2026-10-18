import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { AnimatePresence, motion } from 'framer-motion';
import { Board } from '../components/Board';
import { MoveNav, useBrowse } from '../components/MoveNav';
import { toDests, turnColor, isPromotion } from '../lib/chess';
import { pickPuzzle, themeLabel, THEME_LABELS, type Puzzle } from '../lib/puzzles';
import { usePuzzles } from '../store/puzzles';
import { useDaily } from '../store/daily';
import { sound } from '../lib/sound';
import { useRatingStatus } from '../lib/rating';
import { useUnlocks } from '../lib/useUnlocks';
import { levelUnlocked, useLessons } from '../store/lessons';

type Phase = 'loading' | 'empty' | 'opp' | 'user' | 'solved' | 'failed' | 'showing';

const sq = (uci: string) => [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key] as const;

export function Puzzles({ theme: initialTheme, review, first }: { theme?: string; review?: boolean; first?: Puzzle } = {}) {
  const firstUsed = useRef(false);
  const logDay = useDaily((s) => s.log);
  const startedAt = useRef(0);
  const { rating, rd, streak, bestStreak, recordAttempt, dueReviews, recentIds } = usePuzzles();
  const reviewsDue = usePuzzles((s) => Object.values(s.reviews).filter((c) => c.due <= Date.now()).length);

  const chess = useRef(new Chess());
  const token = useRef(0);
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [isReview, setIsReview] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [step, setStep] = useState(0);
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [highlights, setHighlights] = useState<Map<Key, string>>(new Map());
  const [shapes, setShapes] = useState<DrawShape[]>([]);
  const [delta, setDelta] = useState<number | null>(null);
  const [theme, setTheme] = useState<string>(initialTheme ?? '');
  const [reviewMode, setReviewMode] = useState(!!review);
  // Beginner support: a hint ladder below 900, and gentle feedback until Level 1.
  const open = useUnlocks();
  const established = useRatingStatus().established;
  const showRating = open.ratings && established;
  const completed = useLessons((s) => s.completed);
  const ladder = rating < 900;
  const gentle = !levelUnlocked(1, completed, rating);
  const [hint, setHint] = useState(0);
  const [missed, setMissed] = useState(false);
  const [hinted, setHinted] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const solution = useMemo(() => puzzle?.moves.split(' ') ?? [], [puzzle]);
  const c = chess.current;
  const fen = c.fen();
  const browse = useBrowse(c, fen);
  const bv = browse.view;

  const flash = (key: Key, cls: 'flash-good' | 'flash-bad') => {
    setHighlights(new Map([[key, cls]]));
    const t = token.current;
    setTimeout(() => t === token.current && setHighlights(new Map()), 650);
  };

  const playUci = (uci: string) => {
    const [from, to] = sq(uci);
    chess.current.move({ from, to, promotion: uci[4] });
    setLastMove([from, to]);
    rerender();
  };

  const start = useCallback((p: Puzzle, review: boolean) => {
    const t = ++token.current;
    chess.current = new Chess(p.fen);
    setPuzzle(p);
    setIsReview(review);
    setStep(0);
    setLastMove(undefined);
    setHighlights(new Map());
    setShapes([]);
    setDelta(null);
    setHint(0);
    setMissed(false);
    setHinted(false);
    setNote(null);
    setPhase('opp');
    startedAt.current = Date.now();
    rerender();
    setTimeout(() => {
      if (t !== token.current) return;
      playUci(p.moves.split(' ')[0]);
      setStep(1);
      setPhase('user');
    }, 650);
  }, []);

  const next = useCallback(async () => {
    setPhase('loading');
    const due = dueReviews();
    if (reviewMode && due.length) return start(due[0].puzzle, true);
    if (reviewMode) setReviewMode(false);
    if (first && !firstUsed.current) {
      firstUsed.current = true;
      return start(first, false);
    }
    const p = await pickPuzzle(usePuzzles.getState().rating, { theme: theme || undefined, exclude: recentIds() });
    if (!p) return setPhase('empty');
    start(p, false);
  }, [dueReviews, recentIds, reviewMode, start, theme, first]);

  useEffect(() => {
    next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, reviewMode]);

  const finish = (ok: boolean, usedHint = hinted, hadMiss = missed) => {
    if (!puzzle) return;
    // Using hints is never punished: a hinted solve doesn't touch the rating.
    const { delta } = usedHint ? recordAttempt(puzzle, true, true) : recordAttempt(puzzle, ok && !hadMiss, isReview);
    if (ok) sound.correct();
    else if (!gentle) sound.wrong();
    // Cap idle time so a puzzle left open doesn't count as training.
    logDay({ puzzles: 1, puzzleMs: Math.min(Date.now() - startedAt.current, 3 * 60_000) });
    setDelta(isReview ? null : delta);
    setPhase(ok ? 'solved' : 'failed');
  };

  const onUserMove = (from: Key, to: Key, viaHint = false) => {
    if (phase !== 'user' || !puzzle) return;
    const expected = solution[step];
    const promo = isPromotion(chess.current, from, to) ? (expected?.startsWith(from + to) ? expected[4] : 'q') : '';
    const uci = from + to + promo;

    // Any checkmating move is also accepted (puzzles may have alternate mates).
    const probe = new Chess(chess.current.fen());
    probe.move({ from, to, promotion: promo || undefined });
    const mates = probe.isCheckmate();

    if (uci === expected || mates) {
      playUci(uci);
      flash(to, 'flash-good');
      setNote(null);
      setHint(0);
      const nextStep = step + 1;
      if (mates || nextStep >= solution.length) return finish(true, hinted || viaHint, missed);
      const t = token.current;
      setPhase('opp');
      setTimeout(() => {
        if (t !== token.current) return;
        playUci(solution[nextStep]);
        setStep(nextStep + 1);
        setPhase('user');
      }, 400);
    } else {
      // A miss never spoils the puzzle: the piece snaps back and they try again.
      // Only a clean first try counts as solved for the rating (see finish).
      if (!gentle) {
        flash(to, 'flash-bad');
        sound.wrong();
      }
      setMissed(true);
      setNote(
        gentle
          ? probe.inCheck()
            ? 'Not quite. That gives check, but look for a move that wins more.'
            : 'Not quite. Look for checks and captures first, then try again.'
          : 'Not that one. Try again.',
      );
      rerender(); // snap the piece back
    }
  };

  // Hint ladder: 1 nudge, 2 highlight the piece, 3 arrow, 4 play it and explain.
  const expectedNow = phase === 'user' ? solution[step] : undefined;
  const nextHint = () => {
    const h = hint + 1;
    setHint(h);
    if (h >= 2) setHinted(true);
    if (h >= 4 && expectedNow) {
      const [from, to] = sq(expectedNow);
      setNote('Here it is. Watch what it attacks.');
      onUserMove(from, to, true);
    }
  };
  const HINT_TEXT = ['Hint', 'Show the piece', 'Show the move', 'Play it for me'];
  const hintShapes: DrawShape[] = expectedNow && hint >= 3 ? [{ orig: sq(expectedNow)[0], dest: sq(expectedNow)[1], brush: 'green' }] : [];
  const hintHighlights = expectedNow && hint >= 2 ? new Map<Key, string>([[sq(expectedNow)[0], 'hint']]) : null;

  // Where the user gave up, so "Replay solution" can run the line again from there.
  const gaveUpAt = useRef({ fen: '', step: 0 });
  const giveUp = () => {
    gaveUpAt.current = { fen: chess.current.fen(), step };
    finish(false);
    showSolution();
  };

  const showSolution = () => {
    const t = token.current;
    chess.current = new Chess(gaveUpAt.current.fen);
    rerender();
    setPhase('showing');
    const rest = solution.slice(gaveUpAt.current.step);
    rest.forEach((uci, i) => {
      setTimeout(() => {
        if (t !== token.current) return;
        const [from, to] = sq(uci);
        setShapes([{ orig: from, dest: to, brush: 'green' }]);
        playUci(uci);
        if (i === rest.length - 1) setPhase('failed');
      }, 300 + i * 900);
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ArrowRight steps through moves first (MoveNav); only at the live position does it go on.
      if ((e.key === 'Enter' || (e.key === 'ArrowRight' && !bv)) && (phase === 'solved' || phase === 'failed')) next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, next, bv]);

  const userColor = puzzle ? (new Chess(puzzle.fen).turn() === 'w' ? 'black' : 'white') : 'white';
  const dests = phase === 'user' ? toDests(c) : new Map<Key, Key[]>();
  const done = phase === 'solved' || phase === 'failed';

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 pb-8 pt-4 md:grid-cols-[minmax(0,1fr)_340px] md:gap-8 md:px-8 md:pt-10">
      <div className="mx-auto flex w-full max-w-[min(100%,calc(100dvh-10rem))] flex-col gap-2">
        <div className="flex h-10 items-center justify-between px-1 text-sm">
          <span className="text-zinc-400">
            {phase === 'empty'
              ? 'No puzzles'
              : phase === 'loading'
                ? 'Loading…'
                : `${userColor === 'white' ? 'White' : 'Black'} to move${isReview ? ' · review' : ''}`}
          </span>
          {puzzle && done && showRating && <span className="num text-zinc-500">#{puzzle.id} &middot; {puzzle.rating}</span>}
        </div>
        <div className="relative">
          <Board
            fen={bv ? bv.fen : fen}
            orientation={userColor}
            turnColor={bv ? bv.turnColor : turnColor(c)}
            movableColor={userColor}
            dests={bv ? new Map() : dests}
            lastMove={bv ? bv.lastMove : lastMove}
            check={bv ? bv.check : c.inCheck()}
            viewOnly={!!bv || phase !== 'user'}
            highlights={bv ? undefined : hintHighlights && !highlights.size ? hintHighlights : highlights}
            shapes={bv ? undefined : hintShapes.length ? hintShapes : shapes}
            onMove={(from, to) => onUserMove(from, to)}
          />
          {phase === 'empty' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6">
              <div className="glass max-w-sm p-5 text-sm text-zinc-300">
                No puzzles found{theme ? ` for ${themeLabel(theme)}` : ''}. Put <code>lichess_db_puzzle.csv.zst</code> in{' '}
                <code>data/</code> and run <code className="text-accent">npm run puzzles</code>.
              </div>
            </div>
          )}
        </div>
        {browse.total > 0 && phase !== 'showing' && (
          <div className="mt-2">
            <MoveNav b={browse} />
          </div>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        {phase === 'user' && (ladder || note) && (
          <div className="flex flex-col gap-3 bg-surface-2 px-5 py-4">
            {hint >= 1 && <p className="text-[17px]">Look for checks first, then captures, then threats.</p>}
            {note && <p className="text-[17px] text-ink-2">{note}</p>}
            <div className="flex flex-wrap gap-2">
              {ladder && hint < 4 && (
                <button onClick={nextHint} className="btn-ghost">
                  {HINT_TEXT[hint]}
                </button>
              )}
              {missed && (
                <button onClick={giveUp} className="btn-ghost">
                  Show solution
                </button>
              )}
            </div>
          </div>
        )}

        <div className={`card-hero grid gap-4 p-6 ${showRating ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div className={showRating ? '' : 'hidden'}>
            <div className="label !text-zinc-400">Puzzle rating</div>
            <div className="flex items-baseline gap-2">
              <span className="num text-5xl font-bold">{Math.round(rating)}</span>
              <AnimatePresence>
                {delta !== null && delta !== 0 && (
                  <motion.span
                    key={puzzle?.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`chip ${delta > 0 ? '!bg-up/15 !text-up' : '!bg-down/15 !text-down'}`}
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <div className="text-xs text-zinc-500">&plusmn;{Math.round(rd)}</div>
          </div>
          <div>
            <div className="label !text-zinc-400">Streak</div>
            <motion.div key={streak} initial={{ scale: 1.25 }} animate={{ scale: 1 }} className="num text-5xl font-bold">
              {streak}
            </motion.div>
            <div className="text-xs text-zinc-500">best {bestStreak}</div>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {done && (
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="glass flex flex-col gap-3 p-5"
            >
              <div className={`font-display text-2xl font-bold ${phase === 'solved' ? 'text-up' : 'text-down'}`}>
                {phase === 'solved' ? 'Solved' : 'Not quite'}
              </div>
              {phase === 'failed' && !isReview && <div className="text-sm text-zinc-400">Added to reviews &middot; back tomorrow.</div>}
              {puzzle && (
                <div className="flex flex-wrap gap-1.5">
                  {puzzle.themes.slice(0, 5).map((t) => (
                    <span key={t} className="chip">
                      {themeLabel(t)}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                {phase === 'failed' && (
                  <button onClick={showSolution} className="btn-ghost flex-1">
                    Replay solution
                  </button>
                )}
                <button
                  onClick={next}
                  className="btn-primary flex-1"
                >
                  Next &rarr;
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="card flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <span className="label">Theme</span>
            {theme && (
              <button onClick={() => setTheme('')} className="text-xs text-zinc-400 hover:text-white">
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {['', ...Object.keys(THEME_LABELS).filter((t) => !['short', 'opening'].includes(t))].map((t) => (
              <button
                key={t || 'any'}
                onClick={() => {
                  setReviewMode(false);
                  setTheme(t);
                }}
                className={`px-3 py-2 text-sm font-semibold transition-colors ${
                  theme === t && !reviewMode ? 'bg-ink text-black' : 'bg-surface-2 text-ink hover:bg-surface-3'
                }`}
              >
                {t ? THEME_LABELS[t] : 'Any'}
              </button>
            ))}
          </div>
          <button
            disabled={!reviewsDue || reviewMode}
            onClick={() => setReviewMode(true)}
            className="btn-ghost"
          >
            {reviewMode ? 'Reviewing…' : reviewsDue ? `${reviewsDue} review${reviewsDue === 1 ? '' : 's'} due` : 'No reviews due'}
          </button>
        </div>
      </aside>
    </div>
  );
}
