import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';

export interface BrowseView {
  fen: string;
  lastMove?: [Key, Key];
  check: boolean;
  turnColor: 'white' | 'black';
}

/**
 * Step back and forward through the moves played so far, like the arrows under a chess.com board.
 * `view` is null at the live position; otherwise the board should show it read-only.
 * Any new move (liveFen changes) jumps back to live.
 */
export function useBrowse(game: Chess, liveFen: string) {
  const [pick, setPick] = useState<{ ply: number; at: string } | null>(null);
  // liveFen is the change signal: the game object is mutated in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const moves = useMemo(() => game.history({ verbose: true }), [game, liveFen]);
  const total = moves.length;
  const ply = pick && pick.at === liveFen ? Math.min(pick.ply, total) : total;
  const go = (n: number) => setPick({ ply: Math.max(0, Math.min(total, n)), at: liveFen });

  let view: BrowseView | null = null;
  if (ply < total) {
    const fen = ply === 0 ? moves[0].before : moves[ply - 1].after;
    const m = ply > 0 ? moves[ply - 1] : undefined;
    view = {
      fen,
      lastMove: m ? [m.from as Key, m.to as Key] : undefined,
      check: new Chess(fen).inCheck(),
      turnColor: fen.split(' ')[1] === 'w' ? 'white' : 'black',
    };
  }
  return { ply, total, view, go };
}

type Browse = ReturnType<typeof useBrowse>;

const BTN = 'flex h-10 flex-1 items-center justify-center bg-surface-2 text-ink disabled:text-ink-2 disabled:opacity-40';

/** ⏮ ◀ ▶ ⏭ under the board. Arrow keys step, Home/End jump. */
export function MoveNav({ b }: { b: Browse }) {
  const { ply, total, go } = b;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') go(ply - 1);
      else if (e.key === 'ArrowRight') go(ply + 1);
      else if (e.key === 'Home' || e.key === 'ArrowUp') go(0);
      else if (e.key === 'End' || e.key === 'ArrowDown') go(total);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="flex gap-[2px]" role="group" aria-label="Move through the game">
      <button className={BTN} disabled={ply === 0} onClick={() => go(0)} aria-label="First move">
        {'⏮︎'}
      </button>
      <button className={BTN} disabled={ply === 0} onClick={() => go(ply - 1)} aria-label="Back one move">
        {'◀︎'}
      </button>
      <button className={BTN} disabled={ply >= total} onClick={() => go(ply + 1)} aria-label="Forward one move">
        {'▶︎'}
      </button>
      <button className={BTN} disabled={ply >= total} onClick={() => go(total)} aria-label="Back to the current position">
        {'⏭︎'}
      </button>
    </div>
  );
}
