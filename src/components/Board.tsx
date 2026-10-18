import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { sound } from '../lib/sound';

export interface BoardProps {
  fen: string;
  orientation: 'white' | 'black';
  turnColor: 'white' | 'black';
  movableColor?: 'white' | 'black' | 'both';
  dests: Map<Key, Key[]>;
  lastMove?: [Key, Key];
  check?: boolean;
  viewOnly?: boolean;
  /** square -> CSS class, e.g. flash-good / flash-bad */
  highlights?: Map<Key, string>;
  shapes?: DrawShape[];
  onMove?: (from: Key, to: Key) => void;
  onSelect?: (key: Key) => void;
}

export function Board(p: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMove = useRef(p.onMove);
  onMove.current = p.onMove;
  const onSelect = useRef(p.onSelect);
  onSelect.current = p.onSelect;

  const config = (): Config => ({
    fen: p.fen,
    orientation: p.orientation,
    turnColor: p.turnColor,
    lastMove: p.lastMove,
    check: p.check,
    // Never set chessground's viewOnly: it only binds input if false at creation.
    coordinates: true,
    trustAllEvents: import.meta.env.DEV, // lets scripted events drive the board in dev

    animation: { enabled: true, duration: 180 },
    highlight: { lastMove: true, check: true, custom: p.highlights ?? new Map() },
    premovable: { enabled: false },
    events: { select: (key) => onSelect.current?.(key) },
    movable: {
      free: false,
      color: p.viewOnly ? undefined : p.movableColor,
      dests: p.dests,
      showDests: true,
      events: { after: (from, to) => onMove.current?.(from, to) },
    },
  });

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, config());
    return () => api.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const cfg = config();
    // Setting a fen wipes the user's right-click arrows, and this runs on every render (the game
    // clock re-renders 10x a second). Only send it when the board really differs: a new position,
    // or a rejected move that has to snap back.
    if (a.getFen() === p.fen.split(' ')[0]) delete cfg.fen;
    a.set(cfg);
    // set() deep-merges and skips Map contents, so assign custom highlights directly.
    a.state.highlight.custom = p.highlights ?? new Map();
    a.state.dom.redraw();
    a.setAutoShapes(p.shapes ?? []);
  });

  // Move/capture sounds: fire when a new last move lands; capture = fewer pieces than before.
  const prev = useRef<{ fen: string; move?: string }>({ fen: p.fen, move: p.lastMove?.join('') });
  useEffect(() => {
    const move = p.lastMove?.join('');
    const before = prev.current;
    prev.current = { fen: p.fen, move };
    if (!move || move === before.move || p.fen === before.fen) return;
    const count = (f: string) => f.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
    if (count(p.fen) < count(before.fen)) sound.capture();
    else sound.move();
  }, [p.fen, p.lastMove]);

  return (
    <div className="board-wrap">
      <div ref={el} />
    </div>
  );
}
