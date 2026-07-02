import { setRequestLocale } from 'next-intl/server';
import { LoansView } from '@/components/loans/loans-view';

export default async function LoansPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LoansView />;
}
