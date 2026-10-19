import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import { useDaily, dayStreak } from '../store/daily';
import { usePuzzles } from '../store/puzzles';
import { useLessons } from '../store/lessons';
import { useGames } from '../store/games';
import { useBot } from '../store/settings';
import { useNav } from '../store/nav';
import { useOpenings, dueLines } from '../store/openings';
import { useUnlocks } from '../lib/useUnlocks';
import { useTraining } from '../lib/useTraining';
import { ratingStatus } from '../lib/rating';
import { LEVELS, type Lesson } from '../lib/lessons';
import { pickPuzzle, themeLabel, type Puzzle } from '../lib/puzzles';
import { currentLevel, estimatedStrength } from '../lib/plan';
import { Board } from '../components/Board';
import { Sparkline, Row, RowGroup, PieceArt, Icon, rise } from '../components/ui';

const GOAL = 1200;
const WEEK = 7 * 86_400_000;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const NO_DESTS = new Map<Key, Key[]>();

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Still up?' : h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';
}

/** What the board on Today shows: the real next puzzle, else the next lesson's position. */
type Preview =
  | { kind: 'puzzle'; puzzle: Puzzle; fen: string; last: [Key, Key] }
  | { kind: 'lesson'; lesson: Lesson; fen: string }
  | { kind: 'start'; fen: string };

