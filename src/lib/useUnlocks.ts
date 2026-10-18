import { useJourney } from '../store/journey';
import { useLessons, levelUnlocked } from '../store/lessons';
import { usePuzzles } from '../store/puzzles';
import { useGames } from '../store/games';
import { unlocks, type Feature } from './unlocks';

/** Which features are open right now (re-renders when any input changes). */
export function useUnlocks(): Record<Feature, boolean> {
  const { done, skipped, startedAt } = useJourney();
  useLessons((s) => s.completed); // levelUnlocked reads lessons; subscribe so this re-renders
  const rating = usePuzzles((s) => s.rating);
  const gamesPlayed = useGames((s) => s.games.length);
  return unlocks({ done, skipped, startedAt, level1: levelUnlocked(1, useLessons.getState().completed, rating), gamesPlayed });
}
