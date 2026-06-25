import { setRequestLocale } from 'next-intl/server';
import { CollectionView } from '@/components/grid/collection-view';

export default async function FavoritesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CollectionView favoritesOnly />;
}
