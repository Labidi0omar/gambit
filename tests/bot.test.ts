import { describe, it, expect } from 'vitest';
import { weakBotParams, pickWeakMove } from '../src/engine/weak';

const SF_ELO_FLOOR = 1320;

describe('weak bot (< 1320) does not rely on UCI_Elo', () => {
  it('uses Skill Level 0, depth 1-4 and MultiPV 4-8 below the UCI_Elo floor', () => {
    for (const elo of [400, 600, 900, 1200, 1300]) {
      const p = weakBotParams(elo);
      expect(p.skill).toBe(0);
      expect(p.depth).toBeGreaterThanOrEqual(1);
      expect(p.depth).toBeLessThanOrEqual(4);
      expect(p.multipv).toBeGreaterThanOrEqual(4);
      expect(p.multipv).toBeLessThanOrEqual(8);
      expect(p.limitStrength).toBe(false);
    }
  });

  it('blunders more at lower Elo', () => {
    expect(weakBotParams(400).blunder).toBeGreaterThan(weakBotParams(900).blunder);
    expect(weakBotParams(900).blunder).toBeGreaterThan(weakBotParams(1300).blunder);
    expect(weakBotParams(400).blunder).toBeGreaterThanOrEqual(0.25);
  });

  it('at 400 often picks a non-best move; near the floor mostly the best', () => {
    const cands = [
      { uci: 'e2e4', cp: 40 },
      { uci: 'd2d4', cp: 35 },
      { uci: 'g1f3', cp: 30 },
      { uci: 'a2a3', cp: -10 },
      { uci: 'g2g4', cp: -60 },
    ];
    const legal = ['e2e4', 'd2d4', 'g1f3', 'a2a3', 'g2g4', 'h2h4', 'b1a3', 'f2f3'];
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const nonBest = (elo: number) => {
      let n = 0;
      for (let i = 0; i < 2000; i++) if (pickWeakMove(cands, legal, elo, rand) !== 'e2e4') n++;
      return n / 2000;
    };
    expect(nonBest(400)).toBeGreaterThan(0.5);
    expect(nonBest(1300)).toBeLessThan(nonBest(400));
  });

  it('uses UCI_Elo only at or above the floor', () => {
    expect(weakBotParams(SF_ELO_FLOOR).limitStrength).toBe(true);
    expect(weakBotParams(1600).limitStrength).toBe(true);
  });
});
