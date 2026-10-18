import level0 from '../content/level0.json';
import level1 from '../content/level1.json';
import level2 from '../content/level2.json';
import demosJson from '../content/demos.json';
import type { Puzzle } from './puzzles';

/**
 * Hand-written steps exist only for what the puzzle DB lacks: piece-movement mini-games,
 * K+Q / K+R vs K, and K+P opposition. SAN moves throughout.
 */
export type Step =
  // Mini-game: white pieces collect static black targets. Kings only block.
  | { type: 'collect'; fen: string; text: string; maxMoves?: number; explain?: string }
  // line = user, reply, user, reply... `alts` = other accepted first moves. anyMate accepts any mating move.
  | { type: 'move'; fen: string; text: string; line: string[]; alts?: string[]; anyMate?: boolean; explain: string }
  // Play it out against Stockfish at full strength.
  | { type: 'play'; fen: string; text: string; goal: 'mate' | 'promote'; maxMoves: number; explain: string };

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  /** At most four sentences. */
  explain: string;
  /** Puzzle-DB theme for demos (picked into demos.json) and practice. */
  theme?: string;
  steps?: Step[];
  practice?: { theme: string; label: string; count: number };
}

export interface Level {
  level: number;
  title: string;
  range: string;
  /** Puzzle rating that also unlocks this level. */
  unlockRating: number;
  lessons: Lesson[];
}

export const LEVELS: Level[] = [level0, level1, level2] as Level[];

export const ALL_LESSONS = LEVELS.flatMap((l) => l.lessons);

/** Demo positions per lesson id, picked from the puzzle DB and validated by scripts/validate-content.ts. */
export const DEMOS = demosJson as Record<string, Puzzle[]>;

export const sanEq = (a: string, b: string) => a.replace(/[+#!?]/g, '') === b.replace(/[+#!?]/g, '');

export * from './collect';
