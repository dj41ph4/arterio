import { setRequestLocale } from 'next-intl/server';
import { ExhibitionsView } from '@/components/exhibitions/exhibitions-view';

export default async function ExhibitionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ExhibitionsView />;
}
