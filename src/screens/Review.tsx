import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { motion } from 'framer-motion';
import { Board } from '../components/Board';
import { toDests, isPromotion } from '../lib/chess';
import { analyzeGame, positions, formatEval, whitePov, REVIEW_DEPTH, type Position } from '../lib/review';
import { explainLine, compareLines, playLine, type LineStep } from '../lib/explain';
import { themeLabel } from '../lib/puzzles';
import { getEngine } from '../engine/stockfish';
import { useGames, type GameRecord, type GameAnalysis } from '../store/games';
import { usePuzzles } from '../store/puzzles';
import { useNav } from '../store/nav';
import { sound } from '../lib/sound';
import { useUnlocks } from '../lib/useUnlocks';

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
  const [sel, setSel] = useState(0);
  // Per mistake (ply): found the better move yourself, or asked to be shown. Until then it's a puzzle.
  const [outcome, setOutcome] = useState<Record<number, 'found' | 'shown'>>({});
  const [attemptView, setAttemptView] = useState<{ fen: string; last: [Key, Key] } | null>(null);
  const [tryMsg, setTryMsg] = useState<{ text: string; tone: 'bad' | 'good' | 'wait' } | null>(null);
  const tryToken = useRef(0);
  const [line, setLine] = useState<ShownLine | null>(null);
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
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setLine(null);
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      // While a line is shown, the arrows step through it; otherwise through the game.
      if (line) return setLine({ ...line, n: Math.max(0, Math.min(line.steps.length - 1, line.n + d)) });
      setCur((c) => Math.max(0, Math.min(pos.length - 1, c + d)));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [pos.length, line]);

  const userFlags = a ? a.flags.map((f, i) => (f && isUserPly(i) ? i : -1)).filter((i) => i >= 0) : [];
  const counts = {
    blunder: userFlags.filter((i) => a!.flags[i] === 'blunder').length,
    mistake: userFlags.filter((i) => a!.flags[i] === 'mistake').length,
  };
  const missed = a ? [...new Set(userFlags.map((i) => a.themes[i]).filter(Boolean) as string[])] : [];

  // Open on the first mistake once the analysis is in: that's what you came here for.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !a) return;
    opened.current = true;
    if (userFlags.length) setCur(userFlags[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  const resetTry = () => {
    tryToken.current++;
    setAttemptView(null);
    setTryMsg(null);
  };
  const pickMistake = (k: number) => {
    setSel(k);
    setCur(userFlags[k]);
    setLine(null);
    resetTry();
  };
  const browse = (to: number) => {
    setCur(to);
    setLine(null);
    resetTry();
  };

  // On an unsolved mistake the board is a puzzle: find a better move than the one you played.
  const trying = !!a && !line && userFlags.includes(cur) && !outcome[cur];
  const canTry = trying && !attemptView && tryMsg?.tone !== 'wait';

  const onTryMove = async (from: Key, to: Key) => {
    if (!a || !canTry) return;
    const i = cur;
    const c = new Chess(pos[i].fen);
    let mv;
    try {
      mv = c.move({ from, to, promotion: isPromotion(c, from, to) ? (a.best[i][4] ?? 'q') : undefined });
    } catch {
      return setAttemptView(null);
    }
    const t = ++tryToken.current;
    const uci = mv.from + mv.to + (mv.promotion ?? '');
    setAttemptView({ fen: c.fen(), last: [from, to] });
    const retry = (text: string) => {
      sound.wrong();
      setTryMsg({ text, tone: 'bad' });
      setTimeout(() => t === tryToken.current && setAttemptView(null), 900);
    };
    if (uci === pos[i].uci) return retry("That's the move you played. Look for a better one.");
    let good = uci === a.best[i] || c.isCheckmate();
    if (!good) {
      setTryMsg({ text: 'Checking with Stockfish…', tone: 'wait' });
      try {
        const r = await getEngine().analyze(c.fen(), 12);
        if (t !== tryToken.current) return;
        const pov = game.userColor === 'w' ? 1 : -1;
        const cl = (x: number) => Math.max(-1000, Math.min(1000, x));
        good = cl(pov * a.evals[i]) - cl(pov * whitePov(c.fen(), r)) <= PRACTICE_TOLERANCE;
      } catch {
        return retry("Couldn't check that move (the engine didn't load). Try the move again or press Show me.");
      }
    }
    if (!good) return retry(`${mv.san} isn't better. Try again.`);
    sound.correct();
    setTryMsg({ text: uci === a.best[i] ? `${mv.san}! That's the best move.` : `${mv.san} works too. Stockfish's first choice was ${sanOf(pos[i].fen, a.best[i])}.`, tone: 'good' });
    setOutcome((o) => ({ ...o, [i]: 'found' }));
    setAttemptView(null);
  };

  // Arrows at the current position: the move played (yellow, red if it was a mistake) and, once
  // the mistake is solved or shown, the better move (green).
  const shapes: DrawShape[] = [];
  if (cur < pos.length - 1 && pos[cur].uci && !attemptView) {
    shapes.push(arrow(pos[cur].uci!, a?.flags[cur] ? 'red' : 'yellow'));
    if (a?.flags[cur] && a.best[cur] && !trying) shapes.push(arrow(a.best[cur], 'green'));
  }
  const lastUci = cur > 0 ? pos[cur - 1].uci : undefined;
  const ls = line ? line.steps[line.n] : null;
  const lineNext = line ? line.steps[line.n + 1] : null;
  const shownUci = ls ? ls.uci : lastUci;
  const last = attemptView ? attemptView.last : shownUci ? ([shownUci.slice(0, 2), shownUci.slice(2, 4)] as [Key, Key]) : undefined;
  const boardFen = ls ? ls.fen : attemptView ? attemptView.fen : pos[cur].fen;
  const lineShapes = lineNext ? [arrow(lineNext.uci, line!.which === 'best' ? 'green' : 'red')] : [];
  // The four buttons under the board step through the line when one is shown, else the game.
  const navTo = (to: number) => (line ? setLine({ ...line, n: to }) : browse(to));
  const navMax = line ? line.steps.length - 1 : pos.length - 1;
  const navCur = line ? line.n : cur;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 pb-8 pt-4 md:grid-cols-[minmax(0,1fr)_340px] md:gap-8 md:px-8 md:pt-10">
      <div className="mx-auto flex w-full max-w-[min(100%,calc(100dvh-12rem))] flex-col gap-3">
        <Board
          fen={boardFen}
          orientation={orientation}
          turnColor={boardFen.split(' ')[1] === 'w' ? 'white' : 'black'}
          movableColor={orientation}
          dests={canTry ? toDests(new Chess(pos[cur].fen)) : NO_DESTS}
          viewOnly={!canTry}
          lastMove={last}
          check={new Chess(boardFen).inCheck()}
          shapes={line ? lineShapes : shapes}
          onMove={onTryMove}
        />
        {line && (
          <div className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-2 text-[15px]">
            <span>
              {line.which === 'best' ? 'Better line' : "The bot's best answer"}: move {line.n + 1} of {line.steps.length}
            </span>
            <button onClick={() => setLine(null)} className="link shrink-0">
              Back to the game
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          {[
            ['⏮︎', 0],
            ['◀︎', Math.max(0, navCur - 1)],
            ['▶︎', Math.min(navMax, navCur + 1)],
            ['⏭︎', navMax],
          ].map(([label, to]) => (
            <button key={label} onClick={() => navTo(to as number)} className="glass flex-1 py-2 text-sm hover:bg-white/10">
              {label}
            </button>
          ))}
        </div>
        {a && <EvalGraph a={a} cur={cur} onPick={browse} userColor={game.userColor} />}
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
              <p className="mt-4 font-display text-2xl font-semibold leading-tight">
                {userFlags.length
                  ? [counts.blunder && `${counts.blunder} blunder${counts.blunder === 1 ? '' : 's'}`, counts.mistake && `${counts.mistake} mistake${counts.mistake === 1 ? '' : 's'}`]
                      .filter(Boolean)
                      .join(' and ')
                  : 'No blunders or mistakes. Clean game.'}
              </p>
              {userFlags.length > 0 && (
                <p className="mt-2 text-[15px] text-ink-2">For each one, find the better move on the board first. Then see why it works and the line that should have happened.</p>
              )}
              {showEval && <p className="mt-3 text-[15px] text-ink-2">Eval here: <span className="num text-ink">{formatEval(a.evals[cur])}</span></p>}
              {missed.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <span className="text-[15px] text-ink-2">Practice:</span>
                  {missed.map((t) => (
                    <button key={t} onClick={() => go('puzzles', { puzzleTheme: t })} className="chip hover:bg-surface-3">
                      {themeLabel(t)} &rarr;
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {a && userFlags.length > 0 && (
          <MistakeCoach
            a={a}
            pos={pos}
            plies={userFlags}
            k={sel}
            onPick={pickMistake}
            line={line}
            onLine={setLine}
            revealed={outcome[userFlags[sel]]}
            atMistake={cur === userFlags[sel]}
            tryMsg={tryMsg}
            onReveal={() => {
              resetTry();
              setCur(userFlags[sel]);
              setOutcome((o) => ({ ...o, [userFlags[sel]]: 'shown' }));
            }}
            onBack={() => {
              setLine(null);
              resetTry();
              setCur(userFlags[sel]);
            }}
          />
        )}

        <h2 className="mt-2 text-[13px] font-semibold uppercase tracking-wider text-ink-2">Whole game</h2>
        <MoveList pos={pos} a={a} cur={cur} onPick={browse} isUserPly={isUserPly} />
      </aside>
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
    // Scroll the list box only. scrollIntoView would also scroll the page down to the list,
    // pushing the board off screen every time the move changes.
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>('[data-cur="true"]');
    if (!box || !el) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight;
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

function sanOf(fen: string, uci: string) {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

// ---------- mistake coach: what went wrong, what was better, and the line ----------

/** A line shown on the board instead of the game: the better move, or the punishment. */
export interface ShownLine {
  which: 'best' | 'punish';
  steps: LineStep[];
  n: number;
}

const lineCache = new Map<string, Promise<{ pv: string[]; mate: number | null }>>();
/** Best line from a position at review depth, computed once per position. */
function bestLine(fen: string) {
  let p = lineCache.get(fen);
  if (!p) {
    p = getEngine()
      .analyze(fen, REVIEW_DEPTH)
      .then((r) => ({ pv: r.pv.length ? r.pv : [r.best], mate: r.mate }));
    p.catch(() => lineCache.delete(fen));
    lineCache.set(fen, p);
  }
  return p;
}

function MistakeCoach({
  a,
  pos,
  plies,
  k,
  onPick,
  line,
  onLine,
  revealed,
  atMistake,
  tryMsg,
  onReveal,
  onBack,
}: {
  a: GameAnalysis;
  pos: Position[];
  plies: number[];
  k: number;
  onPick: (k: number) => void;
  line: ShownLine | null;
  onLine: (l: ShownLine | null) => void;
  revealed?: 'found' | 'shown';
  atMistake: boolean;
  tryMsg: { text: string; tone: 'bad' | 'good' | 'wait' } | null;
  onReveal: () => void;
  onBack: () => void;
}) {
  const i = plies[k];
  const ended = new Chess(pos[i + 1].fen).isGameOver();
  const [lines, setLines] = useState<{ best: LineStep[]; bestText: string; punish: LineStep[]; punishText: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const bot = 'the bot';

  useEffect(() => {
    let live = true;
    setLines(null);
    setFailed(false);
    Promise.all([bestLine(pos[i].fen), ended ? Promise.resolve({ pv: [], mate: null }) : bestLine(pos[i + 1].fen)])
      .then(([b, p]) => {
        if (!live) return;
        setLines({
          best: playLine(pos[i].fen, b.pv),
          bestText: [
            explainLine(pos[i].fen, b.pv, b.mate, 'you'),
            ended ? '' : compareLines(pos[i].fen, b.pv, [pos[i].uci!, ...p.pv], p.mate !== null && p.mate > 0),
          ]
            .filter(Boolean)
            .join(' '),
          punish: playLine(pos[i + 1].fen, p.pv),
          punishText: p.pv.length ? explainLine(pos[i + 1].fen, p.pv, p.mate, bot) : '',
        });
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Show a line on the board; the buttons under the board then step through it.
  const show = (which: 'best' | 'punish', n: number) => {
    const steps = which === 'best' ? lines!.best : lines!.punish;
    onLine({ which, steps, n });
    document.querySelector('.board-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const step = line;

  const flag = a.flags[i];
  const moveNo = `${Math.floor(i / 2) + 1}${pos[i].fen.split(' ')[1] === 'w' ? '.' : '...'}`;
  const bestSan = lines?.best[0]?.san ?? sanOf(pos[i].fen, a.best[i]);

  const Line = ({ which, l }: { which: 'best' | 'punish'; l: LineStep[] }) => (
    <div className="flex flex-col gap-2">
      <div className="num flex flex-wrap gap-x-1 gap-y-1 text-[15px]">
        {l.map((s, n) => (
          <button
            key={n}
            onClick={() => show(which, n)}
            className={`px-1 ${step?.which === which && step.n === n ? 'bg-accent text-black' : 'hover:bg-surface-3'}`}
          >
            {s.label && <span className="text-ink-2">{s.label} </span>}
            {s.san}
          </button>
        ))}
      </div>
      <button className="btn-ghost self-start !py-2" onClick={() => show(which, 0)}>
        Show it on the board
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-5 bg-surface-2 p-5">
      <div className="flex items-center justify-between text-[15px] text-ink-2">
        <span>
          Mistake {k + 1} of {plies.length}
        </span>
        <span className="flex gap-1">
          <button className="btn-ghost !px-3 !py-1" disabled={k === 0} onClick={() => onPick(k - 1)} aria-label="Previous mistake">
            {'◀︎'}
          </button>
          <button className="btn-ghost !px-3 !py-1" disabled={k + 1 >= plies.length} onClick={() => onPick(k + 1)} aria-label="Next mistake">
            {'▶︎'}
          </button>
        </span>
      </div>

      <p className="font-display text-2xl font-semibold leading-tight">
        {moveNo} You played <span className={flag === 'blunder' ? 'text-down' : 'text-amber-400'}>{pos[i].san}{flag === 'blunder' ? '??' : '?'}</span>
      </p>

      {failed ? (
        <p className="text-[15px] text-ink-2">The engine didn't load, so the explanation isn't available. The red arrow is your move, the green one was better.</p>
      ) : !lines ? (
        <p className="text-[15px] text-ink-2">Working out the lines&hellip;</p>
      ) : (
        <>
          {lines.punishText && (
            <section className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-down">What went wrong</h3>
              <p className="text-[17px] leading-relaxed">After {pos[i].san}, {lines.punishText}</p>
              <Line which="punish" l={lines.punish} />
            </section>
          )}
          {revealed && (
            <section className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-up">Better was {bestSan}</h3>
              <p className="text-[17px] leading-relaxed">{lines.bestText}</p>
              <Line which="best" l={lines.best} />
            </section>
          )}
        </>
      )}

      {revealed === 'found' && tryMsg?.tone === 'good' && <p className="text-[17px] font-semibold text-up">{tryMsg.text}</p>}

      {!revealed && (
        <section className="flex flex-col gap-3 border-t border-white/10 pt-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-accent">Your turn</h3>
          {atMistake && !line ? (
            <>
              <p className="text-[17px] leading-relaxed">Find a better move than {pos[i].san}. Make it on the board.</p>
              {tryMsg && <p className={`text-[17px] ${tryMsg.tone === 'bad' ? 'text-down' : 'text-ink-2'}`}>{tryMsg.text}</p>}
            </>
          ) : (
            <button className="btn-ghost self-start" onClick={onBack}>
              Back to this position
            </button>
          )}
          <button className="btn-ghost self-start" onClick={onReveal}>
            Show me
          </button>
        </section>
      )}
    </div>
  );
}
