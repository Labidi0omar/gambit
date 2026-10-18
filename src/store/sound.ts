import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOptions } from '../lib/storage';

export const useSound = create<{ muted: boolean; toggle: () => void }>()(
  persist((set) => ({ muted: false, toggle: () => set((s) => ({ muted: !s.muted })) }), persistOptions('gambit.sound')),
);
