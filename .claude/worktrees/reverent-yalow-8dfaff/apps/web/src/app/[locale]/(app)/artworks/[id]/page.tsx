import { setRequestLocale } from 'next-intl/server';
import { ArtworkDetailView } from '@/components/artwork/detail-view';

export default async function ArtworkPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <ArtworkDetailView id={id} />;
}
