// Home while you're on the First Steps path: one big Continue button, the path map and your streak.
import { motion } from 'framer-motion';
import { STEPS } from '../lib/firststeps';
import { PieceArt, Icon } from '../components/ui';
import { useJourney, nextStep } from '../store/journey';
import { useDaily, dayStreak } from '../store/daily';
import { useNav } from '../store/nav';

export function FirstStepsHome() {
  const j = useJourney();
  const days = useDaily((s) => s.days);
  const go = useNav((s) => s.go);
  const streak = dayStreak(days);
  const next = nextStep(j);
  const cur = next ? STEPS.indexOf(next) : STEPS.length;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 pb-24 pt-8">
      <div className="flex w-full items-center justify-between">
        <h1 className="display-m">First steps</h1>
        <span className="flex items-center gap-1.5 text-[17px] font-semibold" title="Days in a row">
          <Icon name="flame" className={`h-5 w-5 ${streak ? 'text-accent' : 'text-ink-2'}`} strokeWidth={2} />
          {streak} {streak === 1 ? 'day' : 'days'}
        </span>
      </div>

      <button onClick={() => go('session')} autoFocus className="btn-primary mt-8 w-full !py-5 text-[19px]">
        {Object.keys(j.done).length ? 'Continue' : 'Start'}
        {next ? `: ${next.title.toLowerCase()}` : ''}
      </button>

      {/* the path */}
      <ol className="relative mt-12 flex w-full flex-col items-center gap-7" aria-label="Your path">
        {STEPS.map((s, i) => {
          const done = !!j.done[s.id] || !!j.skipped[s.id];
          const current = i === cur;
          const visible = i <= cur + 2;
          const x = Math.round(Math.sin(i * 0.9) * 70);
          return (
            <motion.li
              key={s.id}
              initial={{ opacity: 0, y: 10, x }}
              animate={{ opacity: visible ? 1 : 0.35, y: 0, x }}
              transition={{ delay: Math.min(i, 8) * 0.04 }}
              className={`flex flex-col items-center gap-2 ${visible ? '' : 'pointer-events-none blur-[3px]'}`}
            >
              <button
                onClick={() => (done || current) && go('session', { stepId: s.id })}
                disabled={!done && !current}
                aria-current={current ? 'step' : undefined}
                aria-label={`${s.title}${done ? ', done' : current ? ', next' : ''}`}
                className={`relative flex h-20 w-20 items-center justify-center rounded-full transition-transform ${
                  current ? 'node-glow bg-accent' : done ? 'bg-surface-2 hover:scale-105' : 'bg-surface'
                }`}
              >
                <PieceArt role={s.icon} size={46} color={current ? 'black' : 'white'} className={done || current ? '' : 'opacity-40'} />
                {done && (
                  <span className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-up text-black">
                    <Icon name="check" className="h-4 w-4" strokeWidth={3} />
                  </span>
                )}
              </button>
              <span className={`text-[15px] font-semibold ${current ? 'text-accent' : done ? 'text-ink' : 'text-ink-2'}`}>{s.title}</span>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
