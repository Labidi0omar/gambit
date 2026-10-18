import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { moveLoss, BLUNDER, MISTAKE } from '../src/lib/review';
import { forcingMoves, nullMoveFen, blunderStep } from '../src/lib/cct';
import { acceptLineMove } from '../src/lib/openings';

describe('post-game review loss', () => {
  // evals are White-POV centipawns, mate = ±(10000 - n)
  it('measures the drop from the mover’s point of view (White)', () => {
    expect(moveLoss([50, -200], 0, 'w')).toBe(250);
    expect(moveLoss([50, 200], 0, 'w')).toBe(0);
  });

  it('flips the sign for Black', () => {
    // Black to move at +50 (good for White); after Black's move +300: Black lost 250.
    expect(moveLoss([50, 300], 0, 'b')).toBe(250);
    // Black improves to -100: no loss.
    expect(moveLoss([50, -100], 0, 'b')).toBe(0);
  });

  it('classifies by >2 pawns blunder, >1 mistake', () => {
    expect(BLUNDER).toBe(200);
    expect(MISTAKE).toBe(100);
  });

  it('does not flag mate-in-3 to mate-in-2 or other mate shuffles', () => {
    expect(moveLoss([9997, 9998], 0, 'w')).toBe(0); // M3 -> M2
    expect(moveLoss([9997, 9995], 0, 'w')).toBe(0); // M3 -> M5, still winning
    expect(moveLoss([-9998, -9997], 0, 'b')).toBe(0); // Black mating
  });

  it('does flag throwing away a mate', () => {
    expect(moveLoss([9997, 0], 0, 'w')).toBeGreaterThan(BLUNDER);
  });
});

describe('CCT detection matches chess.js', () => {
  const fens = [
    'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    'r3k2r/ppp2ppp/2n1bn2/3pp3/1b1PP3/2N1BN2/PPP2PPP/R2QKB1R w KQkq - 0 7',
  ];
  it('lists exactly the checks and captures chess.js generates', () => {
    for (const fen of fens) {
      const moves = new Chess(fen).moves({ verbose: true });
      const want = new Set(moves.filter((m) => m.san.includes('+') || m.san.includes('#') || m.captured).map((m) => m.from + m.to + (m.promotion ?? '')));
      const got = new Set(forcingMoves(fen).map((i) => i.uci));
      expect(got).toEqual(want);
      for (const i of forcingMoves(fen)) {
        const m = moves.find((x) => x.from + x.to + (x.promotion ?? '') === i.uci)!;
        expect(i.kind).toBe(m.san.includes('+') || m.san.includes('#') ? 'check' : 'capture');
      }
    }
  });

  it('null move flips the side and is refused when in check', () => {
    expect(nullMoveFen(fens[0])!.split(' ')[1]).toBe('b');
    expect(nullMoveFen('4k3/8/8/8/8/8/4q3/4K3 w - - 0 1')).toBeNull();
  });

  it('labels a blunder by the opponent’s punishing reply', () => {
    // After 3...Nf6?? White mates with Qxf7#: a missed check.
    const after = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    expect(blunderStep(after, 'h5f7')).toBe('check');
    expect(blunderStep('4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1', 'd1d5')).toBe('capture');
    expect(blunderStep('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'e1d2')).toBe('threat');
  });
});

describe('opening recall', () => {
  const italian = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'];

  it('accepts the line move', () => {
    const c = new Chess();
    c.move('e4');
    c.move('e5');
    expect(acceptLineMove(italian, 2, c.fen(), 'g1f3')).toEqual(italian);
  });

  it('rejects a move that leaves the line', () => {
    const c = new Chess();
    c.move('e4');
    c.move('e5');
    expect(acceptLineMove(italian, 2, c.fen(), 'd2d4')).toBeNull();
  });

  it('accepts a transposition that reaches the same position', () => {
    const c = new Chess();
    c.move('e4');
    c.move('e5');
    // 2.Bc4 then 3.Nf3 reaches the line's position after 3.Bc4.
    const line = acceptLineMove(italian, 2, c.fen(), 'f1c4');
    expect(line).not.toBeNull();
    const a = new Chess();
    for (const m of line!.slice(0, 5)) a.move(m);
    const b = new Chess();
    for (const m of italian.slice(0, 5)) b.move(m);
    expect(a.fen().split(' ').slice(0, 4)).toEqual(b.fen().split(' ').slice(0, 4));
  });
});
