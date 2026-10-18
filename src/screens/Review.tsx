import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { AnimatePresence, motion } from 'framer-motion';
import { Board } from '../components/Board';
import { toDests, isPromotion } from '../lib/chess';
import { analyzeGame, positions, formatEval, whitePov, type Position } from '../lib/review';
import { themeLabel } from '../lib/puzzles';
import { getEngine, FULL_STRENGTH } from '../engine/stockfish';
import { useGames, type GameRecord, type GameAnalysis } from '../store/games';
import { usePuzzles } from '../store/puzzles';
import { useNav } from '../store/nav';
import { sound } from '../lib/sound';
import { useUnlocks } from '../lib/useUnlocks';
import { blunderStep, CCT_LABEL, type CctKind } from '../lib/cct';

const NO_DESTS = new Map<Key, Key[]>();
const PRACTICE_TOLERANCE = 50; // a move within half a pawn of best counts as found
const arrow = (uci: string, brush: string): DrawShape => ({ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush });
const RESULT_TEXT = { win: 'Won', loss: 'Lost', draw: 'Draw' } as const;

export function Review() {
  const gameId = useNav((s) => s.gameId);
  const game = useGames((s) => s.games.find((g) => g.id === gameId));
  return game ? <GameReview key={game.id} game={game} /> : <GameList />;
}

