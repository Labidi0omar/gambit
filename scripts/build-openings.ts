// Builds src/content/openings.json from the lichess-org/chess-openings TSVs (names + main lines only).
// Put a.tsv..e.tsv in data/openings/ (https://github.com/lichess-org/chess-openings).
// Each repertoire = one main line + two common deviations, cut to the first 8 moves.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { Chess } from 'chess.js';

const MAX_PLIES = 16;
const DIR = 'data/openings';

type Pick = [name: string, pgn: string];
interface Repertoire {
  id: string;
  name: string;
  lines: Pick[]; // [0] = main line
  /** Unlocks at puzzle rating 1200. */
  advanced?: boolean;
}

const WHITE: Repertoire[] = [
  {
    id: 'italian',
    name: 'Italian Game',
    lines: [
      ['Italian Game: Giuoco Pianissimo', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. Nc3 Nf6 5. O-O O-O 6. d3'],
      ['Italian Game: Giuoco Pianissimo', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O Bc5 5. Nc3 d6 6. d3'],
      ["Petrov's Defense", '1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6 4. Nf3 Nxe4'],
    ],
  },
  {
    id: 'ruy-lopez',
    advanced: true,
    name: 'Ruy Lopez',
    lines: [
      ['Ruy Lopez: Closed', '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O'],
      ['Ruy Lopez: Berlin Defense', '1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O'],
      ["Petrov's Defense", '1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6 4. Nf3 Nxe4'],
    ],
  },
  {
    id: 'london',
    name: 'London System',
    lines: [
      ["Queen's Pawn Game: London System", '1. d4 d5 2. Nf3 Nf6 3. Bf4 c5 4. e3 Nc6 5. Nbd2 e6 6. c3'],
      ['London System, with Bd3', '1. d4 Nf6 2. Nf3 g6 3. Bf4 Bg7 4. e3 d6 5. Bd3'],
      ['Indian Defense: London System', '1. d4 Nf6 2. Nf3 e6 3. Bf4'],
    ],
  },
  {
    id: 'queens-gambit',
    advanced: true,
    name: "Queen's Gambit",
    lines: [
      ["Queen's Gambit Declined", '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. Nf3 c6 6. e3 dxc4 7. Bxc4'],
      ["Queen's Gambit Accepted", '1. d4 d5 2. c4 dxc4 3. Nf3 Nf6'],
      ['Slav Defense', '1. d4 d5 2. c4 c6 3. Nc3 dxc4'],
    ],
  },
];

const BLACK: Repertoire[] = [
  {
    id: 'caro-kann',
    name: 'Caro-Kann Defense',
    lines: [
      ['Caro-Kann Defense: Classical Variation', '1. e4 c6 2. d4 d5 3. Nd2 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7'],
      ['Caro-Kann Defense: Advance, Short Variation', '1. e4 c6 2. d4 d5 3. e5 Bf5 4. c3 e6 5. Be2'],
      ['Caro-Kann Defense: Exchange Variation, Rubinstein Variation', '1. e4 c6 2. d4 d5 3. exd5 cxd5 4. Bd3 Nc6 5. c3 Nf6 6. Bf4'],
    ],
  },
  {
    id: 'french',
    advanced: true,
    name: 'French Defense',
    lines: [
      ['French Defense: Advance Variation, Main Line', '1. e4 e6 2. d4 d5 3. e5 c5 4. c3 Nc6 5. Nf3 Qb6 6. a3'],
      ['French Defense: Classical Variation', '1. e4 e6 2. d4 d5 3. Nc3 Nf6 4. Bg5 Be7 5. e5 Nfd7 6. Bxe7 Qxe7'],
      ['French Defense: Exchange Variation', '1. e4 e6 2. d4 d5 3. exd5 exd5 4. Nf3'],
    ],
  },
  {
    id: 'open-games',
    name: '1...e5 (open games)',
    lines: [
      ['Italian Game: Giuoco Pianissimo', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. Nc3 Nf6 5. O-O O-O 6. d3'],
      ['Ruy Lopez: Closed', '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O'],
      ['Scotch Game', '1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Qh4 5. Nb5 Bb4+ 6. Bd2'],
    ],
  },
  {
    id: 'qgd',
    advanced: true,
    name: "Queen's Gambit Declined",
    lines: [
      ["Queen's Gambit Declined", '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. Nf3 c6 6. e3 dxc4 7. Bxc4'],
      ["Queen's Gambit Declined: Exchange Variation", '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. e3 Be7 5. cxd5 exd5 6. Bd3 O-O 7. Nf3 c6'],
      ["Queen's Pawn Game: London System", '1. d4 d5 2. Nf3 Nf6 3. Bf4 c5 4. e3 Nc6 5. Nbd2 e6 6. c3'],
    ],
  },
];

// "name<TAB>pgn" -> ECO code
const rows = new Map<string, string>(
  readdirSync(DIR)
    .filter((f) => f.endsWith('.tsv'))
    .flatMap((f) => readFileSync(`${DIR}/${f}`, 'utf8').split('\n').slice(1))
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 3)
    .map((c) => [`${c[1]}\t${c[2].trim()}`, c[0]] as [string, string]),
);
console.log(`${rows.size} dataset lines`);

function build(list: Repertoire[]) {
  return list.map((r) => ({
    id: r.id,
    name: r.name,
    advanced: r.advanced ?? false,
    lines: r.lines.map(([name, pgn]) => {
      const eco = rows.get(`${name}\t${pgn}`);
      if (!eco) throw new Error(`Not in dataset: ${name} | ${pgn}`);
      const san = pgn.split(' ').filter((t) => !/^\d+\.$/.test(t));
      const c = new Chess();
      for (const m of san) c.move(m); // throws if illegal
      return { eco, name, pgn, san: san.slice(0, MAX_PLIES) };
    }),
  }));
}

const out = { white: build(WHITE), black: build(BLACK) };
writeFileSync('src/content/openings.json', JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote src/content/openings.json: ${out.white.length} white, ${out.black.length} black repertoires`);
