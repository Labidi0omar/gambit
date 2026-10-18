import { useEffect } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Play } from './screens/Play';
import { Puzzles } from './screens/Puzzles';
import { Learn } from './screens/Learn';
import { Review } from './screens/Review';
import { Today } from './screens/Today';
import { Progress } from './screens/Progress';
import { Openings } from './screens/Openings';
import { Onboarding } from './screens/Onboarding';
import { Session } from './screens/Session';
import { FirstStepsHome } from './screens/FirstStepsHome';
import { Icon, Wordmark, type IconName } from './components/ui';
import { Splash } from './components/Splash';
import { FeatureIntro } from './components/FeatureIntro';
import { useNav, type Tab } from './store/nav';
import { useSound } from './store/sound';
import { useJourney, firstStepsDone } from './store/journey';
import { useUnlocks } from './lib/useUnlocks';
import { howToUnlock, type Feature } from './lib/unlocks';
import { useGames } from './store/games';

type NavTab = Exclude<Tab, 'session'>;
const LABEL: Record<NavTab, string> = { today: 'Today', learn: 'Learn', puzzles: 'Puzzles', openings: 'Openings', play: 'Play', review: 'Games', progress: 'Progress' };

export default function App() {
  const { tab, puzzleTheme, puzzleReview, puzzle, go } = useNav();
  const { muted, toggle } = useSound();
  const journey = useJourney();
  const open = useUnlocks();
  const gamesPlayed = useGames((s) => s.games.length);
  const pathDone = firstStepsDone(journey);

  // Progressive reveal: a tab exists only once its feature is open.
  const visible: Record<NavTab, boolean> = {
    today: true,
    learn: open.learn,
    puzzles: open.puzzles,
    openings: open.openings,
    play: open.play,
    review: open.play,
    progress: open.ratings,
  };
  const desktopLinks = (['learn', 'puzzles', 'openings', 'play', 'review', 'progress'] as NavTab[]).filter((t) => visible[t]);
  // The phone bar fits six; Openings is reached from Learn there.
  const phoneTabs = (['today', 'learn', 'puzzles', 'play', 'review', 'progress'] as NavTab[]).filter((t) => visible[t]);
  const showNav = tab !== 'session' && desktopLinks.length > 0;


  // Play stays mounted so a running game survives tab switches; chessground caches its
  // board bounds, so tell it to re-measure when the board becomes visible again.
  useEffect(() => {
    if (tab !== 'play') return;
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      document.body.dispatchEvent(new Event('chessground.resize'));
    });
  }, [tab]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [tab]);

  if (!journey.onboarded)
    return (
      <MotionConfig reducedMotion="user">
        <Splash />
        <Onboarding />
      </MotionConfig>
    );

  // A link (or a tab saved from an earlier visit) can point at a locked feature. Say so and say how
  // to open it, rather than silently bouncing home: a bounce looks like a broken button.
  const lockedFeature: Feature | null =
    tab !== 'session' && !visible[tab as NavTab] ? (tab === 'review' ? 'play' : tab === 'progress' ? 'ratings' : (tab as Feature)) : null;

  const page = (() => {
    if (lockedFeature)
      return (
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 pb-20 pt-10 md:pt-16">
          <h1 className="display-m">{LABEL[tab as NavTab]} isn't open yet</h1>
          <p className="text-xl leading-relaxed">{howToUnlock(lockedFeature, gamesPlayed)}</p>
          <button onClick={() => go('today')} className="btn-primary self-start">
            Back to home
          </button>
        </div>
      );
    switch (tab) {
      case 'session':
        return <Session />;
      case 'today':
        return pathDone ? <Today /> : <FirstStepsHome />;
      case 'learn':
        return <Learn />;
      case 'puzzles':
        return <Puzzles key={`${puzzleTheme ?? ''}-${puzzleReview ? 'r' : ''}-${puzzle?.id ?? ''}`} theme={puzzleTheme} review={puzzleReview} first={puzzle} />;
      case 'review':
        return <Review />;
      case 'progress':
        return <Progress />;
      case 'openings':
        return <Openings />;
      default:
        return null;
    }
  })();

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-accent focus:px-4 focus:py-2 focus:text-black">
          Skip to content
        </a>
        <Splash />
        {tab === 'today' && <FeatureIntro open={open} />}

        <header className="sticky top-0 z-30 bg-bg">
          <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-8 px-4 md:px-8">
            <button onClick={() => go('today')} aria-label="Gambit, home">
              <Wordmark />
            </button>
            {showNav && (
              <nav className="hidden items-center gap-7 md:flex" aria-label="Main">
                {desktopLinks.map((t) => (
                  <button
                    key={t}
                    onClick={() => go(t)}
                    aria-current={tab === t ? 'page' : undefined}
                    className={`text-[15px] font-semibold transition-colors duration-200 ${tab === t ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}
                  >
                    {LABEL[t]}
                    <span className={`mt-1 block h-[3px] bg-accent transition-opacity ${tab === t ? 'opacity-100' : 'opacity-0'}`} />
                  </button>
                ))}
              </nav>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={toggle}
                aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
                className="flex h-11 w-11 items-center justify-center text-ink-2 transition-colors hover:text-ink"
              >
                <Icon name={muted ? 'soundOff' : 'soundOn'} />
              </button>
              {pathDone && showNav && (
                <button onClick={() => go('today')} className="btn-primary hidden !py-2.5 md:inline-flex">
                  Today&rsquo;s training
                </button>
              )}
            </div>
          </div>
        </header>

        <main id="main" className={showNav ? 'pb-24 md:pb-0' : ''}>
          {open.play && (
            <div className={tab === 'play' ? '' : 'hidden'}>
              <Play />
            </div>
          )}
          <AnimatePresence mode="wait">
            {page && (
              <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                {page}
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {showNav && phoneTabs.length > 1 && (
          <nav className="fixed inset-x-0 bottom-0 z-30 bg-surface md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Main">
            <div className="grid" style={{ gridTemplateColumns: `repeat(${phoneTabs.length}, minmax(0, 1fr))` }}>
              {phoneTabs.map((t) => (
                <button
                  key={t}
                  onClick={() => go(t)}
                  aria-current={tab === t ? 'page' : undefined}
                  className={`flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${tab === t ? 'text-ink' : 'text-ink-2'}`}
                >
                  <span className={`h-[3px] w-6 ${tab === t ? 'bg-accent' : 'bg-transparent'}`} />
                  <Icon name={t as IconName} className="h-5 w-5" />
                  {LABEL[t]}
                </button>
              ))}
            </div>
          </nav>
        )}
      </div>
    </MotionConfig>
  );
}
