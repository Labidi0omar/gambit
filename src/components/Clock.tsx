export function Clock({ ms, active, label }: { ms: number; active: boolean; label: string }) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  const low = ms < 20_000;
  const [name, ...rest] = label.split(' · ');
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            name === 'You' ? 'bg-gradient-to-br from-accent to-accent-2 text-white' : 'bg-white/10 text-zinc-300'
          }`}
        >
          {name === 'You' ? 'Me' : 'SF'}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{name}</span>
          {rest.length > 0 && <span className="block truncate text-xs text-zinc-500">{rest.join(' · ')}</span>}
        </span>
      </div>
      <span
        className={`num rounded-xl px-3 py-1.5 text-xl font-bold transition-colors ${
          active ? (low ? 'bg-down text-white' : 'bg-white text-black') : 'bg-white/[0.06] text-zinc-400'
        }`}
      >
        {mm}:{ss}
      </span>
    </div>
  );
}
