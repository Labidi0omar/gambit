import { describe, expect, it } from 'vitest';
import { parseCandidate } from '../src/engine/stockfish';

// The weak bot picks among these lines; if parsing breaks it silently plays random moves.
describe('parseCandidate', () => {
  it('reads line number, first move and centipawns', () => {
    const l = 'info depth 4 seldepth 5 multipv 3 score cp -42 nodes 900 nps 90000 time 10 pv g1f3 d7d5 c2c4';
    expect(parseCandidate(l)).toEqual({ k: 3, uci: 'g1f3', cp: -42 });
  });

  it('turns mate scores into +-3000', () => {
    expect(parseCandidate('info depth 6 multipv 1 score mate 2 pv d1h5 g6h5')?.cp).toBe(3000);
    expect(parseCandidate('info depth 6 multipv 2 score mate -1 pv e1e2')?.cp).toBe(-3000);
  });

  it('reads promotions and defaults to line 1', () => {
    expect(parseCandidate('info depth 2 score cp 900 pv e7e8q')).toEqual({ k: 1, uci: 'e7e8q', cp: 900 });
  });

  it('ignores bounds and non-info lines', () => {
    expect(parseCandidate('info depth 5 multipv 1 score cp 10 lowerbound pv e2e4')).toBeNull();
    expect(parseCandidate('bestmove e2e4 ponder e7e5')).toBeNull();
    expect(parseCandidate('info string NNUE evaluation using nn.nnue')).toBeNull();
  });
});
