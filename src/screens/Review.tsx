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

// ---------- move classification, like chess.com ----------

type Cls = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
const CLS: Record<Cls, { label: string; sym: string; color: string; says: string }> = {
  best: { label: 'Best', sym: '★', color: '#81b64c', says: 'is the best move' },
  excellent: { label: 'Excellent', sym: '!', color: '#96bc4b', says: 'is excellent' },
  good: { label: 'Good', sym: '✓', color: '#96af8b', says: 'is good' },
  inaccuracy: { label: 'Inaccuracy', sym: '?!', color: '#f7c631', says: 'is an inaccuracy' },
  mistake: { label: 'Mistake', sym: '?', color: '#ffa459', says: 'is a mistake' },
  blunder: { label: 'Blunder', sym: '??', color: '#fa412d', says: 'is a blunder' },
};
const CLS_ORDER: Cls[] = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
const BAD = new Set<Cls>(['inaccuracy', 'mistake', 'blunder']);

function classOf(a: GameAnalysis, pos: Position[], i: number): Cls {
  if (a.flags[i]) return a.flags[i]!;
  if (pos[i].uci === a.best[i]) return 'best';
  const l = a.loss[i];
  return l <= 20 ? 'excellent' : l <= 50 ? 'good' : 'inaccuracy';
}

/** Lichess-style accuracy: win chance lost per move, averaged. */
function accuracy(a: GameAnalysis, pos: Position[], color: 'w' | 'b') {
  const wp = (cp: number) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp)))) - 1);
  const pov = color === 'w' ? 1 : -1;
  const accs: number[] = [];
  for (let i = 0; i < pos.length - 1; i++) {
    if (pos[i].fen.split(' ')[1] !== color) continue;
    const drop = pos[i].uci === a.best[i] ? 0 : Math.max(0, wp(pov * a.evals[i]) - wp(pov * a.evals[i + 1]));
    accs.push(Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669)));
  }
  return accs.length ? accs.reduce((s, x) => s + x, 0) / accs.length : 100;
}

function Badge({ cls, size = 'md' }: { cls: Cls; size?: 'sm' | 'md' }) {
  const c = CLS[cls];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none text-white ${size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-7 w-7 text-[13px]'}`}
      style={{ background: c.color, boxShadow: '0 1px 3px rgb(0 0 0 / 0.5)' }}
      aria-label={c.label}
    >
      {c.sym}
    </span>
  );
}

/** Classification icon pinned to the top-right corner of a board square. */
function SquareBadge({ sq, cls, orientation }: { sq: string; cls: Cls; orientation: 'white' | 'black' }) {
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]) - 1;
  const col = orientation === 'white' ? f : 7 - f;
  const row = orientation === 'white' ? 7 - r : r;
  return (
    <div className="pointer-events-none absolute inset-[9px] z-10">
      <div className="absolute" style={{ left: `${(col + 1) * 12.5}%`, top: `${row * 12.5}%`, transform: 'translate(-60%, -35%)' }}>
        <Badge cls={cls} />
      </div>
    </div>
  );
}

function EvalBar({ cp, orientation, showNum }: { cp: number; orientation: 'white' | 'black'; showNum: boolean }) {
  const white = 50 + 50 * Math.tanh(cp / 400); // % of the bar that is white
  return (
    <div className="relative w-5 shrink-0 overflow-hidden rounded-sm bg-[#403d39] md:w-6" aria-hidden>
      <div
        className="absolute inset-x-0 bg-[#f2efe8] transition-all duration-300"
        style={orientation === 'white' ? { bottom: 0, height: `${white}%` } : { top: 0, height: `${white}%` }}
      />
      {showNum && (
        <span
          className={`num absolute inset-x-0 text-center text-[9px] font-semibold ${cp >= 0 ? 'text-[#403d39]' : 'text-[#f2efe8]'}`}
          style={(cp >= 0) === (orientation === 'white') ? { bottom: 4 } : { top: 4 }}
        >
          {formatEval(cp).replace('+', '')}
        </span>
      )}
    </div>
  );
}

// ---------- the review screen: summary, then one move at a time ----------

