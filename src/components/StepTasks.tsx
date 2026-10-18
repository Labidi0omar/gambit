// The task views used by the First Steps player. Each one takes the current hint level and
// auto-solves at level 4 ("play it and explain") without counting it against you.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { Board } from './Board';
import { toDests, turnColor, isPromotion } from '../lib/chess';
import { parsePlacement, toPlacementFen, collectDests, applyCollect, goalsLeft, solveCollect, type CollectState } from '../lib/collect';
import { protectedSquares, choiceTruth, moveAccepted, moveWhy, type Task } from '../lib/firststeps';

export interface TaskProps<T extends Task['type']> {
  task: Extract<Task, { type: T }>;
  hint: number;
  onSuccess: (msg?: string) => void;
  onMistake: (why: string) => void;
}

const NO_DESTS = new Map<Key, Key[]>();
const EMPTY = '8/8/8/8/8/8/8/8 w - - 0 1';
const arrow = (from: string, to: string, brush = 'green'): DrawShape => ({ orig: from as Key, dest: to as Key, brush });
const sideOf = (fen: string) => (fen.split(' ')[1] === 'b' ? 'black' : 'white');

/** Plays a timed sequence once (examples and level-4 hints). */
function useAutoPlay(run: boolean, steps: (() => void)[], gap: number, done: () => void) {
  const started = useRef(false);
  useEffect(() => {
    if (!run || started.current) return;
    started.current = true;
    const timers = steps.map((f, i) => setTimeout(f, 700 + i * gap));
    timers.push(setTimeout(done, 700 + steps.length * gap));
    return () => {
      timers.forEach(clearTimeout);
      started.current = false; // StrictMode re-runs effects in dev: let the re-run schedule again
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
}

// ---------- show: a worked example in frames ----------

export function ShowTask({ task, onSuccess }: TaskProps<'show'>) {
  const [i, setI] = useState(0);
  const f = task.frames[i];
  const last = i === task.frames.length - 1;
  useEffect(() => {
    if (last) {
      const t = setTimeout(() => onSuccess(), 900);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setI(i + 1), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);
  return (
    <TaskLayout
      board={
        <Board
          fen={f.fen}
          orientation="white"
          turnColor="white"
          dests={NO_DESTS}
          viewOnly
          highlights={new Map((f.squares ?? []).map((s) => [s as Key, 'mark']))}
          shapes={(f.arrows ?? []).map((a) => arrow(a.slice(0, 2), a.slice(2, 4)))}
        />
      }
    >
      <p className="text-[19px] leading-relaxed">{f.caption}</p>
      <div className="flex gap-1.5">
        {task.frames.map((_, k) => (
          <span key={k} className={`h-1.5 w-8 ${k <= i ? 'bg-accent' : 'bg-surface-3'}`} />
        ))}
      </div>
    </TaskLayout>
  );
}

// ---------- tap: name the squares ----------

export function TapTask({ task, hint, onSuccess, onMistake }: TaskProps<'tap'>) {
  const [n, setN] = useState(0);
  const [wrong, setWrong] = useState<string | null>(null);
  const target = task.targets[n];
  const done = n >= task.targets.length;

  useEffect(() => {
    if (hint >= 4 && !done) {
      setN(task.targets.length);
      onSuccess(`${task.targets.join(', ')}: file letter first, then rank number.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint]);

  const onSelect = (k: Key) => {
    if (done) return;
    if (k === target) {
      setWrong(null);
      if (n + 1 >= task.targets.length) onSuccess();
      setN(n + 1);
    } else {
      setWrong(k);
      onMistake(`Not quite: that's ${k}. You want file ${target[0]}, rank ${target[1]}.`);
    }
  };

  const hl = new Map<Key, string>(task.targets.slice(0, n).map((s) => [s as Key, 'found']));
  if (!done && hint >= 2) for (let r = 1; r <= 8; r++) if (!hl.has(`${target[0]}${r}` as Key)) hl.set(`${target[0]}${r}` as Key, 'mark');
  if (!done && hint >= 3) hl.set(target as Key, 'hint');
  if (wrong) hl.set(wrong as Key, 'soft');

  return (
    <TaskLayout board={<Board fen={EMPTY} orientation="white" turnColor="white" dests={NO_DESTS} viewOnly highlights={hl} onSelect={onSelect} />}>
      {task.targets.length > 1 && (
        <p className="text-[17px]">
          {task.targets.map((t, i) => (
            <span key={t} className={`mr-3 font-semibold ${i < n ? 'text-up' : i === n ? 'text-accent' : 'text-ink-2'}`}>
              {t}
            </span>
          ))}
        </p>
      )}
    </TaskLayout>
  );
}

// ---------- stars / collect: move pieces onto every target ----------

export function CollectTask({ task, hint, onSuccess }: TaskProps<'stars'> | TaskProps<'collect'>) {
  const start = (): CollectState => ({ pos: parsePlacement(task.fen), stars: new Set(task.type === 'stars' ? task.stars : []) });
  const [s, setS] = useState<CollectState>(start);
  const [moves, setMoves] = useState(0);
  const [last, setLast] = useState<[Key, Key]>();
  const [auto, setAuto] = useState(task.phase === 'example');
  const left = goalsLeft(s);
  const path = useMemo(() => (left ? solveCollect(s) ?? [] : []), [s, left]);
  const par = task.par;

  const step = (cur: CollectState, from: string, to: string, n: number) => {
    const next = applyCollect(cur, from, to);
    setS(next);
    setMoves(n);
    setLast([from as Key, to as Key]);
    if (goalsLeft(next) === 0)
      onSuccess(
        task.phase === 'example'
          ? undefined
          : n <= par
            ? `${n} move${n === 1 ? '' : 's'}: the fewest possible.`
            : `Done in ${n}. It can be done in ${par}: try again any time.`,
      );
    return next;
  };

  // Examples and the level-4 hint play the shortest route.
  useEffect(() => {
    if (hint >= 4 && left) setAuto(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint]);
  const route = useMemo(() => (auto ? solveCollect(s) ?? [] : []), [auto]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = useRef(s);
  cur.current = s;
  useAutoPlay(
    auto && route.length > 0,
    route.map(([from, to], i) => () => (cur.current = step(cur.current, from, to, moves + i + 1))),
    1000,
    () => undefined,
  );

  const hl = new Map<Key, string>([...s.stars].map((x) => [x as Key, 'star']));
  if (!auto && path[0] && hint >= 2) hl.set(path[0][0] as Key, 'hint');
  const shapes = !auto && path[0] && hint >= 3 ? [arrow(path[0][0], path[0][1])] : [];

  return (
    <TaskLayout
      board={
        <Board
          fen={toPlacementFen(s.pos)}
          orientation="white"
          turnColor="white"
          movableColor="white"
          dests={auto || !left ? NO_DESTS : (collectDests(s.pos) as unknown as Map<Key, Key[]>)}
          lastMove={last}
          highlights={hl}
          shapes={shapes}
          onMove={(from, to) => step(s, from, to, moves + 1)}
        />
      }
    >
      {task.phase !== 'example' && (
        <div className="flex items-center justify-between text-[15px] text-ink-2">
          <span>
            Moves <span className="num text-lg text-ink">{moves}</span>
          </span>
          {moves > 0 && left > 0 && (
            <button
              onClick={() => {
                setS(start());
                setMoves(0);
                setLast(undefined);
              }}
              className="link"
            >
              Start over
            </button>
          )}
        </div>
      )}
    </TaskLayout>
  );
}

// ---------- pick: tap every protected piece ----------

export function PickTask({ task, hint, onSuccess, onMistake }: TaskProps<'pick'>) {
  const answer = useMemo(() => protectedSquares(task.fen), [task.fen]);
  const [found, setFound] = useState<string[]>([]);
  const [soft, setSoft] = useState<string | null>(null);
  const c = useMemo(() => new Chess(task.fen), [task.fen]);
  const rest = answer.filter((a) => !found.includes(a));

  useEffect(() => {
    if (hint >= 4 && rest.length) {
      setFound(answer);
      onSuccess(`Protected: ${answer.join(', ')}. Another of your pieces could capture back on each.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint]);

  const onSelect = (k: Key) => {
    const p = c.get(k as never);
    if (!p || p.color !== 'w' || p.type === 'k' || found.includes(k)) return;
    if (answer.includes(k)) {
      const f = [...found, k];
      setFound(f);
      setSoft(null);
      if (f.length === answer.length) onSuccess();
    } else {
      setSoft(k);
      onMistake(`Not quite. ${task.why}`);
    }
  };

  const hl = new Map<Key, string>(found.map((s) => [s as Key, 'found']));
  if (hint >= 3) rest.forEach((s) => hl.set(s as Key, 'hint'));
  if (soft) hl.set(soft as Key, 'soft');
  // Level 2: show who protects one of the remaining pieces.
  const shapes: DrawShape[] = [];
  if (hint >= 2 && rest[0]) {
    const by = c.attackers(rest[0] as never, 'w')[0];
    if (by) shapes.push(arrow(by, rest[0]));
  }

  return (
    <TaskLayout board={<Board fen={task.fen} orientation="white" turnColor="white" dests={NO_DESTS} viewOnly highlights={hl} shapes={shapes} onSelect={onSelect} />}>
      {answer.length > 1 && (
        <p className="text-[15px] text-ink-2">
          Found {found.length} of {answer.length}
        </p>
      )}
    </TaskLayout>
  );
}

// ---------- choice ----------

export function ChoiceTask({ task, hint, onSuccess, onMistake }: TaskProps<'choice'>) {
  const fens = task.fens ?? [task.fen!];
  const truth = useMemo(() => choiceTruth(task.rule, fens), [task]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tried, setTried] = useState<number[]>([]);
  const [done, setDone] = useState(false);

  const pick = (i: number) => {
    if (done) return;
    if (i === truth) {
      setDone(true);
      onSuccess(task.why);
    } else {
      setTried([...tried, i]);
      onMistake(`Not quite. ${task.why}`);
    }
  };

  useEffect(() => {
    if (hint >= 4 && !done) pick(truth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint]);

  const keys = new Map<Key, string>(hint >= 2 ? (task.keySquares ?? []).map((s) => [s as Key, 'hint']) : []);
  const hidden = hint >= 3 ? task.options.findIndex((_, i) => i !== truth && !tried.includes(i)) : -1;

  return (
    <TaskLayout
      board={
        fens.length > 1 ? (
          <div className="grid grid-cols-2 gap-3">
            {fens.map((f, i) => (
              <div key={f}>
                <Board fen={f} orientation="white" turnColor={sideOf(f)} dests={NO_DESTS} viewOnly check={new Chess(f).inCheck()} />
                <p className="mt-2 text-center text-[15px] text-ink-2">{task.options[i]}</p>
              </div>
            ))}
          </div>
        ) : (
          <Board fen={fens[0]} orientation="white" turnColor={sideOf(fens[0])} dests={NO_DESTS} viewOnly highlights={keys} check={new Chess(fens[0]).inCheck()} />
        )
      }
    >
      <div className="flex flex-wrap gap-2">
        {task.options.map((o, i) =>
          i === hidden ? null : (
            <button
              key={o}
              onClick={() => pick(i)}
              disabled={done || tried.includes(i)}
              className={`min-w-28 px-6 py-3.5 text-[17px] font-semibold transition-colors ${
                done && i === truth ? 'bg-up text-black' : tried.includes(i) ? 'bg-surface-2 text-ink-2' : 'bg-surface-2 hover:bg-surface-3'
              }`}
            >
              {o}
            </button>
          ),
        )}
      </div>
    </TaskLayout>
  );
}

// ---------- move ----------

const PROMO = ['q', 'r', 'b', 'n'] as const;
const GLYPH: Record<string, string> = { q: '♛', r: '♜', b: '♝', n: '♞' };

export function MoveTask({ task, hint, onSuccess, onMistake }: TaskProps<'move'>) {
  const [fen, setFen] = useState(task.fen);
  const [last, setLast] = useState<[Key, Key]>();
  const [done, setDone] = useState(false);
  const [promo, setPromo] = useState<{ from: Key; to: Key } | null>(null);
  const [, setTick] = useState(0);
  const side = sideOf(task.fen);
  const want = useMemo(() => new Chess(task.fen).move(task.answer), [task]);

  const play = (uci: string, explain: boolean) => {
    const c = new Chess(task.fen);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || want.promotion || 'q' });
    setFen(c.fen());
    setLast([m.from as Key, m.to as Key]);
    setDone(true);
    onSuccess(explain || task.phase === 'example' ? task.why : undefined);
  };

  const tryMove = (uci: string) => {
    if (moveAccepted(task.fen, uci, task.accept, task.answer)) play(uci, false);
    else {
      onMistake(`Not quite. ${moveWhy(task.fen, uci, task.accept, task.why)}`);
      setTick((t) => t + 1); // snap the piece back
    }
  };

  const onMove = (from: Key, to: Key) => {
    if (isPromotion(new Chess(task.fen), from, to)) return setPromo({ from, to });
    tryMove(from + to);
  };

  const wantUci = want.from + want.to + (want.promotion ?? '');
  useAutoPlay(task.phase === 'example' || hint >= 4, [() => play(wantUci, true)], 0, () => undefined);

  const hl = new Map<Key, string>(!done && hint >= 2 ? [[want.from as Key, 'hint']] : []);
  const shapes = !done && hint >= 3 ? [arrow(want.from, want.to)] : [];
  const g = new Chess(fen);

  return (
    <TaskLayout
      board={
        <div className="relative">
          <Board
            fen={fen}
            orientation={side}
            turnColor={turnColor(g)}
            movableColor={side}
            dests={done || task.phase === 'example' ? NO_DESTS : toDests(g)}
            lastMove={last}
            check={g.inCheck()}
            highlights={hl}
            shapes={shapes}
            onMove={onMove}
          />
          {promo && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/75">
              <div className="flex flex-col items-center gap-3 bg-surface-2 p-5">
                <p className="text-[17px] font-semibold">Choose the new piece</p>
                <div className="flex gap-2">
                  {PROMO.map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setPromo(null);
                        tryMove(promo.from + promo.to + p);
                      }}
                      className="h-16 w-16 bg-surface-3 text-4xl hover:bg-accent hover:text-black"
                      aria-label={p}
                    >
                      {GLYPH[p]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      }
    />
  );
}

// ---------- layout ----------

export function TaskLayout({ board, children }: { board: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-16rem))]">{board}</div>
      {children}
    </div>
  );
}
