import type { Chess, Square } from 'chess.js';
import type { Key } from 'chessground/types';

export function toDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) {
    const arr = dests.get(m.from as Key) ?? [];
    arr.push(m.to as Key);
    dests.set(m.from as Key, arr);
  }
  return dests;
}

export function turnColor(chess: Chess): 'white' | 'black' {
  return chess.turn() === 'w' ? 'white' : 'black';
}

export function isPromotion(chess: Chess, from: Key, to: Key) {
  const piece = chess.get(from as Square);
  return piece?.type === 'p' && (to[1] === '8' || to[1] === '1');
}
