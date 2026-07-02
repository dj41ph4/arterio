'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import type { ArtworkView, Locale } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';
import { Link } from '@/i18n/navigation';
import { formatCurrency } from '@/lib/format';

const AUTOPLAY_MS = 5500;

function gradientFor(colors: string[]): string {
  const [c1, c2, c3] = [colors[0] ?? '#312e81', colors[1] ?? colors[0] ?? '#1e1b4b', colors[2] ?? colors[1] ?? '#0f172a'];
  return `linear-gradient(135deg, ${c1} 0%, ${c2} 55%, ${c3} 100%)`;
}

export function HeroSlideshow({ artworks, locale }: { artworks: ArtworkView[]; locale: Locale }) {
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const slides = artworks.slice(0, 6);

  React.useEffect(() => {
    if (paused || slides.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % slides.length), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [paused, slides.length]);

  if (slides.length === 0) return null;

  const art = slides[index]!;
  const title = resolveLocalized(art.title, locale) || art.inventoryNumber;
  const image = art.primaryImageUrl ?? art.media[0]?.url;

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="relative h-[340px] w-full overflow-hidden rounded-2xl border border-border shadow-elevated sm:h-[400px]"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={art.id}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0"
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={title} className="size-full object-cover" />
          ) : (
            <div className="size-full" style={{ background: gradientFor(art.dominantColors) }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/10" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent" />
        </motion.div>
      </AnimatePresence>

      {/* Content */}
      <div className="relative flex h-full flex-col justify-end p-6 sm:p-10">
        <motion.div
          key={`${art.id}-text`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="max-w-xl"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
            <Sparkles className="size-3" /> Ajouté récemment
          </span>
          <h2 className="mt-3 font-display text-2xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
            {title}
          </h2>
          <p className="mt-1.5 text-sm text-white/80 sm:text-base">
            {art.artistName ?? art.attribution ?? '—'}
            {art.dateText && <span className="text-white/60"> · {art.dateText}</span>}
          </p>
          {art.valuation?.insuranceValue != null && (
            <p className="mt-3 inline-flex items-center rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
              {formatCurrency(art.valuation.insuranceValue, art.valuation.currency, locale)}
            </p>
          )}
          <Link
            href={`/artworks/${art.id}`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Voir la fiche
          </Link>
        </motion.div>
      </div>

      {/* Controls */}
      {slides.length > 1 && (
        <>
          <button
            onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
            className="absolute left-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-black/50"
            aria-label="Précédent"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={() => setIndex((i) => (i + 1) % slides.length)}
            className="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-black/50"
            aria-label="Suivant"
          >
            <ChevronRight className="size-4" />
          </button>

          <div className="absolute bottom-4 right-4 flex gap-1.5 sm:bottom-6 sm:right-10">
            {slides.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setIndex(i)}
                className="relative h-1 w-7 overflow-hidden rounded-full bg-white/30"
                aria-label={`Aller à la diapositive ${i + 1}`}
              >
                {i === index && (
                  <motion.div
                    key={`${art.id}-progress`}
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: AUTOPLAY_MS / 1000, ease: 'linear' }}
                    className="absolute inset-y-0 left-0 bg-white"
                  />
                )}
                {i !== index && i < index && <div className="absolute inset-0 bg-white/70" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
