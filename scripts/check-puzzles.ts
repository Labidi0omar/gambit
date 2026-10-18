// Samples public/puzzles/*.json and checks: legal FEN, playable moves (first = opponent setup),
// rating inside the band, no duplicate ids across bands.
// Usage: node scripts/check-puzzles.ts [samplePerBand=200]
import { readFileSync, readdirSync } from 'node:fs';
import { Chess } from 'chess.js';

const N = Number(process.argv[2] ?? 200);
const dir = 'public/puzzles';
let failures = 0;
const fail = (msg: string) => {
  failures++;
  if (failures <= 20) console.log(`  FAIL ${msg}`);
};

// Deterministic sample so reruns are comparable.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const seenIds = new Map<string, string>();
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const [lo, hi] = file.replace('.json', '').split('-').map(Number);
  const all: { id: string; fen: string; moves: string; rating: number; themes: string[] }[] = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
  for (const p of all) {
    if (seenIds.has(p.id)) fail(`${p.id} duplicated in ${seenIds.get(p.id)} and ${file}`);
    seenIds.set(p.id, file);
    if (p.rating < lo || p.rating >= hi) fail(`${file} ${p.id}: rating ${p.rating} outside band`);
  }
  const sample = [...all].sort(() => rand() - 0.5).slice(0, N);
  for (const p of sample) {
    try {
      const c = new Chess(p.fen);
      const flip = p.fen.split(' ');
      flip[1] = flip[1] === 'w' ? 'b' : 'w';
      flip[3] = '-';
      if (new Chess(flip.join(' ')).inCheck()) throw new Error('side not to move is in check');
      const moves = p.moves.split(' ');
      if (moves.length < 2) throw new Error('no solution after the setup move');
      const setupColor = c.turn();
      for (const [i, u] of moves.entries()) {
        const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
        // ply 0 is the opponent's setup move; the solver is the other color.
        if (i === 0 && m.color !== setupColor) throw new Error('setup move by the wrong side');
      }
      if (!p.themes.length) throw new Error('no themes');
    } catch (e) {
      fail(`${file} ${p.id}: ${(e as Error).message}`);
    }
  }
  console.log(`${file}: ${all.length} puzzles, ${sample.length} sampled`);
}
console.log(`\n${seenIds.size} unique ids, ${failures} failures`);
process.exit(failures ? 1 : 0);
