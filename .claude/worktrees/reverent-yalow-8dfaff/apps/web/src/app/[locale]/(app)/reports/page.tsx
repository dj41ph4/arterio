import { setRequestLocale } from 'next-intl/server';
import { ReportsView } from '@/components/reports/reports-view';

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ReportsView />;
}
