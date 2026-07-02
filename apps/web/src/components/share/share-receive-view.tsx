'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Search, Share2, Upload } from 'lucide-react';
import type { Locale } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';
import { artworkRepository } from '@/lib/data';
import { compressImage } from '@/lib/media/compress-image';
import { useDebounce } from '@/hooks/use-debounce';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArtworkThumbnail } from '@/components/artwork/thumbnail';
import { cn } from '@/lib/utils';

const SHARE_CACHE = 'arterio-share';

interface SharedFile {
  file: File;
  previewUrl: string;
}

/** Reads the photo(s) the service worker stashed when the OS share sheet POSTed to /share-target. */
async function readSharedFiles(): Promise<SharedFile[]> {
  if (!('caches' in window)) return [];
  const cache = await caches.open(SHARE_CACHE);
  const keys = await cache.keys();
  const out: SharedFile[] = [];
  for (const key of keys) {
    const res = await cache.match(key);
    if (!res) continue;
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('X-File-Name') ?? 'photo.jpg');
    const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
    out.push({ file, previewUrl: URL.createObjectURL(blob) });
  }
  return out;
}

async function clearSharedFiles(): Promise<void> {
  const cache = await caches.open(SHARE_CACHE);
  await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
}

export function ShareReceiveView() {
  const t = useTranslations('pwa.shareReceive');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [shared, setShared] = React.useState<SharedFile[] | null>(null);
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [uploadingTo, setUploadingTo] = React.useState<string | null>(null);

  React.useEffect(() => {
    void readSharedFiles().then(setShared);
    return () => {
      setShared((prev) => {
        prev?.forEach((s) => URL.revokeObjectURL(s.previewUrl));
        return prev;
      });
    };
  }, []);

  const { data: artworks, isLoading } = useQuery({
    queryKey: ['share-artwork-picker', debouncedSearch],
    queryFn: () =>
      artworkRepository.list({
        search: debouncedSearch || undefined,
        limit: 12,
        locale,
        sort: { field: 'updatedAt', dir: 'desc' },
      }),
  });

  async function attachTo(artworkId: string) {
    if (!shared?.length || uploadingTo) return;
    setUploadingTo(artworkId);
    try {
      for (const s of shared) {
        await artworkRepository.uploadMedia(artworkId, await compressImage(s.file));
      }
      await clearSharedFiles();
      toast.success(t('uploaded', { count: shared.length }));
      router.push(`/artworks/${artworkId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('failed'));
      setUploadingTo(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <div className="mb-5 flex items-center gap-2.5">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
          <Share2 className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-lg font-semibold">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      {shared === null ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> …
        </div>
      ) : shared.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t('empty')}</div>
      ) : (
        <>
          {/* Shared photos preview */}
          <div className="mb-5 flex gap-2 overflow-x-auto">
            {shared.map((s, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={s.previewUrl} alt="" className="size-24 shrink-0 rounded-lg border object-cover" />
            ))}
          </div>

          <p className="mb-2 text-sm font-medium">{t('pickArtwork')}</p>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} className="pl-9" />
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> …
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(artworks?.items ?? []).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  disabled={!!uploadingTo}
                  onClick={() => void attachTo(a.id)}
                  className={cn(
                    'group overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary/50',
                    uploadingTo === a.id && 'border-primary',
                  )}
                >
                  <div className="relative aspect-square">
                    <ArtworkThumbnail colors={a.dominantColors} src={a.thumbnailUrl} />
                    {uploadingTo === a.id && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <Loader2 className="size-6 animate-spin text-white" />
                      </div>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-xs font-medium">{resolveLocalized(a.title, locale) || a.inventoryNumber}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{a.artistName ?? '—'}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="mt-6 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Upload className="size-3.5" />
            {t('hint')}
          </div>
        </>
      )}
    </div>
  );
}
