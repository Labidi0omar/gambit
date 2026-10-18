import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chess, type Move } from 'chess.js';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { AnimatePresence, motion } from 'framer-motion';
import { Board } from '../components/Board';
import { toDests, turnColor, isPromotion } from '../lib/chess';
import {
  sanEq,
  parsePlacement,
  toPlacementFen,
  collectDests,
  collectMove,
  targetsLeft,
  DEMOS,
  type Lesson,
  type Step,
} from '../lib/lessons';
import { getEngine, FULL_STRENGTH } from '../engine/stockfish';
import { sound } from '../lib/sound';
import { Seal, PieceArt, type Role } from '../components/ui';
import { PuzzleRunner, type RunnerState } from '../components/PuzzleRunner';
import { pickPuzzle, type Puzzle } from '../lib/puzzles';
import { usePuzzles } from '../store/puzzles';
import { useRatingStatus } from '../lib/rating';
import { useDaily } from '../store/daily';
import { WatchFirst, LESSON_VIDEOS } from '../components/WatchFirst';

type Solved = (explain?: string) => void;
type Feedback = { tone: 'good' | 'bad'; text: string } | null;

const NO_DESTS = new Map<Key, Key[]>();
const colorOf = (fen: string) => (fen.split(' ')[1] === 'b' ? 'black' : 'white');

function useFlash() {
  const [hl, setHl] = useState<Map<Key, string>>(new Map());
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = (k: Key, cls: 'flash-good' | 'flash-bad') => {
    clearTimeout(t.current);
    setHl(new Map([[k, cls]]));
    t.current = setTimeout(() => setHl(new Map()), 650);
  };
  useEffect(() => () => clearTimeout(t.current), []);
  return { hl, flash };
}

/** Try a user move in chess.js; picks the promotion piece from `want` SAN if given, else queen. */
function tryMove(chess: Chess, from: Key, to: Key, want?: string): Move | null {
  const promo = isPromotion(chess, from, to) ? (want?.match(/=([QRBN])/)?.[1]?.toLowerCase() ?? 'q') : undefined;
  try {
    return chess.move({ from, to, promotion: promo });
  } catch {
    return null;
  }
}

function Shell({ text, board, children }: { text: string; board?: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_340px] md:gap-6">
      <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-12rem))]">
        {board ?? (
          <div className="board-wrap glass flex items-center justify-center text-7xl text-zinc-600">{'♞'}</div>
        )}
      </div>
      <div className="flex flex-col gap-6 self-start md:pt-1">
        <p className="font-display text-[26px] font-medium leading-[1.2] md:text-[30px]">{text}</p>
        {children}
      </div>
    </div>
  );
}

interface StepProps<T extends Step['type']> {
  step: Extract<Step, { type: T }>;
  onSolved: Solved;
  setFeedback: (f: Feedback) => void;
}

// ---------- step views ----------

function CollectStep({ step, onSolved, setFeedback }: StepProps<'collect'>) {
  const [pos, setPos] = useState(() => parsePlacement(step.fen));
  const [moves, setMoves] = useState(0);
  const [last, setLast] = useState<[Key, Key]>();
  const { hl, flash } = useFlash();
  const left = targetsLeft(pos);
  const dests = useMemo(() => (left === 0 ? NO_DESTS : (collectDests(pos) as unknown as Map<Key, Key[]>)), [pos, left]);

  const onMove = (from: Key, to: Key) => {
    const captured = pos.has(to);
    const next = collectMove(pos, from, to);
    const n = moves + 1;
    setPos(next);
    setMoves(n);
    setLast([from, to]);
    if (captured) flash(to, 'flash-good');
    if (targetsLeft(next) === 0) {
      const par = step.maxMoves;
      onSolved(
        par
          ? n <= par
            ? `Perfect: ${n} moves (par ${par}). ${step.explain ?? ''}`
            : `Done in ${n} moves. Par is ${par}; try for it next time.`
          : step.explain,
      );
    }
  };

  const reset = () => {
    setPos(parsePlacement(step.fen));
    setMoves(0);
    setLast(undefined);
    setFeedback(null);
  };

  return (
    <Shell
      text={step.text}
      board={
        <Board
          fen={toPlacementFen(pos)}
          orientation="white"
          turnColor="white"
          movableColor="white"
          dests={dests}
          lastMove={last}
          highlights={hl}
          onMove={onMove}
        />
      }
    >
      <div className="flex items-center justify-between text-sm text-zinc-400">
        <span>
          Moves <span className="num text-zinc-200">{moves}</span>
          {step.maxMoves ? ` / par ${step.maxMoves}` : ''} &middot; Left <span className="num text-zinc-200">{left}</span>
        </span>
        {left > 0 && moves > 0 && (
          <button onClick={reset} className="rounded-lg px-2 py-1 hover:bg-white/10">
            Reset
          </button>
        )}
      </div>
    </Shell>
  );
}

