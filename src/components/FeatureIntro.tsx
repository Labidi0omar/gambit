import { AnimatePresence, motion } from 'framer-motion';
import { FEATURE_INTRO, FEATURE_ORDER, type Feature } from '../lib/unlocks';
import { useJourney } from '../store/journey';
import { Seal } from './ui';

/** One card per newly opened feature, one at a time: what it is and why it matters. */
export function FeatureIntro({ open }: { open: Record<Feature, boolean> }) {
  const { introsSeen, seeIntro } = useJourney();
  const f = FEATURE_ORDER.find((k) => open[k] && !introsSeen[k]);
  const card = f ? FEATURE_INTRO[f] : null;
  return (
    <AnimatePresence>
      {f && card && (
        <motion.div key={f} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="intro-title">
          <motion.div initial={{ y: 24 }} animate={{ y: 0 }} className="flex w-full max-w-md flex-col gap-4 bg-surface-2 p-7">
            <Seal size={48} />
            <h2 id="intro-title" className="display-m">
              {card.title}
            </h2>
            <p className="text-[19px] leading-relaxed">{card.what}</p>
            <p className="text-[17px] text-ink-2">{card.why}</p>
            <button onClick={() => seeIntro(f)} autoFocus className="btn-primary mt-2">
              Got it
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
