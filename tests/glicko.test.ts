import { describe, it, expect } from 'vitest';
import { glickoUpdate, decayRd, MIN_RD, MAX_RD } from '../src/lib/glicko';

describe('Glicko-lite puzzle rating', () => {
  it('goes up on a win and down on a loss', () => {
    expect(glickoUpdate(800, 200, 800, 1).rating).toBeGreaterThan(800);
    expect(glickoUpdate(800, 200, 800, 0).rating).toBeLessThan(800);
  });

  it('moves more for an upset than for an expected result', () => {
    const upset = glickoUpdate(800, 150, 1200, 1).rating - 800;
    const expected = glickoUpdate(800, 150, 400, 1).rating - 800;
    expect(upset).toBeGreaterThan(expected);
  });

  it('shrinks RD with games and never below the floor', () => {
    let r = 500;
    let rd = 300;
    for (let i = 0; i < 200; i++) ({ rating: r, rd } = glickoUpdate(r, rd, 500 + (i % 7) * 30, i % 3 ? 1 : 0));
    expect(rd).toBeLessThan(300);
    expect(rd).toBeGreaterThanOrEqual(MIN_RD);
    expect(Number.isFinite(r)).toBe(true);
  });

  it('handles the very first puzzle (max RD, no history)', () => {
    const r = glickoUpdate(500, 300, 450, 1);
    expect(Number.isNaN(r.rating)).toBe(false);
    expect(Number.isNaN(r.rd)).toBe(false);
    expect(r.rating).toBeGreaterThan(500);
  });

  it('never produces NaN on extreme gaps', () => {
    for (const opp of [0, 100, 3000, 5000]) for (const s of [0, 1] as const) {
      const r = glickoUpdate(500, 300, opp, s);
      expect(Number.isFinite(r.rating) && Number.isFinite(r.rd)).toBe(true);
    }
  });

  it('RD grows with inactivity up to the cap', () => {
    expect(decayRd(60, 30)).toBeGreaterThan(60);
    expect(decayRd(60, 10_000)).toBe(MAX_RD);
    expect(decayRd(100, 0)).toBe(100);
  });
});