function MoveStep({ step, onSolved, setFeedback }: StepProps<'move'>) {
  const [game, setGame] = useState(() => new Chess(step.fen));
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [misses, setMisses] = useState(0);
  const [last, setLast] = useState<[Key, Key]>();
  const [, setTick] = useState(0);
  const { hl, flash } = useFlash();
  const user = colorOf(step.fen);

  const hint = useMemo<DrawShape[]>(() => {
    if (misses < 2 || done) return [];
    const m = new Chess(game.fen()).move(step.line[idx]);
    return [{ orig: m.from as Key, brush: 'yellow' }];
  }, [misses, idx, done, game, step.line]);

  const finish = () => {
    setDone(true);
    setFeedback(null);
    onSolved(step.explain);
  };

  const onMove = (from: Key, to: Key) => {
    const g = new Chess(game.fen());
    const mv = tryMove(g, from, to, step.line[idx]);
    if (!mv) return setTick((t) => t + 1);
    const expected = new Chess(game.fen()).move(step.line[idx]);
    const isLast = idx + 1 >= step.line.length;
    // On the final move, any capture of the same target counts (e.g. Qxd8 vs Nxd8).
    const sameCapture = isLast && !!expected.captured && mv.to === expected.to;
    const isAlt = idx === 0 && !!step.alts?.some((a) => sanEq(a, mv.san));
    const ok = sanEq(mv.san, step.line[idx]) || isAlt || sameCapture || (step.anyMate && g.isCheckmate());
    if (!ok) {
      flash(to, 'flash-bad');
      setMisses((m) => m + 1);
      setFeedback({ tone: 'bad', text: misses >= 1 ? 'Not that one. Hint: look at the highlighted piece.' : `${mv.san} isn't it. Try again.` });
      return setTick((t) => t + 1); // snap the piece back
    }
    setGame(g);
    setLast([from, to]);
    flash(to, 'flash-good');
    const next = idx + 1;
    if (isAlt || g.isCheckmate() || next >= step.line.length) return finish();

    setBusy(true);
    setFeedback({ tone: 'good', text: `${mv.san}! Keep going.` });
    setTimeout(() => {
      const r = new Chess(g.fen());
      const reply = r.move(step.line[next]);
      setGame(r);
      setLast([reply.from as Key, reply.to as Key]);
      setBusy(false);
      if (next + 1 >= step.line.length) finish();
      else setIdx(next + 1);
    }, 500);
  };

  return (
    <Shell
      text={step.text}
      board={
        <Board
          fen={game.fen()}
          orientation={user}
          turnColor={turnColor(game)}
          movableColor={user}
          dests={busy || done ? NO_DESTS : toDests(game)}
          lastMove={last}
          check={game.inCheck()}
          highlights={hl}
          shapes={hint}
          onMove={onMove}
        />
      }
    />
  );
}

