// Weak-bot layer. Stockfish's UCI_Elo bottoms out around 1320, so below that we never use it:
// Skill Level 0, a shallow search with several candidate lines (MultiPV), then pick among them
// with an Elo-scaled temperature, plus an Elo-scaled chance of a plain random legal move.

export const SF_ELO_FLOOR = 1320;
const LOW = 400;

export interface WeakParams {
  /** true = Stockfish's own UCI_LimitStrength/UCI_Elo (only at or above the floor) */
  limitStrength: boolean;
  skill: number;
  depth: number;
  multipv: number;
  /** chance of a random legal move (can hang pieces) */
  blunder: number;
  /** softmax temperature in centipawns: higher = picks worse candidates more often */
  temperature: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function weakBotParams(elo: number): WeakParams {
  if (elo >= SF_ELO_FLOOR) return { limitStrength: true, skill: 20, depth: 0, multipv: 1, blunder: 0, temperature: 0 };
  const t = clamp((elo - LOW) / (SF_ELO_FLOOR - LOW), 0, 1); // 0 at 400, ~1 just under the floor
  return {
    limitStrength: false,
    skill: 0,
    depth: 1 + Math.round(t * 3), // 1..4
    multipv: 8 - Math.round(t * 4), // 8..4
    blunder: 0.03 + 0.35 * (1 - t), // ~38% at 400, ~3% near 1320
    temperature: 40 + 260 * (1 - t), // 300cp at 400, 40cp near 1320
  };
}

export interface Candidate {
  uci: string;
  /** centipawns for the side to move (mate mapped to ±3000) */
  cp: number;
}

export function pickWeakMove(cands: Candidate[], legal: string[], elo: number, rand: () => number = Math.random): string {
  const p = weakBotParams(elo);
  if (!cands.length || rand() < p.blunder) return legal[Math.floor(rand() * legal.length)] ?? cands[0]?.uci;
  const top = Math.max(...cands.map((c) => c.cp));
  const w = cands.map((c) => Math.exp((c.cp - top) / Math.max(1, p.temperature)));
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cands.length; i++) if ((r -= w[i]) <= 0) return cands[i].uci;
  return cands[cands.length - 1].uci;
}
