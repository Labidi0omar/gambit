import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

// ---------- icons (one stroke weight everywhere) ----------

const PATHS = {
  today: 'M3 11.5L12 4l9 7.5M5.5 9.5V20h13V9.5',
  learn: 'M3 8l9-4 9 4-9 4-9-4zm3 2v5c0 1.5 3 3 6 3s6-1.5 6-3v-5',
  puzzles: 'M9 3h6v3a2 2 0 104 0V3h2v6h-3a2 2 0 100 4h3v8H9v-3a2 2 0 10-4 0v3H3V9h6V3z',
  play: 'M9 4h6l-1 4h2l-2 5h1l1 7H8l1-7h1L8 8h2L9 4z',
  review: 'M3 17l5-6 4 4 4-7 5 9M3 21h18',
  progress: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  flame: 'M12 3s5 4.5 5 9.5A5 5 0 0112 18a5 5 0 01-5-5.5C7 10 9 8.5 9 8.5s.5 2.5 2.5 3C11 8 12 3 12 3z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  lock: 'M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z',
  soundOn: 'M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12',
  soundOff: 'M4 9v6h4l5 4V5L8 9H4zM17 9l4 6M21 9l-4 6',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8z',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4',
  openings: 'M4 5h7v14H4zM13 5h7v14h-7zM7 9h1M16 9h1',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'h-5 w-5', strokeWidth = 1.75 }: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

// ---------- brand ----------

export type Role = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';

/** Classic (cburnett) piece artwork outside a board, reusing chessground's piece CSS. */
export function PieceArt({ role, color = 'white', size = 48, className = '' }: { role: Role; color?: 'white' | 'black'; size?: number; className?: string }) {
  return (
    <div
      ref={(el) => {
        // chessground styles <piece> elements; React warns about unknown tags, so create it directly.
        if (!el) return;
        const p = el.firstElementChild ?? el.appendChild(document.createElement('piece'));
        p.className = `${role} ${color}`;
      }}
      className={`cg-wrap piece-art shrink-0 ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${color} ${role}`}
    />
  );
}

/** The mark: a black knight on a flat brass square. */
export function Seal({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center bg-accent" style={{ width: size, height: size, borderRadius: 2 }}>
      <PieceArt role="knight" color="black" size={size * 0.78} />
    </span>
  );
}

export function Wordmark({ size = 32 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <Seal size={size} />
      <span className="font-display text-[22px] font-semibold leading-none">Gambit</span>
    </span>
  );
}

// ---------- data ----------

/** A plain line chart: one line, no fill, no glow. */
export function Sparkline({ values, height = 64, color = 'var(--color-accent)' }: { values: number[]; height?: number; color?: string }) {
  const W = 300;
  const H = height;
  if (values.length < 2) values = [values[0] ?? 0, values[0] ?? 0];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => 3 + (1 - (v - lo) / span) * (H - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden="true">
      <motion.path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

export function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (!value) return <span className="text-sm text-ink-2">No change{suffix}</span>;
  return (
    <span className={`text-sm font-semibold ${value > 0 ? 'text-up' : 'text-down'}`}>
      {value > 0 ? '+' : '−'}
      {Math.abs(value)}
      {suffix}
    </span>
  );
}

// ---------- lists ----------

/** A list row on a tone step. Rows sit 2px apart so the ground separates them, not a line. */
export function Row({
  title,
  sub,
  right,
  onClick,
  done,
  art,
  highlight,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  done?: boolean;
  art?: ReactNode;
  highlight?: boolean;
  icon?: IconName;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-200 ${
        highlight ? 'bg-surface-2 hover:bg-surface-3' : 'bg-surface hover:bg-surface-2'
      }`}
    >
      {art && <span className={`flex h-11 w-11 shrink-0 items-center justify-center ${done ? 'opacity-35' : ''}`}>{art}</span>}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[17px] font-semibold ${done ? 'text-ink-2' : ''}`}>{title}</span>
        {sub && <span className="block truncate text-[15px] text-ink-2">{sub}</span>}
      </span>
      {done ? (
        <span className="flex items-center gap-1.5 text-sm font-semibold text-up">
          <Icon name="check" className="h-4 w-4" strokeWidth={2.5} /> Done
        </span>
      ) : (
        right
      )}
      <Icon name="chevron" className="h-4 w-4 shrink-0 text-ink-2 transition-transform duration-200 group-hover:translate-x-0.5" />
    </button>
  );
}

export function RowGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-[2px] overflow-hidden rounded-[3px]">{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="display-m">{children}</h2>
      {action}
    </div>
  );
}

/** Staggered rise for the parts of a section. */
export const rise = (i: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.07 * i, duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
});
