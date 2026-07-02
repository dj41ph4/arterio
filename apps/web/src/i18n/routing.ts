import { defineRouting } from 'next-intl/routing';
import { LOCALES, DEFAULT_LOCALE } from '@arterio/shared';

export const routing = defineRouting({
  locales: [...LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  // Always show the locale in the path (/en, /fr …) for clear deep-linking.
  localePrefix: 'always',
  // Without this, next-intl redirects "/" based on the browser's
  // Accept-Language header, so an English browser landed on "/en" even
  // though defaultLocale is "fr" — the homepage must always be French
  // unless the visitor explicitly picks another locale via the URL/switcher.
  localeDetection: false,
});
