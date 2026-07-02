import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { ShieldCheck, Sparkles, Layers } from 'lucide-react';
import { Logo, Wordmark } from '@/components/app-shell/logo';
import { LoginForm } from '@/components/auth/login-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('signIn') };
}

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'auth' });

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand / marketing panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[hsl(224_28%_8%)] p-12 text-white lg:flex">
        <div className="absolute inset-0">
          <div className="absolute -left-24 top-1/4 size-[28rem] rounded-full bg-primary/30 blur-[120px]" />
          <div className="absolute -right-16 bottom-0 size-[24rem] rounded-full bg-violet-500/20 blur-[120px]" />
          <div className="absolute inset-0 bg-[radial-gradient(hsl(0_0%_100%/0.06)_1px,transparent_1px)] [background-size:24px_24px]" />
        </div>

        <div className="relative flex items-center gap-2.5">
          <Logo />
          <Wordmark className="text-white" />
        </div>

        <div className="relative max-w-md">
          <h2 className="font-display text-4xl font-semibold leading-tight tracking-tight text-balance">
            The collection management platform for serious institutions.
          </h2>
          <p className="mt-4 text-white/70">
            Catalogue, value, track and exhibit with the rigour of the world's leading
            museums and auction houses.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/80">
            <li className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-lg bg-white/10">
                <Layers className="size-4" />
              </span>
              100 000+ artworks, millions of images, instant search
            </li>
            <li className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-lg bg-white/10">
                <ShieldCheck className="size-4" />
              </span>
              MFA, passkeys, AES-256, immutable audit trail
            </li>
            <li className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-lg bg-white/10">
                <Sparkles className="size-4" />
              </span>
              AI-ready enrichment, six languages, modular core
            </li>
          </ul>
        </div>

        <p className="relative text-xs text-white/40">© {new Date().getFullYear()} Arterio</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-col items-center justify-center p-6 sm:p-12">
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <Logo />
          <Wordmark />
        </div>
        <div className="w-full max-w-sm">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{t('signIn')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('signInSubtitle')}</p>
        </div>
        <div className="mt-8 w-full max-w-sm">
          <LoginForm />
        </div>
        <p className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" /> {t('secured')}
        </p>
      </div>
    </div>
  );
}
