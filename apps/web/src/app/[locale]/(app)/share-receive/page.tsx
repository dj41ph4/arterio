import { setRequestLocale } from 'next-intl/server';
import { ShareReceiveView } from '@/components/share/share-receive-view';

export default async function ShareReceivePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ShareReceiveView />;
}
