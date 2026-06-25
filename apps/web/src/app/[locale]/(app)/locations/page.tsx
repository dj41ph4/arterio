import { setRequestLocale } from 'next-intl/server';
import { LocationsView } from '@/components/locations/locations-view';

export default async function LocationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LocationsView />;
}
