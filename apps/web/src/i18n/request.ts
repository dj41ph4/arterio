import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';
import { isLocale, DEFAULT_LOCALE } from '@arterio/shared';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // Sensible global formats; components may override per-call.
    formats: {
      dateTime: {
        short: { day: 'numeric', month: 'short', year: 'numeric' },
      },
    },
    onError() {
      // Swallow missing-message errors in non-default locales; fall back silently.
    },
    getMessageFallback({ key }) {
      return key.split('.').pop() ?? key;
    },
  };
});

export { DEFAULT_LOCALE };
