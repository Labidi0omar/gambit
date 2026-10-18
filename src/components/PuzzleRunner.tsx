import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { Board } from './Board';
import { toDests, turnColor, isPromotion } from '../lib/chess';
import { sound } from '../lib/sound';
import type { Puzzle } from '../lib/puzzles';

const NO_DESTS = new Map<Key, Key[]>();
const sq = (uci: string) => [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key] as const;

export type RunnerState = 'setup' | 'user' | 'reply' | 'solved' | 'failed' | 'showing';

/**
 * Plays one Lichess-format puzzle: the first move is the opponent's setup move, then the user must
 * find every solution move. On a miss it reports failure and walks through the solution with arrows.
 * `reveal` flips to true to show the solution without trying (used by lesson demos).
 */
export function PuzzleRunner({
  puzzle,
  onFinish,
  reveal = false,
  onState,
}: {
  puzzle: Puzzle;
  onFinish: (ok: boolean) => void;
  reveal?: boolean;
  onState?: (s: RunnerState) => void;
}) {
  const moves = puzzle.moves.split(' ');
  const [game, setGame] = useState(() => new Chess(puzzle.fen));
  const [idx, setIdx] = useState(0);
  const [state, setStateRaw] = useState<RunnerState>('setup');
  const [last, setLast] = useState<[Key, Key]>();
  const [hl, setHl] = useState<Map<Key, string>>(new Map());
  const [shapes, setShapes] = useState<DrawShape[]>([]);
  const [, setTick] = useState(0);
  const alive = useRef(true);
  const finished = useRef(false);
  const user = new Chess(puzzle.fen).turn() === 'w' ? 'black' : 'white';

  const setState = (s: RunnerState) => {
    setStateRaw(s);
    onState?.(s);
  };

  const play = (g: Chess, uci: string) => {
    const n = new Chess(g.fen());
    const [from, to] = sq(uci);
    n.move({ from, to, promotion: uci[4] });
    setGame(n);
    setLast([from, to]);
    return n;
  };

  const flash = (k: Key, cls: string) => {
    setHl(new Map([[k, cls]]));
    setTimeout(() => alive.current && setHl(new Map()), 650);
  };

  const finish = (ok: boolean) => {
    if (finished.current) return;
    finished.current = true;
    onFinish(ok);
  };

  // Walk through the rest of the solution with arrows.
  const showFrom = (g: Chess, from: number) => {
    setState('showing');
    let cur = g;
    moves.slice(from).forEach((uci, k) => {
      setTimeout(() => {
        if (!alive.current) return;
        setShapes([{ orig: sq(uci)[0], dest: sq(uci)[1], brush: 'green' }]);
        cur = play(cur, uci);
        if (from + k === moves.length - 1) setState('failed');
      }, 500 + k * 900);
    });
  };

  useEffect(() => {
    alive.current = true;
    const t = setTimeout(() => {
      if (!alive.current) return;
      play(game, moves[0]);
      setIdx(1);
      setState('user');
    }, 600);
    return () => {
      alive.current = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (reveal && state === 'user') {
      finish(false);
      showFrom(game, idx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal, state]);

  const onMove = (from: Key, to: Key) => {
    if (state !== 'user') return;
    const expected = moves[idx];
    const promo = isPromotion(game, from, to) ? (expected?.startsWith(from + to) ? expected[4] : 'q') : '';
    const uci = from + to + (promo ?? '');
    const probe = new Chess(game.fen());
    try {
      probe.move({ from, to, promotion: promo || undefined });
    } catch {
      return setTick((t) => t + 1);
    }
    // Any mating move also solves it (some puzzles have more than one mate).
    if (uci === expected || probe.isCheckmate()) {
      const g = play(game, uci);
      flash(to, 'flash-good');
      if (probe.isCheckmate() || idx + 1 >= moves.length) {
        setState('solved');
        sound.correct();
        return finish(true);
      }
      setState('reply');
      setTimeout(() => {
        if (!alive.current) return;
        play(g, moves[idx + 1]);
        setIdx(idx + 2);
        setState('user');
      }, 450);
    } else {
      flash(to, 'flash-bad');
      sound.wrong();
      setTick((t) => t + 1);
      finish(false);
      setTimeout(() => alive.current && showFrom(game, idx), 500);
    }
  };

  return (
    <Board
      fen={game.fen()}
      orientation={user}
      turnColor={turnColor(game)}
      movableColor={user}
      dests={state === 'user' ? toDests(game) : NO_DESTS}
      lastMove={last}
      check={game.inCheck()}
      highlights={hl}
      shapes={shapes}
      onMove={onMove}
    />
  );
}
