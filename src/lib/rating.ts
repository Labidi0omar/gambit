import { usePuzzles, type Attempt } from '../store/puzzles';

/**
 * A rating means little after a handful of puzzles: early results swing it hundreds of points.
 * So no rating (or anything derived from it) is shown until this many rated puzzles are done.
 */
export const RATED_PUZZLES_NEEDED = 20;

export const ratedCount = (attempts: Attempt[]) => attempts.filter((a) => !a.review).length;

export function ratingStatus(attempts: Attempt[]) {
  const count = ratedCount(attempts);
  return { established: count >= RATED_PUZZLES_NEEDED, count, need: RATED_PUZZLES_NEEDED };
}

export const useRatingStatus = () => ratingStatus(usePuzzles((s) => s.attempts));
