import { describe, it, expect, beforeEach, vi } from 'vitest';

// Fresh module graph per test so persisted stores rehydrate from whatever localStorage holds.
async function load<T>(path: string): Promise<T> {
  vi.resetModules();
  return (await import(path)) as T;
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('bot auto-raise', () => {
  it('raises +100 after 3 wins in the last 5', async () => {
    const { useBot } = await load<typeof import('../src/store/settings')>('../src/store/settings');
    const s = useBot.getState();
    s.setBotElo(600);
    expect(useBot.getState().recordResult('win').raised).toBe(false);
    expect(useBot.getState().recordResult('loss').raised).toBe(false);
    expect(useBot.getState().recordResult('win').raised).toBe(false);
    const r = useBot.getState().recordResult('win');
    expect(r.raised).toBe(true);
    expect(r.newElo).toBe(700);
  });

  it('only counts the last 5 games', async () => {
    const { useBot } = await load<typeof import('../src/store/settings')>('../src/store/settings');
    useBot.getState().setBotElo(600);
    for (const r of ['win', 'win', 'loss', 'loss', 'loss', 'loss'] as const) useBot.getState().recordResult(r);
    expect(useBot.getState().recordResult('win').raised).toBe(false); // last 5: L L L L W
  });

  it('never goes above 2000', async () => {
    const { useBot, BOT_MAX } = await load<typeof import('../src/store/settings')>('../src/store/settings');
    expect(BOT_MAX).toBeLessThanOrEqual(2000);
    useBot.getState().setBotElo(1950);
    for (let i = 0; i < 9; i++) useBot.getState().recordResult('win');
    expect(useBot.getState().botElo).toBeLessThanOrEqual(2000);
    useBot.getState().setBotElo(5000);
    expect(useBot.getState().botElo).toBeLessThanOrEqual(2000);
  });

  it('survives a reload', async () => {
    let m = await load<typeof import('../src/store/settings')>('../src/store/settings');
    m.useBot.getState().setBotElo(900);
    m.useBot.getState().recordResult('win');
    m = await load<typeof import('../src/store/settings')>('../src/store/settings');
    expect(m.useBot.getState().botElo).toBe(900);
    expect(m.useBot.getState().recent).toEqual(['win']);
  });
});

const PUZ = { id: 'p1', fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 1', moves: 'g8h8 a1a8', rating: 600, themes: ['mateIn1'] };

describe('spaced repetition (puzzles)', () => {
  // Local calendar days: a puzzle missed at 23:30 is due the next day, not 24 hours later.
  const localDay = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const plusDays = (n: number, from: Date) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + n);

  it('missed puzzle comes back on the next local day, then 3, 7, 14', async () => {
    vi.useFakeTimers();
    const start = new Date(2026, 9, 18, 23, 30); // 23:30 local
    vi.setSystemTime(start);
    const { usePuzzles } = await load<typeof import('../src/store/puzzles')>('../src/store/puzzles');
    usePuzzles.getState().recordAttempt(PUZ, false, false);
    let card = usePuzzles.getState().reviews.p1;
    expect(card.stage).toBe(0);
    expect(localDay(card.due)).toBe(localDay(plusDays(1, start).getTime()));
    expect(card.due).toBeLessThanOrEqual(plusDays(1, start).getTime()); // due from local midnight

    // Solve it on each due date: 3, then 7, then 14 days.
    for (const gap of [3, 7, 14]) {
      vi.setSystemTime(new Date(card.due + 9 * 3600_000)); // 09:00 on the due day
      usePuzzles.getState().recordAttempt(PUZ, true, true);
      card = usePuzzles.getState().reviews.p1;
      const now = new Date(Date.now());
      expect(localDay(card.due)).toBe(localDay(plusDays(gap, now).getTime()));
    }
  });

  it('graduates after the 14-day review is solved', async () => {
    const { usePuzzles } = await load<typeof import('../src/store/puzzles')>('../src/store/puzzles');
    const s = usePuzzles.getState();
    s.recordAttempt(PUZ, false, false);
    for (let i = 0; i < 4; i++) usePuzzles.getState().recordAttempt(PUZ, true, true);
    expect(usePuzzles.getState().reviews.p1).toBeUndefined();
  });

  it('a miss during review resets to tomorrow', async () => {
    const { usePuzzles } = await load<typeof import('../src/store/puzzles')>('../src/store/puzzles');
    usePuzzles.getState().recordAttempt(PUZ, false, false);
    usePuzzles.getState().recordAttempt(PUZ, true, true);
    usePuzzles.getState().recordAttempt(PUZ, false, true);
    expect(usePuzzles.getState().reviews.p1.stage).toBe(0);
  });

  it('reviews do not change the rating; rated attempts do', async () => {
    const { usePuzzles } = await load<typeof import('../src/store/puzzles')>('../src/store/puzzles');
    const r0 = usePuzzles.getState().rating;
    usePuzzles.getState().recordAttempt(PUZ, true, true);
    expect(usePuzzles.getState().rating).toBe(r0);
    usePuzzles.getState().recordAttempt(PUZ, true, false);
    expect(usePuzzles.getState().rating).toBeGreaterThan(r0);
  });
});

describe('opening line SRS', () => {
  it('uses local days and the 1/3/7/14 ladder', async () => {
    vi.useFakeTimers();
    const start = new Date(2026, 9, 18, 23, 50);
    vi.setSystemTime(start);
    const { useOpenings } = await load<typeof import('../src/store/openings')>('../src/store/openings');
    useOpenings.getState().grade('white:italian:0', true);
    const due = new Date(useOpenings.getState().cards['white:italian:0'].due);
    expect(due.getDate()).toBe(new Date(2026, 9, 19).getDate());
    expect(due.getHours()).toBe(0);
  });
});

describe('localStorage robustness', () => {
  it('works when storage throws', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const spy2 = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { useBot } = await load<typeof import('../src/store/settings')>('../src/store/settings');
    expect(useBot.getState().botElo).toBe(400);
    expect(() => useBot.getState().setBotElo(500)).not.toThrow();
    spy.mockRestore();
    spy2.mockRestore();
  });

  it('falls back to defaults on corrupted JSON', async () => {
    localStorage.setItem('gambit.puzzles', '{not json');
    localStorage.setItem('gambit.bot', 'null}');
    const p = await load<typeof import('../src/store/puzzles')>('../src/store/puzzles');
    const b = await load<typeof import('../src/store/settings')>('../src/store/settings');
    expect(p.usePuzzles.getState().rating).toBe(500);
    expect(b.useBot.getState().botElo).toBe(400);
  });

  it('falls back to defaults on a wrong-shaped state', async () => {
    localStorage.setItem('gambit.puzzles', JSON.stringify({ state: { rating: 'abc', attempts: 5, reviews: null }, version: 1 }));
    const p = await load<typeof import('../src/store/puzzles')>('../src/store/puzzles');
    const s = p.usePuzzles.getState();
    expect(Number.isFinite(s.rating)).toBe(true);
    expect(Array.isArray(s.attempts)).toBe(true);
    expect(() => s.dueReviews()).not.toThrow();
  });

  it('every persisted store declares a schema version', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const files = readdirSync('src', { recursive: true })
      .map(String)
      .filter((f) => /\.tsx?$/.test(f));
    let stores = 0;
    for (const f of files) {
      const src = readFileSync(`src/${f}`, 'utf8');
      if (!src.includes('persist(')) continue;
      stores++;
      // Either the shared versioned options or an explicit version.
      expect(src, f).toMatch(/persistOptions\(|version:\s*\d/);
    }
    expect(stores).toBeGreaterThanOrEqual(9);
    const { SCHEMA_VERSION } = await import('../src/lib/storage');
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('keeps old (version 0) saves when upgrading to version 1', async () => {
    localStorage.setItem('gambit.bot', JSON.stringify({ state: { botElo: 1100, recent: ['win'] }, version: 0 }));
    const b = await load<typeof import('../src/store/settings')>('../src/store/settings');
    expect(b.useBot.getState().botElo).toBe(1100);
  });
});
