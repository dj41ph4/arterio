import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Logo, Wordmark } from '@/components/app-shell/logo';

export default async function NotFound() {
  // `notFound()` can be thrown before params resolve; default to English copy.
  const t = await getTranslations({ locale: 'en', namespace: 'common' });
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-dotted p-6 text-center">
      <div className="flex items-center gap-2.5">
        <Logo />
        <Wordmark />
      </div>
      <p className="font-display text-6xl font-semibold tracking-tight">404</p>
      <p className="max-w-sm text-muted-foreground">{t('noResults')}</p>
      <Button asChild>
        <Link href="/dashboard">{t('back')}</Link>
      </Button>
    </div>
  );
}
