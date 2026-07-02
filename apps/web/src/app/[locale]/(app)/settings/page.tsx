import { setRequestLocale } from 'next-intl/server';
import { SettingsView } from '@/components/settings/settings-view';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SettingsView />;
}
