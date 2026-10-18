export interface Puzzle {
  id: string;
  fen: string;
  moves: string; // space-separated UCI; first move is the opponent's setup move
  rating: number;
  themes: string[];
}

export const BANDS: [number, number][] = [
  [400, 800],
  [800, 1000],
  [1000, 1200],
  [1200, 1400],
  [1400, 1600],
];

const cache = new Map<string, Promise<Puzzle[]>>();

export function bandFor(rating: number): [number, number] {
  return BANDS.find(([lo, hi]) => rating >= lo && rating < hi) ?? (rating < 400 ? BANDS[0] : BANDS[BANDS.length - 1]);
}

export function loadBand([lo, hi]: [number, number]): Promise<Puzzle[]> {
  const key = `${lo}-${hi}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}puzzles/${key}.json`).then((r) => {
      if (!r.ok) throw new Error(`missing ${key}.json`);
      return r.json() as Promise<Puzzle[]>;
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Pick a puzzle near `rating`, skipping recently seen ids; widens the window if needed. */
export async function pickPuzzle(rating: number, opts: { theme?: string; exclude: Set<string> }): Promise<Puzzle | null> {
  const band = bandFor(rating);
  const idx = BANDS.indexOf(band);
  const bands = [band, BANDS[idx - 1], BANDS[idx + 1]].filter(Boolean) as [number, number][];
  const lists = await Promise.all(bands.map((b) => loadBand(b).catch(() => [] as Puzzle[])));
  const all = lists.flat().filter((p) => !opts.exclude.has(p.id) && (!opts.theme || p.themes.includes(opts.theme)));
  for (const win of [100, 200, 350, 600, Infinity]) {
    const near = all.filter((p) => Math.abs(p.rating - rating) <= win);
    if (near.length) return near[Math.floor(Math.random() * near.length)];
  }
  return null;
}

export const THEME_LABELS: Record<string, string> = {
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  discoveredAttack: 'Discovered attack',
  hangingPiece: 'Hanging piece',
  backRankMate: 'Back-rank mate',
  smotheredMate: 'Smothered mate',
  doubleCheck: 'Double check',
  endgame: 'Endgame',
  short: 'Short',
  deflection: 'Deflection',
  capturingDefender: 'Remove the defender',
  queenEndgame: 'Queen endgame',
  rookEndgame: 'Rook endgame',
  pawnEndgame: 'Pawn endgame',
  promotion: 'Promotion',
  opening: 'Opening',
};

export const themeLabel = (t: string) => THEME_LABELS[t] ?? t.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
