import { defineRouting } from 'next-intl/routing';
import { LOCALES, DEFAULT_LOCALE } from '@arterio/shared';

export const routing = defineRouting({
  locales: [...LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  // Always show the locale in the path (/en, /fr …) for clear deep-linking.
  localePrefix: 'always',
});
