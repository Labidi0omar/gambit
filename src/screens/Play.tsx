import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import { AnimatePresence, motion } from 'framer-motion';
import { Board } from '../components/Board';
import { Clock } from '../components/Clock';
import { toDests, turnColor, isPromotion } from '../lib/chess';
import { botMove } from '../engine/bot';
import { getEngine } from '../engine/stockfish';
import { useBot, BOT_MIN, BOT_MAX, type GameResult } from '../store/settings';
import { useGames } from '../store/games';
import { useNav } from '../store/nav';
import { useDaily } from '../store/daily';
import { useUnlocks } from '../lib/useUnlocks';
import { sound } from '../lib/sound';
import { randomLine, findRepertoire, ADVANCED_RATING } from '../lib/openings';
import { useOpenings } from '../store/openings';
import { cctExpected, sameArrow, useCctStats, type CctItem } from '../lib/cct';
import { CctPanel, type CctPhase } from '../components/CctPanel';
import { useLessons, levelUnlocked } from '../store/lessons';
import { usePuzzles } from '../store/puzzles';
import type { DrawShape } from 'chessground/draw';
import { MoveNav, useBrowse } from '../components/MoveNav';

const NO_DESTS = new Map<Key, Key[]>();

const BASE_MS = 10 * 60_000;
const INC_MS = 5_000;

type Status = 'setup' | 'playing' | 'over';
type Side = 'w' | 'b';
type PromoPiece = 'q' | 'r' | 'b' | 'n';

const PROMO_GLYPH: Record<PromoPiece, string> = { q: '♛', r: '♜', b: '♝', n: '♞' };
const COLOR_LABEL = { w: 'White', r: 'Random', b: 'Black' } as const;
const RESULT_LABEL: Record<GameResult, string> = { win: 'You won', loss: 'You lost', draw: 'Draw' };

