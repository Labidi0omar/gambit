// A daily session for the first weeks: warm-up -> new step(s) -> short practice -> finish card.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { STEPS, type Step, type Task } from '../lib/firststeps';
import { StepPlayer } from './StepPlayer';
import { PieceArt } from '../components/ui';
import { useJourney, nextStep } from '../store/journey';
import { useDaily, dayKey } from '../store/daily';
import { useNav } from '../store/nav';

const replayable = (t: Task) => t.phase === 'solo' && t.type !== 'game' && t.type !== 'show';

type Item = { kind: 'warmup' | 'practice'; step: Step } | { kind: 'step'; step: Step };

function plan(stepId: string | undefined): Item[] {
  const j = useJourney.getState();
  // Replaying one step from the path map: just that step.
  if (stepId) return [{ kind: 'step', step: STEPS.find((s) => s.id === stepId)! }];

  const learned = STEPS.filter((s) => j.done[s.id]);
  const items: Item[] = [];
  // Warm-up: one solo task from a step you already finished (none on day one).
  const warm = learned.flatMap((s) => s.tasks.filter(replayable).map((t) => ({ s, t })));
  if (warm.length) {
    const { s, t } = warm[Math.floor(Math.random() * warm.length)];
    items.push({ kind: 'warmup', step: { ...s, id: `warmup-${s.id}`, title: 'Warm-up', tasks: [t] } });
  }
  // New steps: about one per five minutes of the time you chose.
  const count = Math.max(1, Math.round(j.profile.minutes / 5));
  const start = nextStep(j);
  if (start) {
    const from = STEPS.indexOf(start);
    for (const s of STEPS.slice(from, from + count)) {
      items.push({ kind: 'step', step: s });
      if (s.tasks.some((t) => t.type === 'game')) break; // the first game ends a session on its own
    }
  }
  // Practice: two solo tasks from the steps in this session (or recent ones).
  const pool = items
    .filter((i) => i.kind === 'step')
    .flatMap((i) => i.step.tasks.filter(replayable))
    .concat(learned.slice(-3).flatMap((s) => s.tasks.filter(replayable)));
  if (pool.length) {
    const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, 2);
    items.push({ kind: 'practice', step: { ...STEPS[0], id: 'practice', title: 'Practice', icon: 'knight', tasks: picks } });
  }
  return items;
}

export function Session() {
  const { stepId, go } = useNav();
  const complete = useJourney((s) => s.completeStep);
  const logDay = useDaily((s) => s.log);
  const items = useMemo(() => plan(stepId), [stepId]);
  const [i, setI] = useState(0);
  const [finished, setFinished] = useState(items.length === 0);
  const item = items[i];
  const newSteps = items.filter((x) => x.kind === 'step').length;
  const stepNo = items.slice(0, i + 1).filter((x) => x.kind === 'step').length;

  const advance = () => {
    if (item?.kind === 'step') {
      complete(item.step.id);
      logDay({ lessons: 1 });
    }
    if (i + 1 < items.length) setI(i + 1);
    else setFinished(true);
  };

  if (finished) return <Finish />;

  return (
    <StepPlayer
      key={`${i}-${item.step.id}`}
      step={item.step}
      compact={item.kind !== 'step'}
      label={item.kind === 'warmup' ? 'Warm-up' : item.kind === 'practice' ? 'Practice' : newSteps > 1 ? `New step ${stepNo} of ${newSteps}` : 'New step'}
      onDone={advance}
      onExit={() => go('today')}
    />
  );
}

function Finish() {
  const { go } = useNav();
  const j = useJourney();
  const today = STEPS.filter((s) => j.done[s.id] && dayKey(new Date(j.done[s.id])) === dayKey());
  const next = nextStep(j);
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto flex max-w-xl flex-col items-start gap-6 px-4 pb-20 pt-12">
      <PieceArt role="king" size={96} />
      <h1 className="display-m">Done for today.</h1>
      {today.length > 0 && (
        <div>
          <p className="text-[17px] font-semibold text-up">Today you learned</p>
          <ul className="mt-2 flex flex-col gap-2 text-[19px]">
            {today.map((s) => (
              <li key={s.id}>{s.learned}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[19px]">
        <span className="text-ink-2">Tomorrow: </span>
        {next ? next.title.toLowerCase() : 'your first lessons on tactics'}.
      </p>
      <button onClick={() => go('today')} autoFocus className="btn-primary min-w-48">
        Finish
      </button>
    </motion.div>
  );
}
