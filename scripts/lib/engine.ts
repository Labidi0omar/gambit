// Minimal Node-side UCI driver for the bundled Stockfish 18 lite build, plus solution checks
// shared by scripts/validate-content.ts and scripts/build-demos.ts.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Chess } from 'chess.js';

export const DEPTH = 18;
/** Two moves within this many centipawns are the same move for our purposes. */
const TIE_CP = 10;
const MATE = 100000;

export interface Eval {
  /** Side-to-move POV; mate in n -> MATE - n, getting mated in n -> -(MATE - n). */
  score: number;
  best: string;
  mate: number | null;
}

export const fmt = (s: number) => (Math.abs(s) > MATE - 1000 ? `#${Math.sign(s) * (MATE - Math.abs(s))}` : `${s}cp`);

export class Engine {
  private proc: ChildProcessWithoutNullStreams;
  private buf = '';
  private listeners = new Set<(l: string) => void>();

  constructor() {
    this.proc = spawn(process.execPath, ['node_modules/stockfish/bin/stockfish-18-lite-single.js']);
    this.proc.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        this.listeners.forEach((l) => l(line));
      }
    });
  }

  private send(c: string) {
    this.proc.stdin.write(c + '\n');
  }

  private until(pred: (l: string) => boolean, onLine?: (l: string) => void) {
    return new Promise<string>((res) => {
      const l = (line: string) => {
        onLine?.(line);
        if (pred(line)) {
          this.listeners.delete(l);
          res(line);
        }
      };
      this.listeners.add(l);
    });
  }

  async init() {
    // The wasm build drops input that arrives before it has loaded, so repeat until it answers.
    const ok = this.until((l) => l === 'uciok');
    const t = setInterval(() => this.send('uci'), 500);
    this.send('uci');
    await ok;
    clearInterval(t);
    this.send('setoption name Hash value 64');
    this.send('isready');
    await this.until((l) => l === 'readyok');
  }

  async evaluate(fen: string, depth = DEPTH): Promise<Eval> {
    const g = new Chess(fen);
    if (g.isCheckmate()) return { score: -MATE, best: '', mate: 0 };
    if (g.isDraw() || g.isStalemate()) return { score: 0, best: '', mate: null };
    let score = 0;
    let mate: number | null = null;
    this.send('ucinewgame');
    this.send(`position fen ${fen}`);
    const done = this.until(
      (l) => l.startsWith('bestmove'),
      (l) => {
        if (!l.startsWith('info') || l.includes('bound')) return;
        const m = l.match(/score (cp|mate) (-?\d+)/);
        if (!m) return;
        if (m[1] === 'cp') {
          score = Number(m[2]);
          mate = null;
        } else {
          mate = Number(m[2]);
          score = Math.sign(mate || -1) * (MATE - Math.abs(mate));
        }
      },
    );
    this.send(`go depth ${depth}`);
    const best = (await done).split(' ')[1];
    if (/^[a-h][1-8][a-h][1-8]/.test(best)) return { score, best, mate };
    // The lite build sometimes answers "(none)" in bare K+Q vs K; score it from its children instead.
    return this.evaluateViaChildren(fen, depth);
  }

  private async evaluateViaChildren(fen: string, depth: number): Promise<Eval> {
    let top: Eval = { score: -Infinity, best: '', mate: null };
    for (const m of new Chess(fen).moves({ verbose: true })) {
      const c = new Chess(fen);
      c.move(m);
      const e = await this.evaluate(c.fen(), depth - 1);
      const s = -e.score;
      if (s > top.score) top = { score: s, best: m.from + m.to + (m.promotion ?? ''), mate: e.mate === null ? null : -e.mate };
    }
    return top;
  }

  /** Raw UCI option, e.g. setOption('MultiPV', 6). */
  async setOption(name: string, value: string | number) {
    this.send(`setoption name ${name} value ${value}`);
    this.send('isready');
    await this.until((l) => l === 'readyok');
  }

  /** Top MultiPV lines at a fixed depth (count from the MultiPV option), best first. */
  async candidates(fen: string, depth: number): Promise<{ uci: string; cp: number }[]> {
    const lines = new Map<number, { uci: string; cp: number }>();
    this.send(`position fen ${fen}`);
    const done = this.until(
      (l) => l.startsWith('bestmove'),
      (l) => {
        if (!l.startsWith('info') || l.includes('bound')) return;
        const k = Number(l.match(/ multipv (\d+)/)?.[1] ?? 1);
        const s = l.match(/score (cp|mate) (-?\d+)/);
        const pv = l.match(/ pv (\S+)/);
        if (!s || !pv) return;
        lines.set(k, { uci: pv[1], cp: s[1] === 'cp' ? Number(s[2]) : Math.sign(Number(s[2]) || -1) * 3000 });
      },
    );
    this.send(`go depth ${depth}`);
    await done;
    return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  }

  quit() {
    this.send('quit');
    setTimeout(() => this.proc.kill(), 200);
  }
}

const toUci = (fen: string, move: string) => {
  const m = new Chess(fen).move(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move) ? { from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] } : move);
  return m.from + m.to + (m.promotion ?? '');
};

/**
 * The stated move must be Stockfish's best at DEPTH. A different engine choice still passes only if it is
 * a true tie: both mate equally fast, or the evals are within TIE_CP.
 */
export async function checkBest(engine: Engine, fen: string, move: string): Promise<{ ok: boolean; why: string }> {
  const uci = toUci(fen, move);
  const before = await engine.evaluate(fen);
  if (before.best === uci) return { ok: true, why: `best (${fmt(before.score)})` };
  const c = new Chess(fen);
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  if (c.isCheckmate()) return { ok: true, why: 'mates' };
  const got = -(await engine.evaluate(c.fen())).score;
  const bothMate = before.score > MATE - 1000 && got > MATE - 1000;
  if (bothMate ? got >= before.score : Math.abs(before.score - got) <= TIE_CP) return { ok: true, why: `ties best ${before.best} (${fmt(got)})` };
  return { ok: false, why: `${move} = ${fmt(got)}, engine best ${before.best} = ${fmt(before.score)}` };
}

/** Validates a Lichess-format puzzle: first move is the setup, then user/opponent alternate. */
export async function checkPuzzle(engine: Engine, fen: string, moves: string[], themes: string[] = []): Promise<{ ok: boolean; why: string }> {
  const g = new Chess(fen);
  let userMoves = 0;
  for (const [i, mv] of moves.entries()) {
    const before = g.fen();
    try {
      g.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] });
    } catch {
      return { ok: false, why: `illegal move ${mv} at ply ${i}` };
    }
    if (i % 2 === 1) {
      userMoves++;
      const r = await checkBest(engine, before, mv);
      if (!r.ok) return { ok: false, why: `move ${userMoves}: ${r.why}` };
    }
  }
  const mateTheme = themes.find((t) => /^mateIn\d$/.test(t));
  if (mateTheme) {
    const n = Number(mateTheme.slice(6));
    if (!g.isCheckmate()) return { ok: false, why: `${mateTheme} but the line does not end in mate` };
    if (userMoves !== n) return { ok: false, why: `${mateTheme} but the solution has ${userMoves} moves` };
  }
  return { ok: true, why: `${userMoves} move(s) verified` };
}
