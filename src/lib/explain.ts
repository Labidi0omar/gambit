import { Chess, type Move, type Square } from 'chess.js';

// Turns an engine line into plain words: what the first move does and what it wins.

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const MAX_PLIES = 8;

export interface LineStep {
  san: string;
  uci: string;
  fen: string; // position after the move
  /** "12." before White's moves, "12..." for a line that starts with Black */
  label?: string;
}

/** Plays a UCI line from `fen`, stopping at the first illegal move. */
export function playLine(fen: string, uci: string[], max = MAX_PLIES): LineStep[] {
  const c = new Chess(fen);
  const out: LineStep[] = [];
  for (const u of uci.slice(0, max)) {
    const no = Number(c.fen().split(' ')[5]);
    const white = c.turn() === 'w';
    let m: Move;
    try {
      m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    } catch {
      break;
    }
    out.push({ san: m.san, uci: u, fen: c.fen(), label: white ? `${no}.` : out.length === 0 ? `${no}...` : undefined });
  }
  return out;
}

const material = (fen: string, color: 'w' | 'b') =>
  new Chess(fen)
    .board()
    .flat()
    .reduce((s, p) => (p ? s + (p.color === color ? 1 : -1) * VALUE[p.type] : s), 0);

function gainWords(n: number): string {
  if (n >= 9) return 'the queen';
  if (n >= 5) return n === 5 ? 'a rook' : `${n} points of material`;
  if (n === 3) return 'a piece';
  if (n === 4) return 'a piece and a pawn';
  if (n === 2) return 'the exchange (rook for a minor piece)';
  if (n === 1) return 'a pawn';
  return `${n} points of material`;
}

/** Valuable things (pieces worth 3+, or the king) the piece on `sq` attacks. */
function targets(c: Chess, sq: Square, color: 'w' | 'b'): string[] {
  const parts = c.fen().split(' ');
  parts[1] = color;
  parts[3] = '-';
  const out: string[] = [];
  try {
    const t = new Chess(parts.join(' '), { skipValidation: true });
    for (const m of t.moves({ square: sq, verbose: true })) {
      if (m.captured && VALUE[m.captured] >= 3) out.push(`${NAME[m.captured]} on ${m.to}`);
    }
  } catch {
    /* ignore */
  }
  if (c.inCheck() && c.turn() !== color) out.unshift('king');
  return out;
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * Explains a line in a sentence or two.
 * `who` names the side making the first move ("you" or e.g. "Black").
 */
export function explainLine(fen: string, uci: string[], mate: number | null, who: string): string {
  const line = playLine(fen, uci);
  if (!line.length) return '';
  const me = fen.split(' ')[1] as 'w' | 'b';
  const opp = me === 'w' ? 'b' : 'w';
  const you = who === 'you';
  const first = new Chess(fen).move({ from: line[0].uci.slice(0, 2), to: line[0].uci.slice(2, 4), promotion: line[0].uci[4] });
  const after = new Chess(line[0].fen);

  if (mate !== null && mate > 0) {
    const n = Math.min(line.length, mate * 2 - 1);
    const end = new Chess(line[n - 1].fen);
    if (end.isCheckmate()) return mate === 1 ? `${first.san} is checkmate.` : `${first.san} forces checkmate in ${mate} moves.`;
    return `${first.san} starts a forced checkmate in ${mate}.`;
  }

  const parts: string[] = [];
  // What the first move does.
  const t = targets(after, first.to as Square, me);
  const pieces = t.filter((x) => x !== 'king');
  const check = after.inCheck();
  if (first.captured) {
    const free = !after.isAttacked(first.to as Square, opp);
    let p = `${first.san} takes the ${NAME[first.captured]} on ${first.to}${check ? ' with check' : ''}${free ? ' (nothing can take it back)' : ''}`;
    if (pieces.length >= 2) p += ` and attacks the ${list(pieces)} at once`;
    else if (pieces.length === 1) p += ` and attacks the ${pieces[0]}`;
    parts.push(p);
  } else if (first.promotion) {
    parts.push(`${first.san} makes a new ${NAME[first.promotion]}`);
  } else if (t.length >= 2) {
    parts.push(`${first.san} attacks the ${list(t)} at once (a fork)`);
  } else if (check) {
    parts.push(`${first.san} gives check`);
  } else if (t.length === 1) {
    parts.push(`${first.san} attacks the ${t[0]}`);
  } else if (line[2]) {
    // A quiet move: say what it threatens next.
    const threat = new Chess(line[1].fen).move({ from: line[2].uci.slice(0, 2), to: line[2].uci.slice(2, 4), promotion: line[2].uci[4] });
    parts.push(`${first.san} prepares ${threat.san}${threat.captured ? `, winning the ${NAME[threat.captured]}` : ''}`);
  } else {
    parts.push(`${first.san} is the strongest move here`);
  }

  const gain = lineGain(fen, uci);
  if (gain >= 1) parts.push(`${you ? 'you win' : `${who} wins`} ${gainWords(gain)}`);

  // No capitalizing: the sentence starts with a move, and pawn moves are lowercase (exd5).
  return `${parts.join(', and ')}.`;
}

/**
 * Material the first mover is up (or down) by the end of the line. If the line ends on a capture
 * that can be taken back, the recapture is counted too, so "Qxd5" into a defended square isn't a win.
 */
export function lineGain(fen: string, uci: string[]): number {
  const line = playLine(fen, uci);
  if (!line.length) return 0;
  const me = fen.split(' ')[1] as 'w' | 'b';
  let gain = material(line[line.length - 1].fen, me) - material(fen, me);
  const lastFen = line.length > 1 ? line[line.length - 2].fen : fen;
  const u = line[line.length - 1].uci;
  const lastMove = new Chess(lastFen).move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  const end = new Chess(line[line.length - 1].fen);
  if (lastMove.captured && !end.isCheckmate() && end.isAttacked(lastMove.to as Square, end.turn()))
    gain += (lastMove.color === me ? -1 : 1) * VALUE[lastMove.promotion ?? lastMove.piece];
  return gain;
}

/**
 * One sentence comparing the better line with what happened: material you'd keep, or mate avoided.
 * `played` is your move followed by the opponent's best reply line.
 */
export function compareLines(fen: string, best: string[], played: string[], playedMate: boolean): string {
  if (playedMate) return 'It also stops the checkmate your move allowed.';
  const diff = lineGain(fen, best) - lineGain(fen, played);
  if (diff < 1) return '';
  const worth = diff >= 9 ? "a queen's worth" : diff === 5 ? "a rook's worth" : diff === 3 ? "a piece's worth" : diff === 1 ? "a pawn's worth" : `${diff} points`;
  return `Compared with your move, you'd be ${worth} of material better off.`;
}


/** "12. Nf5 Qd7 13. Nxg7" */
export function lineText(steps: LineStep[]): string {
  return steps.map((s) => (s.label ? `${s.label} ${s.san}` : s.san)).join(' ');
}
