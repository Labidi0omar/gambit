// CCT = checks, captures, threats. Before moving, list the opponent's, then your own.
import { Chess } from 'chess.js';

export type CctKind = 'check' | 'capture' | 'threat';
export const CCT_KINDS: CctKind[] = ['check', 'capture', 'threat'];

export interface CctItem {
  uci: string;
  san: string;
  kind: CctKind;
}

/** Same position with the other side to move ("what would they do if it were their turn?"). */
export function nullMoveFen(fen: string): string | null {
  if (new Chess(fen).inCheck()) return null; // passing while in check isn't a position
  const p = fen.split(' ');
  p[1] = p[1] === 'w' ? 'b' : 'w';
  p[3] = '-';
  return p.join(' ');
}

/** Every check and capture for the side to move. A capturing check counts as a check. */
export function forcingMoves(fen: string): CctItem[] {
  return new Chess(fen)
    .moves({ verbose: true })
    .filter((m) => m.san.includes('+') || m.san.includes('#') || m.captured)
    .map((m) => ({
      uci: m.from + m.to + (m.promotion ?? ''),
      san: m.san,
      kind: m.san.includes('+') || m.san.includes('#') ? 'check' : 'capture',
    }));
}

/**
 * Which CCT step a blunder skipped: what the opponent's best reply was.
 * A check you didn't see coming, a capture you didn't see, or a quiet threat.
 */
export function blunderStep(fenAfterBlunder: string, oppBestUci?: string): CctKind | null {
  if (!oppBestUci) return null;
  try {
    const m = new Chess(fenAfterBlunder).move({ from: oppBestUci.slice(0, 2), to: oppBestUci.slice(2, 4), promotion: oppBestUci[4] });
    return m.san.includes('+') || m.san.includes('#') ? 'check' : m.captured ? 'capture' : 'threat';
  } catch {
    return null;
  }
}

export const CCT_LABEL: Record<CctKind, string> = { check: 'missed check', capture: 'missed capture', threat: 'missed threat' };
