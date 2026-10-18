import { create } from 'zustand';
import type { Puzzle } from '../lib/puzzles';

export type Tab = 'today' | 'learn' | 'puzzles' | 'openings' | 'play' | 'review' | 'progress' | 'session';
export const TAB_IDS: Tab[] = ['today', 'learn', 'puzzles', 'play', 'review', 'progress'];

interface NavState {
  tab: Tab;
  puzzleTheme?: string;
  lessonId?: string;
  gameId?: string;
  puzzleReview?: boolean;
  /** A specific puzzle to open first (e.g. the one previewed on Today). */
  puzzle?: Puzzle;
  /** session: replay this one First Steps step */
  stepId?: string;
  go: (tab: Tab, opts?: { puzzleTheme?: string; lessonId?: string; gameId?: string; puzzleReview?: boolean; puzzle?: Puzzle; stepId?: string }) => void;
}

const saved = (() => {
  try {
    return localStorage.getItem('gambit.tab') as Tab | null;
  } catch {
    return null;
  }
})();

export const useNav = create<NavState>()((set) => ({
  tab: saved && (TAB_IDS.includes(saved) || saved === 'openings') ? saved : 'today',
  go: (tab, opts) => {
    try {
      if (tab !== 'session') localStorage.setItem('gambit.tab', tab);
    } catch {
      /* ignore */
    }
    set({ tab, puzzleTheme: opts?.puzzleTheme, lessonId: opts?.lessonId, gameId: opts?.gameId, puzzleReview: opts?.puzzleReview, puzzle: opts?.puzzle, stepId: opts?.stepId });
  },
}));
