import { Chess } from 'chess.js';
import { weakBotParams, type Candidate } from './weak';

// UCI wrapper around the single-threaded lite Stockfish 18 build, running as a Web Worker.
type Listener = (line: string) => void;

export interface Strength {
  elo: number;
}

export const FULL_STRENGTH = 3190;
const LOAD_TIMEOUT_MS = 30_000;

export interface Analysis {
  /** centipawns from the side to move's view (null when mate) */
  cp: number | null;
  /** moves to mate from the side to move's view, negative = getting mated */
  mate: number | null;
  best: string;
  pv: string[];
}

export class Engine {
  private worker: Worker;
  private listeners = new Set<Listener>();
  private ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  /** Strength the engine is set to now. Every job sets its own, so callers can't leak settings into each other. */
  private strength: number | null = null;

  constructor() {
    // BASE_URL keeps this working when the site is served from a sub-path (GitHub Pages: /gambit/).
    this.worker = new Worker(`${import.meta.env.BASE_URL}stockfish/stockfish-18-lite-single.js`);
    this.worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      this.listeners.forEach((l) => l(line));
    };
    this.ready = (async () => {
      // The wasm build drops messages that arrive while it is still downloading/compiling
      // (slow on phones), so keep saying "uci" until it answers.
      const retry = setInterval(() => this.send('uci'), 500);
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Never hang forever: a failed download or a crashed worker rejects every waiting job.
      const failed = new Promise<never>((_, reject) => {
        this.worker.onerror = () => reject(new Error('Stockfish failed to load'));
        timer = setTimeout(() => reject(new Error('Stockfish took too long to load')), LOAD_TIMEOUT_MS);
      });
      try {
        await Promise.race([this.cmd('uci', (l) => l === 'uciok'), failed]);
      } finally {
        clearInterval(retry);
        clearTimeout(timer);
      }
      await this.isReady();
    })();
    this.ready.catch(() => {
      if (shared === this) shared = null; // the next getEngine() tries a fresh worker
      this.worker.terminate();
    });
  }

  private send(c: string) {
    this.worker.postMessage(c);
  }

  private cmd(c: string, done: (line: string) => boolean, onLine?: Listener): Promise<string> {
    return new Promise((resolve) => {
      const l: Listener = (line) => {
        onLine?.(line);
        if (done(line)) {
          this.listeners.delete(l);
          resolve(line);
        }
      };
      this.listeners.add(l);
      this.send(c);
    });
  }

  private isReady() {
    return this.cmd('isready', (l) => l === 'readyok');
  }

  /** Serialize engine jobs so concurrent callers never interleave UCI commands. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(() => this.ready).then(job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  setStrength({ elo }: Strength) {
    return this.enqueue(async () => {
      this.apply(elo);
      await this.isReady();
    });
  }

  /** Send the options for `elo` if the engine isn't already there. Only call inside a queued job. */
  private apply(elo: number) {
    if (this.strength === elo) return;
    this.strength = elo;
    {
      const p = weakBotParams(elo);
      if (elo >= FULL_STRENGTH) {
        this.send('setoption name UCI_LimitStrength value false');
        this.send('setoption name Skill Level value 20');
        this.send('setoption name MultiPV value 1');
      } else if (p.limitStrength) {
        this.send('setoption name Skill Level value 20');
        this.send('setoption name MultiPV value 1');
        this.send('setoption name UCI_LimitStrength value true');
        this.send(`setoption name UCI_Elo value ${Math.round(elo)}`);
      } else {
        // Below the UCI_Elo floor: never UCI_Elo. Skill 0 + several shallow candidates (see weak.ts).
        this.send('setoption name UCI_LimitStrength value false');
        this.send(`setoption name Skill Level value ${p.skill}`);
        this.send(`setoption name MultiPV value ${p.multipv}`);
      }
    }
  }

  /** Aborts any search still running for an abandoned game, then resets. */
  newGame() {
    this.send('stop');
    return this.enqueue(async () => {
      this.send('ucinewgame');
      await this.isReady();
    });
  }

  /** Returns best move in UCI notation (e.g. "e2e4", "e7e8q"). */
  bestMove(fen: string, opts: { movetime?: number; depth?: number; elo?: number } = {}): Promise<string> {
    return this.enqueue(async () => {
      this.send('stop');
      this.apply(opts.elo ?? FULL_STRENGTH);
      this.send(`position fen ${fen}`);
      const go = opts.depth ? `go depth ${opts.depth}` : `go movetime ${opts.movetime ?? 500}`;
      const line = await this.cmd(go, (l) => l.startsWith('bestmove'));
      const mv = line.split(' ')[1];
      if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(mv)) return mv;
      // The lite build occasionally answers "(none)" in trivial endgames; fall back to any legal move.
      const legal = new Chess(fen).moves({ verbose: true })[0];
      return legal ? legal.from + legal.to + (legal.promotion ?? '') : mv;
    });
  }

  /** Full-strength analysis to a fixed depth. */
  analyze(fen: string, depth: number): Promise<Analysis> {
    return this.enqueue(async () => {
      const res: Analysis = { cp: 0, mate: null, best: '', pv: [] };
      this.send('stop');
      this.apply(FULL_STRENGTH);
      this.send(`position fen ${fen}`);
      const line = await this.cmd(`go depth ${depth}`, (l) => l.startsWith('bestmove'), (l) => {
        if (!l.startsWith('info') || l.includes('lowerbound') || l.includes('upperbound')) return;
        if (/ multipv (?!1 )\d+/.test(l)) return; // only the main line
        const s = l.match(/score (cp|mate) (-?\d+)/);
        if (!s) return;
        if (s[1] === 'cp') {
          res.cp = Number(s[2]);
          res.mate = null;
        } else {
          res.cp = null;
          res.mate = Number(s[2]);
        }
        const pv = l.match(/ pv (.+)$/);
        if (pv) res.pv = pv[1].split(' ');
      });
      res.best = line.split(' ')[1];
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(res.best)) {
        const legal = new Chess(fen).moves({ verbose: true })[0];
        res.best = legal ? legal.from + legal.to + (legal.promotion ?? '') : '';
      }
      return res;
    });
  }

  /** The top MultiPV lines at a fixed depth, best first. `elo` sets how many lines (see weak.ts). */
  candidates(fen: string, depth: number, elo: number): Promise<Candidate[]> {
    return this.enqueue(async () => {
      const lines = new Map<number, Candidate>();
      this.send('stop');
      this.apply(elo);
      this.send(`position fen ${fen}`);
      await this.cmd(`go depth ${depth}`, (l) => l.startsWith('bestmove'), (l) => {
        const c = parseCandidate(l);
        if (c) lines.set(c.k, { uci: c.uci, cp: c.cp });
      });
      return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    });
  }

  stop() {
    this.send('stop');
  }

  terminate() {
    this.worker.terminate();
  }
}

/** One MultiPV "info" line -> its line number, first move and score (mate = +-3000). Null if it isn't one. */
export function parseCandidate(l: string): { k: number; uci: string; cp: number } | null {
  if (!l.startsWith('info') || l.includes('bound')) return null;
  const s = l.match(/score (cp|mate) (-?\d+)/);
  const pv = l.match(/ pv (\S+)/);
  if (!s || !pv) return null;
  const k = Number(l.match(/ multipv (\d+)/)?.[1] ?? 1);
  const cp = s[1] === 'cp' ? Number(s[2]) : Math.sign(Number(s[2]) || -1) * 3000;
  return { k, uci: pv[1], cp };
}

let shared: Engine | null = null;
export function getEngine() {
  if (!shared) shared = new Engine();
  return shared;
}

/** Free the worker when the page goes away (and on hot reload, so dev doesn't leak workers). */
function disposeEngine() {
  shared?.stop();
  shared?.terminate();
  shared = null;
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', disposeEngine);
import.meta.hot?.dispose(disposeEngine);
