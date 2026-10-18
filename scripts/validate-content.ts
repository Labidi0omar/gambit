// Validates every position in src/content/ against chess.js and Stockfish (depth 18).
//   node scripts/validate-content.ts         report; exit 1 on any failure
//   node scripts/validate-content.ts --fix   also delete failing demo positions from demos.json
// Hand-written positions can't be auto-fixed: fix or delete them in the level files.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { Chess } from 'chess.js';
import { parsePlacement, collectDests, collectMove, targetsLeft, toPlacementFen, solveCollect } from '../src/lib/collect.ts';
import { Engine, checkBest, checkPuzzle, fmt, DEPTH } from './lib/engine.ts';

const FIX = process.argv.includes('--fix');
const LEVEL_FILES = ['level0.json', 'level1.json', 'level2.json'];
const DEMOS_FILE = 'src/content/demos.json';

let errors = 0;
let warnings = 0;
const err = (where: string, msg: string) => {
  errors++;
  console.log(`  FAIL  ${where}: ${msg}`);
};
const warn = (where: string, msg: string) => {
  warnings++;
  console.log(`  warn  ${where}: ${msg}`);
};
const pass = (where: string, msg: string) => console.log(`  ok    ${where}: ${msg}`);

function legal(fen: string) {
  new Chess(fen); // throws on an illegal FEN
  // chess.js doesn't reject a position where the side NOT to move is in check.
  const p = fen.split(' ');
  p[1] = p[1] === 'w' ? 'b' : 'w';
  p[3] = '-';
  if (new Chess(p.join(' ')).inCheck()) throw new Error('illegal: the side not to move is in check');
}

function minCollectMoves(fen: string): number {
  const start = parsePlacement(fen);
  let frontier = [start];
  const seen = new Set([toPlacementFen(start)]);
  for (let d = 0; d <= 10; d++) {
    const next: typeof frontier = [];
    for (const p of frontier) {
      if (targetsLeft(p) === 0) return d;
      for (const [from, tos] of collectDests(p))
        for (const to of tos) {
          const n = collectMove(p, from, to);
          const k = toPlacementFen(n);
          if (!seen.has(k)) {
            seen.add(k);
            next.push(n);
          }
        }
    }
    frontier = next;
  }
  return Infinity;
}

const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => x.trim()).length;

