import { motion } from 'framer-motion';
import { LEVELS, ALL_LESSONS } from '../lib/lessons';
import { useLessons, levelUnlocked, lessonUnlocked, usePuzzleRating } from '../store/lessons';
import { useNav } from '../store/nav';
import { useDaily } from '../store/daily';
import { LessonPlayer } from './LessonPlayer';
import { Icon, PieceArt, Row, RowGroup, rise, type Role } from '../components/ui';
import { nextLesson } from '../lib/plan';
import { useUnlocks } from '../lib/useUnlocks';
import { useGames } from '../store/games';

export function Learn() {
  const { completed, complete } = useLessons();
  const rating = usePuzzleRating();
  const { lessonId, go } = useNav();
  const logDay = useDaily((s) => s.log);
  const open = useUnlocks();
  const gamesPlayed = useGames((s) => s.games.length);

  const lesson = ALL_LESSONS.find((l) => l.id === lessonId);
  if (lesson) {
    const idx = ALL_LESSONS.indexOf(lesson);
    const next = ALL_LESSONS[idx + 1];
    return (
      <LessonPlayer
        key={lesson.id}
        lesson={lesson}
        nextLesson={next}
        onExit={() => go('learn')}
        onDone={() => {
          complete(lesson.id);
          logDay({ lessons: 1 });
        }}
        onNext={() => go('learn', { lessonId: next?.id })}
        onPractice={() => go('puzzles', { puzzleTheme: lesson.practice?.theme })}
      />
    );
  }

  const next = nextLesson(completed, rating);
  const total = ALL_LESSONS.length;
  const doneAll = ALL_LESSONS.filter((l) => completed[l.id]).length;
  const ART: Role[] = ['pawn', 'knight', 'rook'];

  return (
    <div className="mx-auto grid w-full max-w-[1240px] gap-12 [&>*]:min-w-0 px-4 pb-20 pt-6 md:grid-cols-12 md:px-8 md:pt-12">
      <div className="md:col-span-4">
        <div className="md:sticky md:top-28">
          <motion.h1 {...rise(0)} className="display-xl">
            Learn
          </motion.h1>
          <motion.p {...rise(1)} className="mt-6 max-w-[30ch] text-xl leading-relaxed">
            Three levels, from how the pieces move to the habits of a 1200 player. {doneAll} of {total} lessons done.
          </motion.p>
          {next && (
            <motion.div {...rise(2)} className="mt-8">
              <button onClick={() => go('learn', { lessonId: next.id })} className="btn-primary">
                Continue: {next.title}
                <Icon name="chevron" className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </motion.div>
          )}
          <motion.div {...rise(3)} className="mt-6">
            {open.openings ? (
              <button onClick={() => go('openings')} className="link text-[17px]">
                Drill your openings
              </button>
            ) : (
              <p className="text-[15px] text-ink-2">Openings open after {Math.max(0, 10 - gamesPlayed)} more bot game{10 - gamesPlayed === 1 ? '' : 's'}.</p>
            )}
          </motion.div>
        </div>
      </div>

      <div className="flex flex-col gap-16 md:col-span-8">
        {LEVELS.map((lvl, li) => {
          if (!lvl.lessons.length) return null; // Level 0 is the First Steps path, shown on Home
          const open = levelUnlocked(li, completed, rating);
          const done = lvl.lessons.filter((l) => completed[l.id]).length;
          return (
            <motion.section key={lvl.level} {...rise(li + 1)}>
              <div className="mb-5 flex items-end gap-5">
                <PieceArt role={ART[li % ART.length]} size={72} className={open ? '' : 'opacity-40'} />
                <div className="min-w-0">
                  <h2 className="display-m">{lvl.title}</h2>
                  <p className="mt-1 text-[17px] text-ink-2">
                    {open
                      ? `Rated ${lvl.range}. ${done} of ${lvl.lessons.length} done.`
                      : `Opens after level ${lvl.level - 1}, or at ${lvl.unlockRating} puzzle rating.`}
                  </p>
                </div>
              </div>
              <RowGroup>
                {lvl.lessons.map((l, i) => {
                  const unlocked = lessonUnlocked(li, i, completed, rating);
                  const isDone = !!completed[l.id];
                  const isNext = next?.id === l.id;
                  if (!unlocked)
                    return (
                      <div key={l.id} className="flex items-center gap-4 bg-surface px-5 py-4 text-ink-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[17px] font-semibold">{l.title}</span>
                          <span className="block truncate text-[15px]">{l.summary}</span>
                        </span>
                        <Icon name="lock" className="h-4 w-4 shrink-0" />
                      </div>
                    );
                  return (
                    <Row
                      key={l.id}
                      title={l.title}
                      sub={l.summary}
                      done={isDone}
                      highlight={isNext}
                      right={isNext ? <span className="text-sm font-bold text-accent">Up next</span> : undefined}
                      onClick={() => go('learn', { lessonId: l.id })}
                    />
                  );
                })}
              </RowGroup>
            </motion.section>
          );
        })}
      </div>
    </div>
  );
}
