import { setRequestLocale } from 'next-intl/server';
import { DocumentsView } from '@/components/documents/documents-view';

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <DocumentsView />;
}
