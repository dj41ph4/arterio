/** Supported locales — single source of truth for web + api. */
export const LOCALES = ['en', 'fr', 'it', 'es', 'de', 'nl'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'fr';

export const LOCALE_META: Record<
  Locale,
  { label: string; nativeLabel: string; flag: string; dir: 'ltr' | 'rtl' }
> = {
  en: { label: 'English', nativeLabel: 'English', flag: '🇬🇧', dir: 'ltr' },
  fr: { label: 'French', nativeLabel: 'Français', flag: '🇫🇷', dir: 'ltr' },
  it: { label: 'Italian', nativeLabel: 'Italiano', flag: '🇮🇹', dir: 'ltr' },
  es: { label: 'Spanish', nativeLabel: 'Español', flag: '🇪🇸', dir: 'ltr' },
  de: { label: 'German', nativeLabel: 'Deutsch', flag: '🇩🇪', dir: 'ltr' },
  nl: { label: 'Dutch', nativeLabel: 'Nederlands', flag: '🇳🇱', dir: 'ltr' },
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** Language-keyed content as stored in the DB (Json columns). */
export type LocalizedText = Partial<Record<Locale, string>>;

/**
 * Resolve a localized value using a fallback chain:
 * requested → organization default → English → first available → ''.
 */
export function resolveLocalized(
  value: LocalizedText | null | undefined,
  requested: Locale,
  orgDefault: Locale = DEFAULT_LOCALE,
): string {
  if (!value) return '';
  return (
    value[requested] ??
    value[orgDefault] ??
    value[DEFAULT_LOCALE] ??
    Object.values(value).find((v) => typeof v === 'string' && v.length > 0) ??
    ''
  );
}
