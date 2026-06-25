import type { Locale } from '@arterio/shared';

const LOCALE_TAG: Record<Locale, string> = {
  en: 'en-GB',
  fr: 'fr-FR',
  it: 'it-IT',
  es: 'es-ES',
  de: 'de-DE',
  nl: 'nl-NL',
};

export function formatCurrency(
  value: number | null | undefined,
  currency: string,
  locale: Locale,
): string {
  if (value == null) return '—';
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number | null | undefined, locale: Locale): string {
  if (value == null) return '—';
  return new Intl.NumberFormat(LOCALE_TAG[locale]).format(value);
}

export function formatCompact(value: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** Returns DD-MM-YYYY. Uses UTC to avoid timezone-offset shifts on ISO date strings. */
export function formatDate(
  value: string | Date | null | undefined,
  _locale?: Locale,
): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

export function formatDimensions(
  h?: number | null,
  w?: number | null,
  d?: number | null,
): string {
  const parts = [h, w, d].filter((x): x is number => x != null);
  if (parts.length === 0) return '—';
  return `${parts.map((p) => p.toLocaleString()).join(' × ')} cm`;
}
