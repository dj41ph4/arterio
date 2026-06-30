'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import { translateNationality } from '@/lib/nationality';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  Globe,
  Image as ImageIcon,
  MapPin,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  User,
} from 'lucide-react';
import { artistRepository, type ArtistView } from '@/lib/data/artist-repository';
import { artworkRepository } from '@/lib/data';
import type { Locale } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';
import { ArtworkThumbnail } from '@/components/artwork/thumbnail';
import { ArtworkFormModal } from '@/components/artwork/artwork-form-modal';
import { EditArtistModal } from './edit-artist-modal';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BiographyTab({
  locales,
  biography,
  activeLocale,
  onLocaleChange,
}: {
  locales: Locale[];
  biography: Partial<Record<Locale, string>>;
  activeLocale: Locale;
  onLocaleChange: (l: Locale) => void;
}) {
  const availableLocales = locales.filter((l) => biography[l]);
  if (availableLocales.length === 0)
    return <p className="text-sm text-muted-foreground">No biography available.</p>;

  const currentLocale = biography[activeLocale] ? activeLocale : (availableLocales[0] ?? 'en');
  const text = biography[currentLocale];

  return (
    <div className="space-y-3">
      {/* Language tabs */}
      <div className="flex flex-wrap gap-1.5">
        {availableLocales.map((l) => (
          <button
            key={l}
            onClick={() => onLocaleChange(l)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              currentLocale === l
                ? 'bg-primary text-white'
                : 'bg-muted text-muted-foreground hover:bg-border'
            }`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      <AnimatePresence initial={false}>
        <motion.p
          key={currentLocale}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          className="text-sm leading-relaxed text-foreground"
        >
          {text}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div>
        <span className="text-xs text-muted-foreground">{label}</span>
        <p className="text-foreground">{value}</p>
      </div>
    </div>
  );
}

function ExternalLinkButton({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
    >
      {icon}
      {label}
      <ExternalLink className="ml-auto h-3 w-3 opacity-40" />
    </a>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const ALL_LOCALES: Locale[] = ['en', 'fr', 'it', 'es', 'de', 'nl'];

export function ArtistProfile({ id, locale }: { id: string; locale: string }) {
  const t = useTranslations();
  const router = useRouter();
  const { data: artist, isLoading } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => artistRepository.getById(id),
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!artist) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">{t('common.noResults')}</p>
        <button onClick={() => router.push(`/${locale}/artists`)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
          {t('common.back')}
        </button>
      </div>
    );
  }

  return <ArtistProfileContent artist={artist} locale={locale} />;
}

function ArtistArtworksSection({
  artistId,
  count,
  locale,
}: {
  artistId: string;
  count: number;
  locale: Locale;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ['artist-artworks', artistId],
    queryFn: () => artworkRepository.list({ artistId: [artistId], limit: 24 }),
  });

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ImageIcon className="h-4 w-4 text-primary" />
        {t('artists.worksInCollection', { count })}
      </h2>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {isLoading
          ? Array.from({ length: Math.min(count, 8) }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg bg-muted" />
            ))
          : data?.items.map((artwork) => (
              <button
                key={artwork.id}
                onClick={() => router.push(`/${locale}/artworks/${artwork.id}`)}
                className="group space-y-1.5 text-left"
              >
                <ArtworkThumbnail
                  colors={artwork.dominantColors}
                  src={artwork.thumbnailUrl}
                  alt={resolveLocalized(artwork.title, locale)}
                  className="aspect-square w-full transition-transform group-hover:scale-[1.02]"
                  rounded="lg"
                />
                <p className="truncate text-xs font-medium text-foreground">
                  {resolveLocalized(artwork.title, locale) || t('artwork.fields.title')}
                </p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {artwork.inventoryNumber}
                </p>
              </button>
            ))}
      </div>
    </section>
  );
}

function ArtistProfileContent({ artist, locale }: { artist: ArtistView; locale: string }) {
  const t = useTranslations();
  const router = useRouter();
  const { locale: paramLocale } = useParams<{ locale: string }>();
  const currentLocale = (locale || paramLocale || 'en') as Locale;

  const [bioLocale, setBioLocale] = useState<Locale>(
    (artist.biography[currentLocale] ? currentLocale : ALL_LOCALES.find((l) => artist.biography[l])) ?? 'en',
  );
  const [editOpen, setEditOpen] = useState(false);
  const [createArtworkOpen, setCreateArtworkOpen] = useState(false);
  const qc = useQueryClient();

  // Same backend call as the list page's per-card retry — full bio + nationality
  // + dates + photo + movement enrichment, exposed directly on the profile page
  // instead of being buried inside the edit modal.
  const enrichMutation = useMutation({
    mutationFn: () => artistRepository.enrich(artist.id),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['artist', artist.id] });
      qc.invalidateQueries({ queryKey: ['artists-all'] });
      if (updated.externalIds.wikidata || Object.keys(updated.externalIds).length > 0) {
        toast.success(`${updated.fullName} — enrichissement mis à jour`);
      } else {
        toast.error('Aucune information trouvée (vérifiez l\'orthographe du nom)');
      }
    },
    onError: () => toast.error("Échec de l'enrichissement — réessayez plus tard"),
  });

  const initials = artist.fullName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const birthYear = artist.birthDate?.slice(0, 4);
  const deathYear = artist.deathDate?.slice(0, 4);
  const lifespan = [birthYear, deathYear].filter(Boolean).join(' – ');

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Back button */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 backdrop-blur-sm px-6 py-3">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('common.back')}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreateArtworkOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            Nouvelle œuvre
          </button>
          <button
            onClick={() => enrichMutation.mutate()}
            disabled={enrichMutation.isPending}
            title="Relance la recherche Wikidata/Wikipédia (+ sources de secours) et complète bio, nationalité, dates et photo manquantes"
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${enrichMutation.isPending ? 'animate-spin' : ''}`} />
            {enrichMutation.isPending ? 'Recherche…' : 'Réessayer enrichissement'}
          </button>
          <button
            onClick={() => setEditOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('common.edit')}
          </button>
        </div>
      </div>

      <EditArtistModal
        artist={artist}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onDeleted={() => router.push(`/${locale}/artists`)}
      />

      <ArtworkFormModal
        open={createArtworkOpen}
        onClose={() => setCreateArtworkOpen(false)}
        defaultArtistId={artist.id}
        defaultArtistName={artist.fullName}
      />

      <div className="mx-auto w-full max-w-5xl px-6 py-8 space-y-8">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
          {/* Background blur from portrait */}
          {artist.thumbnail && (
            <div
              className="absolute inset-0 scale-110 blur-2xl opacity-20"
              style={{ backgroundImage: `url(${artist.thumbnail})`, backgroundSize: 'cover' }}
            />
          )}
          <div className="relative flex flex-col gap-6 p-8 sm:flex-row sm:items-end">
            {/* Portrait */}
            <div className="h-32 w-32 shrink-0 overflow-hidden rounded-2xl border-2 border-border shadow-lg">
              {artist.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={artist.thumbnail}
                  alt={artist.fullName}
                  className="h-full w-full object-cover object-top"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted">
                  <span className="text-3xl font-semibold text-muted-foreground">{initials}</span>
                </div>
              )}
            </div>

            {/* Name & meta */}
            <div className="flex-1 space-y-2">
              <h1 className="text-3xl font-bold tracking-tight text-foreground">
                {artist.fullName}
              </h1>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {artist.nationality && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {translateNationality(artist.nationality, currentLocale)}
                  </span>
                )}
                {lifespan && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {lifespan}
                  </span>
                )}
                {artist.movement && (
                  <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-0.5 text-xs font-medium text-primary">
                    <Palette className="h-3 w-3" />
                    {resolveLocalized(artist.movement.label, currentLocale) || artist.movement.name}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {t('artists.worksInCollection', { count: artist.artworkCount })}
              </p>
            </div>
          </div>
        </div>

        {/* ── Main layout ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left column — bio + notable works + influenced by */}
          <div className="space-y-6 lg:col-span-2">
            {/* Biography */}
            <section className="rounded-xl border border-border bg-card p-6 space-y-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <User className="h-4 w-4 text-primary" />
                {t('artists.biography')}
              </h2>
              <BiographyTab
                locales={ALL_LOCALES}
                biography={artist.biography}
                activeLocale={bioLocale}
                onLocaleChange={setBioLocale}
              />
              {Object.keys(artist.externalUrls).length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Source: Wikipedia (open content, CC BY-SA 3.0)
                </p>
              )}
            </section>

            {/* Notable works */}
            {artist.notableWorks && artist.notableWorks.length > 0 && (
              <section className="rounded-xl border border-border bg-card p-6 space-y-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Star className="h-4 w-4 text-primary" />
                  {t('artists.notableWorks')}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {artist.notableWorks.map((work) => (
                    <span
                      key={work}
                      className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-foreground"
                    >
                      {work}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Influenced by */}
            {artist.influencedBy && artist.influencedBy.length > 0 && (
              <section className="rounded-xl border border-border bg-card p-6 space-y-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Sparkles className="h-4 w-4 text-primary" />
                  {t('artists.influencedBy')}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {artist.influencedBy.map((name) => (
                    <span
                      key={name}
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Works in collection */}
            {artist.artworkCount > 0 && (
              <ArtistArtworksSection artistId={artist.id} count={artist.artworkCount} locale={currentLocale} />
            )}
          </div>

          {/* Right column — info panel + external links */}
          <div className="space-y-4">
            {/* Biographical data */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('artists.artistInfo')}
              </h2>

              {artist.nationality && (
                <InfoRow icon={MapPin} label={t('artists.nationality')} value={translateNationality(artist.nationality, currentLocale)} />
              )}
              {artist.birthDate && (
                <InfoRow icon={Calendar} label={t('artists.born')} value={formatDate(artist.birthDate)} />
              )}
              {artist.deathDate && (
                <InfoRow icon={Calendar} label={t('artists.died')} value={formatDate(artist.deathDate)} />
              )}
              {artist.movement && (
                <InfoRow
                  icon={Palette}
                  label={t('artists.movement')}
                  value={resolveLocalized(artist.movement.label, currentLocale) || artist.movement.name}
                />
              )}
            </div>

            {/* External authority links */}
            {Object.values(artist.externalUrls).some(Boolean) && (
              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('artists.authorityLinks')}
                </h2>
                <div className="space-y-2">
                  {artist.externalUrls.wikipedia && (
                    <ExternalLinkButton
                      href={artist.externalUrls.wikipedia}
                      label="Wikipedia"
                      icon={<Globe className="h-3.5 w-3.5" />}
                    />
                  )}
                  {artist.externalUrls.wikidata && (
                    <ExternalLinkButton
                      href={artist.externalUrls.wikidata}
                      label="Wikidata"
                      icon={
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                          <path d="M2 2h2v20H2V2zm3 0h1v20H5V2zm2 0h2v20H7V2zm3 0h1v20h-1V2zm2 0h2v20h-2V2zm3 0h1v20h-1V2zm2 0h2v20h-2V2z" />
                        </svg>
                      }
                    />
                  )}
                  {artist.externalUrls.ulan && (
                    <ExternalLinkButton
                      href={artist.externalUrls.ulan}
                      label="Getty ULAN"
                      icon={<ExternalLink className="h-3.5 w-3.5" />}
                    />
                  )}
                  {artist.externalUrls.viaf && (
                    <ExternalLinkButton
                      href={artist.externalUrls.viaf}
                      label="VIAF"
                      icon={<ExternalLink className="h-3.5 w-3.5" />}
                    />
                  )}
                </div>
              </div>
            )}

            {/* External IDs */}
            {Object.keys(artist.externalIds).length > 0 && (
              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('artists.identifiers')}
                </h2>
                <div className="space-y-1.5">
                  {Object.entries(artist.externalIds).map(([key, value]) => (
                    <div key={key} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{key.toUpperCase()}</span>
                      <span className="font-mono text-foreground">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
