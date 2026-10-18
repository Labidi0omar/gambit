import { Chess, type Square } from 'chess.js';
import { PIECE_NAME } from './coach';
import data from '../content/firststeps.json';

/** I do -> we do -> you do. */
export type Phase = 'example' | 'guided' | 'solo';

export interface Frame {
  fen: string;
  caption: string;
  arrows?: string[]; // "e2e4"
  squares?: string[];
}

interface TaskBase {
  phase: Phase;
  prompt: string;
  /** hint level 1: a text nudge */
  nudge?: string;
}

export type ChoiceRule = 'inCheck' | 'mateOrStale' | 'compareMate' | 'canCastleKingside' | 'canMate';
export type MoveAccept = 'best' | 'mate' | 'kingMove' | 'block' | 'captureChecker' | 'castle' | 'enPassant' | 'promote';

export type Task =
  | (TaskBase & { type: 'show'; frames: Frame[] })
  // tap squares on an empty board, in order
  | (TaskBase & { type: 'tap'; targets: string[] })
  // move a lone piece onto every star; fen is a placement (pieces only)
  | (TaskBase & { type: 'stars'; fen: string; stars: string[]; par: number })
  // capture every black piece; fen is a placement (pieces only)
  | (TaskBase & { type: 'collect'; fen: string; par: number })
  // tap every white piece that is protected (answer computed from the position)
  | (TaskBase & { type: 'pick'; fen: string; rule: 'defended'; why: string })
  | (TaskBase & { type: 'choice'; fen?: string; fens?: string[]; options: string[]; answer: number; rule: ChoiceRule; why: string; keySquares?: string[] })
  // answer = the move hints and examples use; accept = which moves count
  | (TaskBase & { type: 'move'; fen: string; answer: string; accept: MoveAccept; why: string })
  | (TaskBase & { type: 'game' });

export interface Step {
  id: string;
  title: string;
  /** the one new idea, in at most three short sentences */
  intro: string;
  /** chess terms this step introduces (each needs a one-line definition in the intro) */
  defines: string[];
  /** the "you learned" card */
  learned: string;
  tasks: Task[];
  /** feature that opens when this step is done */
  unlocks?: 'puzzles' | 'play';
  /** piece shown on the path map */
  icon: 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
}

export const STEPS = data.steps as Step[];
export const stepIndex = (id: string) => STEPS.findIndex((s) => s.id === id);

// ---------- task logic shared by the step player (and mirrored by validate-content.ts) ----------

/** White non-king pieces that another white piece could capture back on. */
export function protectedSquares(fen: string): string[] {
  const c = new Chess(fen);
  return c
    .board()
    .flat()
    .filter((p) => p && p.color === 'w' && p.type !== 'k' && c.isAttacked(p.square, 'w'))
    .map((p) => p!.square);
}

export const whitePieces = (fen: string) =>
  new Chess(fen)
    .board()
    .flat()
    .filter((p) => p && p.color === 'w' && p.type !== 'k')
    .map((p) => p!.square as string);

export function choiceTruth(rule: ChoiceRule, fens: string[]): number {
  const c = new Chess(fens[0]);
  switch (rule) {
    case 'inCheck':
      return c.inCheck() ? 0 : 1;
    case 'mateOrStale':
      return c.isCheckmate() ? 0 : 1;
    case 'compareMate':
      return fens.findIndex((f) => new Chess(f).isCheckmate());
    case 'canCastleKingside':
      return c.moves().includes('O-O') ? 0 : 1;
    case 'canMate':
      return c.isInsufficientMaterial() ? 1 : 0;
  }
}

/** Does this move satisfy the task? */
export function moveAccepted(fen: string, uci: string, accept: MoveAccept, answer: string): boolean {
  const c = new Chess(fen);
  const wasCheck = c.inCheck();
  const want = new Chess(fen).move(answer);
  let m;
  try {
    m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || want.promotion || 'q' });
  } catch {
    return false;
  }
  switch (accept) {
    case 'best':
      return m.from === want.from && m.to === want.to && (m.promotion ?? '') === (want.promotion ?? '');
    case 'mate':
      return c.isCheckmate();
    case 'kingMove':
      return wasCheck && m.piece === 'k';
    case 'block':
      return wasCheck && m.piece !== 'k' && !m.captured;
    case 'captureChecker':
      return wasCheck && !!m.captured;
    case 'castle':
      return m.san.startsWith('O-O');
    case 'enPassant':
      return m.flags.includes('e');
    case 'promote':
      return !!m.promotion;
  }
}

/** A plain-language "here's why" for a move that didn't do the job. */
export function moveWhy(fen: string, uci: string, accept: MoveAccept, fallback: string): string {
  const c = new Chess(fen);
  try {
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  } catch {
    return fallback;
  }
  if (accept === 'mate') {
    if (!c.inCheck()) return "That move doesn't attack the king, so it isn't check yet.";
    const escape = c.moves({ verbose: true }).find((m) => m.piece === 'k');
    if (escape) return `That's check, but the king can still step to ${escape.to}.`;
    const save = c.moves({ verbose: true })[0];
    if (save) return `That's check, but Black can answer with ${save.san}.`;
  }
  return fallback;
}

/** Name the piece giving check, for hints and explanations. */
export function checkerName(fen: string): string | null {
  const c = new Chess(fen);
  if (!c.inCheck()) return null;
  const king = c.board().flat().find((p) => p?.type === 'k' && p.color === c.turn())!.square;
  const by = c.attackers(king as Square, c.turn() === 'w' ? 'b' : 'w')[0];
  const p = c.get(by);
  return p ? `the ${PIECE_NAME[p.type]} on ${by}` : null;
}
