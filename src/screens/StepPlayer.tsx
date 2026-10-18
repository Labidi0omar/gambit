// Runs one First Steps step: intro -> worked example -> guided try -> solo try -> "you learned".
// Gentle by design: no red flashes or buzzers, a hint ladder on every task, and after two misses
// an easier task comes first so every step ends on a success.
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { STEPS, type Step, type Task } from '../lib/firststeps';
import { ShowTask, TapTask, CollectTask, PickTask, ChoiceTask, MoveTask } from '../components/StepTasks';
import { CoachGame } from '../components/CoachGame';
import { PieceArt, Icon } from '../components/ui';
import { sound } from '../lib/sound';
import { WatchFirst, LESSON_VIDEOS } from '../components/WatchFirst';

const PHASE_LABEL: Record<Task['phase'], string> = { example: 'Watch', guided: 'Try it with help', solo: 'Your turn' };
const HINT_LABEL = ['Hint', 'More help', 'Show me where', 'Do it for me', ''];

export function StepPlayer({
  step,
  onDone,
  onExit,
  label,
  compact = false,
}: {
  step: Step;
  onDone: () => void;
  onExit: () => void;
  label?: string;
  /** warm-up and practice: no intro or "you learned" card */
  compact?: boolean;
}) {
  // Guided tries start with the first hint already showing.
  const startHint = (t?: Task | null) => (t?.phase === 'guided' ? 1 : 0);
  const [queue, setQueue] = useState<Task[]>(() => step.tasks);
  const [i, setI] = useState(compact ? 0 : -1); // -1 = intro card
  const [run, setRun] = useState(0); // remount key: changes on every new task shown
  const [hint, setHint] = useState(() => (compact ? startHint(step.tasks[0]) : 0));
  const [solved, setSolved] = useState<{ msg?: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [misses, setMisses] = useState(0);
  const [eased, setEased] = useState<Set<number>>(new Set());
  const [learned, setLearned] = useState(false);
  const task = i >= 0 ? queue[i] : null;

  const show = (n: number, q: Task[] = queue, keepNote: string | null = null) => {
    setI(n);
    setRun((r) => r + 1);
    setHint(startHint(q[n]));
    setSolved(null);
    setNote(keepNote);
    setMisses(0);
  };

  const onSuccess = (msg?: string) => {
    if (task?.phase !== 'example') sound.correct();
    setNote(null);
    setSolved({ msg });
  };

  const onMistake = (why: string) => {
    setNote(why);
    if (!task || task.type === 'game' || task.phase === 'example') return;
    const n = misses + 1;
    setMisses(n);
    // Two misses: step back to something easier first, then come back to this one.
    if (n >= 2 && !eased.has(i)) {
      const easier = queue.slice(0, i).reverse().find((t) => t.phase === 'guided') ?? step.tasks.find((t) => t.phase === 'guided');
      if (easier) {
        const q = [...queue.slice(0, i), { ...easier }, ...queue.slice(i)];
        setEased(new Set([...eased, i, i + 1]));
        setQueue(q);
        show(i, q, "Let's take a smaller step first, then come back to this one.");
      }
    }
  };

  const next = () => {
    if (i + 1 < queue.length) show(i + 1);
    else if (compact) onDone();
    else {
      sound.complete();
      setLearned(true);
    }
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if (learned) onDone();
      else if (i < 0 || solved) next();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const progress = useMemo(() => (i < 0 ? 0 : (i + (solved ? 1 : 0)) / queue.length), [i, solved, queue.length]);
  const props = { hint, onSuccess, onMistake };

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pb-32 pt-4 md:px-8 md:pt-8">
      <div className="mb-6 flex items-center gap-4">
        <button onClick={onExit} className="flex h-11 w-11 items-center justify-center text-ink-2 hover:text-ink" aria-label="Leave this step">
          <Icon name="back" />
        </button>
        <div className="h-2 flex-1 bg-surface-2">
          <motion.div className="h-full bg-accent" initial={{ width: 0 }} animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.4 }} />
        </div>
        {label && <span className="text-[15px] text-ink-2">{label}</span>}
      </div>

      <AnimatePresence mode="wait">
        {learned ? (
          <motion.div key="learned" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto flex max-w-xl flex-col items-center gap-6 pt-10 text-center">
            <PieceArt role={step.icon} size={110} />
            <p className="text-[17px] font-semibold text-up">You learned</p>
            <h1 className="display-m">{step.learned}</h1>
            <button onClick={onDone} autoFocus className="btn-primary min-w-48">
              Continue
            </button>
          </motion.div>
        ) : i < 0 ? (
          <motion.div key="intro" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto flex max-w-xl flex-col items-start gap-6 pt-6">
            <PieceArt role={step.icon} size={96} />
            <h1 className="display-m">{step.title}</h1>
            <p className="font-display text-[24px] leading-snug">{step.intro}</p>
            <button onClick={() => show(0)} autoFocus className="btn-primary min-w-48">
              Start
            </button>
            {LESSON_VIDEOS[step.id] && (
              <div className="w-full">
                <WatchFirst video={LESSON_VIDEOS[step.id]} />
              </div>
            )}
          </motion.div>
        ) : task ? (
          <motion.div key={`${run}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px] md:gap-10">
            <div className="min-w-0">
              {task.type === 'show' && <ShowTask task={task} {...props} />}
              {task.type === 'tap' && <TapTask task={task} {...props} />}
              {(task.type === 'stars' || task.type === 'collect') && <CollectTask task={task as never} {...props} />}
              {task.type === 'pick' && <PickTask task={task} {...props} />}
              {task.type === 'choice' && <ChoiceTask task={task} {...props} />}
              {task.type === 'move' && <MoveTask task={task} {...props} />}
              {task.type === 'game' && <CoachGame {...props} />}
            </div>

            <div className="flex flex-col gap-4 md:pt-2">
              <p className="text-[15px] font-semibold text-accent">{PHASE_LABEL[task.phase]}</p>
              <p className="font-display text-[24px] leading-snug">{task.prompt}</p>
              {hint >= 1 && task.nudge && !solved && <p className="bg-surface px-4 py-3 text-[17px]">{task.nudge}</p>}
              {note && !solved && <p className="text-[17px] text-ink-2">{note}</p>}

              {solved ? (
                <div className="flex flex-col gap-4">
                  {solved.msg && <p className="text-[17px] text-up">{solved.msg}</p>}
                  <button onClick={next} autoFocus className="btn-primary self-start min-w-40">
                    Continue
                  </button>
                </div>
              ) : (
                task.phase !== 'example' &&
                hint < 4 && (
                  <button onClick={() => setHint(hint + 1)} className="btn-ghost self-start">
                    <Icon name="target" className="h-4 w-4" />
                    {HINT_LABEL[hint]}
                  </button>
                )
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export const stepById = (id: string) => STEPS.find((s) => s.id === id)!;
