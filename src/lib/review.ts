import { Chess, type Square } from 'chess.js';
import { getEngine, FULL_STRENGTH, type Analysis } from '../engine/stockfish';
import type { Flag, GameAnalysis, GameRecord } from '../store/games';

export const REVIEW_DEPTH = 14;
const CLAMP = 1000; // evals beyond ±10 pawns are all "won"
export const BLUNDER = 200; // eval drop > 2 pawns
export const MISTAKE = 100; // eval drop > 1 pawn

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export interface Position {
  fen: string;
  /** UCI of the move that leads OUT of this position (undefined for the last). */
  uci?: string;
  san?: string;
}

/** Replays a game into positions 0..n. */
export function positions(g: Pick<GameRecord, 'startFen' | 'san'>): Position[] {
  const c = new Chess(g.startFen);
  const out: Position[] = [];
  for (const san of g.san) {
    const fen = c.fen();
    const m = c.move(san);
    out.push({ fen, uci: m.from + m.to + (m.promotion ?? ''), san: m.san });
  }
  out.push({ fen: c.fen() });
  return out;
}

/** White-POV score, mate encoded as ±(10000 - |mate|). */
export function whitePov(fen: string, a: Analysis): number {
  const side = fen.split(' ')[1] === 'w' ? 1 : -1;
  const s = a.mate !== null ? Math.sign(a.mate || -1) * (10000 - Math.abs(a.mate)) : (a.cp ?? 0);
  return side * s;
}

function terminalEval(fen: string): number | null {
  const c = new Chess(fen);
  if (c.isCheckmate()) return c.turn() === 'w' ? -10000 : 10000;
  if (c.isDraw() || c.isStalemate()) return 0;
  return null;
}

const clamp = (x: number) => Math.max(-CLAMP, Math.min(CLAMP, x));

/** Centipawns the mover lost by playing from position i to i+1. */
export function moveLoss(evals: number[], i: number, mover: 'w' | 'b') {
  const pov = mover === 'w' ? 1 : -1;
  return Math.max(0, clamp(pov * evals[i]) - clamp(pov * evals[i + 1]));
}

/** Pieces (value >= 3, or the king) that the piece on `sq` attacks, from `color`'s point of view. */
function bigTargets(fen: string, sq: string, color: 'w' | 'b'): number {
  const parts = fen.split(' ');
  parts[1] = color;
  parts[3] = '-';
  try {
    const c = new Chess(parts.join(' '), { skipValidation: true });
    const seen = new Set<string>();
    for (const m of c.moves({ square: sq as Square, verbose: true })) {
      if (m.captured && VALUE[m.captured] >= 3) seen.add(m.to);
    }
    // chess.js never generates king captures; count a check from this piece separately.
    const kingSq = c
      .board()
      .flat()
      .find((p) => p?.type === 'k' && p.color !== color)?.square;
    if (kingSq && c.attackers(kingSq as Square, color).includes(sq as Square)) seen.add(kingSq);
    return seen.size;
  } catch {
    return 0;
  }
}

/**
 * Names the tactic behind a bad move, as a Lichess puzzle theme:
 * what the best move would have done, or else what the played move allowed.
 */
export function classify(fenBefore: string, bestUci: string, bestMate: number | null, fenAfterPlayed: string, oppBestUci?: string): string | null {
  if (bestMate !== null && bestMate > 0) return bestMate <= 5 ? `mateIn${bestMate}` : 'mate';
  const me = fenBefore.split(' ')[1] as 'w' | 'b';
  const c = new Chess(fenBefore);
  try {
    const m = c.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] });
    const opp = me === 'w' ? 'b' : 'w';
    if (bigTargets(c.fen(), m.to, me) >= 2) return 'fork';
    if (m.captured && !c.isAttacked(m.to, opp)) return 'hangingPiece';
  } catch {
    /* ignore */
  }
  // The played move let the opponent win something for free.
  if (oppBestUci) {
    const a = new Chess(fenAfterPlayed);
    try {
      const r = a.move({ from: oppBestUci.slice(0, 2), to: oppBestUci.slice(2, 4), promotion: oppBestUci[4] });
      if (a.isCheckmate()) return 'mateIn1';
      if (r.captured && !a.isAttacked(r.to, me)) return 'hangingPiece';
      if (bigTargets(a.fen(), r.to, r.color) >= 2) return 'fork';
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Analyzes every position at REVIEW_DEPTH. Resolves null if cancelled. */
export async function analyzeGame(
  g: GameRecord,
  onProgress: (done: number, total: number) => void,
  cancelled: () => boolean,
): Promise<GameAnalysis | null> {
  const engine = getEngine();
  await engine.setStrength({ elo: FULL_STRENGTH });
  const pos = positions(g);
  const evals: number[] = [];
  const best: string[] = [];
  const mates: (number | null)[] = [];
  for (const [i, p] of pos.entries()) {
    if (cancelled()) return null;
    const t = terminalEval(p.fen);
    if (t !== null) {
      evals.push(t);
      best.push('');
      mates.push(null);
    } else {
      const a = await engine.analyze(p.fen, REVIEW_DEPTH);
      evals.push(whitePov(p.fen, a));
      best.push(a.best);
      mates.push(a.mate);
    }
    onProgress(i + 1, pos.length);
  }

  const loss: number[] = [];
  const flags: Flag[] = [];
  const themes: (string | null)[] = [];
  for (let i = 0; i < pos.length - 1; i++) {
    const mover = pos[i].fen.split(' ')[1] as 'w' | 'b';
    const l = pos[i].uci === best[i] ? 0 : moveLoss(evals, i, mover);
    loss.push(l);
    const flag: Flag = l > BLUNDER ? 'blunder' : l > MISTAKE ? 'mistake' : null;
    flags.push(flag);
    themes.push(flag ? classify(pos[i].fen, best[i], mates[i], pos[i + 1].fen, best[i + 1]) : null);
  }
  return { depth: REVIEW_DEPTH, evals, best, loss, flags, themes };
}

export function formatEval(cp: number) {
  if (Math.abs(cp) > 9000) return `${cp > 0 ? '' : '-'}M${10000 - Math.abs(cp)}`;
  const p = cp / 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}`;
}
