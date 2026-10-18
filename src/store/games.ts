import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOptions } from '../lib/storage';
import type { GameResult } from './settings';

export type Flag = 'blunder' | 'mistake' | null;

export interface GameAnalysis {
  depth: number;
  /** White-POV eval per position (0..n), centipawns; mate encoded as ±(10000 - plies). */
  evals: number[];
  /** Engine best move (UCI) per position. */
  best: string[];
  /** Per ply (0..n-1): loss in centipawns for the mover, clamped. */
  loss: number[];
  flags: Flag[];
  /** Per ply: tactic the mover missed or allowed, as a Lichess theme. */
  themes: (string | null)[];
}

export interface GameRecord {
  id: string;
  date: number;
  userColor: 'w' | 'b';
  botElo: number;
  result: GameResult;
  reason: string;
  startFen: string;
  san: string[];
  analysis?: GameAnalysis;
}

interface GamesState {
  games: GameRecord[];
  addGame: (g: Omit<GameRecord, 'id' | 'date'>) => string;
  setAnalysis: (id: string, a: GameAnalysis) => void;
}

const MAX_GAMES = 50;

export const useGames = create<GamesState>()(
  persist(
    (set) => ({
      games: [],
      addGame: (g) => {
        const id = Date.now().toString(36);
        set((s) => ({ games: [{ ...g, id, date: Date.now() }, ...s.games].slice(0, MAX_GAMES) }));
        return id;
      },
      setAnalysis: (id, a) => set((s) => ({ games: s.games.map((g) => (g.id === id ? { ...g, analysis: a } : g)) })),
    }),
    persistOptions('gambit.games'),
  ),
);
