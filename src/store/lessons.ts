import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOptions } from '../lib/storage';
import { LEVELS } from '../lib/lessons';
import { usePuzzles } from './puzzles';
import { useJourney, firstStepsDone } from './journey';

interface LessonState {
  completed: Record<string, number>; // lesson id -> completion timestamp
  complete: (id: string) => void;
}

export const useLessons = create<LessonState>()(
  persist(
    (set) => ({
      completed: {},
      complete: (id) => set((s) => ({ completed: { ...s.completed, [id]: s.completed[id] ?? Date.now() } })),
    }),
    persistOptions('gambit.lessons'),
  ),
);

/** A level opens when the previous one is fully done, or puzzle rating proves you're past it. */
export function levelUnlocked(i: number, completed: Record<string, number>, rating: number) {
  if (i === 0) return true;
  // Level 1 opens when the First Steps path is done (Level 0 has no lessons of its own).
  if (i === 1) return firstStepsDone(useJourney.getState()) || rating >= LEVELS[1].unlockRating;
  const prev = LEVELS[i - 1];
  return prev.lessons.every((l) => completed[l.id]) || rating >= LEVELS[i].unlockRating;
}

/** Lessons inside a level unlock in order. */
export function lessonUnlocked(levelIdx: number, lessonIdx: number, completed: Record<string, number>, rating: number) {
  if (!levelUnlocked(levelIdx, completed, rating)) return false;
  return lessonIdx === 0 || !!completed[LEVELS[levelIdx].lessons[lessonIdx - 1].id];
}

export const usePuzzleRating = () => usePuzzles((s) => s.rating);
