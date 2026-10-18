import { createJSONStorage, type PersistOptions, type StateStorage } from 'zustand/middleware';

/** localStorage that never throws: blocked storage reads as empty, corrupted JSON is dropped. */
export const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) JSON.parse(v); // corrupted -> treat as missing
      return v;
    } catch {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export const SCHEMA_VERSION = 1;

const sameShape = (a: unknown, b: unknown) =>
  Array.isArray(b) ? Array.isArray(a) : b === null || b === undefined ? true : typeof a === typeof b && (typeof b !== 'object' || (a !== null && !Array.isArray(a)));

/**
 * Keep each saved field only if it has the same type as the default, so a hand-edited or
 * stale save can't put a string where a number belongs and crash a screen.
 */
export function safeMerge<T extends object>(persisted: unknown, current: T): T {
  if (!persisted || typeof persisted !== 'object') return current;
  const out = { ...current } as Record<string, unknown>;
  for (const [k, v] of Object.entries(persisted as Record<string, unknown>)) {
    const def = (current as Record<string, unknown>)[k];
    if (typeof def === 'function') continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    if (k in current ? sameShape(v, def) : true) out[k] = v;
  }
  return out as T;
}

/** Shared persist options: safe storage, versioned schema, shape-checked merge. */
export function persistOptions<T extends object>(name: string): PersistOptions<T, T> {
  return {
    name,
    storage: createJSONStorage<T>(() => safeStorage),
    version: SCHEMA_VERSION,
    // v0 -> v1 only added the version number; the data is unchanged.
    migrate: (state) => state as T,
    merge: (persisted, current) => safeMerge(persisted, current),
  };
}
