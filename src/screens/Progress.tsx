import { useMemo, useState } from 'react';
import { usePuzzles } from '../store/puzzles';
import { useGames } from '../store/games';
import { useLessons } from '../store/lessons';
import { useDaily, dayStreak, bestDayStreak } from '../store/daily';
import { useNav } from '../store/nav';
import { LEVELS } from '../lib/lessons';
import { themeLabel } from '../lib/puzzles';
import { estimatedStrength } from '../lib/plan';
import { motion } from 'framer-motion';
import { rise } from '../components/ui';
import { blunderStep, useCctStats, CCT_KINDS, type CctKind } from '../lib/cct';
import { positions } from '../lib/review';

const GOAL = 1200;

export function Progress() {
  const { rating, rd, attempts, themeStats, missedThemes, bestStreak } = usePuzzles();
  const games = useGames((s) => s.games);
  const completed = useLessons((s) => s.completed);
  const days = useDaily((s) => s.days);
  const go = useNav((s) => s.go);

  const est = estimatedStrength(games, rating);
  const streak = dayStreak(days);
  const record = {
    w: games.filter((g) => g.result === 'win').length,
    d: games.filter((g) => g.result === 'draw').length,
    l: games.filter((g) => g.result === 'loss').length,
  };

  const pct = Math.min(100, (est.elo / GOAL) * 100);

  // Which CCT step each of your blunders skipped, across reviewed games.
  const cct = useCctStats();
  const skipped: Record<CctKind, number> = { check: 0, capture: 0, threat: 0 };
  for (const g of games) {
    if (!g.analysis) continue;
    const pos = positions(g);
    g.analysis.flags.forEach((f, i) => {
      if (f !== 'blunder' || pos[i].fen.split(' ')[1] !== g.userColor) return;
      const k = blunderStep(pos[i + 1].fen, g.analysis!.best[i + 1]);
      if (k) skipped[k]++;
    });
  }
  const totalSkipped = skipped.check + skipped.capture + skipped.threat;
  const worst = totalSkipped ? CCT_KINDS.reduce((a, b) => (skipped[b] > skipped[a] ? b : a)) : null;
  const CCT_NAME: Record<CctKind, string> = { check: 'Checks', capture: 'Captures', threat: 'Threats' };

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 md:px-8">
      <section className="grid gap-8 pb-14 pt-6 [&>*]:min-w-0 md:grid-cols-12 md:pb-20 md:pt-12">
        <motion.h1 {...rise(0)} className="display-xl md:col-span-7">
          Roughly {est.elo} in games.
        </motion.h1>
        <motion.p {...rise(1)} className="max-w-[40ch] self-end text-xl leading-relaxed md:col-span-5">
          A rough estimate from {est.basis === 'puzzles' ? 'your puzzles' : 'your bot games and puzzles'}: puzzle rating is not a game rating, and
          Lichess and Chess.com ratings differ from each other too. Puzzle rating {Math.round(rating)}, give or take {Math.round(rd)}. {record.w} wins, {record.d} draws and {record.l} losses against the bot.{' '}
          {streak ? `${streak} ${streak === 1 ? 'day' : 'days'} in a row` : 'No streak running'}, best {bestDayStreak(days)}. Longest puzzle run: {bestStreak}.
        </motion.p>
      </section>

      <motion.section {...rise(2)} className="pb-16 md:pb-24">
        <h2 className="display-m mb-6">Puzzle rating over time</h2>
        <RatingChart points={attempts.filter((a) => !a.review).map((a) => ({ ts: a.ts, r: a.ratingAfter }))} />
      </motion.section>

      <section className="pb-16 md:pb-24">
        <h2 className="display-m mb-2">The road to {GOAL}</h2>
        <p className="mb-6 text-[17px] text-ink-2">Estimated from {est.basis === 'puzzles' ? 'your puzzles' : 'your games and puzzles'}.</p>
        <div className="relative grid h-14 grid-cols-12 gap-[2px]">
          {LEVELS.map((l, i) => (
            <div key={l.level} className={`relative bg-surface-2 ${i === 0 ? 'col-span-6' : 'col-span-3'}`}>
              <span className="absolute bottom-full mb-2 text-[15px] font-semibold">{l.title}</span>
            </div>
          ))}
          <motion.div
            className="absolute inset-y-0 left-0 bg-accent"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[15px] text-ink-2">
          <span>0</span>
          <span>600</span>
          <span>900</span>
          <span>{GOAL}</span>
        </div>
      </section>

      <section className="pb-16 md:pb-24">
        <h2 className="display-m mb-2">Blind spots</h2>
        <p className="mb-8 max-w-[52ch] text-[17px] text-ink-2">
          {totalSkipped
            ? `Your blunders, by the CCT step you skipped. ${worst ? `${CCT_NAME[worst]} cost you the most.` : ''}`
            : 'Review a game to see which CCT step your blunders skip: checks, captures or threats.'}
        </p>
        <div className="grid grid-cols-3 gap-6">
          {CCT_KINDS.map((k) => {
            const t = cct.tally[k];
            return (
              <div key={k}>
                <div className={`num text-6xl font-semibold leading-none ${worst === k ? 'text-down' : ''}`}>{skipped[k]}</div>
                <div className="mt-3 text-[17px] font-semibold">Missed {k === 'check' ? 'checks' : k === 'capture' ? 'captures' : 'threats'}</div>
                <div className="mt-1 text-[15px] text-ink-2">
                  {t.total ? `CCT scans: found ${t.found} of ${t.total}` : 'No CCT scans yet'}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="-mx-4 bg-surface px-4 py-16 md:-mx-8 md:px-8 md:py-24">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <h2 className="display-m">Where you lose points</h2>
          <p className="text-[17px] text-ink-2">Tap a theme to drill it.</p>
        </div>
        <Heatmap stats={themeStats} missed={missedThemes} onPick={(t) => go('puzzles', { puzzleTheme: t })} />
      </section>

      <section className="py-16 md:py-24">
        <h2 className="display-m mb-8">Course</h2>
        <div className="grid gap-10 md:grid-cols-3">
          {LEVELS.map((l) => {
            const done = l.lessons.filter((x) => completed[x.id]).length;
            return (
              <button key={l.level} onClick={() => go('learn')} className="group text-left">
                <div className="num text-6xl font-semibold leading-none">
                  {done}
                  <span className="text-ink-2">/{l.lessons.length}</span>
                </div>
                <div className="mt-3 text-[17px] font-semibold group-hover:text-accent">{l.title}</div>
                <div className="mt-3 h-1.5 bg-surface-2">
                  <div className="h-full bg-accent" style={{ width: `${(done / l.lessons.length) * 100}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function RatingChart({ points }: { points: { ts: number; r: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(() => [{ ts: points[0]?.ts ?? 0, r: 500 }, ...points], [points]);
  if (points.length < 2)
    return <div className="py-10 text-center text-sm text-zinc-500">Solve a few puzzles to see your rating curve.</div>;
  const W = 640;
  const H = 240;
  const P = { l: 36, r: 8, t: 8, b: 20 };
  const lo = Math.floor((Math.min(...data.map((d) => d.r)) - 30) / 100) * 100;
  const hi = Math.ceil((Math.max(...data.map((d) => d.r)) + 30) / 100) * 100;
  const x = (i: number) => P.l + (i / (data.length - 1)) * (W - P.l - P.r);
  const y = (r: number) => P.t + (1 - (r - lo) / (hi - lo)) * (H - P.t - P.b);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.r)}`).join('');
  const ticks = [];
  for (let t = lo; t <= hi; t += hi - lo > 600 ? 200 : 100) ticks.push(t);
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(data.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (data.length - 1)))));
        }}
      >
                {ticks.map((t) => (
          <g key={t}>
            <text x={P.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#a9a18d">
              {t}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#c99a3e" strokeWidth="2" strokeLinejoin="round" />
        {h && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="rgb(255 255 255 / 0.2)" />
            <circle cx={x(hover)} cy={y(h.r)} r="4" fill="#c99a3e" stroke="#0b0b0f" strokeWidth="2" />
          </>
        )}
        <text x={P.l} y={H - 4} fontSize="11" fill="#a9a18d">
          {data.length - 1} puzzles
        </text>
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute right-2 top-0 rounded-lg bg-black/70 px-2 py-1 text-xs">
          <span className="num">{h.r}</span> <span className="text-zinc-400">{hover ? new Date(h.ts).toLocaleDateString() : 'start'}</span>
        </div>
      )}
    </div>
  );
}

function Heatmap({
  stats,
  missed,
  onPick,
}: {
  stats: Record<string, { ok: number; total: number }>;
  missed: Record<string, number>;
  onPick: (t: string) => void;
}) {
  // Lichess tags every puzzle with length/meta themes; they aren't skills to train.
  const META = new Set(['short', 'long', 'veryLong', 'oneMove', 'master', 'masterVsMaster', 'superGM', 'myGames', 'advantage', 'crushing', 'equality', 'middlegame', 'opening']);
  const themes = [...new Set([...Object.keys(stats), ...Object.keys(missed)])]
    .filter((t) => !META.has(t))
    .sort((a, b) => (stats[b]?.total ?? 0) - (stats[a]?.total ?? 0));
  if (!themes.length) return <div className="py-6 text-center text-sm text-zinc-500">No data yet. Puzzles and game reviews fill this in.</div>;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
      {themes.map((t) => {
        const s = stats[t] ?? { ok: 0, total: 0 };
        const acc = s.total ? s.ok / s.total : null;
        // red (0%) -> amber (50%) -> green (100%)
        const hue = acc === null ? 0 : acc * 140;
        const bg = acc === null ? 'rgb(255 255 255 / 0.04)' : `hsl(${hue} 70% 45% / ${0.15 + Math.min(1, s.total / 20) * 0.35})`;
        return (
          <button
            key={t}
            onClick={() => onPick(t)}
            className="p-4 text-left transition duration-200 hover:brightness-125"
            style={{ background: bg }}
          >
            <div className="truncate text-sm font-medium">{themeLabel(t)}</div>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-zinc-300">
              <span className="num">{acc === null ? '—' : `${Math.round(acc * 100)}%`}</span>
              <span className="text-zinc-400">
                {s.total} tried{missed[t] ? ` · ${missed[t]} missed in games` : ''}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
