// Pulls your recent games from chess.com or Lichess (public APIs, no login) into game records.
import { Chess } from 'chess.js';
import type { GameRecord } from '../store/games';

export type Site = 'chesscom' | 'lichess';
export type Imported = GameRecord;

const MAX = 20;
const START = new Chess().fen();

const REASON: Record<string, string> = {
  checkmated: 'checkmate',
  mate: 'checkmate',
  resigned: 'resignation',
  resign: 'resignation',
  timeout: 'time',
  outoftime: 'time',
  abandoned: 'abandoned',
  agreed: 'agreement',
  repetition: 'repetition',
  stalemate: 'stalemate',
  insufficient: 'insufficient material',
  timevsinsufficient: 'time vs insufficient material',
  '50move': '50-move rule',
  draw: 'draw',
};

/** SAN moves and start position of a PGN, or null if it doesn't parse. */
function parsePgn(pgn: string) {
  const c = new Chess();
  try {
    c.loadPgn(pgn);
  } catch {
    return null;
  }
  const fen = /\[FEN "([^"]+)"\]/.exec(pgn)?.[1] ?? START;
  return { startFen: fen, san: c.history() };
}

async function chesscom(user: string): Promise<Imported[]> {
  const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
  if (r.status === 404) throw new Error(`No chess.com player called "${user}".`);
  if (!r.ok) throw new Error(`chess.com answered ${r.status}.`);
  const { archives } = (await r.json()) as { archives: string[] };
  const out: Imported[] = [];
  // Newest month first, until there are enough games.
  for (const url of archives.reverse().slice(0, 3)) {
    const m = await fetch(url);
    if (!m.ok) continue; // chess.com sometimes fails on one month; try the one before
    const { games = [] } = (await m.json()) as { games?: any[] };
    for (const g of games.reverse()) {
      if (g.rules !== 'chess' || !g.pgn) continue;
      const p = parsePgn(g.pgn);
      if (!p || p.san.length < 2) continue;
      const white = g.white.username.toLowerCase() === user.toLowerCase();
      const me = white ? g.white : g.black;
      const them = white ? g.black : g.white;
      const result = me.result === 'win' ? 'win' : them.result === 'win' ? 'loss' : 'draw';
      out.push({
        id: `cc-${g.url.split('/').pop()}`,
        date: g.end_time * 1000,
        userColor: white ? 'w' : 'b',
        botElo: them.rating,
        opponent: them.username,
        site: 'chess.com',
        result,
        reason: REASON[result === 'win' ? them.result : me.result] ?? (me.result as string),
        ...p,
      });
      if (out.length >= MAX) return out;
    }
  }
  return out;
}

async function lichess(user: string): Promise<Imported[]> {
  const r = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${MAX}&pgnInJson=true&perfType=bullet,blitz,rapid,classical,correspondence`, {
    headers: { Accept: 'application/x-ndjson' },
  });
  if (r.status === 404) throw new Error(`No Lichess player called "${user}".`);
  if (!r.ok) throw new Error(`Lichess answered ${r.status}.`);
  const lines = (await r.text()).split('\n').filter(Boolean);
  const out: Imported[] = [];
  for (const l of lines) {
    const g = JSON.parse(l);
    const p = parsePgn(g.pgn ?? '');
    if (!p || p.san.length < 2) continue;
    const white = g.players.white.user?.name?.toLowerCase() === user.toLowerCase();
    const them = white ? g.players.black : g.players.white;
    const color = white ? 'white' : 'black';
    out.push({
      id: `li-${g.id}`,
      date: g.lastMoveAt ?? g.createdAt,
      userColor: white ? 'w' : 'b',
      botElo: them.rating ?? 1500,
      opponent: them.user?.name ?? 'Anonymous',
      site: 'Lichess',
      result: !g.winner ? 'draw' : g.winner === color ? 'win' : 'loss',
      reason: REASON[g.status] ?? g.status,
      ...p,
    });
  }
  return out;
}

export function importGames(site: Site, user: string) {
  return site === 'chesscom' ? chesscom(user.trim()) : lichess(user.trim());
}
