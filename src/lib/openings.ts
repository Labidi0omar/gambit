import { Chess } from 'chess.js';
import data from '../content/openings.json';

export type Side = 'white' | 'black';

export interface OpeningLine {
  eco: string;
  name: string;
  /** Exact PGN from the lichess-org/chess-openings dataset. */
  pgn: string;
  san: string[];
}

export interface Repertoire {
  id: string;
  name: string;
  /** Unlocks at puzzle rating ADVANCED_RATING. */
  advanced: boolean;
  /** [0] is the main line, the rest are common deviations. */
  lines: OpeningLine[];
}

export const ADVANCED_RATING = 1200;

export const REPERTOIRES = data as Record<Side, Repertoire[]>;

export const findRepertoire = (side: Side, id?: string) => REPERTOIRES[side].find((r) => r.id === id);

export const lineKey = (side: Side, repId: string, i: number) => `${side}:${repId}:${i}`;

/** A random line from the chosen repertoire, for the bot to play into. */
export function randomLine(side: Side, repId?: string): OpeningLine | null {
  const r = findRepertoire(side, repId);
  if (!r) return null;
  return r.lines[Math.floor(Math.random() * r.lines.length)];
}

const position = (c: { fen: () => string }) => c.fen().split(' ').slice(0, 3).join(' ');

/**
 * Checks a recall move against the line. Returns the (possibly reordered) line to follow, or null.
 * Accepts the line move itself, and also a transposition: playing one of your own later line moves
 * first, as long as the line's replies stay legal and you reach the same position (compared by FEN).
 */
export function acceptLineMove(line: string[], ply: number, fenBefore: string, uci: string): string[] | null {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const isUser = (m: { from: string; to: string }) => m.from === from && m.to === to;
  const promo = uci[4] || 'q';

  const tryMove = (c: Chess, m: string) => {
    try {
      return c.move(m);
    } catch {
      return null;
    }
  };

  const first = new Chess(fenBefore);
  const expected = tryMove(first, line[ply]);
  if (!expected) return null;
  if (isUser(expected)) return line;

  // Swap this move with each later move of yours and check the position matches where the line goes.
  for (let q = ply + 2; q < line.length; q += 2) {
    const target = new Chess(fenBefore);
    if (!line.slice(ply, q + 1).every((m) => tryMove(target, m))) break;
    const swapped = line.slice(ply, q + 1);
    [swapped[0], swapped[q - ply]] = [swapped[q - ply], swapped[0]];
    const c = new Chess(fenBefore);
    const sans: string[] = [];
    let ok = true;
    for (const [k, m] of swapped.entries()) {
      const mv = k === 0 ? (() => { try { return c.move({ from, to, promotion: promo }); } catch { return null; } })() : tryMove(c, m);
      if (!mv || (k === 0 && tryMove(new Chess(fenBefore), m)?.san !== mv.san)) {
        ok = false;
        break;
      }
      sans.push(mv.san);
    }
    if (ok && position(c) === position(target)) return [...line.slice(0, ply), ...sans, ...line.slice(q + 1)];
  }
  return null;
}
