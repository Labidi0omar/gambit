// Collect mini-game: pseudo-legal moves for white pieces, no checks. Black pieces are static targets.
// Both kings sit on the board so every position is a legal FEN; they only block. The white king moves
// only in games where it is White's sole piece, and the black king is never a target.

export type Placement = Map<string, string>; // square -> piece char (FEN letter)

const FILES = 'abcdefgh';

export function parsePlacement(fen: string): Placement {
  const m: Placement = new Map();
  fen
    .split(' ')[0]
    .split('/')
    .forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += Number(ch);
        else m.set(FILES[f++] + (8 - r), ch);
      }
    });
  return m;
}

export function toPlacementFen(m: Placement): string {
  const rows: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let row = '';
    let empty = 0;
    for (const f of FILES) {
      const p = m.get(f + r);
      if (p) {
        if (empty) row += empty;
        empty = 0;
        row += p;
      } else empty++;
    }
    rows.push(row + (empty || ''));
  }
  return rows.join('/');
}

const DIRS: Record<string, [number, number][]> = {
  R: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  B: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  N: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]],
};
DIRS.Q = [...DIRS.R, ...DIRS.B];
DIRS.K = DIRS.Q;

const isWhite = (p?: string) => !!p && p === p.toUpperCase();
const isBlack = (p?: string) => !!p && p === p.toLowerCase();
const isTarget = (p?: string) => isBlack(p) && p !== 'k';

export function collectDests(m: Placement): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const kingMoves = ![...m.values()].some((p) => isWhite(p) && p !== 'K');
  for (const [sq, p] of m) {
    if (!isWhite(p) || (p === 'K' && !kingMoves)) continue;
    const f = FILES.indexOf(sq[0]);
    const r = Number(sq[1]);
    const at = (df: number, dr: number) => (f + df >= 0 && f + df < 8 && r + dr >= 1 && r + dr <= 8 ? FILES[f + df] + (r + dr) : null);
    const d: string[] = [];
    if (p === 'P') {
      const one = at(0, 1);
      if (one && !m.has(one)) {
        d.push(one);
        const two = at(0, 2);
        if (r === 2 && two && !m.has(two)) d.push(two);
      }
      for (const df of [-1, 1]) {
        const c = at(df, 1);
        if (c && isTarget(m.get(c))) d.push(c);
      }
    } else {
      const slide = p === 'R' || p === 'B' || p === 'Q';
      for (const [df, dr] of DIRS[p]) {
        for (let k = 1; k <= (slide ? 7 : 1); k++) {
          const t = at(df * k, dr * k);
          if (!t || isWhite(m.get(t)) || m.get(t) === 'k') break;
          d.push(t);
          if (m.has(t)) break;
        }
      }
    }
    if (d.length) out.set(sq, d);
  }
  return out;
}

export function collectMove(m: Placement, from: string, to: string): Placement {
  const n = new Map(m);
  let p = n.get(from)!;
  if (p === 'P' && to[1] === '8') p = 'Q';
  n.delete(from);
  n.set(to, p);
  return n;
}

export const targetsLeft = (m: Placement) => [...m.values()].filter(isTarget).length;

// ---- stars + solver (First Steps mini-games) ----
// Stars are markers on empty squares: they never block, and a piece collects one by landing on it.

export interface CollectState {
  pos: Placement;
  stars: Set<string>;
}

export const goalsLeft = (s: CollectState) => targetsLeft(s.pos) + s.stars.size;

export function applyCollect(s: CollectState, from: string, to: string): CollectState {
  const stars = new Set(s.stars);
  stars.delete(to);
  return { pos: collectMove(s.pos, from, to), stars };
}

const key = (s: CollectState) => `${toPlacementFen(s.pos)}|${[...s.stars].sort().join(',')}`;

/** Shortest move sequence that collects every target and star (BFS), or null if impossible within maxDepth. */
export function solveCollect(start: CollectState, maxDepth = 10): [string, string][] | null {
  if (goalsLeft(start) === 0) return [];
  let frontier: { s: CollectState; path: [string, string][] }[] = [{ s: start, path: [] }];
  const seen = new Set([key(start)]);
  for (let d = 0; d < maxDepth; d++) {
    const next: typeof frontier = [];
    for (const { s, path } of frontier) {
      for (const [from, tos] of collectDests(s.pos)) {
        for (const to of tos) {
          const n = applyCollect(s, from, to);
          const p: [string, string][] = [...path, [from, to]];
          if (goalsLeft(n) === 0) return p;
          const k = key(n);
          if (!seen.has(k)) {
            seen.add(k);
            next.push({ s: n, path: p });
          }
        }
      }
    }
    frontier = next;
  }
  return null;
}
