import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOptions } from '../lib/storage';
import { STEPS, stepIndex } from '../lib/firststeps';

export type Knows = 'no' | 'some' | 'yes';
export type Minutes = 10 | 20 | 30;

export interface Profile {
  knowsPieces: Knows;
  playedGame: boolean;
  minutes: Minutes;
}

interface JourneyState {
  onboarded: boolean;
  startedAt: number;
  profile: Profile;
  /** step id -> completed timestamp */
  done: Record<string, number>;
  /** steps placed past during onboarding (still replayable) */
  skipped: Record<string, true>;
  /** feature intro cards already shown */
  introsSeen: Record<string, true>;
  finishOnboarding: (p: Profile) => void;
  completeStep: (id: string) => void;
  seeIntro: (feature: string) => void;
}

/** Where onboarding places you. Default: the very first step. */
export function placementStep(p: Pick<Profile, 'knowsPieces' | 'playedGame'>): string {
  if (p.knowsPieces === 'yes' && p.playedGame) return 'fs-check';
  if (p.knowsPieces === 'yes') return 'fs-capture';
  return STEPS[0].id;
}

export const useJourney = create<JourneyState>()(
  persist(
    (set) => ({
      onboarded: false,
      startedAt: 0,
      profile: { knowsPieces: 'no', playedGame: false, minutes: 10 },
      done: {},
      skipped: {},
      introsSeen: {},
      finishOnboarding: (profile) => {
        const start = stepIndex(placementStep(profile));
        const skipped: Record<string, true> = {};
        STEPS.slice(0, start).forEach((s) => (skipped[s.id] = true));
        set({ onboarded: true, startedAt: Date.now(), profile, skipped });
      },
      completeStep: (id) => set((s) => ({ done: { ...s.done, [id]: s.done[id] ?? Date.now() } })),
      seeIntro: (feature) => set((s) => ({ introsSeen: { ...s.introsSeen, [feature]: true } })),
    }),
    persistOptions('gambit.journey'),
  ),
);

const passed = (s: Pick<JourneyState, 'done' | 'skipped'>, id: string) => !!s.done[id] || !!s.skipped[id];

/** The step to do next, or null when the path is finished. */
export function nextStep(s: Pick<JourneyState, 'done' | 'skipped'>) {
  return STEPS.find((st) => !passed(s, st.id)) ?? null;
}

export const firstStepsDone = (s: Pick<JourneyState, 'done' | 'skipped'>) => STEPS.every((st) => passed(s, st.id));

export const stepReached = (s: Pick<JourneyState, 'done' | 'skipped'>, id: string) => passed(s, id);