async function main() {
  const engine = new Engine();
  await engine.init();
  console.log(`Stockfish depth ${DEPTH}\n`);

  const demos: Record<string, { id: string; fen: string; moves: string; themes: string[] }[]> = JSON.parse(readFileSync(DEMOS_FILE, 'utf8'));
  let demosChanged = false;

  for (const file of LEVEL_FILES) {
    const level = JSON.parse(readFileSync(`src/content/${file}`, 'utf8'));
    console.log(`${file}: ${level.lessons.length} lessons`);
    for (const lesson of level.lessons) {
      const at = lesson.id;
      const n = sentences(lesson.explain ?? '');
      if (!lesson.explain) err(at, 'missing explanation');
      else if (n > 4) err(at, `explanation has ${n} sentences (max 4)`);

      // Demo positions from the puzzle DB.
      if (lesson.theme) {
        const list = demos[lesson.id] ?? [];
        if (!list.length) warn(at, `no demo positions yet for "${lesson.theme}" (build the puzzle DB: npm run puzzles)`);
        const kept = [];
        for (const p of list) {
          const where = `${at} demo ${p.id}`;
          try {
            legal(p.fen);
            const r = await checkPuzzle(engine, p.fen, p.moves.split(' '), p.themes);
            if (!r.ok) throw new Error(r.why);
            if (!p.themes.includes(lesson.theme)) throw new Error(`not tagged ${lesson.theme}`);
            pass(where, r.why);
            kept.push(p);
          } catch (e) {
            err(where, (e as Error).message);
            demosChanged = true;
          }
        }
        if (FIX && kept.length !== list.length) demos[lesson.id] = kept;
        if (kept.length && (kept.length < 2 || kept.length > 3)) err(at, `${kept.length} demo positions (need 2-3)`);
      }

      // Hand-written positions.
      for (const [i, step] of (lesson.steps ?? []).entries()) {
        const where = `${at} step ${i + 1} (${step.type})`;
        try {
          legal(step.fen);
          if (step.type === 'collect') {
            const min = minCollectMoves(step.fen);
            if (min === Infinity) err(where, 'targets unreachable');
            else if (step.maxMoves && min > step.maxMoves) err(where, `par ${step.maxMoves} impossible, minimum is ${min}`);
            else pass(where, `legal, solvable in ${min}`);
          } else if (step.type === 'play') {
            const e = await engine.evaluate(step.fen);
            if (e.score < 400) err(where, `start is not clearly winning: ${fmt(e.score)}`);
            else pass(where, `winning (${fmt(e.score)})`);
          } else if (step.type === 'move') {
            const g = new Chess(step.fen);
            for (const [k, san] of step.line.entries()) {
              const fen = g.fen();
              g.move(san);
              if (k % 2 === 0) {
                const r = await checkBest(engine, fen, san);
                if (r.ok) pass(`${where} ${san}`, r.why);
                else err(where, r.why);
              }
            }
            if (step.line.length % 2 === 0) err(where, 'line must end on a user move');
            const mateClaim = step.anyMate || step.line[step.line.length - 1].endsWith('#');
            if (mateClaim && !g.isCheckmate()) err(where, 'claims mate but the line does not end in checkmate');
            for (const alt of step.alts ?? []) {
              const r = await checkBest(engine, step.fen, alt);
              if (!r.ok) err(`${where} alt ${alt}`, r.why);
            }
          }
        } catch (e) {
          err(where, (e as Error).message);
        }
      }
    }
  }

  // First Steps path. Chess positions must be legal; mini-game boards (stars/collect: a lone piece
  // and targets, no kings) aren't chess positions, so they're checked for solvability and par instead.
  console.log('\nfirststeps.json');
  const fs = JSON.parse(readFileSync('src/content/firststeps.json', 'utf8'));
  const GLOSSARY = ['file', 'rank', 'capture', 'protected', 'check', 'checkmate', 'stalemate', 'draw', 'castling', 'en passant', 'promotion'];
  const defined = new Set<string>();
  const sq = /^[a-h][1-8]$/;
  for (const step of fs.steps) {
    const at = step.id;
    for (const t of step.defines) defined.add(t);
    const n = sentences(step.intro);
    if (n > 3) err(at, `intro has ${n} sentences (max 3)`);
    for (const t of step.defines as string[]) if (!new RegExp(`\\b${t}s?\\b`, 'i').test(step.intro)) err(at, `"${t}" is introduced but not defined in the intro`);
    // No chess term before the step that defines it.
    const text = JSON.stringify(step.tasks) + ' ' + step.intro + ' ' + step.learned;
    for (const term of GLOSSARY) {
      if (defined.has(term)) continue;
      const re = new RegExp(`\\b${term}(s|ed|ing)?\\b`, 'i');
      if (re.test(text)) err(at, `uses "${term}" before it is taught`);
    }
    const phases = step.tasks.map((t: { phase: string }) => t.phase);
    if (step.tasks.length > 1 && (phases[0] !== 'example' || !phases.includes('solo'))) err(at, 'needs example -> ... -> solo');

    for (const [i, task] of step.tasks.entries()) {
      const where = `${at} task ${i + 1} (${task.type})`;
      try {
        if (task.type === 'tap') {
          for (const s of task.targets) if (!sq.test(s)) throw new Error(`bad square ${s}`);
          pass(where, task.targets.join(' '));
        } else if (task.type === 'show') {
          for (const f of task.frames) {
            if (!f.fen.startsWith('8/8/8/8/8/8/8/8 ')) legal(f.fen);
            for (const a of f.arrows ?? []) if (!sq.test(a.slice(0, 2)) || !sq.test(a.slice(2, 4))) throw new Error(`bad arrow ${a}`);
            for (const s of f.squares ?? []) if (!sq.test(s)) throw new Error(`bad square ${s}`);
          }
          pass(where, `${task.frames.length} frames`);
        } else if (task.type === 'stars' || task.type === 'collect') {
          const pos = parsePlacement(task.fen);
          if ([...pos.values()].some((p) => p === 'k' || p === 'K') && task.type === 'stars' && [...pos.values()].length > 1) throw new Error('star games use a lone piece');
          const stars = new Set<string>(task.stars ?? []);
          for (const s of stars) if (!sq.test(s) || pos.has(s)) throw new Error(`bad star ${s}`);
          const path = solveCollect({ pos, stars });
          if (!path) throw new Error('not solvable');
          if (path.length !== task.par) throw new Error(`par ${task.par}, shortest is ${path.length}`);
          pass(where, `shortest ${path.length} = par`);
        } else if (task.type === 'pick') {
          legal(task.fen);
          const c = new Chess(task.fen);
          const mine = c.board().flat().filter((p) => p && p.color === 'w' && p.type !== 'k');
          const protectedSq = mine.filter((p) => c.isAttacked(p!.square, 'w')).map((p) => p!.square);
          if (!protectedSq.length) throw new Error('no protected piece to find');
          if (protectedSq.length === mine.length) throw new Error('every piece is protected: no real choice');
          pass(where, `answer ${protectedSq.join(', ')}`);
        } else if (task.type === 'choice') {
          const fens: string[] = task.fens ?? [task.fen];
          fens.forEach(legal);
          const c = new Chess(fens[0]);
          let truth: number;
          if (task.rule === 'inCheck') truth = c.inCheck() ? 0 : 1;
          else if (task.rule === 'mateOrStale') {
            if (!c.isCheckmate() && !c.isStalemate()) throw new Error('neither mate nor stalemate');
            truth = c.isCheckmate() ? 0 : 1;
          } else if (task.rule === 'compareMate') {
            const mates = fens.map((f) => new Chess(f).isCheckmate());
            if (mates.filter(Boolean).length !== 1) throw new Error('exactly one board must be checkmate');
            truth = mates.indexOf(true);
          } else if (task.rule === 'canCastleKingside') truth = c.moves().includes('O-O') ? 0 : 1;
          else if (task.rule === 'canMate') truth = c.isInsufficientMaterial() ? 1 : 0;
          else throw new Error(`unknown rule ${task.rule}`);
          if (truth !== task.answer) throw new Error(`stated answer "${task.options[task.answer]}", position says "${task.options[truth]}"`);
          pass(where, `${task.rule} -> ${task.options[truth]}`);
        } else if (task.type === 'move') {
          legal(task.fen);
          const c = new Chess(task.fen);
          const all = c.moves({ verbose: true });
          const checker = c.inCheck() ? all.length && new Chess(task.fen) : null;
          const m = c.move(task.answer); // throws if illegal
          const ok: Record<string, boolean> = {
            mate: c.isCheckmate(),
            kingMove: !!checker && m.piece === 'k',
            block: !!checker && m.piece !== 'k' && !m.captured,
            captureChecker: !!checker && !!m.captured,
            castle: m.san.startsWith('O-O'),
            enPassant: m.flags.includes('e'),
            promote: !!m.promotion,
            best: true,
          };
          if (!ok[task.accept]) throw new Error(`answer ${task.answer} is not a "${task.accept}" move`);
          if (task.accept === 'best' || task.accept === 'mate') {
            const r = await checkBest(engine, task.fen, task.answer);
            if (!r.ok) throw new Error(r.why);
          }
          pass(where, `${task.answer} (${task.accept})`);
        } else if (task.type === 'game') pass(where, 'coach game');
        else throw new Error(`unknown task type ${task.type}`);
      } catch (e) {
        err(where, (e as Error).message);
      }
    }
  }

  // Openings: every line must match the lichess-org/chess-openings TSV exactly (ECO, name, PGN) and play legally.
  console.log('\nopenings.json');
  const openings = JSON.parse(readFileSync('src/content/openings.json', 'utf8'));
  let tsv: Map<string, string> | null = null;
  if (existsSync('data/openings')) {
    tsv = new Map(
      readdirSync('data/openings')
        .filter((f) => f.endsWith('.tsv'))
        .flatMap((f) => readFileSync(`data/openings/${f}`, 'utf8').split('\n').slice(1))
        .map((l) => l.split('\t'))
        .filter((c) => c.length >= 3)
        .map((c) => [`${c[1]}\t${c[2].trim()}`, c[0]] as [string, string]),
    );
  } else warn('openings', 'data/openings/*.tsv not found, dataset match not checked');
  for (const side of ['white', 'black']) {
    for (const rep of openings[side]) {
      for (const line of rep.lines) {
        const where = `${side} ${rep.id}: ${line.name}`;
        try {
          const c = new Chess();
          for (const m of line.san) c.move(m);
          const pgnSan = line.pgn.split(' ').filter((t: string) => !/^\d+\.$/.test(t));
          if (line.san.join(' ') !== pgnSan.slice(0, line.san.length).join(' ')) throw new Error('moves differ from the PGN');
          if (line.san.length > 16) throw new Error(`${line.san.length} plies (max 16)`);
          if (tsv) {
            const eco = tsv.get(`${line.name}\t${line.pgn}`);
            if (!eco) throw new Error('name + PGN not in the dataset');
            if (eco !== line.eco) throw new Error(`ECO ${line.eco}, dataset says ${eco}`);
          }
          pass(where, `${line.eco}, ${line.san.length} plies`);
        } catch (e) {
          err(where, (e as Error).message);
        }
      }
    }
  }

  // Videos: well-formed YouTube video / playlist ids.
  console.log('\nvideos.json');
  const videos = JSON.parse(readFileSync('src/content/videos.json', 'utf8'));
  const lessonIds = new Set(LEVEL_FILES.flatMap((f) => JSON.parse(readFileSync(`src/content/${f}`, 'utf8')).lessons.map((l: { id: string }) => l.id)));
  for (const st of fs.steps) lessonIds.add(st.id);
  for (const [key, v] of [...Object.entries(videos.lessons), ...Object.entries(videos.openings)] as [string, { youtube?: string; playlist?: string }][]) {
    if (/^(l\d|fs-)/.test(key) && !lessonIds.has(key)) err(`video ${key}`, 'no lesson with this id');
    if (v.youtube && !/^[A-Za-z0-9_-]{11}$/.test(v.youtube)) err(`video ${key}`, `bad video id "${v.youtube}"`);
    else if (v.playlist && !/^PL[A-Za-z0-9_-]{16,32}$/.test(v.playlist)) err(`video ${key}`, `bad playlist id "${v.playlist}"`);
    else if (!v.youtube && !v.playlist) err(`video ${key}`, 'no video or playlist id');
    else pass(`video ${key}`, v.youtube ?? v.playlist!);
  }

  if (FIX && demosChanged) {
    writeFileSync(DEMOS_FILE, JSON.stringify(demos, null, 1) + '\n');
    console.log(`\nRemoved failing demos from ${DEMOS_FILE}.`);
  }
  console.log(`\n${errors} failures, ${warnings} warnings`);
  engine.quit();
  process.exit(errors && !FIX ? 1 : 0);
}

main();
