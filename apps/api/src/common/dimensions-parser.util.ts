/**
 * Shared "20x30 cm" → { heightCm, widthCm } parser, reused everywhere a raw
 * dimension string comes back from a museum API or a scraped page (the AI
 * providers parse this themselves inside their own prompt, but anything
 * structured — museum object records, auction lots — needs the same logic
 * applied to plain text outside an LLM call).
 *
 * Convention matches the AI prompts already in use: first number = height,
 * second = width, both converted to centimeters (1 in = 2.54 cm).
 */
export interface ParsedDimensions {
  heightCm: number;
  widthCm: number;
}

const DIMENSION_PATTERN = /(\d+(?:[.,]\d+)?)\s*(cm|in|inches|")?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(cm|in|inches|")?/i;

export function parseDimensions(text: string | undefined | null): ParsedDimensions | null {
  if (!text) return null;
  const match = text.match(DIMENSION_PATTERN);
  if (!match) return null;

  const toNumber = (raw: string) => parseFloat(raw.replace(',', '.'));
  const unit = (match[2] || match[4] || 'cm').toLowerCase();
  const isInches = unit === 'in' || unit === 'inches' || unit === '"';
  const toCm = (n: number) => (isInches ? n * 2.54 : n);

  const first = toNumber(match[1]!);
  const second = toNumber(match[3]!);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  return { heightCm: Math.round(toCm(first) * 10) / 10, widthCm: Math.round(toCm(second) * 10) / 10 };
}
