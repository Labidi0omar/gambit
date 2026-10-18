// @vitest-environment node
// Plays the real weak-bot layer (Node Stockfish + weak.ts) against a random legal mover.
import { describe, it, expect, afterAll } from 'vitest';
import { Chess } from 'chess.js';
import { Engine } from '../scripts/lib/engine';
import { weakBotParams, pickWeakMove } from '../src/engine/weak';

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const material = (c: Chess, color: 'w' | 'b') =>
  c.board().flat().reduce((s, p) => s + (p && p.color === color ? VAL[p.type] : 0), 0);

const engine = new Engine();
afterAll(() => engine.quit());

async function play(elo: number, games: number, plies: number, seed: number) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const p = weakBotParams(elo);
  await engine.setOption('UCI_LimitStrength', 'false');
  await engine.setOption('Skill Level', p.skill);
  await engine.setOption('MultiPV', p.multipv);
  let lostMaterial = 0;
  for (let g = 0; g < games; g++) {
    const c = new Chess();
    const start = material(c, 'w');
    let lost = false;
    for (let ply = 0; ply < plies && !c.isGameOver(); ply++) {
      const legal = c.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
      const uci = c.turn() === 'w' ? pickWeakMove(await engine.candidates(c.fen(), p.depth), legal, elo, rand) : legal[Math.floor(rand() * legal.length)];
      c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (material(c, 'w') < start) lost = true;
    }
    if (lost) lostMaterial++;
  }
  return lostMaterial;
}

describe('bot strength sanity', () => {
  it('a 400 bot loses material in most games, even against random moves', async () => {
    await engine.init();
    const lost = await play(400, 8, 60, 11);
    expect(lost).toBeGreaterThanOrEqual(5);
  }, 120_000);

  it('a 1300 bot loses material less often than a 400 bot', async () => {
    const weak = await play(400, 8, 60, 23);
    const strong = await play(1300, 8, 60, 23);
    expect(strong).toBeLessThan(weak);
  }, 180_000);
});