export function Play() {
  const { botElo, setBotElo, recordResult, recent, cct: cctOn, setCct } = useBot();
  const completed = useLessons((s) => s.completed);
  const puzzleRating = usePuzzles((s) => s.rating);
  const cctUnlocked = levelUnlocked(1, completed, puzzleRating);
  // No numbers before ratings are taught: the bot is just "the bot" until then.
  const showNumbers = useUnlocks().ratings;
  const recordCct = useCctStats((s) => s.record);
  // Opening practice: half the games, the bot follows a line from your chosen repertoire.
  const book = useRef<string[] | null>(null);
  const [bookName, setBookName] = useState<string | null>(null);
  // CCT scan state for the current move.
  const [cctPhase, setCctPhase] = useState<CctPhase>('move');
  const [marks, setMarks] = useState<string[]>([]);
  const [markFrom, setMarkFrom] = useState<Key | null>(null);
  const [cctResult, setCctResult] = useState<{ expected: CctItem[]; missed: CctItem[] } | null>(null);
  const [cctChecking, setCctChecking] = useState(false);
  const addGame = useGames((s) => s.addGame);
  const go = useNav((s) => s.go);
  const logDay = useDaily((s) => s.log);
  const chess = useRef(new Chess());
  const gameId = useRef(0);
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  const [status, setStatus] = useState<Status>('setup');
  const [userSide, setUserSide] = useState<Side>('w');
  const [colorPick, setColorPick] = useState<'w' | 'b' | 'r'>('w');
  const [clocks, setClocks] = useState({ w: BASE_MS, b: BASE_MS });
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [promo, setPromo] = useState<{ from: Key; to: Key } | null>(null);
  const [result, setResult] = useState<{ r: GameResult; reason: string; raised?: number; gameId?: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [engineError, setEngineError] = useState(false);
  const [engineTry, setEngineTry] = useState(0);
  const lastTick = useRef(0);
  const clockPaused = useRef(false);
  const statusRef = useRef<Status>('setup');
  statusRef.current = status;

  // Start loading Stockfish (a few MB of wasm) as soon as Play opens, not when the first move is due.
  useEffect(() => {
    getEngine();
  }, []);

  const c = chess.current;
  const turn = c.turn();
  const fen = c.fen();
  const browse = useBrowse(c, fen);
  const bv = browse.view;

  const finish = useCallback(
    (r: GameResult, reason: string) => {
      if (statusRef.current !== 'playing') return;
      statusRef.current = 'over';
      gameId.current++;
      getEngine().stop(); // don't let a search for a finished game hold up the next one
      setStatus('over');
      setThinking(false);
      const { raised, newElo } = recordResult(r);
      const g = chess.current;
      const san = g.history();
      const savedId = san.length
        ? addGame({ userColor: userSide, botElo, result: r, reason, startFen: new Chess().fen(), san })
        : undefined;
      if (savedId) logDay({ games: 1 });
      if (r === 'win') sound.complete();
      setResult({ r, reason, raised: raised ? newElo : undefined, gameId: savedId });
    },
    [recordResult, addGame, userSide, botElo, logDay],
  );

  const checkEnd = useCallback(() => {
    const g = chess.current;
    if (g.isCheckmate()) {
      finish(g.turn() === userSide ? 'loss' : 'win', 'Checkmate');
    } else if (g.isDraw() || g.isStalemate()) {
      const reason = g.isStalemate()
        ? 'Stalemate'
        : g.isThreefoldRepetition()
          ? 'Threefold repetition'
          : g.isInsufficientMaterial()
            ? 'Insufficient material'
            : '50-move rule';
      finish('draw', reason);
    }
  }, [finish, userSide]);

  const applyMove = useCallback(
    (from: string, to: string, promotion?: string) => {
      const g = chess.current;
      const mover = g.turn();
      try {
        g.move({ from, to, promotion });
      } catch {
        rerender();
        return;
      }
      setClocks((cl) => ({ ...cl, [mover]: cl[mover] + INC_MS }));
      lastTick.current = performance.now();
      setLastMove([from as Key, to as Key]);
      rerender();
      checkEnd();
    },
    [checkEnd],
  );

  // Clock ticking
  useEffect(() => {
    if (status !== 'playing') return;
    lastTick.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - lastTick.current;
      lastTick.current = now;
      if (clockPaused.current) return; // the CCT scan is training, not thinking time
      const side = chess.current.turn();
      setClocks((cl) => {
        const left = cl[side] - dt;
        if (left <= 0) queueMicrotask(() => finish(side === userSide ? 'loss' : 'win', 'Time out'));
        return { ...cl, [side]: Math.max(0, left) };
      });
    }, 100);
    return () => clearInterval(id);
  }, [status, userSide, finish]);

  // Bot turn
  useEffect(() => {
    if (status !== 'playing' || turn === userSide) return;
    const id = gameId.current;
    setThinking(true);
    const hist = chess.current.history();
    const line = book.current;
    if (line && hist.length < line.length && hist.every((m, i) => m === line[i])) {
      const m = new Chess(fen).move(line[hist.length]);
      const t = setTimeout(() => {
        if (id !== gameId.current) return;
        setThinking(false);
        applyMove(m.from, m.to, m.promotion);
      }, 500 + Math.random() * 500);
      return () => clearTimeout(t);
    }
    if (line) {
      book.current = null; // left the book
      setBookName(null);
    }
    botMove(fen, botElo)
      .then((uci) => {
        if (id !== gameId.current) return;
        setThinking(false);
        applyMove(uci.slice(0, 2), uci.slice(2, 4), uci[4]);
      })
      .catch(() => {
        if (id !== gameId.current) return;
        setThinking(false);
        setEngineError(true);
      });
  }, [status, turn, fen, userSide, botElo, applyMove, engineTry]);

  const start = async () => {
    gameId.current++;
    const side: Side = colorPick === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : colorPick;
    chess.current = new Chess();
    setUserSide(side);
    const reps = useOpenings.getState();
    const mySide = side === 'w' ? 'white' : 'black';
    const rep = findRepertoire(mySide, reps[mySide]);
    const allowed = rep && !(rep.advanced && usePuzzles.getState().rating < ADVANCED_RATING);
    const line = allowed && Math.random() < 0.5 ? randomLine(mySide, reps[mySide]) : null;
    book.current = line?.san ?? null;
    setBookName(line?.name ?? null);
    setClocks({ w: BASE_MS, b: BASE_MS });
    setLastMove(undefined);
    setResult(null);
    setPromo(null);
    setEngineError(false);
    // Don't wait for Stockfish to load: the board is playable now, and the bot's first move
    // simply queues behind the load. Each engine job sets its own strength.
    getEngine().newGame().catch(() => setEngineError(true));
    setStatus('playing');
    rerender();
  };

  const onUserMove = (from: Key, to: Key) => {
    if (isPromotion(chess.current, from, to)) {
      setPromo({ from, to });
      return;
    }
    applyMove(from, to);
  };

  const pickPromo = (p: PromoPiece) => {
    if (!promo) return;
    applyMove(promo.from, promo.to, p);
    setPromo(null);
  };

  const myTurn = status === 'playing' && turn === userSide && !promo;
  const cctActive = cctOn && cctUnlocked && status === 'playing';
  clockPaused.current = cctActive && myTurn && cctPhase !== 'move';
  const canMove = myTurn && (!cctActive || cctPhase === 'move');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dests = useMemo(() => (canMove ? toDests(chess.current) : new Map<Key, Key[]>()), [canMove, fen]);

  // Each of my turns in CCT mode starts a fresh scan: theirs first (skipped when I'm in check), then mine.
  useEffect(() => {
    if (!myTurn || !cctActive) return;
    setCctPhase(chess.current.inCheck() ? 'mine' : 'theirs');
    setMarks([]);
    setMarkFrom(null);
    setCctResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, myTurn, cctActive]);

  const onMark = (k: Key) => {
    if (!myTurn || !cctActive || cctPhase === 'move' || cctResult) return;
    if (!markFrom) return setMarkFrom(k);
    if (markFrom === k) return setMarkFrom(null);
    const uci = markFrom + k;
    setMarks((m) => (m.some((x) => sameArrow(x, uci)) ? m.filter((x) => !sameArrow(x, uci)) : [...m, uci]));
    setMarkFrom(null);
  };

  const checkScan = async () => {
    if (cctPhase === 'move') return;
    setCctChecking(true);
    let expected;
    try {
      expected = await cctExpected(chess.current.fen(), cctPhase, botElo);
    } catch {
      // No engine, no answer key: let them play instead of leaving the board locked.
      setCctChecking(false);
      setEngineError(true);
      return skipScan();
    }
    setCctChecking(false);
    recordCct(expected, marks);
    setCctResult({ expected, missed: expected.filter((e) => !marks.some((m) => sameArrow(m, e.uci))) });
  };

  const skipScan = () => {
    setCctResult(null);
    setMarks([]);
    setMarkFrom(null);
    setCctPhase('move');
  };

  const nextScan = () => {
    setCctResult(null);
    setMarks([]);
    setMarkFrom(null);
    setCctPhase(cctPhase === 'theirs' ? 'mine' : 'move');
  };

  const arrowOf = (uci: string, brush: string): DrawShape => ({ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush });
  const cctShapes: DrawShape[] =
    cctActive && myTurn && cctPhase !== 'move'
      ? [
          ...marks.map((m) => arrowOf(m, cctPhase === 'theirs' ? 'blue' : 'green')),
          ...(cctResult?.missed.map((m) => arrowOf(m.uci, 'red')) ?? []),
        ]
      : [];
  const cctHighlights = markFrom ? new Map<Key, string>([[markFrom, 'mark']]) : undefined;
  const orientation = userSide === 'w' ? 'white' : 'black';
  const botSide: Side = userSide === 'w' ? 'b' : 'w';
  const history = c.history();
  const wins = recent.filter((r) => r === 'win').length;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 pb-8 pt-4 md:grid-cols-[minmax(0,1fr)_340px] md:gap-8 md:px-8 md:pt-10">
      <div className="flex flex-col gap-2">
        <div className="mx-auto flex w-full max-w-[min(100%,calc(100dvh-15rem))] flex-col gap-2">
          <Clock
            ms={clocks[botSide]}
            active={status === 'playing' && turn === botSide}
            label={`${showNumbers ? `Stockfish · ${botElo}` : 'Bot'}${thinking ? ' · thinking…' : ''}`}
          />
          <div className="relative">
            <Board
              fen={bv ? bv.fen : fen}
              orientation={orientation}
              turnColor={bv ? bv.turnColor : turnColor(c)}
              movableColor={orientation}
              dests={bv ? NO_DESTS : dests}
              lastMove={bv ? bv.lastMove : lastMove}
              check={bv ? bv.check : c.inCheck()}
              viewOnly={!!bv || status !== 'playing'}
              shapes={bv ? undefined : cctShapes}
              highlights={bv ? undefined : cctHighlights}
              onSelect={onMark}
              onMove={onUserMove}
            />
            <AnimatePresence>
              {promo && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10 flex items-center justify-center bg-black/75"
                >
                  <div className="glass flex gap-2 p-3">
                    {(['q', 'r', 'b', 'n'] as PromoPiece[]).map((p) => (
                      <button key={p} onClick={() => pickPromo(p)} className="h-16 w-16 rounded-2xl bg-white/5 text-4xl hover:bg-white/15">
                        {PROMO_GLYPH[p]}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <Clock ms={clocks[userSide]} active={status === 'playing' && turn === userSide} label="You" />
          {browse.total > 0 && <MoveNav b={browse} />}
        </div>
      </div>

      <aside className="flex flex-col gap-4">
        {!showNumbers && (
          <p className="bg-surface px-5 py-4 text-[17px]">The bot starts gentle and gets a little stronger each time you win 3 of your last 5 games.</p>
        )}
        <div className={`glass p-5 ${showNumbers ? '' : 'hidden'}`}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-300">Bot strength</h2>
            <span className="num text-lg">{botElo}</span>
          </div>
          <input
            type="range"
            min={BOT_MIN}
            max={BOT_MAX}
            step={50}
            value={botElo}
            disabled={status === 'playing'}
            onChange={(e) => setBotElo(Number(e.target.value))}
            className="w-full disabled:opacity-40"
          />
          <p className="mt-2 text-xs text-zinc-500">
            Win 3 of 5 to auto-raise +100 &middot; {wins} win{wins === 1 ? '' : 's'} in last {recent.length}
          </p>
        </div>

        {cctActive && myTurn && (
          <CctPanel
            phase={cctPhase}
            marks={marks.length}
            result={cctResult}
            checking={cctChecking}
            onDone={checkScan}
            onNext={nextScan}
            onSkip={skipScan}
            onClear={() => setMarks([])}
          />
        )}

        {engineError && status === 'playing' && (
          <div className="flex flex-col gap-3 bg-surface-2 px-5 py-4">
            <p className="text-[17px]">The chess engine didn't load, so the bot can't move. Check your connection, then try again.</p>
            <button
              onClick={() => {
                setEngineError(false);
                setEngineTry((n) => n + 1);
              }}
              className="btn-primary self-start"
            >
              Try again
            </button>
          </div>
        )}

        {status === 'playing' && bookName && <p className="px-1 text-[15px] text-ink-2">Opening practice: {bookName}</p>}

        {status !== 'playing' ? (
          <div className="glass flex flex-col gap-3 p-5">
            <label className={`flex items-start gap-3 ${cctUnlocked ? 'cursor-pointer' : 'hidden'}`}>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
                checked={cctOn && cctUnlocked}
                disabled={!cctUnlocked}
                onChange={(e) => setCct(e.target.checked)}
              />
              <span>
                <span className="block text-[15px] font-semibold">CCT mode</span>
                <span className="block text-sm text-ink-2">
                  {cctUnlocked
                    ? 'Before each move, mark their checks, captures and threats, then yours. Stockfish shows what you missed.'
                    : 'Unlocks at Level 1.'}
                </span>
              </span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['w', 'r', 'b'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setColorPick(k)}
                  className={`rounded-xl py-2 text-sm font-medium transition ${
                    colorPick === k ? 'bg-accent text-white' : 'bg-white/5 text-zinc-300 hover:bg-white/10'
                  }`}
                >
                  {COLOR_LABEL[k]}
                </button>
              ))}
            </div>
            <button
              onClick={start}
              className="btn-primary w-full"
            >
              {status === 'over' ? 'New game' : 'Play'} &middot; 10+5
            </button>
          </div>
        ) : (
          <button onClick={() => finish('loss', 'Resigned')} className="glass py-3 text-sm font-medium text-zinc-300 hover:text-red-300">
            Resign
          </button>
        )}

        <AnimatePresence>
          {result && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass p-5">
              <div
                className={`text-2xl font-bold ${
                  result.r === 'win' ? 'text-up' : result.r === 'loss' ? 'text-down' : 'text-zinc-200'
                }`}
              >
                {RESULT_LABEL[result.r]}
              </div>
              <div className="text-sm text-zinc-400">{result.reason}</div>
              {result.raised && <div className="mt-2 text-sm text-accent">Bot raised to {result.raised}</div>}
              {result.gameId && (
                <button
                  onClick={() => go('review', { gameId: result.gameId })}
                  className="btn-accent mt-4 w-full"
                >
                  Review game
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="glass max-h-64 overflow-y-auto p-4 num text-sm">
          {history.length === 0 ? (
            <span className="text-zinc-500">No moves yet</span>
          ) : (
            <ol className="grid grid-cols-[2rem_1fr_1fr] gap-y-1">
              {Array.from({ length: Math.ceil(history.length / 2) }, (_, i) => (
                <li key={i} className="contents">
                  <span className="text-zinc-500">{i + 1}.</span>
                  <span>{history[i * 2]}</span>
                  <span>{history[i * 2 + 1] ?? ''}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}
