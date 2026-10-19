import { useDaily, today, dayKey } from '../store/daily';
import { usePuzzles } from '../store/puzzles';
import { useLessons } from '../store/lessons';
import { useGames } from '../store/games';
import { useNav } from '../store/nav';
import { DAILY_PUZZLE_MS, currentLevel, nextLesson, weakestTheme } from './plan';

/**
 * Today's three-part training (puzzles, a lesson, a game): what's done and where to go next.
 * Shared by the Today screen and the header button so they can't disagree.
 */
export function useTraining() {
  const days = useDaily((s) => s.days);
  const { rating, themeStats, missedThemes } = usePuzzles();
  const completed = useLessons((s) => s.completed);
  const games = useGames((s) => s.games);
  const go = useNav((s) => s.go);

  const d = today(days);
  const theme = weakestTheme(currentLevel(completed, rating), themeStats, missedThemes);
  const lesson = nextLesson(completed, rating);
  const lessonToday = Object.values(completed).some((ts) => dayKey(new Date(ts)) === dayKey());
  const gameToday = games.some((g) => dayKey(new Date(g.date)) === dayKey());
  const puzzlePct = Math.min(1, d.puzzleMs / DAILY_PUZZLE_MS);
  const done = [puzzlePct >= 1, lessonToday || !lesson, gameToday];
  const doneCount = done.filter(Boolean).length;

  /** Jump to the first unfinished part; once all three are done, more puzzles. */
  const start = () => {
    if (!done[0]) go('puzzles', { puzzleTheme: theme });
    else if (!done[1]) go('learn', { lessonId: lesson?.id });
    else if (!done[2]) go('play');
    else go('puzzles', { puzzleTheme: theme });
  };
  const nextLabel = !done[0] ? 'Puzzles' : !done[1] ? 'Lesson' : !done[2] ? 'Game' : 'Extra puzzles';

  return { d, theme, lesson, lessonToday, puzzlePct, done, doneCount, start, nextLabel };
}
