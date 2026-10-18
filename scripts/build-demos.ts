// Picks 2-3 demo positions per themed lesson from public/puzzles/*.json and writes src/content/demos.json.
// Every candidate is checked with Stockfish (depth 18) before it is kept, so the file only ever
// contains validated positions. Run after build-puzzles.ts; validate-content.ts re-checks them.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { Chess } from 'chess.js';
import { Engine, checkPuzzle } from './lib/engine.ts';

interface Puzzle {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  themes: string[];
}

const PER_LESSON = 3;
const MAX_TRIES = 12;
// Demo difficulty per curriculum level: easy examples, near the level's rating range.
const WINDOW: [number, number][] = [
  [400, 900],
  [600, 1100],
  [850, 1400],
];

const dir = 'public/puzzles';
if (!existsSync(dir)) {
  console.error('No public/puzzles yet. Run scripts/build-puzzles.ts first.');
  process.exit(1);
}
const all: Puzzle[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as Puzzle[]);
console.log(`${all.length} puzzles loaded`);

async function main() {
  const engine = new Engine();
  await engine.init();
  const used = new Set<string>();
  const out: Record<string, Puzzle[]> = {};

  for (const [li, file] of ['level0.json', 'level1.json', 'level2.json'].entries()) {
    const level = JSON.parse(readFileSync(`src/content/${file}`, 'utf8'));
    for (const lesson of level.lessons) {
      if (!lesson.theme) continue;
      const [lo, hi] = WINDOW[li];
      const tagged = all.filter((p) => p.themes.includes(lesson.theme) && !used.has(p.id) && p.moves.split(' ').length <= 6);
      const byLength = (a: Puzzle, b: Puzzle) => a.moves.split(' ').length - b.moves.split(' ').length || a.rating - b.rating;
      const inWindow = tagged.filter((p) => p.rating >= lo && p.rating < hi).sort(byLength);
      // Rare themes: widen to the nearest ratings outside the level's window.
      const outside = tagged
        .filter((p) => p.rating < lo || p.rating >= hi)
        .sort((a, b) => Math.min(Math.abs(a.rating - lo), Math.abs(a.rating - hi)) - Math.min(Math.abs(b.rating - lo), Math.abs(b.rating - hi)));
      const candidates = [...inWindow, ...outside];
      const kept: Puzzle[] = [];
      for (const p of candidates.slice(0, MAX_TRIES)) {
        if (kept.length >= PER_LESSON) break;
        try {
          new Chess(p.fen);
          const r = await checkPuzzle(engine, p.fen, p.moves.split(' '), p.themes);
          if (!r.ok) {
            console.log(`  skip ${lesson.id} ${p.id}: ${r.why}`);
            continue;
          }
        } catch (e) {
          console.log(`  skip ${lesson.id} ${p.id}: ${(e as Error).message}`);
          continue;
        }
        kept.push(p);
        used.add(p.id);
      }
      // A lesson needs 2-3 demos; with fewer, it shows none rather than a lone example.
      if (kept.length < 2) console.log(`  WARN ${lesson.id}: only ${kept.length} valid demo(s) for "${lesson.theme}", skipped`);
      else out[lesson.id] = kept;
      console.log(`${lesson.id}: ${kept.map((p) => `${p.id} (${p.rating})`).join(', ') || 'none'}`);
    }
  }

  writeFileSync('src/content/demos.json', JSON.stringify(out, null, 1) + '\n');
  console.log('Wrote src/content/demos.json');
  engine.quit();
}

main();
