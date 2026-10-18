import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOptions } from '../lib/storage';

export interface DayLog {
  puzzleMs: number;
  puzzles: number;
  lessons: number;
  games: number;
}

const EMPTY: DayLog = { puzzleMs: 0, puzzles: 0, lessons: 0, games: 0 };
export const dayKey = (d = new Date()) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

interface DailyState {
  days: Record<string, DayLog>;
  log: (patch: Partial<DayLog>) => void;
}

export const useDaily = create<DailyState>()(
  persist(
    (set) => ({
      days: {},
      log: (patch) =>
        set((s) => {
          const k = dayKey();
          const cur = s.days[k] ?? EMPTY;
          const next = { ...cur };
          for (const key of Object.keys(patch) as (keyof DayLog)[]) next[key] = cur[key] + (patch[key] ?? 0);
          return { days: { ...s.days, [k]: next } };
        }),
    }),
    persistOptions('gambit.daily'),
  ),
);

export const today = (days: Record<string, DayLog>) => days[dayKey()] ?? EMPTY;

const active = (d?: DayLog) => !!d && (d.puzzles > 0 || d.lessons > 0 || d.games > 0);

/** Consecutive days with any training, counting today only if it already has activity. */
export function dayStreak(days: Record<string, DayLog>) {
  const d = new Date();
  if (!active(days[dayKey(d)])) d.setDate(d.getDate() - 1);
  let n = 0;
  while (active(days[dayKey(d)])) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function bestDayStreak(days: Record<string, DayLog>) {
  const keys = Object.keys(days).filter((k) => active(days[k])).sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of keys) {
    const d = new Date(`${k}T12:00:00`);
    run = prev && Math.round((d.getTime() - prev.getTime()) / 86_400_000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}
