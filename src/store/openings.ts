import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOptions } from '../lib/storage';
import { dueInDays } from '../lib/days';
import { findRepertoire, lineKey, type Side } from '../lib/openings';

const INTERVALS = [1, 3, 7, 14]; // days; a mastered line keeps coming back every 14

export interface LineCard {
  stage: number; // -1 = never drilled
  due: number;
}

interface OpeningsState {
  white?: string;
  black?: string;
  cards: Record<string, LineCard>;
  choose: (side: Side, id: string) => void;
  /** Record a drill of one line: perfect moves the card up, any mistake sends it back to tomorrow. */
  grade: (key: string, perfect: boolean) => void;
}

export const useOpenings = create<OpeningsState>()(
  persist(
    (set) => ({
      cards: {},
      choose: (side, id) => set({ [side]: id } as Partial<OpeningsState>),
      grade: (key, perfect) =>
        set((s) => {
          const cur = s.cards[key] ?? { stage: -1, due: 0 };
          const stage = perfect ? Math.min(cur.stage + 1, INTERVALS.length - 1) : 0;
          return { cards: { ...s.cards, [key]: { stage, due: dueInDays(INTERVALS[stage]) } } };
        }),
    }),
    persistOptions('gambit.openings'),
  ),
);

export interface DueLine {
  side: Side;
  repId: string;
  index: number;
  key: string;
  card?: LineCard;
}

/** Lines of the chosen repertoires that are new or due now. */
export function dueLines(s: Pick<OpeningsState, 'white' | 'black' | 'cards'>, all = false): DueLine[] {
  const out: DueLine[] = [];
  for (const side of ['white', 'black'] as Side[]) {
    const rep = findRepertoire(side, s[side]);
    if (!rep) continue;
    rep.lines.forEach((_, index) => {
      const key = lineKey(side, rep.id, index);
      const card = s.cards[key];
      if (all || !card || card.due <= Date.now()) out.push({ side, repId: rep.id, index, key, card });
    });
  }
  return out;
}
