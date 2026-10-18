import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { Board } from '../components/Board';
import { WatchFirst, OPENING_VIDEOS } from '../components/WatchFirst';
import { rise } from '../components/ui';
import { toDests, turnColor } from '../lib/chess';
import { sound } from '../lib/sound';
import { REPERTOIRES, ADVANCED_RATING, findRepertoire, acceptLineMove, type OpeningLine, type Side } from '../lib/openings';
import { usePuzzles } from '../store/puzzles';
import { useOpenings, dueLines, type DueLine } from '../store/openings';

const NO_DESTS = new Map<Key, Key[]>();
const START = new Chess().fen();

export function Openings() {
  const state = useOpenings();
  const rating = usePuzzles((s) => s.rating);
  const { white, black, choose, grade } = state;
  const due = dueLines(state);
  const [queue, setQueue] = useState<DueLine[] | null>(null);
  const [pos, setPos] = useState(0);
  const [last, setLast] = useState<{ perfect: boolean; mistakes: number } | null>(null);

  const start = (all: boolean) => {
    const q = dueLines(useOpenings.getState(), all);
    setQueue(q);
    setPos(0);
    setLast(null);
  };

  const current = queue?.[pos];
  const rep = current ? findRepertoire(current.side, current.repId) : undefined;

  return (
    <div className="mx-auto grid w-full max-w-[1240px] gap-12 px-4 pb-20 pt-6 [&>*]:min-w-0 md:grid-cols-12 md:px-8 md:pt-12">
      <div className="md:col-span-5">
        <motion.h1 {...rise(0)} className="display-xl">
          Openings
        </motion.h1>
        <motion.p {...rise(1)} className="mt-6 max-w-[34ch] text-xl leading-relaxed">
          One opening with White, one with Black. You drill the first moves of the main line and two common replies, nothing deeper.
        </motion.p>

        {(['white', 'black'] as Side[]).map((side, k) => (
          <motion.section key={side} {...rise(2 + k)} className="mt-10">
            <h2 className="text-[17px] font-semibold">With {side === 'white' ? 'White' : 'Black'}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {REPERTOIRES[side].map((r) => {
                const on = (side === 'white' ? white : black) === r.id;
                const locked = r.advanced && rating < ADVANCED_RATING;
                return (
                  <button
                    key={r.id}
                    onClick={() => choose(side, r.id)}
                    disabled={locked}
                    aria-pressed={on}
                    title={locked ? `Opens at ${ADVANCED_RATING} puzzle rating` : undefined}
                    className={`px-4 py-2.5 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'bg-ink text-black' : 'bg-surface-2 enabled:hover:bg-surface-3'}`}
                  >
                    {r.name}
                    {locked && <span className="ml-1.5 text-sm font-medium">at {ADVANCED_RATING}</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-3">
              <WatchFirst video={OPENING_VIDEOS[side]} />
            </div>
          </motion.section>
        ))}
      </div>

      <div className="md:col-span-7">
        {!white && !black ? (
          <div className="flex flex-col gap-4">
            <div className="opacity-60">
              <Board fen={START} orientation="white" turnColor="white" dests={NO_DESTS} viewOnly />
            </div>
            <p className="text-[17px]">Pick an opening for each color to start drilling.</p>
          </div>
        ) : current && rep ? (
          <Drill
            key={`${current.key}-${pos}`}
            line={rep.lines[current.index]}
            side={current.side}
            label={`${rep.name}${current.index === 0 ? ', main line' : ''}`}
            learn={!current.card || current.card.stage < 0}
            progress={`${pos + 1} of ${queue!.length}`}
            onDone={(perfect, mistakes) => {
              grade(current.key, perfect);
              setLast({ perfect, mistakes });
            }}
            next={
              last
                ? () => {
                    setLast(null);
                    if (pos + 1 < queue!.length) setPos(pos + 1);
                    else setQueue(null);
                  }
                : undefined
            }
            result={last}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <div className="opacity-60">
              <Board fen={START} orientation={white ? 'white' : 'black'} turnColor="white" dests={NO_DESTS} viewOnly />
            </div>
            <p className="display-m">{due.length ? `${due.length} line${due.length === 1 ? '' : 's'} to drill today.` : 'Nothing due today.'}</p>
            <div className="flex flex-wrap items-center gap-4">
              {due.length > 0 && (
                <button onClick={() => start(false)} className="btn-primary">
                  Drill {due.length} line{due.length === 1 ? '' : 's'}
                </button>
              )}
              <button onClick={() => start(true)} className={due.length ? 'link text-[17px]' : 'btn-ghost'}>
                Drill every line anyway
              </button>
            </div>
            <p className="text-[15px] text-ink-2">Perfect lines come back after 1, 3, 7 and 14 days. A mistake brings a line back tomorrow.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Drill({
  line,
  side,
  label,
  learn,
  progress,
  onDone,
  next,
  result,
}: {
  line: OpeningLine;
  side: Side;
  label: string;
  learn: boolean;
  progress: string;
  onDone: (perfect: boolean, mistakes: number) => void;
  next?: () => void;
  result: { perfect: boolean; mistakes: number } | null;
}) {
  const [game, setGame] = useState(() => new Chess());
  const [ply, setPly] = useState(0);
  // The line being followed; a transposition reorders your moves within it.
  const [seq, setSeq] = useState(line.san);
  const [last, setLast] = useState<[Key, Key]>();
  const [hint, setHint] = useState(learn);
  const [hl, setHl] = useState<Map<Key, string>>(new Map());
  const [, setTick] = useState(0);
  const mistakes = useRef(0);
  const alive = useRef(true);
  const userTurn = (p: number) => (p % 2 === 0) === (side === 'white');
  const done = ply >= seq.length;

  useEffect(() => {
    alive.current = true; // StrictMode re-runs effects; re-arm after the dev-only cleanup
    return () => {
      alive.current = false;
    };
  }, []);

  // Opponent's moves play themselves.
  useEffect(() => {
    if (done || userTurn(ply)) return;
    const t = setTimeout(() => {
      if (!alive.current) return;
      const g = new Chess(game.fen());
      const m = g.move(seq[ply]);
      setGame(g);
      setLast([m.from as Key, m.to as Key]);
      setPly(ply + 1);
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ply, done]);

  useEffect(() => {
    if (done && !result) {
      if (mistakes.current === 0) sound.correct();
      onDone(mistakes.current === 0, mistakes.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const expected = !done && userTurn(ply) ? new Chess(game.fen()).move(seq[ply]) : null;

  const onMove = (from: Key, to: Key) => {
    if (!expected) return;
    const accepted = acceptLineMove(seq, ply, game.fen(), from + to);
    if (accepted) {
      const g = new Chess(game.fen());
      g.move(accepted[ply]);
      setSeq(accepted);
      setGame(g);
      setLast([from, to]);
      setPly(ply + 1);
      setHint(learn);
    } else {
      mistakes.current++;
      sound.wrong();
      setHl(new Map([[to, 'flash-bad']]));
      setTimeout(() => alive.current && setHl(new Map()), 650);
      setHint(true); // show the right move after a miss
      setTick((t) => t + 1);
    }
  };

  const shapes: DrawShape[] = expected && hint ? [{ orig: expected.from as Key, dest: expected.to as Key, brush: 'green' }] : [];
  const moveNo = Math.floor(ply / 2) + 1;

  return (
    <div className="flex flex-col gap-5">
      <Board
        fen={game.fen()}
        orientation={side}
        turnColor={turnColor(game)}
        movableColor={side}
        dests={expected ? toDests(game) : NO_DESTS}
        lastMove={last}
        highlights={hl}
        shapes={shapes}
        onMove={onMove}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="display-m">{label}</p>
        <span className="text-[15px] text-ink-2">Line {progress}</span>
      </div>
      <p className="text-[15px] text-ink-2">{line.name}</p>
      <p className="text-[17px] leading-relaxed">
        {seq.slice(0, ply).map((m, i) => (
          <span key={i}>
            {i % 2 === 0 && <span className="text-ink-2">{i / 2 + 1}. </span>}
            {m}{' '}
          </span>
        ))}
        {!done && <span className="text-accent">{userTurn(ply) ? (learn ? 'Play the arrow.' : `Your move ${moveNo}.`) : '…'}</span>}
      </p>
      {result && (
        <div className="flex flex-wrap items-center gap-4 bg-surface-2 px-5 py-4">
          <span className={`flex-1 text-[17px] font-semibold ${result.perfect ? 'text-up' : 'text-down'}`}>
            {result.perfect ? 'Perfect. See you in a few days.' : `${result.mistakes} mistake${result.mistakes === 1 ? '' : 's'}. This line comes back tomorrow.`}
          </span>
          {next && (
            <button onClick={next} className="btn-primary">
              Next
            </button>
          )}
        </div>
      )}
    </div>
  );
}
