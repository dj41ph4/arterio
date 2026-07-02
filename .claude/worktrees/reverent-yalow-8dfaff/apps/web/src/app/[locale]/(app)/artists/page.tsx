import { setRequestLocale } from 'next-intl/server';
import { ArtistListView } from '@/components/artists/artist-list-view';

export default async function ArtistsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ArtistListView />;
}