function GameList() {
  const games = useGames((s) => s.games);
  const go = useNav((s) => s.go);
  if (!games.length)
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-zinc-400">
        No games yet.{' '}
        <button onClick={() => go('play')} className="text-accent hover:underline">
          Play the bot
        </button>{' '}
        and your games show up here for review.
      </div>
    );
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-8 pt-4 md:px-8 md:pt-10">
      <h1 className="font-display mb-2 text-3xl font-bold md:text-4xl">Your games</h1>
      {games.map((g) => {
        const mine = g.analysis?.flags.filter((f, i) => f && (i % 2 === 0) === (g.userColor === 'w')) ?? [];
        return (
          <button
            key={g.id}
            onClick={() => go('review', { gameId: g.id })}
            className="glass flex items-center gap-4 p-4 text-left transition-colors hover:bg-white/[0.07]"
          >
            <span
              className={`w-12 text-sm font-semibold ${g.result === 'win' ? 'text-up' : g.result === 'loss' ? 'text-down' : 'text-zinc-300'}`}
            >
              {RESULT_TEXT[g.result]}
            </span>
            <span className="flex-1 text-sm">
              vs Stockfish {g.botElo} &middot; {g.userColor === 'w' ? 'White' : 'Black'} &middot; {Math.ceil(g.san.length / 2)} moves
              <span className="block text-xs text-zinc-500">
                {new Date(g.date).toLocaleString()} &middot; {g.reason}
              </span>
            </span>
            <span className="text-xs text-zinc-400">
              {g.analysis ? (
                <>
                  <span className="text-down">{mine.filter((f) => f === 'blunder').length}??</span>{' '}
                  <span className="text-amber-400">{mine.filter((f) => f === 'mistake').length}?</span>
                </>
              ) : (
                'not reviewed'
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Feeds the user's own blunders/mistakes into spaced repetition and the missed-theme tally. */
function feedTraining(game: GameRecord, a: GameAnalysis, pos: Position[]) {
  const { addGamePuzzle, addMissedTheme, rating } = usePuzzles.getState();
  a.flags.forEach((flag, i) => {
    if (!flag || pos[i].fen.split(' ')[1] !== game.userColor) return;
    const theme = a.themes[i];
    if (theme) addMissedTheme(theme);
    // Puzzle format matches Lichess: first move is the opponent's setup move.
    if (i === 0 || !a.best[i]) return;
    addGamePuzzle({
      id: `g${game.id}-${i}`,
      fen: pos[i - 1].fen,
      moves: `${pos[i - 1].uci} ${a.best[i]}`,
      rating: Math.round(rating),
      themes: theme ? [theme, 'myGames'] : ['myGames'],
    });
  });
}

function GameReview({ game }: { game: GameRecord }) {
  // The eval number is shown only once ratings and numbers have been introduced.
  const showEval = useUnlocks().ratings;
  const setAnalysis = useGames((s) => s.setAnalysis);
  const go = useNav((s) => s.go);
  const pos = useMemo(() => positions(game), [game]);
  const a = game.analysis;
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [cur, setCur] = useState(0);
  const [practice, setPractice] = useState(false);
  const orientation = game.userColor === 'w' ? 'white' : 'black';
  const isUserPly = (i: number) => pos[i].fen.split(' ')[1] === game.userColor;

  useEffect(() => {
    if (a) return;
    let cancelled = false;
    analyzeGame(game, (d, t) => setProgress(d / t), () => cancelled)
      .then((res) => {
        if (!res || cancelled) return;
        setAnalysis(game.id, res);
        feedTraining(game, res, pos);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    if (practice) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setCur((c) => Math.max(0, c - 1));
      if (e.key === 'ArrowRight') setCur((c) => Math.min(pos.length - 1, c + 1));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [pos.length, practice]);

  const userFlags = a ? a.flags.map((f, i) => (f && isUserPly(i) ? i : -1)).filter((i) => i >= 0) : [];
  const counts = {
    blunder: userFlags.filter((i) => a!.flags[i] === 'blunder').length,
    mistake: userFlags.filter((i) => a!.flags[i] === 'mistake').length,
  };
  const missed = a ? [...new Set(userFlags.map((i) => a.themes[i]).filter(Boolean) as string[])] : [];
  const steps = a
    ? userFlags
        .filter((i) => a.flags[i] === 'blunder')
        .map((i) => blunderStep(pos[i + 1].fen, a.best[i + 1]))
        .filter(Boolean) as CctKind[]
    : [];
  const stepCounts = (['check', 'capture', 'threat'] as CctKind[]).map((k) => [k, steps.filter((x) => x === k).length] as const).filter(([, n]) => n);

  if (practice && a) return <Practice game={game} a={a} pos={pos} plies={userFlags} onExit={() => setPractice(false)} />;

  // Arrows at the current position: the move played (blue) and, if it was bad, the best move (green).
  const shapes: DrawShape[] = [];
  if (cur < pos.length - 1 && pos[cur].uci) {
    shapes.push(arrow(pos[cur].uci!, 'yellow'));
    if (a?.flags[cur] && a.best[cur]) shapes.push(arrow(a.best[cur], 'green'));
  }
  const last = cur > 0 ? pos[cur - 1].uci : undefined;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 pb-8 pt-4 md:grid-cols-[minmax(0,1fr)_340px] md:gap-8 md:px-8 md:pt-10">
      <div className="mx-auto flex w-full max-w-[min(100%,calc(100dvh-12rem))] flex-col gap-3">
        <Board
          fen={pos[cur].fen}
          orientation={orientation}
          turnColor={pos[cur].fen.split(' ')[1] === 'w' ? 'white' : 'black'}
          dests={NO_DESTS}
          viewOnly
          lastMove={last ? [last.slice(0, 2) as Key, last.slice(2, 4) as Key] : undefined}
          check={new Chess(pos[cur].fen).inCheck()}
          shapes={shapes}
        />
        <div className="flex items-center gap-2">
          {[
            ['⏮', 0],
            ['◀', Math.max(0, cur - 1)],
            ['▶', Math.min(pos.length - 1, cur + 1)],
            ['⏭', pos.length - 1],
          ].map(([label, to]) => (
            <button key={label} onClick={() => setCur(to as number)} className="glass flex-1 py-2 text-sm hover:bg-white/10">
              {label}
            </button>
          ))}
        </div>
        {a && <EvalGraph a={a} cur={cur} onPick={setCur} userColor={game.userColor} />}
      </div>

      <aside className="flex flex-col gap-4">
        <div className="glass p-5">
          <div className="flex items-center justify-between">
            <button onClick={() => go('review')} className="text-sm text-zinc-400 hover:text-white">
              &larr; Games
            </button>
            <span className="text-xs text-zinc-500">vs Stockfish {game.botElo}</span>
          </div>
          {!a && failed ? (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm text-zinc-300">The chess engine didn't load, so this game can't be analyzed yet. Check your connection.</p>
              <button
                onClick={() => {
                  setFailed(false);
                  setProgress(0);
                  setAttempt((n) => n + 1);
                }}
                className="btn-primary self-start"
              >
                Try again
              </button>
            </div>
          ) : !a ? (
            <div className="mt-4">
              <div className="mb-2 text-sm text-zinc-300">Analyzing every move (depth 14)&hellip;</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full bg-accent" animate={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          ) : (
            <>
              <div className={`mt-4 grid gap-2 text-center ${showEval ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <Stat n={counts.blunder} label="Blunders" cls="text-down" />
                <Stat n={counts.mistake} label="Mistakes" cls="text-amber-400" />
                {showEval && <Stat n={formatEval(a.evals[cur])} label="Eval" cls="text-zinc-100" />}
              </div>
              {stepCounts.length > 0 && (
                <p className="mt-4 text-[15px]">
                  <span className="text-ink-2">Blunders came from: </span>
                  {stepCounts.map(([k, n]) => `${n} ${CCT_LABEL[k]}${n === 1 ? '' : 's'}`).join(', ')}
                </p>
              )}
              {missed.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {missed.map((t) => (
                    <button
                      key={t}
                      onClick={() => go('puzzles', { puzzleTheme: t })}
                      className="chip hover:bg-surface-3"
                      title="Practice this theme"
                    >
                      {themeLabel(t)} &rarr;
                    </button>
                  ))}
                </div>
              )}
              <button
                disabled={!userFlags.length}
                onClick={() => setPractice(true)}
                className="btn-accent mt-4 w-full"
              >
                {userFlags.length ? `Find the better move (${userFlags.length})` : 'No mistakes to practice'}
              </button>
              {userFlags.length > 0 && <p className="mt-2 text-xs text-zinc-500">These positions were also added to your puzzle reviews.</p>}
            </>
          )}
        </div>

        <MoveList pos={pos} a={a} cur={cur} onPick={setCur} isUserPly={isUserPly} />
      </aside>
    </div>
  );
}

function Stat({ n, label, cls }: { n: number | string; label: string; cls: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] py-3">
      <div className={`num text-lg font-semibold ${cls}`}>{n}</div>
      <div className="text-sm text-ink-2">{label}</div>
    </div>
  );
}

function MoveList({
  pos,
  a,
  cur,
  onPick,
  isUserPly,
}: {
  pos: Position[];
  a?: GameAnalysis;
  cur: number;
  onPick: (i: number) => void;
  isUserPly: (i: number) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[data-cur="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cur]);
  const plies = pos.slice(0, -1);
  const white0 = pos[0].fen.split(' ')[1] === 'w';
  const cell = (i: number) => {
    if (i < 0 || i >= plies.length) return <span />;
    const f = a?.flags[i];
    const mark = f === 'blunder' ? '??' : f === 'mistake' ? '?' : '';
    // Selecting a move shows the position after it.
    const active = cur === i + 1;
    return (
      <button
        data-cur={active}
        onClick={() => onPick(i + 1)}
        className={`rounded px-1.5 py-0.5 text-left ${active ? 'bg-accent/30 text-white' : 'hover:bg-white/10'} ${
          f === 'blunder' ? 'text-down' : f === 'mistake' ? 'text-amber-400' : ''
        } ${isUserPly(i) ? '' : 'opacity-70'}`}
      >
        {plies[i].san}
        {mark}
      </button>
    );
  };
  const rows = Math.ceil((plies.length + (white0 ? 0 : 1)) / 2);
  return (
    <div ref={ref} className="glass max-h-80 overflow-y-auto p-3 num text-sm">
      <div className="grid grid-cols-[2rem_1fr_1fr] gap-y-0.5">
        {Array.from({ length: rows }, (_, r) => {
          const w = white0 ? r * 2 : r * 2 - 1;
          return (
            <div key={r} className="contents">
              <span className="py-0.5 text-zinc-500">{r + 1}.</span>
              {cell(w)}
              {cell(w + 1)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EvalGraph({ a, cur, onPick, userColor }: { a: GameAnalysis; cur: number; onPick: (i: number) => void; userColor: 'w' | 'b' }) {
  const W = 600;
  const H = 90;
  const n = a.evals.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  // Squash evals so ±10 pawns fill the graph but small edges still show.
  const y = (cp: number) => H / 2 - (Math.tanh(cp / 400) * H) / 2;
  const line = a.evals.map((e, i) => `${x(i)},${y(e)}`).join(' ');
  return (
    <div className="glass overflow-hidden p-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-20 w-full cursor-pointer"
        preserveAspectRatio="none"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onPick(Math.round(((e.clientX - r.left) / r.width) * (n - 1)));
        }}
      >
        <polygon points={`0,${H} ${line} ${W},${H}`} fill="rgb(255 255 255 / 0.85)" />
        <rect x="0" y="0" width={W} height={H} fill="rgb(0 0 0 / 0.0)" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="rgb(124 108 255 / 0.5)" strokeWidth="1" />
        {a.flags.map((f, i) => {
          if (!f) return null;
          const mine = (i % 2 === 0) === (userColor === 'w');
          if (!mine) return null;
          return <circle key={i} cx={x(i + 1)} cy={y(a.evals[i + 1])} r="4" fill={f === 'blunder' ? '#f87171' : '#fbbf24'} />;
        })}
        <line x1={x(cur)} x2={x(cur)} y1="0" y2={H} stroke="#7c6cff" strokeWidth="2" />
      </svg>
    </div>
  );
}

// ---------- blunder practice: "find the better move" ----------

function Practice({ game, a, pos, plies, onExit }: { game: GameRecord; a: GameAnalysis; pos: Position[]; plies: number[]; onExit: () => void }) {
  const [k, setK] = useState(0);
  const [state, setState] = useState<'move' | 'checking' | 'right' | 'wrong' | 'shown'>('move');
  const [fen, setFen] = useState(pos[plies[0]].fen);
  const [last, setLast] = useState<[Key, Key]>();
  const [msg, setMsg] = useState('');
  const [solved, setSolved] = useState(0);
  const [, setTick] = useState(0);
  const i = plies[k];
  const orientation = game.userColor === 'w' ? 'white' : 'black';
  const pov = game.userColor === 'w' ? 1 : -1;

  const load = (idx: number) => {
    setK(idx);
    setFen(pos[plies[idx]].fen);
    setState('move');
    setMsg('');
    setLast(undefined);
  };

  const onMove = async (from: Key, to: Key) => {
    const c = new Chess(pos[i].fen);
    let mv;
    try {
      mv = c.move({ from, to, promotion: isPromotion(c, from, to) ? (a.best[i][4] ?? 'q') : undefined });
    } catch {
      return setTick((t) => t + 1);
    }
    const uci = mv.from + mv.to + (mv.promotion ?? '');
    setFen(c.fen());
    setLast([from, to]);
    if (uci === pos[i].uci) {
      setState('wrong');
      return setMsg('That is the move you played in the game. Find a better one.');
    }
    let good = uci === a.best[i] || c.isCheckmate();
    if (!good) {
      setState('checking');
      await getEngine().setStrength({ elo: FULL_STRENGTH });
      const r = await getEngine().analyze(c.fen(), 12);
      const after = pov * whitePov(c.fen(), r);
      const loss = Math.max(-1000, Math.min(1000, pov * a.evals[i])) - Math.max(-1000, Math.min(1000, after));
      good = loss <= PRACTICE_TOLERANCE;
    }
    if (good) {
      sound.correct();
      setState('right');
      setSolved((s) => s + 1);
      setMsg(uci === a.best[i] ? `${mv.san}! The engine's top choice.` : `${mv.san} works too. Engine's best was ${sanOf(pos[i].fen, a.best[i])}.`);
    } else {
      sound.wrong();
      setState('wrong');
      setMsg(`${mv.san} isn't better. Try again.`);
    }
  };

  const retry = () => {
    setFen(pos[i].fen);
    setLast(undefined);
    setState('move');
    setMsg('');
  };

  const show = () => {
    setFen(pos[i].fen);
    setLast(undefined);
    setState('shown');
    setMsg(`Best was ${sanOf(pos[i].fen, a.best[i])}${a.themes[i] ? ` (${themeLabel(a.themes[i]!)})` : ''}.`);
  };

  const done = state === 'right' || state === 'shown';
  const shapes: DrawShape[] = state === 'shown' ? [arrow(a.best[i], 'green')] : [];
  const moveNo = Math.floor(i / 2) + 1;
  const flag = a.flags[i];

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 pb-8 pt-4 md:grid-cols-[minmax(0,1fr)_340px] md:gap-8 md:px-8 md:pt-10">
      <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-10rem))]">
        <Board
          fen={fen}
          orientation={orientation}
          turnColor={fen.split(' ')[1] === 'w' ? 'white' : 'black'}
          movableColor={orientation}
          dests={state === 'move' ? toDests(new Chess(fen)) : NO_DESTS}
          lastMove={last}
          check={new Chess(fen).inCheck()}
          shapes={shapes}
          onMove={onMove}
        />
      </div>
      <aside className="flex flex-col gap-4">
        <div className="glass flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between text-sm">
            <button onClick={onExit} className="text-zinc-400 hover:text-white">
              &larr; Review
            </button>
            <span className="text-zinc-500">
              {k + 1} / {plies.length} &middot; {solved} found
            </span>
          </div>
          <div className="text-base leading-relaxed">
            Move {moveNo}: you played <span className={flag === 'blunder' ? 'text-down' : 'text-amber-400'}>{pos[i].san}</span>
            {flag === 'blunder' ? '??' : '?'}
            {flag === 'blunder' && blunderStep(pos[i + 1].fen, a.best[i + 1]) && (
              <span className="text-ink-2"> ({CCT_LABEL[blunderStep(pos[i + 1].fen, a.best[i + 1])!]})</span>
            )}{' '}
            Find a better move.
          </div>
          <AnimatePresence mode="wait">
            {msg && (
              <motion.div
                key={msg}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={`text-sm ${state === 'right' ? 'text-emerald-300' : state === 'shown' ? 'text-zinc-300' : 'text-red-300'}`}
              >
                {msg}
              </motion.div>
            )}
          </AnimatePresence>
          {state === 'checking' && <div className="text-sm text-zinc-400">Checking with Stockfish&hellip;</div>}
          <div className="flex gap-2">
            {state === 'wrong' && (
              <>
                <button onClick={retry} className="btn-ghost flex-1">
                  Try again
                </button>
                <button onClick={show} className="btn-ghost flex-1">
                  Show best
                </button>
              </>
            )}
            {done && (
              <button
                onClick={() => (k + 1 < plies.length ? load(k + 1) : onExit())}
                className="btn-primary flex-1"
              >
                {k + 1 < plies.length ? 'Next' : 'Done'}
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function sanOf(fen: string, uci: string) {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}
