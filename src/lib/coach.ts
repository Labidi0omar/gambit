// Coach checks for a beginner's first game: what can be taken for free, and what a move would hang.
import { Chess, type Square, type Color } from 'chess.js';

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
export const PIECE_NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export interface Threat {
  square: Square;
  piece: string;
  /** an enemy capture that wins it */
  by: { from: Square; piece: string };
}

/**
 * Pieces of `color` the opponent could win right now: attacked and undefended, or attacked by
 * something worth less. (Ignores the king; checks are their own lesson.)
 */
export function hangingPieces(fen: string, color: Color): Threat[] {
  const parts = fen.split(' ');
  parts[1] = color === 'w' ? 'b' : 'w'; // look from the opponent's side
  parts[3] = '-';
  let c: Chess;
  try {
    c = new Chess(parts.join(' '), { skipValidation: true });
  } catch {
    return [];
  }
  const out: Threat[] = [];
  const seen = new Set<string>();
  for (const m of c.moves({ verbose: true })) {
    if (!m.captured || m.captured === 'k' || seen.has(m.to)) continue;
    const defended = c.isAttacked(m.to as Square, color);
    if (!defended || VALUE[m.piece] < VALUE[m.captured]) {
      seen.add(m.to);
      out.push({ square: m.to as Square, piece: m.captured, by: { from: m.from as Square, piece: m.piece } });
    }
  }
  return out.sort((a, b) => VALUE[b.piece] - VALUE[a.piece]);
}

/** What playing `uci` would hang (pieces the opponent could then win), plus whether it allows mate in one. */
export function moveWarnings(fen: string, uci: string): { hangs: Threat[]; allowsMate: string | null } {
  const c = new Chess(fen);
  const me = c.turn();
  const before = new Set(hangingPieces(fen, me).map((t) => t.square));
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  const hangs = hangingPieces(c.fen(), me).filter((t) => !before.has(t.square) || t.square === uci.slice(2, 4));
  let allowsMate: string | null = null;
  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    const mate = c.isCheckmate();
    c.undo();
    if (mate) {
      allowsMate = m.san;
      break;
    }
  }
  return { hangs, allowsMate };
}
