import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOptions } from '../lib/storage';
import { Icon } from './ui';
import videos from '../content/videos.json';

export interface Video {
  youtube?: string;
  playlist?: string;
  title: string;
  short?: boolean;
}

export const LESSON_VIDEOS = videos.lessons as Record<string, Video>;
export const OPENING_VIDEOS = videos.openings as Record<'white' | 'black', Video>;

const videoKey = (v: Video) => v.youtube ?? v.playlist ?? v.title;

/** Watched / unwatched, nothing else. */
export const useWatched = create<{ watched: Record<string, true>; toggle: (key: string) => void }>()(
  persist(
    (set) => ({
      watched: {},
      toggle: (key) =>
        set((s) => {
          const w = { ...s.watched };
          if (w[key]) delete w[key];
          else w[key] = true;
          return { watched: w };
        }),
    }),
    persistOptions('gambit.videos'),
  ),
);

/** Optional, collapsible "Watch first" embed. The iframe only exists once it's opened. */
export function WatchFirst({ video }: { video?: Video }) {
  const [open, setOpen] = useState(false);
  const { watched, toggle } = useWatched();
  if (!video) return null;
  const key = videoKey(video);
  const seen = !!watched[key];
  const src = video.playlist
    ? `https://www.youtube-nocookie.com/embed/videoseries?list=${video.playlist}`
    : `https://www.youtube-nocookie.com/embed/${video.youtube}?rel=0`;

  return (
    <div className="bg-surface">
      <div className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-surface-2 text-accent">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block text-[17px] font-semibold">Watch first</span>
            <span className="block truncate text-[15px] text-ink-2">
              {video.title}
              {video.playlist ? ' · playlist' : video.short ? ' · short' : ''}
            </span>
          </span>
          <Icon name="chevron" className={`ml-auto h-4 w-4 shrink-0 text-ink-2 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        {/* Only one extra choice until the video is open: the toggle appears with it (or once watched). */}
        {(open || seen) && (
          <button
            onClick={() => toggle(key)}
            aria-pressed={seen}
            className={`flex shrink-0 items-center gap-1.5 text-sm font-semibold transition-colors ${seen ? 'text-up' : 'text-ink-2 hover:text-ink'}`}
          >
            {seen && <Icon name="check" className="h-4 w-4" strokeWidth={2.5} />}
            {seen ? 'Watched' : 'Mark watched'}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className={`mx-5 mb-5 ${video.short ? 'mx-auto aspect-[9/16] max-w-[300px]' : 'aspect-video'}`}>
              <iframe
                src={src}
                title={video.title}
                loading="lazy"
                className="h-full w-full"
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
