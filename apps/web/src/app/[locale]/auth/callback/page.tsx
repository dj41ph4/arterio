import { setRequestLocale } from 'next-intl/server';
import { OAuthCallback } from '@/components/auth/oauth-callback';

export default async function OAuthCallbackPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <OAuthCallback />;
}