function PlayStep({ step, onSolved, setFeedback }: StepProps<'play'>) {
  const [game, setGame] = useState(() => new Chess(step.fen));
  const [userMoves, setUserMoves] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [over, setOver] = useState<'won' | 'lost' | null>(null);
  const [last, setLast] = useState<[Key, Key]>();
  const [, setTick] = useState(0);
  const user = colorOf(step.fen);
  const us = user === 'white' ? 'w' : 'b';
  const them = us === 'w' ? 'b' : 'w';
  const gen = useRef(0);

  useEffect(() => {
    getEngine().setStrength({ elo: FULL_STRENGTH });
  }, []);

  const fail = (why: string) => {
    setOver('lost');
    setFeedback({ tone: 'bad', text: `${why} Press Retry.` });
  };

  const onMove = (from: Key, to: Key) => {
    const g = new Chess(game.fen());
    const mv = tryMove(g, from, to);
    if (!mv) return setTick((t) => t + 1);
    const n = userMoves + 1;
    setGame(g);
    setUserMoves(n);
    setLast([from, to]);
    setFeedback(null);

    if (step.goal === 'mate' && g.isCheckmate()) {
      setOver('won');
      return onSolved(`Mate in ${n} moves. ${step.explain}`);
    }
    if (step.goal === 'promote' && mv.promotion) {
      if (!g.isAttacked(mv.to, them) || g.isAttacked(mv.to, us)) {
        setOver('won');
        return onSolved(step.explain);
      }
      return fail('Promoted, but the new queen gets taken.');
    }
    if (g.isStalemate()) return fail('Stalemate! That throws away the win.');
    if (g.isDraw()) return fail('That position is a draw.');
    if (n >= step.maxMoves) return fail(`Out of moves (limit ${step.maxMoves}).`);

    const id = ++gen.current;
    setThinking(true);
    getEngine()
      .bestMove(g.fen(), { movetime: 350 })
      .then((uci) => {
        if (id !== gen.current) return;
        const r = new Chess(g.fen());
        const reply = r.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        setGame(r);
        setLast([reply.from as Key, reply.to as Key]);
        setThinking(false);
        if (step.goal === 'promote' && !r.board().flat().some((p) => p?.type === 'p' && p.color === us)) fail('Your pawn was captured.');
        else if (r.isDraw()) fail('That position is a draw.');
      });
  };

  const retry = () => {
    gen.current++;
    setGame(new Chess(step.fen));
    setUserMoves(0);
    setOver(null);
    setThinking(false);
    setLast(undefined);
    setFeedback(null);
  };

  return (
    <Shell
      text={step.text}
      board={
        <Board
          fen={game.fen()}
          orientation={user}
          turnColor={turnColor(game)}
          movableColor={user}
          dests={over || thinking || game.turn() !== us ? NO_DESTS : toDests(game)}
          lastMove={last}
          check={game.inCheck()}
          onMove={onMove}
        />
      }
    >
      <div className="flex items-center justify-between text-sm text-zinc-400">
        <span>
          Moves <span className="num text-zinc-200">{userMoves}</span> / {step.maxMoves}
          {thinking && ' · thinking…'}
        </span>
        {userMoves > 0 && over !== 'won' && (
          <button onClick={retry} className="rounded-lg px-2 py-1 hover:bg-white/10">
            Retry
          </button>
        )}
      </div>
    </Shell>
  );
}

function StepView(p: { step: Step; onSolved: Solved; setFeedback: (f: Feedback) => void }) {
  const { step } = p;
  switch (step.type) {
    case 'collect':
      return <CollectStep {...p} step={step} />;
    case 'move':
      return <MoveStep {...p} step={step} />;
    case 'play':
      return <PlayStep {...p} step={step} />;
  }
}

// ---------- explanation, demos, practice ----------

const LESSON_ART: Record<string, Role> = {
  'l0-rook': 'rook',
  'l0-bishop': 'bishop',
  'l0-queen': 'queen',
  'l0-knight': 'knight',
  'l0-pawn-king': 'pawn',
  'l2-kq-k': 'queen',
  'l2-kr-k': 'rook',
  'l2-opposition': 'king',
  'l2-kp-k': 'pawn',
};

