import { setRequestLocale } from 'next-intl/server';
import { ArtistProfile } from '@/components/artists/artist-profile';

export default async function ArtistDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return <ArtistProfile id={id} locale={locale} />;
}
