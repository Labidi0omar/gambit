// CCT = checks, captures, threats. Before moving, list the opponent's, then your own.
import { Chess } from 'chess.js';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOptions } from './storage';
import { getEngine, FULL_STRENGTH } from '../engine/stockfish';

export type CctKind = 'check' | 'capture' | 'threat';
export const CCT_KINDS: CctKind[] = ['check', 'capture', 'threat'];

export interface CctItem {
  uci: string;
  san: string;
  kind: CctKind;
}

const CCT_DEPTH = 10;

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
 * What a full CCT scan should find. Checks and captures come from the rules; the threat is
 * Stockfish's best move when it is quiet, i.e. the idea you can't see by counting forcing moves.
 */
export async function cctExpected(fen: string, who: 'theirs' | 'mine', restoreElo: number): Promise<CctItem[]> {
  const pos = who === 'theirs' ? nullMoveFen(fen) : fen;
  if (!pos) return [];
  const items = forcingMoves(pos);
  // Collapse promotions (e7e8q/r/b/n) to one item: a marked arrow has no piece choice.
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const k = i.uci.slice(0, 4);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const engine = getEngine();
  await engine.setStrength({ elo: FULL_STRENGTH });
  const a = await engine.analyze(pos, CCT_DEPTH);
  await engine.setStrength({ elo: restoreElo });
  if (a.best && !seen.has(a.best.slice(0, 4))) {
    const m = new Chess(pos).move({ from: a.best.slice(0, 2), to: a.best.slice(2, 4), promotion: a.best[4] });
    unique.push({ uci: a.best, san: m.san, kind: 'threat' });
  }
  return unique;
}

export const sameArrow = (a: string, b: string) => a.slice(0, 4) === b.slice(0, 4);

// ---------- stats from CCT mode ----------

type Tally = Record<CctKind, { found: number; total: number }>;
const empty = (): Tally => ({ check: { found: 0, total: 0 }, capture: { found: 0, total: 0 }, threat: { found: 0, total: 0 } });

export const useCctStats = create<{ tally: Tally; scans: number; record: (expected: CctItem[], marked: string[]) => void }>()(
  persist(
    (set) => ({
      tally: empty(),
      scans: 0,
      record: (expected, marked) =>
        set((s) => {
          const t: Tally = JSON.parse(JSON.stringify(s.tally));
          for (const e of expected) {
            t[e.kind].total++;
            if (marked.some((m) => sameArrow(m, e.uci))) t[e.kind].found++;
          }
          return { tally: t, scans: s.scans + 1 };
        }),
    }),
    persistOptions('gambit.cct'),
  ),
);

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
