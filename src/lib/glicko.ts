// Glicko-1 single-game update ("Glicko-lite": puzzle RD is assumed fixed).
const Q = Math.log(10) / 400;
const PUZZLE_RD = 80;
export const MIN_RD = 60;
export const MAX_RD = 350;

const g = (rd: number) => 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));

export function glickoUpdate(r: number, rd: number, opp: number, score: 0 | 1) {
  const gj = g(PUZZLE_RD);
  const e = 1 / (1 + Math.pow(10, (-gj * (r - opp)) / 400));
  const d2 = 1 / (Q * Q * gj * gj * e * (1 - e));
  const denom = 1 / (rd * rd) + 1 / d2;
  return {
    rating: r + (Q / denom) * gj * (score - e),
    rd: Math.max(MIN_RD, Math.sqrt(1 / denom)),
  };
}

/** RD grows with inactivity (c chosen so ~100 idle days take RD 60 -> 350). */
export function decayRd(rd: number, days: number) {
  const C = 34.6;
  return Math.min(MAX_RD, Math.sqrt(rd * rd + C * C * days));
}
