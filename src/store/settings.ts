import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOptions } from '../lib/storage';

export type GameResult = 'win' | 'loss' | 'draw';

interface BotState {
  botElo: number;
  recent: GameResult[]; // last results at current Elo
  /** Old CCT-mode toggle; the mode was removed. Kept so saved settings load unchanged. */
  cct: boolean;
  setCct: (on: boolean) => void;
  setBotElo: (elo: number) => void;
  recordResult: (r: GameResult) => { raised: boolean; newElo: number };
}

export const BOT_MIN = 400;
export const BOT_MAX = 2000;

export const useBot = create<BotState>()(
  persist(
    (set, get) => ({
      botElo: 400,
      recent: [],
      cct: false,
      setCct: (on) => set({ cct: on }),
      setBotElo: (elo) => set({ botElo: Math.max(BOT_MIN, Math.min(BOT_MAX, elo)), recent: [] }),
      recordResult: (r) => {
        const recent = [...get().recent, r].slice(-5);
        const wins = recent.filter((x) => x === 'win').length;
        if (wins >= 3) {
          const newElo = Math.min(BOT_MAX, get().botElo + 100);
          set({ botElo: newElo, recent: [] });
          return { raised: true, newElo };
        }
        set({ recent });
        return { raised: false, newElo: get().botElo };
      },
    }),
    persistOptions('gambit.bot'),
  ),
);
