import type { CctItem, CctKind } from '../lib/cct';

export type CctPhase = 'theirs' | 'mine' | 'move';

const PLURAL: Record<CctKind, string> = { check: 'checks', capture: 'captures', threat: 'threat' };

/** The side panel that walks through a CCT scan before each move. */
export function CctPanel({
  phase,
  marks,
  result,
  checking,
  onDone,
  onNext,
  onClear,
  onSkip,
}: {
  phase: CctPhase;
  marks: number;
  result: { expected: CctItem[]; missed: CctItem[] } | null;
  checking: boolean;
  onDone: () => void;
  onNext: () => void;
  onClear: () => void;
  onSkip: () => void;
}) {
  if (phase === 'move') {
    return (
      <div className="bg-surface-2 px-5 py-4 text-[17px]">
        Scan done. <span className="font-semibold">Now pick your move</span> knowing what's on the board.
      </div>
    );
  }
  const whose = phase === 'theirs' ? 'Their' : 'Your';
  const found = result ? result.expected.length - result.missed.length : 0;
  const byKind = (k: CctKind) => result?.missed.filter((m) => m.kind === k) ?? [];

  return (
    <div className="flex flex-col gap-4 bg-surface-2 px-5 py-5">
      <div>
        <p className="font-display text-2xl font-semibold leading-tight">{whose} checks, captures and threats</p>
        <p className="mt-2 text-[15px] text-ink-2">
          {phase === 'theirs'
            ? 'If it were their move, what could they do? Tap a piece, then where it could go.'
            : 'Now your own forcing moves. Tap a piece, then where it could go.'}{' '}
          Your pieces unlock after this scan.
        </p>
      </div>

      {!result ? (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onDone} disabled={checking} className="btn-primary">
            {checking ? 'Checking…' : marks ? `Check my ${marks} arrow${marks === 1 ? '' : 's'}` : 'There are none'}
          </button>
          {marks > 0 && (
            <button onClick={onClear} className="link text-[15px] text-ink-2">
              Clear
            </button>
          )}
          <button onClick={onSkip} className="link text-[15px] text-ink-2">
            Skip, just move
          </button>
        </div>
      ) : (
        <>
          <p className={`text-[17px] font-semibold ${result.missed.length ? 'text-down' : 'text-up'}`}>
            {result.expected.length === 0
              ? 'Nothing forcing here. Correct.'
              : result.missed.length
                ? `You found ${found} of ${result.expected.length}. Missed ones are in red.`
                : `All ${result.expected.length} found.`}
          </p>
          {result.missed.length > 0 && (
            <ul className="flex flex-col gap-1 text-[15px]">
              {(['check', 'capture', 'threat'] as CctKind[]).map((k) =>
                byKind(k).length ? (
                  <li key={k}>
                    <span className="text-ink-2">Missed {PLURAL[k]}: </span>
                    {byKind(k)
                      .map((m) => m.san)
                      .join(', ')}
                  </li>
                ) : null,
              )}
            </ul>
          )}
          <button onClick={onNext} className="btn-primary self-start">
            {phase === 'theirs' ? 'Next: your moves' : 'Make my move'}
          </button>
        </>
      )}
    </div>
  );
}
