// Streams the Lichess puzzle CSV (.csv or .csv.zst) and writes public/puzzles/{band}.json.
// Usage: node scripts/build-puzzles.ts [path/to/lichess_db_puzzle.csv(.zst)]
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import zlib from 'node:zlib';
import { Transform, type Readable, type TransformCallback } from 'node:stream';

const BANDS: [number, number][] = [
  [400, 800],
  [800, 1000],
  [1000, 1200],
  [1200, 1400],
  [1400, 1600],
];
const MAX_PER_BAND = 3000;
// Reserved per lesson theme per band, so every lesson has demos and practice at every level.
const PER_THEME = 60;
const MIN_POPULARITY = 80;
const MIN_PLAYS = 500;
const OUT_DIR = 'public/puzzles';

interface OutPuzzle {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  themes: string[];
}

function findInput(): string {
  const arg = process.argv[2];
  if (arg) return arg;
  for (const p of ['data/lichess_db_puzzle.csv', 'data/lichess_db_puzzle.csv.zst']) if (existsSync(p)) return p;
  console.error('No puzzle CSV found. Put lichess_db_puzzle.csv(.zst) in data/ or pass a path.');
  process.exit(1);
}

/**
 * The Lichess file is written by pzstd: each zstd frame is preceded by a skippable frame
 * (magic 0x184D2A5x) whose 4-byte payload is the next frame's size. Node's decoder rejects
 * skippable frames, so drop them and pass the real frames through back to back.
 */
class StripSkippableFrames extends Transform {
  private buf = Buffer.alloc(0);
  private mode: 'header' | 'frame' | 'pass' = 'header';
  private remaining = 0;

  _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.mode === 'pass') {
        if (this.buf.length) this.push(this.buf);
        this.buf = Buffer.alloc(0);
        break;
      }
      if (this.mode === 'header') {
        if (this.buf.length < 8) break;
        if ((this.buf.readUInt32LE(0) & 0xfffffff0) >>> 0 !== 0x184d2a50) {
          this.mode = 'pass'; // plain zstd from here on
          continue;
        }
        const len = this.buf.readUInt32LE(4);
        if (this.buf.length < 8 + len) break;
        const size = len === 4 ? this.buf.readUInt32LE(8) : null;
        this.buf = this.buf.subarray(8 + len);
        if (size !== null) {
          this.mode = 'frame';
          this.remaining = size;
        }
        continue;
      }
      if (!this.buf.length) break;
      const take = Math.min(this.remaining, this.buf.length);
      this.push(this.buf.subarray(0, take));
      this.buf = this.buf.subarray(take);
      this.remaining -= take;
      if (this.remaining === 0) this.mode = 'header';
    }
    done();
  }

  _flush(done: TransformCallback) {
    if (this.buf.length) this.push(this.buf);
    done();
  }
}

function openStream(path: string): Readable {
  const raw = createReadStream(path);
  if (!path.endsWith('.zst')) return raw;
  const z = zlib as unknown as { createZstdDecompress?: () => NodeJS.ReadWriteStream };
  if (!z.createZstdDecompress) {
    console.error('This Node version cannot read .zst. Use Node >= 22.15, or decompress first: zstd -d file.csv.zst');
    process.exit(1);
  }
  return raw.pipe(new StripSkippableFrames()).pipe(z.createZstdDecompress()) as unknown as Readable;
}

async function main() {
  const input = findInput();
  console.log(`Reading ${input}`);
  // Reservoir sampling per band so the whole DB contributes, not just the first rows.
  const reservoirs = BANDS.map(() => [] as OutPuzzle[]);
  const seen = BANDS.map(() => 0);
  // Rare lesson themes (castling, en passant, smothered mate...) would barely appear in a random
  // sample, so each band also keeps a small reservoir per lesson theme and those go in first.
  const lessonThemes = [
    ...new Set(
      ['level0.json', 'level1.json', 'level2.json'].flatMap((f) =>
        JSON.parse(readFileSync(`src/content/${f}`, 'utf8')).lessons.flatMap((l: { theme?: string; practice?: { theme: string } }) =>
          [l.theme, l.practice?.theme].filter(Boolean),
        ),
      ),
    ),
  ] as string[];
  const themed = BANDS.map(() => new Map(lessonThemes.map((t) => [t, [] as OutPuzzle[]])));
  const themedSeen = BANDS.map(() => new Map(lessonThemes.map((t) => [t, 0])));
  const sample = (arr: OutPuzzle[], n: number, cap: number, p: OutPuzzle) => {
    if (arr.length < cap) arr.push(p);
    else {
      const j = Math.floor(Math.random() * n);
      if (j < cap) arr[j] = p;
    }
  };
  let rows = 0;

  const rl = createInterface({ input: openStream(input), crlfDelay: Infinity });
  for await (const line of rl) {
    if (rows++ === 0 && line.startsWith('PuzzleId')) continue;
    if (rows % 500_000 === 0) console.log(`  ${rows.toLocaleString()} rows`);
    const f = line.split(',');
    if (f.length < 8) continue;
    const rating = Number(f[3]);
    const popularity = Number(f[5]);
    const plays = Number(f[6]);
    if (popularity < MIN_POPULARITY || plays < MIN_PLAYS) continue;
    const b = BANDS.findIndex(([lo, hi]) => rating >= lo && rating < hi);
    if (b < 0) continue;

    const p: OutPuzzle = { id: f[0], fen: f[1], moves: f[2], rating, themes: f[7].split(' ').filter(Boolean) };
    sample(reservoirs[b], ++seen[b], MAX_PER_BAND, p);
    for (const t of p.themes) {
      const r = themed[b].get(t);
      if (!r) continue;
      const n = themedSeen[b].get(t)! + 1;
      themedSeen[b].set(t, n);
      sample(r, n, PER_THEME, p);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  BANDS.forEach(([lo, hi], i) => {
    // Lesson-theme quotas first, then the random sample, deduplicated, never above MAX_PER_BAND.
    const byId = new Map<string, OutPuzzle>();
    for (const r of themed[i].values()) for (const p of r) byId.set(p.id, p);
    for (const p of reservoirs[i]) {
      if (byId.size >= MAX_PER_BAND) break;
      byId.set(p.id, p);
    }
    const list = [...byId.values()].slice(0, MAX_PER_BAND).sort((a, c) => a.rating - c.rating);
    writeFileSync(`${OUT_DIR}/${lo}-${hi}.json`, JSON.stringify(list));
    const thin = lessonThemes.filter((t) => (themed[i].get(t)?.length ?? 0) < 10);
    console.log(`${lo}-${hi}: ${list.length} puzzles (from ${seen[i].toLocaleString()} eligible)${thin.length ? `; under 10 for ${thin.join(', ')}` : ''}`);
  });
}

main();
