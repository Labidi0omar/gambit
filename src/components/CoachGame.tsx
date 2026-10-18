// The first real game: a near-random bot, no clock, and a coach that warns before you give pieces away.
import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { Board } from './Board';
import { TaskLayout } from './StepTasks';
import { toDests, turnColor, isPromotion } from '../lib/chess';
import { hangingPieces, moveWarnings, PIECE_NAME } from '../lib/coach';
import { getEngine, FULL_STRENGTH } from '../engine/stockfish';

const NO_DESTS = new Map<Key, Key[]>();
const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Near-random bot: random legal moves, but it never walks past a free capture of a big piece. */
function botMove(c: Chess, rand = Math.random): string {
  const moves = c.moves({ verbose: true });
  const big = moves.filter((m) => m.captured && VAL[m.captured] >= 5);
  const pick = big.length && rand() < 0.5 ? big[0] : moves[Math.floor(rand() * moves.length)];
  return pick.from + pick.to + (pick.promotion ?? '');
}

export function CoachGame({ hint, onSuccess, onMistake }: { hint: number; onSuccess: (msg?: string) => void; onMistake: (why: string) => void }) {
  const [game, setGame] = useState(() => new Chess());
  const [last, setLast] = useState<[Key, Key]>();
  const [confirm, setConfirm] = useState<{ uci: string; text: string } | null>(null);
  const [over, setOver] = useState<'won' | 'other' | null>(null);
  const [best, setBest] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const myTurn = game.turn() === 'w' && !over;

  // The engine's suggestion feeds the hint ladder (levels 2-4).
  useEffect(() => {
    setBest(null);
    if (!myTurn) return;
    let live = true;
    (async () => {
      const e = getEngine();
      await e.setStrength({ elo: FULL_STRENGTH });
      const a = await e.analyze(game.fen(), 8);
      if (live) setBest(a.best);
    })();
    return () => {
      live = false;
    };
  }, [game, myTurn]);

  const finish = (g: Chess) => {
    if (!g.isGameOver()) return false;
    if (g.isCheckmate() && g.turn() === 'b') {
      setOver('won');
      onSuccess('Checkmate. You won your first game.');
    } else {
      setOver('other');
      onMistake(g.isCheckmate() ? 'The bot found a checkmate this time. Play again: you will get it.' : 'The game ended in a draw. Play again and look for checkmate.');
    }
    return true;
  };

  const play = (uci: string) => {
    const g = new Chess(game.fen());
    const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
    setGame(g);
    setLast([m.from as Key, m.to as Key]);
    if (finish(g)) return;
    setTimeout(() => {
      if (!alive.current) return;
      const b = new Chess(g.fen());
      const reply = botMove(b);
      const r = b.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
      setGame(b);
      setLast([r.from as Key, r.to as Key]);
      finish(b);
    }, 600);
  };

  const attempt = (uci: string) => {
    const w = moveWarnings(game.fen(), uci);
    if (w.allowsMate) return setConfirm({ uci, text: `Are you sure? After this, Black can checkmate you with ${w.allowsMate}.` });
    const h = w.hangs[0];
    if (h) return setConfirm({ uci, text: `Are you sure? After this, Black can take your ${PIECE_NAME[h.piece]} on ${h.square}.` });
    play(uci);
  };

  const onMove = (from: Key, to: Key) => {
    if (!myTurn) return;
    if (isPromotion(game, from, to)) return attempt(from + to + 'q');
    attempt(from + to);
  };

  useEffect(() => {
    if (hint >= 4 && best && myTurn) play(best);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint, best]);

  const threats = myTurn ? hangingPieces(game.fen(), 'w') : [];
  const hl = new Map<Key, string>(threats.map((t) => [t.square as Key, 'soft']));
  if (best && hint >= 2 && myTurn) hl.set(best.slice(0, 2) as Key, 'hint');
  const shapes: DrawShape[] = best && hint >= 3 && myTurn ? [{ orig: best.slice(0, 2) as Key, dest: best.slice(2, 4) as Key, brush: 'green' }] : [];

  const restart = () => {
    setGame(new Chess());
    setLast(undefined);
    setOver(null);
    setTick((t) => t + 1);
  };

  return (
    <TaskLayout
      board={
        <div className="relative">
          <Board
            fen={game.fen()}
            orientation="white"
            turnColor={turnColor(game)}
            movableColor="white"
            dests={myTurn && !confirm ? toDests(game) : NO_DESTS}
            lastMove={last}
            check={game.inCheck()}
            highlights={hl}
            shapes={shapes}
            onMove={onMove}
          />
          {confirm && (
            <div className="absolute inset-x-3 bottom-3 z-10 flex flex-col gap-3 bg-surface-2 p-4">
              <p className="text-[17px] font-semibold">{confirm.text}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setConfirm(null);
                    setTick((t) => t + 1);
                  }}
                  className="btn-primary flex-1"
                >
                  Take it back
                </button>
                <button
                  onClick={() => {
                    const u = confirm.uci;
                    setConfirm(null);
                    play(u);
                  }}
                  className="btn-ghost flex-1"
                >
                  Play it anyway
                </button>
              </div>
            </div>
          )}
        </div>
      }
    >
      <p className="text-[17px]">
        {over === 'other' ? (
          <button onClick={restart} className="btn-primary">
            Play again
          </button>
        ) : !myTurn ? (
          <span className="text-ink-2">The bot is thinking…</span>
        ) : threats.length ? (
          <span>
            Coach: your {PIECE_NAME[threats[0].piece]} on {threats[0].square} can be taken. Move it or protect it.
          </span>
        ) : game.inCheck() ? (
          <span>Coach: you are in check. Move, block or capture.</span>
        ) : (
          <span className="text-ink-2">Coach: your pieces are safe. Your move.</span>
        )}
      </p>
    </TaskLayout>
  );
}
