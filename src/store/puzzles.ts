import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOptions } from '../lib/storage';
import { dueInDays } from '../lib/days';
import { glickoUpdate, decayRd } from '../lib/glicko';
import type { Puzzle } from '../lib/puzzles';

const DAY = 86_400_000;
export const SRS_INTERVALS = [1, 3, 7, 14]; // days

export interface ReviewCard {
  puzzle: Puzzle;
  stage: number; // index into SRS_INTERVALS
  due: number; // ms timestamp
}

export interface Attempt {
  id: string;
  ok: boolean;
  ts: number;
  puzzleRating: number;
  ratingAfter: number;
  themes: string[];
  review: boolean;
}

interface PuzzleState {
  rating: number;
  rd: number;
  lastPlayed: number;
  streak: number;
  bestStreak: number;
  attempts: Attempt[];
  themeStats: Record<string, { ok: number; total: number }>;
  reviews: Record<string, ReviewCard>;
  /** Themes of tactics missed in your own games (fed by post-game review). */
  missedThemes: Record<string, number>;
  /** Adds a puzzle made from your own game straight into spaced repetition. */
  addGamePuzzle: (p: Puzzle) => void;
  addMissedTheme: (t: string) => void;
  recordAttempt: (p: Puzzle, ok: boolean, review: boolean) => { delta: number };
  dueReviews: () => ReviewCard[];
  recentIds: () => Set<string>;
}

export const usePuzzles = create<PuzzleState>()(
  persist(
    (set, get) => ({
      rating: 500,
      rd: 300,
      lastPlayed: 0,
      streak: 0,
      bestStreak: 0,
      attempts: [],
      themeStats: {},
      reviews: {},
      missedThemes: {},

      addGamePuzzle: (p) =>
        set((s) => (s.reviews[p.id] ? s : { reviews: { ...s.reviews, [p.id]: { puzzle: p, stage: 0, due: dueInDays(SRS_INTERVALS[0]) } } })),

      addMissedTheme: (t) => set((s) => ({ missedThemes: { ...s.missedThemes, [t]: (s.missedThemes[t] ?? 0) + 1 } })),

      recordAttempt: (p, ok, review) => {
        const s = get();
        const now = Date.now();
        let { rating, rd } = s;
        // Reviews are practice: they move the SRS card, not the rating.
        if (!review) {
          const idle = s.lastPlayed ? (now - s.lastPlayed) / DAY : 0;
          ({ rating, rd } = glickoUpdate(rating, decayRd(rd, idle), p.rating, ok ? 1 : 0));
        }

        const themeStats = { ...s.themeStats };
        for (const t of p.themes) {
          const cur = themeStats[t] ?? { ok: 0, total: 0 };
          themeStats[t] = { ok: cur.ok + (ok ? 1 : 0), total: cur.total + 1 };
        }

        const reviews = { ...s.reviews };
        const card = reviews[p.id];
        if (!ok) {
          reviews[p.id] = { puzzle: p, stage: 0, due: dueInDays(SRS_INTERVALS[0], now) };
        } else if (card) {
          const next = card.stage + 1;
          if (next >= SRS_INTERVALS.length) delete reviews[p.id];
          else reviews[p.id] = { ...card, stage: next, due: dueInDays(SRS_INTERVALS[next], now) };
        }

        const streak = ok ? s.streak + 1 : 0;
        set({
          rating,
          rd,
          lastPlayed: review ? s.lastPlayed : now,
          streak,
          bestStreak: Math.max(s.bestStreak, streak),
          themeStats,
          reviews,
          attempts: [
            ...s.attempts,
            { id: p.id, ok, ts: now, puzzleRating: p.rating, ratingAfter: Math.round(rating), themes: p.themes, review },
          ].slice(-2000),
        });
        return { delta: Math.round(rating - s.rating) };
      },

      dueReviews: () => {
        const now = Date.now();
        return Object.values(get().reviews)
          .filter((c) => c.due <= now)
          .sort((a, b) => a.due - b.due);
      },

      recentIds: () => new Set(get().attempts.slice(-500).map((a) => a.id)),
    }),
    persistOptions('gambit.puzzles'),
  ),
);