function GameReview({ game }: { game: GameRecord }) {
  // Numbers (eval, accuracy) are shown only once ratings and numbers have been introduced.
  const showNums = useUnlocks().ratings;
  const setAnalysis = useGames((s) => s.setAnalysis);
  const go = useNav((s) => s.go);
  const pos = useMemo(() => positions(game), [game]);
  const a = game.analysis;
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState(false);
  // The position shown; the coach talks about the move that led here (ply cur - 1).
  const [cur, setCur] = useState(0);
  const [retrying, setRetrying] = useState(false);
  // Per bad move (ply): found the better move yourself, or asked to be shown.
  const [outcome, setOutcome] = useState<Record<number, 'found' | 'shown'>>({});
  const [attemptView, setAttemptView] = useState<{ fen: string; last: [Key, Key] } | null>(null);
  const [tryMsg, setTryMsg] = useState<{ text: string; tone: 'bad' | 'good' | 'wait' } | null>(null);
  const tryToken = useRef(0);
  const [line, setLine] = useState<ShownLine | null>(null);
  const orientation = game.userColor === 'w' ? 'white' : 'black';
  const isUserPly = (i: number) => pos[i].fen.split(' ')[1] === game.userColor;
  const ply = cur - 1;
  const cls = a && ply >= 0 ? classOf(a, pos, ply) : null;
  const mineBad = !!cls && BAD.has(cls) && isUserPly(ply);

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

  const resetTry = () => {
    tryToken.current++;
    setRetrying(false);
    setAttemptView(null);
    setTryMsg(null);
  };
  const goTo = (to: number) => {
    setCur(Math.max(0, Math.min(pos.length - 1, to)));
    setLine(null);
    resetTry();
  };
  const toSummary = () => {
    setStarted(false);
    goTo(0);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!started) return;
      if (e.key === 'Escape') return setLine(null);
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      // While a line is shown, the arrows step through it; otherwise through the game.
      if (line) return setLine({ ...line, n: Math.max(-1, Math.min(line.steps.length - 1, line.n + d)) });
      goTo(cur + d);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  // For a bad move: the better line, and how the other side punishes the move played.
  const wantLines = !!a && !!cls && BAD.has(cls) && !!a.best[ply];
  const [lines, setLines] = useState<{ ply: number; best: LineStep[]; bestText: string; punishText: string } | 'failed' | null>(null);
  useEffect(() => {
    if (!wantLines) return;
    let live = true;
    setLines(null);
    const i = ply;
    const mine = isUserPly(i);
    const ended = new Chess(pos[i + 1].fen).isGameOver();
    Promise.all([bestLine(pos[i].fen), ended ? Promise.resolve({ pv: [], mate: null }) : bestLine(pos[i + 1].fen)])
      .then(([b, p]) => {
        if (!live) return;
        setLines({
          ply: i,
          best: playLine(pos[i].fen, b.pv),
          bestText: [
            explainLine(pos[i].fen, b.pv, b.mate, mine ? 'you' : 'the bot'),
            ended || !mine ? '' : compareLines(pos[i].fen, b.pv, [pos[i].uci!, ...p.pv], p.mate !== null && p.mate > 0),
          ]
            .filter(Boolean)
            .join(' '),
          punishText: p.pv.length ? explainLine(pos[i + 1].fen, p.pv, p.mate, mine ? 'the bot' : 'you') : '',
        });
      })
      .catch(() => live && setLines('failed'));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ply, wantLines]);
  const L = lines && lines !== 'failed' && lines.ply === ply ? lines : null;

  const counts = (color: 'w' | 'b') => {
    const c = Object.fromEntries(CLS_ORDER.map((k) => [k, 0])) as Record<Cls, number>;
    if (a) for (let i = 0; i < pos.length - 1; i++) if (pos[i].fen.split(' ')[1] === color) c[classOf(a, pos, i)]++;
    return c;
  };
  const botColor = game.userColor === 'w' ? 'b' : 'w';
  const mine = counts(game.userColor);
  const theirs = counts(botColor);
  const userBad = a ? pos.slice(0, -1).flatMap((_, i) => (isUserPly(i) && a.flags[i] ? [i] : [])) : [];
  const missed = a ? [...new Set(userBad.map((i) => a.themes[i]).filter(Boolean) as string[])] : [];
  const nextBad = userBad.find((i) => i > ply);

  const onTryMove = async (from: Key, to: Key) => {
    if (!a || !retrying || attemptView) return;
    const i = ply;
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
    if (uci === pos[i].uci) return retry("That's the move you played. Try another one.");
    let good = uci === a.best[i] || c.isCheckmate();
    if (!good) {
      setTryMsg({ text: 'Checking…', tone: 'wait' });
      try {
        const r = await getEngine().analyze(c.fen(), 12);
        if (t !== tryToken.current) return;
        const pov = game.userColor === 'w' ? 1 : -1;
        const cl = (x: number) => Math.max(-1000, Math.min(1000, x));
        good = cl(pov * a.evals[i]) - cl(pov * whitePov(c.fen(), r)) <= PRACTICE_TOLERANCE;
      } catch {
        return retry("Couldn't check that move (the engine didn't load). Press Show best instead.");
      }
    }
    if (!good) return retry(`${mv.san} isn't better. Try again.`);
    sound.correct();
    tryToken.current++;
    setRetrying(false);
    setAttemptView(null);
    setTryMsg({ text: uci === a.best[i] ? `Correct! ${mv.san} is the best move.` : `Correct! ${mv.san} works too.`, tone: 'good' });
    setOutcome((o) => ({ ...o, [i]: 'found' }));
  };

  const showBest = () => {
    if (!L) return;
    tryToken.current++;
    setRetrying(false);
    setAttemptView(null);
    setOutcome((o) => ({ ...o, [ply]: o[ply] ?? 'shown' }));
    setLine({ which: 'best', steps: L.best, n: -1 });
  };

  // What the board shows: a line being stepped through, a retry attempt, or the game.
  const ls = line && line.n >= 0 ? line.steps[line.n] : null;
  const lineNext = line ? line.steps[line.n + 1] : null;
  const boardFen = line ? (ls ? ls.fen : pos[ply].fen) : retrying ? (attemptView?.fen ?? pos[ply].fen) : pos[cur].fen;
  const lastUci = line ? (ls ? ls.uci : pos[ply - 1]?.uci) : retrying ? pos[ply - 1]?.uci : pos[cur - 1]?.uci;
  const last = attemptView ? attemptView.last : lastUci ? ([lastUci.slice(0, 2), lastUci.slice(2, 4)] as [Key, Key]) : undefined;
  const shapes = lineNext ? [arrow(lineNext.uci, 'green')] : [];
  const canMove = retrying && !attemptView && tryMsg?.tone !== 'wait';
  const badgeSq = started && !line && !retrying && cls ? pos[ply].uci!.slice(2, 4) : null;
  const evalHere = a ? a.evals[line || retrying ? ply : cur] : 0;
  // The four buttons under the board step through the line when one is shown, else the game.
  const navTo = (to: number) => (line ? setLine({ ...line, n: Math.max(-1, Math.min(line.steps.length - 1, to)) }) : goTo(to));
  const navCur = line ? line.n : cur;
  const navMax = line ? line.steps.length - 1 : pos.length - 1;

  const moveNo = (i: number) => `${pos[i].fen.split(' ')[5]}${pos[i].fen.split(' ')[1] === 'w' ? '.' : '...'}`;
  const bestSan = a && ply >= 0 && a.best[ply] ? (L?.best[0]?.san ?? sanOf(pos[ply].fen, a.best[ply])) : '';
  const revealed = outcome[ply];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 pb-8 pt-4 md:grid-cols-[minmax(0,1fr)_360px] md:gap-8 md:px-8 md:pt-10">
      <div className="mx-auto flex w-full max-w-[min(100%,calc(100dvh-12rem))] flex-col gap-3">
        <div className="flex gap-2">
          {a && <EvalBar cp={evalHere} orientation={orientation} showNum={showNums} />}
          <div className="relative min-w-0 flex-1">
            <Board
              fen={boardFen}
              orientation={orientation}
              turnColor={boardFen.split(' ')[1] === 'w' ? 'white' : 'black'}
              movableColor={orientation}
              dests={canMove ? toDests(new Chess(pos[ply].fen)) : NO_DESTS}
              viewOnly={!canMove}
              lastMove={last}
              check={new Chess(boardFen).inCheck()}
              shapes={shapes}
              onMove={onTryMove}
            />
            {badgeSq && cls && <SquareBadge sq={badgeSq} cls={cls} orientation={orientation} />}
          </div>
        </div>
        {started && (
          <div className="flex items-center gap-2">
            {[
              ['⏮︎', line ? -1 : 0],
              ['◀︎', navCur - 1],
              ['▶︎', navCur + 1],
              ['⏭︎', navMax],
            ].map(([label, to]) => (
              <button key={label} onClick={() => navTo(to as number)} className="glass flex-1 py-2 text-sm hover:bg-white/10">
                {label}
              </button>
            ))}
          </div>
        )}
        {a && started && <EvalGraph a={a} pos={pos} cur={cur} onPick={goTo} isUserPly={isUserPly} />}
      </div>

      <aside className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <button onClick={() => (started ? toSummary() : go('review'))} className="text-sm text-zinc-400 hover:text-white">
            &larr; {started ? 'Summary' : 'Games'}
          </button>
          <span className="text-xs text-zinc-500">vs Stockfish {game.botElo}</span>
        </div>

        {!a && failed ? (
          <div className="glass flex flex-col gap-3 p-5">
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
          <div className="glass p-5">
            <div className="mb-2 text-sm text-zinc-300">Analyzing every move&hellip;</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.div className="h-full bg-accent" animate={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        ) : !started ? (
          <div className="glass flex flex-col gap-5 p-5">
            <div>
              <h1 className="font-display text-2xl font-semibold">Game review</h1>
              <p className="mt-1 text-[15px] text-ink-2">
                {game.result === 'win' ? 'You won' : game.result === 'loss' ? 'You lost' : 'Draw'} &middot; {game.reason}
              </p>
            </div>
            <p className="text-[17px] leading-relaxed">
              {userBad.length
                ? `You made ${[mine.blunder && plural(mine.blunder, 'blunder'), mine.mistake && plural(mine.mistake, 'mistake')].filter(Boolean).join(' and ')}. Go through the game and try to find the better move each time.`
                : 'No blunders or mistakes. Go through the game to see how your moves rated.'}
            </p>
            <div className="grid grid-cols-[1fr_4rem_4rem] items-center gap-y-2 text-[15px]">
              <span />
              <span className="text-center text-[13px] font-semibold text-ink-2">You</span>
              <span className="text-center text-[13px] font-semibold text-ink-2">Bot</span>
              {showNums && (
                <>
                  <span className="text-ink-2">Accuracy</span>
                  <span className="num text-center text-lg font-bold">{accuracy(a, pos, game.userColor).toFixed(1)}</span>
                  <span className="num text-center text-lg font-bold text-ink-2">{accuracy(a, pos, botColor).toFixed(1)}</span>
                </>
              )}
              {CLS_ORDER.map((k) => (
                <div key={k} className="contents">
                  <span className="flex items-center gap-2" style={{ color: CLS[k].color }}>
                    <Badge cls={k} size="sm" /> {CLS[k].label}
                  </span>
                  <span className="num text-center font-semibold" style={{ color: mine[k] ? CLS[k].color : undefined }}>
                    {mine[k]}
                  </span>
                  <span className="num text-center text-ink-2">{theirs[k]}</span>
                </div>
              ))}
            </div>
            <button
              className="btn-primary w-full !py-3 text-base"
              onClick={() => {
                setStarted(true);
                goTo(1);
              }}
            >
              Start review
            </button>
            {userBad.length > 0 && (
              <button
                className="btn-ghost w-full"
                onClick={() => {
                  setStarted(true);
                  goTo(userBad[0] + 1);
                }}
              >
                Jump to my first mistake
              </button>
            )}
            {missed.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[15px] text-ink-2">Practice:</span>
                {missed.map((t) => (
                  <button key={t} onClick={() => go('puzzles', { puzzleTheme: t })} className="chip hover:bg-surface-3">
                    {themeLabel(t)} &rarr;
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4 bg-surface-2 p-5">
            {!cls ? (
              <p className="text-[17px] leading-relaxed">Start of the game. Press Next to go through it move by move.</p>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Badge cls={cls} />
                  <p className="font-display text-xl font-semibold leading-tight">
                    {isUserPly(ply) ? '' : 'Bot: '}
                    {moveNo(ply)} {pos[ply].san} <span style={{ color: CLS[cls].color }}>{CLS[cls].says}</span>
                  </p>
                </div>

                {mineBad &&
                  (retrying ? (
                    <p className={`text-[17px] leading-relaxed ${tryMsg?.tone === 'bad' ? 'text-down' : ''}`}>
                      {tryMsg?.text ?? `Find a better move than ${pos[ply].san}. Make it on the board.`}
                    </p>
                  ) : revealed ? (
                    <>
                      {tryMsg?.tone === 'good' && <p className="text-[17px] font-semibold text-up">{tryMsg.text}</p>}
                      <p className="text-[17px] leading-relaxed">
                        <span className="font-semibold text-up">Best was {bestSan}.</span> {L?.bestText}
                      </p>
                    </>
                  ) : (
                    <p className="text-[17px] leading-relaxed text-ink-2">
                      {lines === 'failed'
                        ? "The engine didn't load, so there's no explanation for this one."
                        : !L
                          ? 'Working out why…'
                          : L.punishText
                            ? `Why it's bad: ${L.punishText}`
                            : 'There was a better move here.'}
                    </p>
                  ))}
                {BAD.has(cls) && !isUserPly(ply) && (
                  <p className="text-[17px] leading-relaxed text-ink-2">
                    The bot slipped. {cls !== 'inaccuracy' && 'Your next move was a chance to punish it. '}Best was {bestSan}.
                  </p>
                )}
                {line && (
                  <div className="num flex flex-wrap gap-x-1 gap-y-1 text-[15px]">
                    {line.steps.map((s, n) => (
                      <button key={n} onClick={() => setLine({ ...line, n })} className={`px-1 ${line.n === n ? 'bg-accent text-black' : 'hover:bg-surface-3'}`}>
                        {s.label && <span className="text-ink-2">{s.label} </span>}
                        {s.san}
                      </button>
                    ))}
                  </div>
                )}
                {cur === pos.length - 1 && <p className="text-[15px] text-ink-2">Game over: {game.reason}.</p>}
              </>
            )}

            <div className="flex flex-wrap gap-2">
              {mineBad && !revealed && !retrying && (
                <button
                  className="btn-primary"
                  onClick={() => {
                    setLine(null);
                    setRetrying(true);
                  }}
                >
                  Retry
                </button>
              )}
              {cls && BAD.has(cls) && !line && (
                <button className="btn-ghost" disabled={!L} onClick={showBest}>
                  Show best
                </button>
              )}
              {retrying && (
                <button className="btn-ghost" onClick={resetTry}>
                  Cancel
                </button>
              )}
              {line && (
                <button className="btn-ghost" onClick={() => setLine(null)}>
                  Back to game
                </button>
              )}
              {cur < pos.length - 1 ? (
                <button className={mineBad && !revealed ? 'btn-ghost' : 'btn-primary'} onClick={() => goTo(cur + 1)}>
                  Next &rarr;
                </button>
              ) : (
                <button className="btn-primary" onClick={toSummary}>
                  Back to summary
                </button>
              )}
            </div>
            {nextBad !== undefined && (
              <button className="link self-start text-[15px]" onClick={() => goTo(nextBad + 1)}>
                Skip to my next mistake &rarr;
              </button>
            )}
          </div>
        )}

        {a && started && <MoveList pos={pos} a={a} cur={cur} onPick={goTo} isUserPly={isUserPly} />}
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
  a: GameAnalysis;
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
    const c = classOf(a, pos, i);
    // Selecting a move shows the position after it.
    const active = cur === i + 1;
    return (
      <button
        data-cur={active}
        onClick={() => onPick(i + 1)}
        className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left ${active ? 'bg-accent/30 text-white' : 'hover:bg-white/10'} ${isUserPly(i) ? '' : 'opacity-70'}`}
      >
        {(BAD.has(c) || c === 'best') && <Badge cls={c} size="sm" />}
        <span style={BAD.has(c) ? { color: CLS[c].color } : undefined}>{plies[i].san}</span>
      </button>
    );
  };
  const rows = Math.ceil((plies.length + (white0 ? 0 : 1)) / 2);
  return (
    <div ref={ref} className="glass max-h-72 overflow-y-auto p-3 num text-sm">
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

function EvalGraph({
  a,
  pos,
  cur,
  onPick,
  isUserPly,
}: {
  a: GameAnalysis;
  pos: Position[];
  cur: number;
  onPick: (i: number) => void;
  isUserPly: (i: number) => boolean;
}) {
  const W = 600;
  const H = 90;
  const n = a.evals.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  // Squash evals so ±10 pawns fill the graph but small edges still show.
  const y = (cp: number) => H / 2 - (Math.tanh(cp / 400) * H) / 2;
  const line = a.evals.map((e, i) => `${x(i)},${y(e)}`).join(' ');
  return (
    <div className="overflow-hidden rounded-sm bg-[#403d39]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-20 w-full cursor-pointer"
        preserveAspectRatio="none"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onPick(Math.round(((e.clientX - r.left) / r.width) * (n - 1)));
        }}
      >
        <polygon points={`0,${H} ${line} ${W},${H}`} fill="#f2efe8" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="rgb(128 128 128 / 0.5)" strokeWidth="1" />
        <line x1={x(cur)} x2={x(cur)} y1="0" y2={H} stroke="#c99a3e" strokeWidth="2" />
        {a.flags.map((f, i) =>
          f && isUserPly(i) ? <circle key={i} cx={x(i + 1)} cy={y(a.evals[i + 1])} r="5" fill={CLS[f].color} stroke="#000" strokeWidth="1" /> : null,
        )}
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

/** A line shown on the board instead of the game. n = -1 is the position before its first move. */
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
