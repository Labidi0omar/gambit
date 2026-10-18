import { Chess } from 'chess.js';
import { getEngine } from './stockfish';
import { weakBotParams, pickWeakMove } from './weak';

/**
 * Picks the bot move. At or above Stockfish's UCI_Elo floor (1320) it plays Stockfish's own
 * limited-strength move; below it, the weak-bot layer chooses among shallow MultiPV candidates.
 */
export async function botMove(fen: string, elo: number): Promise<string> {
  const engine = getEngine();
  const thinkMs = 300 + Math.min(1200, elo / 2) + Math.random() * 400;
  const p = weakBotParams(elo);
  const start = performance.now();

  let mv: string;
  if (p.limitStrength) {
    mv = await engine.bestMove(fen, { movetime: thinkMs, elo });
  } else {
    const cands = await engine.candidates(fen, p.depth, elo);
    const legal = new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
    mv = pickWeakMove(cands, legal, elo);
  }

  const elapsed = performance.now() - start;
  if (elapsed < thinkMs) await new Promise((r) => setTimeout(r, thinkMs - elapsed));
  return mv;
}
