import { LEVELS, type Lesson } from './lessons';
import { levelUnlocked, lessonUnlocked } from '../store/lessons';
import type { GameRecord } from '../store/games';

export const DAILY_PUZZLE_MS = 15 * 60_000;

/** Puzzle themes each curriculum level trains. */
export const LEVEL_THEMES: string[][] = [
  ['mateIn1', 'hangingPiece'],
  ['hangingPiece', 'fork', 'pin', 'skewer', 'discoveredAttack', 'backRankMate', 'mateIn2'],
  ['mateIn2', 'fork', 'hangingPiece', 'deflection', 'capturingDefender', 'pawnEndgame', 'rookEndgame'],
];

/** The level you're working on: the first unlocked level with unfinished lessons. */
export function currentLevel(completed: Record<string, number>, rating: number) {
  let lvl = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (!levelUnlocked(i, completed, rating)) break;
    lvl = i;
    if (LEVELS[i].lessons.some((l) => !completed[l.id])) break;
  }
  return lvl;
}

export function nextLesson(completed: Record<string, number>, rating: number): Lesson | null {
  for (let li = 0; li < LEVELS.length; li++)
    for (let i = 0; i < LEVELS[li].lessons.length; i++) {
      const l = LEVELS[li].lessons[i];
      if (!completed[l.id] && lessonUnlocked(li, i, completed, rating)) return l;
    }
  return null;
}

/**
 * Weakest theme: lowest smoothed puzzle accuracy among this level's themes plus anything you
 * missed in your own games. Missed-in-game counts push a theme down. Ties rotate by day.
 */
export function weakestTheme(
  level: number,
  themeStats: Record<string, { ok: number; total: number }>,
  missed: Record<string, number>,
): string {
  const pool = [...new Set([...LEVEL_THEMES[level], ...Object.keys(missed).filter((t) => !t.startsWith('mateIn') || t === 'mateIn1' || t === 'mateIn2')])];
  const day = Math.floor(Date.now() / 86_400_000);
  const score = (t: string) => {
    const s = themeStats[t] ?? { ok: 0, total: 0 };
    return (s.ok + 2) / (s.total + 3) - 0.05 * (missed[t] ?? 0);
  };
  return pool
    .map((t, i) => ({ t, s: score(t), tie: (i + day) % pool.length }))
    .sort((a, b) => a.s - b.s || a.tie - b.tie)[0].t;
}

/**
 * Estimated playing strength: performance rating vs the bot over recent games, blended with
 * puzzle rating (which runs ~150 above over-the-board strength).
 */
export function estimatedStrength(games: GameRecord[], puzzleRating: number) {
  const recent = games.slice(0, 10);
  const fromPuzzles = puzzleRating - 150;
  if (recent.length < 3) return { elo: Math.max(100, Math.round(fromPuzzles)), basis: 'puzzles' as const };
  const avg = recent.reduce((s, g) => s + g.botElo, 0) / recent.length;
  const score = recent.reduce((s, g) => s + (g.result === 'win' ? 1 : g.result === 'draw' ? 0 : -1), 0);
  const perf = avg + (400 * score) / recent.length;
  return { elo: Math.max(100, Math.round(0.7 * perf + 0.3 * fromPuzzles)), basis: 'games + puzzles' as const };
}
