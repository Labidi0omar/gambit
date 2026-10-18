import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Seal } from './ui';

/** Brief brand intro on the first open of a session. */
export function Splash() {
  const [show, setShow] = useState(() => {
    try {
      return !sessionStorage.getItem('gambit.splash');
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!show) return;
    try {
      sessionStorage.setItem('gambit.splash', '1');
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => setShow(false), 1300);
    return () => clearTimeout(t);
  }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-bg"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
          onClick={() => setShow(false)}
        >
          <div className="flex items-center gap-5">
            <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 18 }}>
              <Seal size={72} />
            </motion.div>
            <motion.div
              className="display-xl"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              Gambit
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
