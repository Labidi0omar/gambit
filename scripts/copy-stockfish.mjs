import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/stockfish/bin';
const dst = 'public/stockfish';
if (!existsSync(src)) process.exit(0);
mkdirSync(dst, { recursive: true });
for (const f of ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']) copyFileSync(`${src}/${f}`, `${dst}/${f}`);
