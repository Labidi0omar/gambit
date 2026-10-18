import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { STEPS, moveAccepted, choiceTruth, protectedSquares, whitePieces } from '../src/lib/firststeps';
import { placementStep } from '../src/store/journey';
import { unlocks } from '../src/lib/unlocks';
import { parsePlacement, solveCollect } from '../src/lib/collect';
import { hangingPieces, moveWarnings } from '../src/lib/coach';

const idx = (id: string) => STEPS.findIndex((s) => s.id === id);

describe('onboarding placement', () => {
  it('defaults to the very start', () => {
    expect(placementStep({ knowsPieces: 'no', playedGame: false })).toBe(STEPS[0].id);
    expect(placementStep({ knowsPieces: 'some', playedGame: true })).toBe(STEPS[0].id);
  });
  it('skips piece movement for people who know the pieces', () => {
    expect(idx(placementStep({ knowsPieces: 'yes', playedGame: false }))).toBeGreaterThan(idx('fs-pawn'));
    expect(idx(placementStep({ knowsPieces: 'yes', playedGame: true }))).toBeGreaterThan(idx(placementStep({ knowsPieces: 'yes', playedGame: false })));
  });
});

describe('progressive reveal', () => {
  const base = { done: {}, skipped: {}, startedAt: Date.now(), level1: false, gamesPlayed: 0 };
  const doneUpTo = (id: string) => Object.fromEntries(STEPS.slice(0, idx(id) + 1).map((s) => [s.id, 1]));

  it('shows nothing extra at the start', () => {
    expect(Object.values(unlocks(base)).some(Boolean)).toBe(false);
  });
  it('opens puzzles after the mate-in-one step, not before', () => {
    expect(unlocks({ ...base, done: doneUpTo('fs-mate-or-stalemate') }).puzzles).toBe(false);
    expect(unlocks({ ...base, done: doneUpTo('fs-mate-in-1') }).puzzles).toBe(true);
  });
  it('opens bot games after the first game step', () => {
    expect(unlocks({ ...base, done: doneUpTo('fs-draws') }).play).toBe(false);
    expect(unlocks({ ...base, done: doneUpTo('fs-first-game') }).play).toBe(true);
  });
  it('opens ratings after a week or at Level 1', () => {
    expect(unlocks({ ...base, startedAt: Date.now() - 6 * 86_400_000 }).ratings).toBe(false);
    expect(unlocks({ ...base, startedAt: Date.now() - 7 * 86_400_000 }).ratings).toBe(true);
    expect(unlocks({ ...base, level1: true }).ratings).toBe(true);
  });
  it('opens openings at Level 1 after 10 games, CCT at Level 1', () => {
    expect(unlocks({ ...base, level1: true, gamesPlayed: 9 }).openings).toBe(false);
    expect(unlocks({ ...base, level1: true, gamesPlayed: 10 }).openings).toBe(true);
    expect(unlocks({ ...base, level1: true }).cct).toBe(true);
  });
});

describe('star mini-games', () => {
  it('finds the shortest route, and stars never block', () => {
    // Rook a1, stars a4 and a8: one straight line, collect a4 by landing on it, then a8.
    const path = solveCollect({ pos: parsePlacement('8/8/8/8/8/8/8/R7'), stars: new Set(['a4', 'a8']) });
    expect(path).toEqual([
      ['a1', 'a4'],
      ['a4', 'a8'],
    ]);
  });
  it('a bishop cannot reach the other color', () => {
    expect(solveCollect({ pos: parsePlacement('8/8/8/8/8/8/8/2B5'), stars: new Set(['c2']) }, 6)).toBeNull();
  });
});

describe('coach', () => {
  it('warns before hanging the queen', () => {
    const w = moveWarnings('4k3/8/4p3/8/8/8/8/3QK3 w - - 0 1', 'd1d5');
    expect(w.hangs[0]?.piece).toBe('q');
  });
  it('warns before allowing mate in one', () => {
    // Fool's mate: after 1.f3 e5, 2.g4?? allows Qh4#.
    expect(moveWarnings('rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2', 'g2g4').allowsMate).toBe('Qh4#');
  });
  it('stays quiet for a safe move', () => {
    const w = moveWarnings('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4');
    expect(w.hangs).toEqual([]);
    expect(w.allowsMate).toBeNull();
  });
  it('spots an attacked, unprotected piece', () => {
    expect(hangingPieces('4k3/8/3p4/8/4N3/8/8/4K3 w - - 0 1', 'w')).toEqual([]); // d6 pawn hits c5/e5, not e4
    expect(hangingPieces('4k3/8/8/8/3p4/4N3/8/4K3 w - - 0 1', 'w')[0]?.square).toBe('e3');
  });
});

describe('every First Steps task accepts its own answer', () => {
  for (const s of STEPS)
    for (const [i, t] of s.tasks.entries()) {
      if (t.type === 'move')
        it(`${s.id} #${i + 1} move`, () => {
          const m = new Chess(t.fen).move(t.answer);
          expect(moveAccepted(t.fen, m.from + m.to + (m.promotion ?? ''), t.accept, t.answer)).toBe(true);
        });
      if (t.type === 'choice')
        it(`${s.id} #${i + 1} choice`, () => {
          expect(choiceTruth(t.rule, t.fens ?? [t.fen!])).toBe(t.answer);
        });
      if (t.type === 'pick')
        it(`${s.id} #${i + 1} pick has a real choice`, () => {
          const ans = protectedSquares(t.fen);
          expect(ans.length).toBeGreaterThan(0);
          expect(ans.length).toBeLessThan(whitePieces(t.fen).length);
        });
    }

  it('a wrong move is not accepted', () => {
    const t = STEPS.find((s) => s.id === 'fs-mate-in-1')!.tasks[1];
    if (t.type !== 'move') throw new Error('expected a move task');
    expect(moveAccepted(t.fen, 'h2h7', t.accept, t.answer)).toBe(false);
  });
});

describe('path shape', () => {
  it('every step: example first, a solo try, a learned line, at most 3 intro sentences', () => {
    for (const s of STEPS) {
      if (s.tasks.length > 1) expect(s.tasks[0].phase, s.id).toBe('example');
      expect(s.tasks.some((t) => t.phase === 'solo'), s.id).toBe(true);
      expect(s.learned.length).toBeGreaterThan(10);
      expect(s.intro.split(/(?<=[.!?])\s+/).length, s.id).toBeLessThanOrEqual(3);
    }
  });
});
