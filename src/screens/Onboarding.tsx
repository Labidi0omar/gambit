// First launch: three quick questions, then straight into the first step. Not a test.
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Wordmark } from '../components/ui';
import { useJourney, type Knows, type Minutes } from '../store/journey';
import { useNav } from '../store/nav';

interface Question<T> {
  ask: string;
  note: string;
  options: { label: string; value: T }[];
}

const Q1: Question<Knows> = {
  ask: 'Do you know how the chess pieces move?',
  note: 'No wrong answers. This only decides where you start.',
  options: [
    { label: 'No, not yet', value: 'no' },
    { label: 'Some of them', value: 'some' },
    { label: 'Yes, all of them', value: 'yes' },
  ],
};
const Q2: Question<boolean> = {
  ask: 'Have you ever played a full game?',
  note: 'From the first move until someone wins.',
  options: [
    { label: 'Not yet', value: false },
    { label: 'Yes', value: true },
  ],
};
const Q3: Question<Minutes> = {
  ask: 'How much time do you want to spend each day?',
  note: 'You can always do more.',
  options: [
    { label: '10 minutes', value: 10 },
    { label: '20 minutes', value: 20 },
    { label: '30 minutes', value: 30 },
  ],
};

export function Onboarding() {
  const finish = useJourney((s) => s.finishOnboarding);
  const go = useNav((s) => s.go);
  const [n, setN] = useState(0);
  const [knows, setKnows] = useState<Knows>('no');
  const [played, setPlayed] = useState(false);

  // Someone who doesn't know the pieces hasn't really played a game: skip question 2 for them.
  const ask = (q: Question<unknown>, pick: (v: never) => void) => (
    <motion.div key={q.ask} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="flex flex-col gap-8">
      <div>
        <h1 className="display-m">{q.ask}</h1>
        <p className="mt-3 text-[17px] text-ink-2">{q.note}</p>
      </div>
      <div className="flex flex-col gap-2">
        {q.options.map((o) => (
          <button key={o.label} onClick={() => pick(o.value as never)} className="bg-surface px-5 py-4 text-left text-[19px] font-semibold transition-colors hover:bg-surface-2">
            {o.label}
          </button>
        ))}
      </div>
    </motion.div>
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-10 pt-6">
      <div className="mb-12 flex items-center justify-between">
        <Wordmark />
        <div className="flex gap-1.5" aria-label={`Question ${n + 1} of 3`}>
          {[0, 1, 2].map((k) => (
            <span key={k} className={`h-1.5 w-8 ${k <= n ? 'bg-accent' : 'bg-surface-3'}`} />
          ))}
        </div>
      </div>
      <AnimatePresence mode="wait">
        {n === 0 &&
          ask(Q1 as Question<unknown>, (v: Knows) => {
            setKnows(v);
            setN(v === 'no' ? 2 : 1);
          })}
        {n === 1 &&
          ask(Q2 as Question<unknown>, (v: boolean) => {
            setPlayed(v);
            setN(2);
          })}
        {n === 2 &&
          ask(Q3 as Question<unknown>, (v: Minutes) => {
            finish({ knowsPieces: knows, playedGame: played, minutes: v });
            go('session');
          })}
      </AnimatePresence>
    </div>
  );
}
