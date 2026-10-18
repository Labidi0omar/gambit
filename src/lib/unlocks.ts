// Progressive reveal: features open one at a time, each with an intro card.
import { STEPS } from './firststeps';

export type Feature = 'puzzles' | 'play' | 'learn' | 'ratings' | 'cct' | 'openings';

export interface UnlockInput {
  done: Record<string, number>;
  skipped: Record<string, true>;
  startedAt: number;
  /** Level 1 unlocked (First Steps finished, or puzzle rating 600+) */
  level1: boolean;
  gamesPlayed: number;
  now?: number;
}

const WEEK = 7 * 86_400_000;

const reached = (i: UnlockInput, id: string) => !!i.done[id] || !!i.skipped[id];
const stepWith = (u: 'puzzles' | 'play') => STEPS.find((s) => s.unlocks === u)!.id;

export function unlocks(i: UnlockInput): Record<Feature, boolean> {
  const now = i.now ?? Date.now();
  const play = reached(i, stepWith('play'));
  return {
    puzzles: reached(i, stepWith('puzzles')),
    play,
    learn: i.level1,
    ratings: i.level1 || (i.startedAt > 0 && now - i.startedAt >= WEEK),
    cct: i.level1,
    openings: i.level1 && i.gamesPlayed >= 10,
  };
}

/** What each feature is and why, shown once when it opens. */
export const FEATURE_INTRO: Record<Feature, { title: string; what: string; why: string }> = {
  puzzles: {
    title: 'Puzzles are open',
    what: 'A puzzle is a position from a real game with one strong move to find.',
    why: 'Short, daily puzzles train your eye faster than anything else.',
  },
  play: {
    title: 'You can play the bot',
    what: 'Play full games against a computer that starts very weak and gets stronger as you win.',
    why: 'Games are where everything you learn comes together.',
  },
  learn: {
    title: 'New lessons are open',
    what: 'Level 1 teaches tactics: tricks that win pieces, like the fork and the pin.',
    why: 'Most beginner games are won by spotting these.',
  },
  ratings: {
    title: 'Your rating',
    what: 'A rating is a number that goes up when you solve puzzles and down when you miss them. Beginners start around 500.',
    why: 'It shows your progress over weeks, not single days, so don’t worry about small ups and downs.',
  },
  cct: {
    title: 'CCT mode',
    what: 'Before each move, you mark every check, capture and threat for both sides. Stockfish shows what you missed.',
    why: 'It builds the habit that stops blunders. Turn it on in Play.',
  },
  openings: {
    title: 'Openings',
    what: 'An opening is the first few moves of a game. Pick one for White and one for Black, and drill them.',
    why: 'After 10 games you know enough to use them. Knowing the first moves saves thinking for later.',
  },
};

/** How to open a feature that is still locked, for anywhere that links to it. */
export function howToUnlock(f: Feature, gamesPlayed: number): string {
  const left = Math.max(0, 10 - gamesPlayed);
  switch (f) {
    case 'puzzles':
    case 'play':
      return 'It opens when you reach it on the First Steps path.';
    case 'learn':
    case 'cct':
      return 'It opens when you finish First Steps, or reach a 600 puzzle rating.';
    case 'ratings':
      return 'It opens when you finish First Steps, or a week after you started.';
    case 'openings':
      return `It opens after First Steps and 10 bot games${left ? ` (${left} to go)` : ''}.`;
  }
}

/** Order intros appear in when several open at once. */
export const FEATURE_ORDER: Feature[] = ['puzzles', 'play', 'learn', 'ratings', 'cct', 'openings'];