export function Today() {
  const days = useDaily((s) => s.days);
  const { rating, reviews, attempts, recentIds } = usePuzzles();
  const completed = useLessons((s) => s.completed);
  const games = useGames((s) => s.games);
  const botElo = useBot((s) => s.botElo);
  const go = useNav((s) => s.go);
  const openings = useOpenings();
  const openDue = dueLines(openings).length;
  const hasRepertoire = !!(openings.white || openings.black);
  const openUnlocked = useUnlocks().openings;

  const { d, theme, lesson, lessonToday, puzzlePct, done, doneCount } = useTraining();
  const streak = dayStreak(days);
  const level = currentLevel(completed, rating);
  const due = Object.values(reviews).filter((c) => c.due <= Date.now()).length;
  const est = estimatedStrength(games, rating);

  const minutes = Math.floor(d.puzzleMs / 60_000);

  const rated = attempts.filter((a) => !a.review);
  const spark = [500, ...rated.slice(-60).map((a) => a.ratingAfter)];
  const weekAgo = [...rated].reverse().find((a) => a.ts <= Date.now() - WEEK)?.ratingAfter ?? 500;
  const weekDelta = Math.round(rating - weekAgo);
  const toGoal = Math.max(0, GOAL - est.elo);
  const rs = ratingStatus(attempts);

  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    let alive = true;
    pickPuzzle(rating, { theme, exclude: recentIds() })
      .catch(() => null)
      .then((p) => {
        if (!alive) return;
        if (p) {
          const c = new Chess(p.fen);
          const m = c.move({ from: p.moves.slice(0, 2), to: p.moves.slice(2, 4), promotion: p.moves[4] });
          return setPreview({ kind: 'puzzle', puzzle: p, fen: c.fen(), last: [m.from as Key, m.to as Key] });
        }
        const step = lesson?.steps?.find((s) => 'fen' in s && s.fen);
        if (lesson && step && 'fen' in step && step.fen) return setPreview({ kind: 'lesson', lesson, fen: step.fen });
        setPreview({ kind: 'start', fen: START });
      });
    return () => {
      alive = false;
    };
    // Pick once per visit; re-picking on every rating change would swap the board under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPreview = () => {
    if (!preview) return;
    if (preview.kind === 'puzzle') go('puzzles', { puzzleTheme: theme, puzzle: preview.puzzle });
    else if (preview.kind === 'lesson') go('learn', { lessonId: preview.lesson.id });
    else go('play');
  };

  const sideToMove = preview?.fen.split(' ')[1] === 'b' ? 'Black' : 'White';
  const caption =
    preview?.kind === 'puzzle'
      ? `${sideToMove} to move. ${themeLabel(theme)}${rs.established ? `, difficulty ${preview.puzzle.rating}` : ''}.`
      : preview?.kind === 'lesson'
        ? `From your next lesson: ${preview.lesson.title}.`
        : 'A fresh board. Play Stockfish to start.';
  const cta = preview?.kind === 'puzzle' ? 'Solve this position' : preview?.kind === 'lesson' ? 'Start the lesson' : 'Play a game';

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 md:px-8">
      {/* first screen: the position is the way in */}
      <section className="grid gap-10 pb-16 pt-6 [&>*]:min-w-0 md:grid-cols-12 md:gap-12 md:pb-24 md:pt-12">
        <div className="md:col-span-5 md:pt-4">
          <motion.h1 {...rise(0)} className="display-xl">
            {greeting()}
          </motion.h1>
          <motion.p {...rise(1)} className="mt-6 max-w-[34ch] text-xl leading-relaxed">
            {doneCount === 3
              ? 'Puzzles, lesson and game are done. Anything more today is extra credit.'
              : `Fifteen minutes of puzzles, one lesson, one game. ${doneCount === 0 ? 'Nothing done yet today.' : `${doneCount} of 3 done today.`}`}
          </motion.p>
          <motion.div {...rise(2)} className="mt-8">
            <button onClick={openPreview} disabled={!preview} className="btn-primary">
              {cta}
              <Icon name="chevron" className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </motion.div>

          <motion.div {...rise(3)} className="mt-12">
            <RowGroup>
              <Row
                art={<PieceArt role="knight" size={38} />}
                title="Puzzles"
                sub={puzzlePct >= 1 ? `${minutes} minutes today` : `${minutes} of 15 minutes · focus on ${themeLabel(theme).toLowerCase()}`}
                done={done[0]}
                highlight={!done[0]}
                onClick={() => go('puzzles', { puzzleTheme: theme })}
              />
              <Row
                art={<PieceArt role="bishop" size={38} />}
                title={lessonToday ? 'Lesson' : lesson ? lesson.title : 'Lessons'}
                sub={lesson ? (lessonToday ? `Next up: ${lesson.title}` : lesson.summary) : 'Every lesson is complete'}
                done={done[1]}
                highlight={done[0] && !done[1]}
                onClick={() => go('learn', { lessonId: lessonToday ? undefined : lesson?.id })}
              />
              <Row
                art={<PieceArt role="king" size={38} />}
                title={`Stockfish at ${botElo}`}
                sub="10+5, no takebacks. Your mistakes become puzzles."
                done={done[2]}
                highlight={done[0] && done[1] && !done[2]}
                onClick={() => go('play')}
              />
              {/* Only once Openings is unlocked: before that the tab doesn't exist and the link would bounce back. */}
              {openUnlocked && (!hasRepertoire || openDue > 0) && (
                <Row
                  art={<PieceArt role="rook" size={36} />}
                  title={hasRepertoire ? `${openDue} opening line${openDue === 1 ? '' : 's'} to drill` : 'Pick your openings'}
                  sub={hasRepertoire ? 'Main lines and two common replies, from memory' : 'One for White, one for Black'}
                  onClick={() => go('openings')}
                />
              )}
              {due > 0 && (
                <Row
                  art={<PieceArt role="pawn" size={34} />}
                  title={`${due} puzzle${due === 1 ? '' : 's'} to revisit`}
                  sub="Missed before, due again today"
                  onClick={() => go('puzzles', { puzzleReview: true })}
                />
              )}
            </RowGroup>
          </motion.div>
        </div>

        <motion.div {...rise(1)} className="order-first md:order-none md:col-span-7">
          <button onClick={openPreview} disabled={!preview} className="group block w-full text-left" aria-label={cta}>
            <div className="transition-transform duration-300 group-hover:-translate-y-1">
              <Board
                fen={preview?.fen ?? START}
                orientation={sideToMove === 'Black' ? 'black' : 'white'}
                turnColor={sideToMove === 'Black' ? 'black' : 'white'}
                dests={NO_DESTS}
                viewOnly
                lastMove={preview?.kind === 'puzzle' ? preview.last : undefined}
              />
            </div>
            <p className="mt-4 flex items-center justify-between gap-4 text-[17px]">
              <span>{preview ? caption : 'Setting up the board…'}</span>
              <span className="link shrink-0">{cta}</span>
            </p>
          </button>
        </motion.div>
      </section>

      {/* second screen: the number that's moving */}
      <section className="-mx-4 bg-surface px-4 py-16 md:-mx-8 md:px-8 md:py-24">
        <div className="grid gap-10 [&>*]:min-w-0 md:grid-cols-12 md:gap-12">
          <div className="md:col-span-5">
            <p className="text-[17px]">Puzzle rating</p>
            {rs.established ? (
              <div className="num mt-2 text-[clamp(6rem,14vw,11rem)] font-semibold leading-[0.85]">{Math.round(rating)}</div>
            ) : (
              <div className="num mt-2 text-[clamp(4rem,9vw,7rem)] font-semibold leading-[0.85] text-ink-2">
                {rs.count}/{rs.need}
              </div>
            )}
            {rs.established ? (
            <p className="mt-6 max-w-[36ch] text-xl leading-relaxed">
              {weekDelta > 0 ? `Up ${weekDelta} this week. ` : weekDelta < 0 ? `Down ${-weekDelta} this week. ` : ''}
              Rough estimate of your game strength: about {est.elo}
              {toGoal ? `, ${toGoal} short of ${GOAL}.` : `, past the ${GOAL} goal.`}
            </p>
            ) : (
              <p className="mt-6 max-w-[36ch] text-xl leading-relaxed">
                No number yet. A rating from a handful of puzzles is noise, so it appears after {rs.need} rated puzzles.
              </p>
            )}
            <p className="mt-2 max-w-[40ch] text-[15px] text-ink-2">
              Puzzle rating is not a game rating, and Lichess and Chess.com ratings differ from each other too.
            </p>
            <button onClick={() => go('progress')} className="link mt-6 text-[17px]">
              See your progress
            </button>
          </div>
          <div className="flex flex-col justify-end md:col-span-7">
            {rs.established && <Sparkline values={spark} height={200} />}
            <dl className="mt-10 grid grid-cols-2 gap-y-8 sm:grid-cols-4">
              <Stat value={streak} label={streak === 1 ? 'day in a row' : 'days in a row'} />
              <Stat value={d.puzzles} label="puzzles today" />
              <Stat value={botElo} label="bot strength" />
              <Stat value={`${Object.keys(completed).length}/${LEVELS.reduce((s, l) => s + l.lessons.length, 0)}`} label="lessons" />
            </dl>
          </div>
        </div>
      </section>

      <footer className="flex flex-wrap items-end justify-between gap-6 py-16 md:py-24">
        <p className="display-m max-w-[18ch]">Level {level}: {LEVELS[level].title}.</p>
        <button onClick={() => go('learn')} className="btn-ghost">
          Open the course
        </button>
      </footer>
    </div>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="num text-5xl font-semibold leading-none">{value}</dd>
      <dd className="mt-2 text-[15px] text-ink-2">{label}</dd>
    </div>
  );
}