function ExplainStage({ lesson, onSolved }: { lesson: Lesson; onSolved: Solved }) {
  useEffect(() => {
    onSolved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="grid gap-10 [&>*]:min-w-0 md:grid-cols-12">
      <div className="md:col-span-7">
        <p className="font-display text-[26px] font-medium leading-[1.25] md:text-[34px]">{lesson.explain}</p>
        {LESSON_VIDEOS[lesson.id] && (
          <div className="mt-8">
            <WatchFirst video={LESSON_VIDEOS[lesson.id]} />
          </div>
        )}
      </div>
      <div className="hidden items-start justify-center md:col-span-5 md:flex">
        <PieceArt role={LESSON_ART[lesson.id] ?? 'knight'} size={220} />
      </div>
    </div>
  );
}

function DemoStage({ puzzle, n, of, onSolved }: { puzzle: Puzzle; n: number; of: number; onSolved: Solved }) {
  const [reveal, setReveal] = useState(false);
  const [state, setState] = useState<RunnerState>('setup');
  const [missed, setMissed] = useState(0);
  const side = new Chess(puzzle.fen).turn() === 'w' ? 'Black' : 'White';
  const line = useMemo(() => {
    const c = new Chess(puzzle.fen);
    return puzzle.moves
      .split(' ')
      .map((u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san)
      .slice(1);
  }, [puzzle]);
  return (
    <Shell
      text={`Example ${n} of ${of}. ${side} to move. Find the move, or watch it.`}
      board={
        <PuzzleRunner
          puzzle={puzzle}
          reveal={reveal}
          onState={setState}
          onMiss={setMissed}
          onFinish={(ok) => onSolved(ok ? `Found it: ${line.filter((_, i) => i % 2 === 0).join(', ')}.` : `The line: ${line.join(' ')}.`)}
        />
      }
    >
      {state === 'user' && missed > 0 && <p className="text-[17px] text-down">Not that one. Try again.</p>}
      {state === 'user' && (
        <button onClick={() => setReveal(true)} className="btn-ghost self-start">
          Show me
        </button>
      )}
    </Shell>
  );
}

function PracticeStage({ lesson, onSolved }: { lesson: Lesson; onSolved: Solved }) {
  const practice = lesson.practice!;
  const { recordAttempt, recentIds } = usePuzzles();
  const logDay = useDaily((s) => s.log);
  const [puzzle, setPuzzle] = useState<Puzzle | null | undefined>(undefined);
  const [results, setResults] = useState<boolean[]>([]);
  const [current, setCurrent] = useState<'solving' | 'done'>('solving');
  const [missed, setMissed] = useState(0);
  const [reveal, setReveal] = useState(false);
  const used = useRef(new Set<string>((DEMOS[lesson.id] ?? []).map((d) => d.id)));
  const started = useRef(0);
  const established = useRatingStatus().established;

  const load = async () => {
    const p = await pickPuzzle(usePuzzles.getState().rating, {
      theme: practice.theme,
      exclude: new Set([...recentIds(), ...used.current]),
    }).catch(() => null);
    if (p) used.current.add(p.id);
    started.current = Date.now();
    setMissed(0);
    setReveal(false);
    setCurrent('solving');
    setPuzzle(p);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (puzzle === null && results.length)
    return (
      <Shell text={`That's every ${practice.label.toLowerCase()} puzzle at your level for now: ${results.filter(Boolean).length} of ${results.length} solved.`}>
        <button onClick={() => onSolved('Practice done.')} className="btn-primary self-start">
          Finish practice
        </button>
      </Shell>
    );

  if (puzzle === null)
    return (
      <Shell
        text={`Practice needs the puzzle database. Build it with npm run puzzles, then come back for ${practice.count} ${practice.label.toLowerCase()} puzzles.`}
      >
        <button onClick={() => onSolved('Lesson finished without practice.')} className="btn-ghost self-start">
          Finish without practice
        </button>
      </Shell>
    );

  const solved = results.filter(Boolean).length;
  const finished = results.length >= practice.count;
  return (
    <Shell
      text={
        finished
          ? `${solved} of ${practice.count} solved.`
          : `Practice ${Math.min(results.length + (current === 'solving' ? 1 : 0), practice.count)} of ${practice.count}: ${practice.label.toLowerCase()}, picked for your level. Only your first try counts.`
      }
      board={
        puzzle ? (
          <PuzzleRunner
            key={puzzle.id}
            puzzle={puzzle}
            reveal={reveal}
            onMiss={setMissed}
            onFinish={(ok) => {
              recordAttempt(puzzle, ok, false);
              logDay({ puzzles: 1, puzzleMs: Math.min(Date.now() - started.current, 3 * 60_000) });
              const r = [...results, ok];
              setResults(r);
              setCurrent('done');
              if (r.length >= practice.count)
                onSolved(`${r.filter(Boolean).length} of ${practice.count} solved. Missed ones come back in your reviews.`);
            }}
          />
        ) : undefined
      }
    >
      <div className="flex gap-1">
        {Array.from({ length: practice.count }, (_, k) => (
          <span key={k} className={`h-2 flex-1 ${k < results.length ? (results[k] ? 'bg-up' : 'bg-down') : 'bg-surface-2'}`} />
        ))}
      </div>
      {current === 'solving' && missed > 0 && (
        <>
          <p className="text-[17px] text-down">Not that one. Try again.</p>
          <button onClick={() => setReveal(true)} className="btn-ghost self-start">
            Show solution
          </button>
        </>
      )}
      {puzzle && established && <p className="text-[15px] text-ink-2">Difficulty {puzzle.rating}</p>}
      {current === 'done' && !finished && (
        <button onClick={load} className="btn-primary self-start">
          Next puzzle
        </button>
      )}
    </Shell>
  );
}

type Stage = { kind: 'explain' } | { kind: 'demo'; puzzle: Puzzle } | { kind: 'step'; step: Step } | { kind: 'practice' };

// ---------- player ----------

export function LessonPlayer({
  lesson,
  nextLesson,
  onExit,
  onDone,
  onNext,
  onPractice,
}: {
  lesson: Lesson;
  nextLesson?: Lesson;
  onExit: () => void;
  onDone: () => void;
  onNext: () => void;
  onPractice: () => void;
}) {
  const stages = useMemo<Stage[]>(() => {
    const demos = (DEMOS[lesson.id] ?? []).slice(0, 3);
    return [
      { kind: 'explain' },
      ...demos.map((puzzle) => ({ kind: 'demo' as const, puzzle })),
      ...(lesson.steps ?? []).map((step) => ({ kind: 'step' as const, step })),
      ...(lesson.practice ? [{ kind: 'practice' as const }] : []),
    ];
  }, [lesson]);
  const demoCount = stages.filter((s) => s.kind === 'demo').length;

  const [i, setI] = useState(0);
  const [solved, setSolved] = useState<{ explain?: string } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [finished, setFinished] = useState(false);
  const stage = stages[i];

  const advance = () => {
    if (i + 1 < stages.length) {
      setI(i + 1);
      setSolved(null);
      setFeedback(null);
    } else {
      setFinished(true);
      sound.complete();
      onDone();
    }
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && solved && !finished) advance();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const onSolved: Solved = (explain) => {
    if (stage.kind === 'step') sound.correct();
    setSolved({ explain });
  };
  const onFeedback = (f: Feedback) => {
    if (f?.tone === 'bad') sound.wrong();
    setFeedback(f);
  };

  const message = solved ? (stage.kind === 'explain' ? '' : solved.explain || 'Correct.') : feedback?.text;
  const tone = solved || feedback?.tone === 'good' ? 'text-up' : 'text-down';
  const key = `${lesson.id}-${i}`;
  const nextLabel =
    i + 1 >= stages.length ? 'Finish' : stage.kind === 'explain' ? (demoCount ? 'See examples' : 'Start') : stages[i + 1].kind === 'practice' ? 'Start practice' : 'Continue';

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-36 pt-6 md:px-8 md:pb-16 md:pt-10">
      <div className="mb-8 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0">
          <button onClick={onExit} className="link text-[15px] text-ink-2">
            Lessons
          </button>
          <h1 className="display-m mt-2">{lesson.title}</h1>
        </div>
        <div className="ml-auto flex w-full gap-1 sm:w-56">
          {stages.map((_, k) => (
            <div
              key={k}
              className={`h-1.5 flex-1 transition-colors ${
                k < i || finished || (k === i && solved) ? 'bg-accent' : k === i ? 'bg-surface-3' : 'bg-surface-2'
              }`}
            />
          ))}
        </div>
      </div>

      {stage.kind === 'explain' && <ExplainStage key={key} lesson={lesson} onSolved={onSolved} />}
      {stage.kind === 'demo' && <DemoStage key={key} puzzle={stage.puzzle} n={i} of={demoCount} onSolved={onSolved} />}
      {stage.kind === 'step' && <StepView key={key} step={stage.step} onSolved={onSolved} setFeedback={onFeedback} />}
      {stage.kind === 'practice' && <PracticeStage key={key} lesson={lesson} onSolved={onSolved} />}

      <AnimatePresence>
        {(solved || feedback) && !finished && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed inset-x-0 bottom-[60px] z-30 bg-surface-2 px-4 py-4 md:static md:mt-8 md:px-6"
          >
            <div className="mx-auto flex max-w-6xl items-center gap-4">
              <div className={`flex-1 text-[17px] font-medium ${tone}`}>{message}</div>
              {solved && (
                <button onClick={advance} autoFocus className="btn-primary">
                  {nextLabel}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {finished && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4">
            <motion.div initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} className="w-full max-w-md bg-surface-2 p-8">
              <Seal size={56} />
              <h2 className="display-m mt-6">Lesson complete.</h2>
              <p className="mt-2 text-[17px] text-ink-2">{lesson.title} is in the bag.</p>
              <div className="mt-8 flex flex-col gap-2">
                {lesson.practice && (
                  <button onClick={onPractice} className="btn-ghost">
                    More {lesson.practice.label.toLowerCase()} puzzles
                  </button>
                )}
                {nextLesson && (
                  <button onClick={onNext} className="btn-primary">
                    Next: {nextLesson.title}
                  </button>
                )}
                <button onClick={onExit} className="link mt-3 self-start text-[15px] text-ink-2">
                  Back to lessons
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
