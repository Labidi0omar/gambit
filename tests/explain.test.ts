import { describe, expect, it } from 'vitest';
import { compareLines, explainLine, lineText, playLine } from '../src/lib/explain';

describe('explainLine', () => {
  it('names a free capture and what it wins', () => {
    const s = explainLine('4k3/8/8/3q4/8/4N3/8/4K3 w - - 0 1', ['e3d5'], null, 'you');
    expect(s).toBe('Nxd5 takes the queen on d5 (nothing can take it back), and you win the queen.');
  });

  it('calls out checkmate', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2';
    expect(explainLine(fen, ['d8h4'], 1, 'Black')).toBe('Qh4# is checkmate.');
  });

  it('spots a fork and the material it wins', () => {
    const s = explainLine('4k3/1r6/8/8/2N5/8/8/4K3 w - - 0 1', ['c4d6', 'e8d7', 'd6b7'], null, 'you');
    expect(s).toContain('attacks the king and rook on b7 at once (a fork)');
    expect(s).toContain('you win a rook');
  });

  it('does not count a capture that gets taken back', () => {
    // Qxd5 grabs a pawn but the e6 pawn takes the queen back.
    const s = explainLine('4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1', ['d1d5'], null, 'you');
    expect(s).not.toContain('you win');
  });

  it('writes the line with move numbers', () => {
    const steps = playLine('4k3/1r6/8/8/2N5/8/8/4K3 w - - 0 1', ['c4d6', 'e8d7', 'd6b7']);
    expect(lineText(steps)).toBe('1. Nd6+ Kd7 2. Nxb7');
  });
});

describe('compareLines', () => {
  it('says how much the better move keeps compared with the game', () => {
    // White can take a free queen (Nxd5), but played Kf1 and Black's queen stays alive.
    const fen = '4k3/8/8/3q4/8/4N3/8/4K3 w - - 0 1';
    expect(compareLines(fen, ['e3d5'], ['e1f1', 'd5d4'], false)).toBe("Compared with your move, you'd be a queen's worth of material better off.");
  });

  it('mentions the mate the game move allowed', () => {
    expect(compareLines('4k3/8/8/8/8/8/8/4K3 w - - 0 1', ['e1e2'], ['e1f1'], true)).toContain('checkmate');
  });
});
