/**
 * Shared free-translation + biography-quality helpers.
 *
 * Extracted from artist-enrichment so BOTH the fire-and-forget enrichment path
 * AND the interactive AI-autofill controller can reuse the exact same, resilient
 * translation logic (free services first, one language at a time). Keeping a
 * single implementation is what guarantees every locale — English included — is
 * filled the same way; the previous controller path fired all locales at once
 * (Promise.all) straight at the paid LLM, so a single burst rate-limit silently
 * dropped whichever locale lost the race.
 */

/**
 * Splits a long text into chunks of at most `maxChars` characters, breaking on
 * sentence boundaries (". ") to avoid cutting mid-sentence — MyMemory caps a
 * single request at 450 chars.
 */
export function splitIntoChunks(text: string, maxChars = 450): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + sentence).length > maxChars && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text.slice(0, maxChars)];
}

/**
 * MyMemory — free REST translation API, no key required for ≤1000 words/day
 * per server IP (well within what enrichment generates).
 */
export async function translateWithMyMemory(text: string, from: string, to: string): Promise<string | null> {
  const chunks = splitIntoChunks(text, 450);
  const translated: string[] = [];
  for (const chunk of chunks) {
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${from}|${to}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Arterio/1.0' }, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const data = (await res.json()) as { responseStatus: number; responseData?: { translatedText?: string } };
      const t = data.responseData?.translatedText;
      if (!t || data.responseStatus !== 200) return null;
      if (t.includes('MYMEMORY WARNING')) return null; // daily quota exceeded
      translated.push(t);
    } catch {
      return null;
    }
  }
  return translated.length ? translated.join(' ') : null;
}

/**
 * Lingva Translate — open-source Google Translate frontend with a public REST
 * API, no key required. Used as fallback when MyMemory fails.
 */
export async function translateWithLingva(text: string, from: string, to: string): Promise<string | null> {
  try {
    const url = `https://lingva.ml/api/v1/${from}/${to}/${encodeURIComponent(text)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Arterio/1.0' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { translation?: string };
    return data.translation ?? null;
  } catch {
    return null;
  }
}

/**
 * Tries free translation services in order (MyMemory → Lingva), validates the
 * result looks like a real biography, and returns it — or null if both fail or
 * return garbage.
 */
export async function translateFree(text: string, from: string, to: string): Promise<string | null> {
  const myMemory = await translateWithMyMemory(text, from, to);
  if (myMemory && isRealBiography(myMemory)) return myMemory;

  const lingva = await translateWithLingva(text, from, to);
  if (lingva && isRealBiography(lingva)) return lingva;

  return null;
}

/**
 * Returns true only if the text looks like a real artist biography. Rejects AI
 * refusals ("Je n'ai pas pu…"), empty stubs, and texts shorter than 80 chars.
 * Requires at least one year-pattern (4 digits) OR multiple sentences — the two
 * most reliable signals of actual encyclopedic content.
 *
 * The refusal patterns are anchored to the START of the text and only fire on
 * short texts (< 240 chars): a genuine bio can legitimately open with "This
 * artist was born in 1920 and…" — long text that merely begins that way is real
 * content, not a refusal, so we must not reject it (that mis-fire disproportionately
 * dropped English translations, whose engines render "Cet artiste" as "This artist").
 */
export function isRealBiography(text: string | undefined | null): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 80) return false;

  // Typical AI refusal / generic placeholder patterns (multilingual).
  const refusalPatterns = [
    /^je n['']ai pas (pu|trouvé)/i,
    /^i (could|was unable|cannot|can'?t) (find|provide|generate|create)/i,
    /^(aucune|no|keine|geen|nessuna|ninguna) (bio|information|donnée|data)/i,
    /^(désolé|sorry|entschuldigung|lo siento|mi dispiace)/i,
    /^(en tant qu['']|as an? (ai|artificial intelligence|language model))/i,
    /biographie? (non disponible|introuvable|non trovata|nicht verfügbar)/i,
    /^(unfortunately|malheureusement|leider|lamentablemente|purtroppo)/i,
  ];
  // Only treat a "This artist…" style opener as a refusal when the whole text is
  // short — a long bio that opens that way is real content, keep it.
  const stubOpeners = /^(this|cette|diese|questo|este) (artist|artiste|künstler)\b/i;
  if (t.length < 240 && stubOpeners.test(t)) return false;
  if (refusalPatterns.some((p) => p.test(t))) return false;

  const hasYear = /\b(1[2-9]\d{2}|20\d{2})\b/.test(t);
  const sentenceCount = (t.match(/[.!?]/g) ?? []).length;
  return hasYear || sentenceCount >= 2;
}

/**
 * Fills every target locale that is still empty by translating from a single
 * source text — free services first (no token cost), then the caller-supplied AI
 * translator as a fallback. Sequential with a short stagger so we never burst a
 * free-tier or provider per-second rate limit (the failure mode that used to drop
 * a random locale — usually English — from the interactive autofill).
 *
 * `existing` is mutated in place and also returned for convenience. A locale that
 * already has text, and the source locale itself, are left untouched.
 */
export async function fillMissingTranslations(
  sourceText: string,
  sourceLocale: string,
  targetLocales: readonly string[],
  aiTranslate: (targetLocale: string) => Promise<string | null>,
  existing: Record<string, string> = {},
): Promise<Record<string, string>> {
  const result = { ...existing };
  const missing = targetLocales.filter((l) => l !== sourceLocale && !result[l]);
  for (let i = 0; i < missing.length; i++) {
    const target = missing[i]!;
    try {
      const free = await translateFree(sourceText, sourceLocale, target);
      if (free) {
        result[target] = free;
      } else {
        const ai = await aiTranslate(target).catch(() => null);
        if (ai && ai.trim()) result[target] = ai.trim();
      }
    } catch {
      /* one locale failing must never block the others */
    }
    if (i < missing.length - 1) await new Promise((r) => setTimeout(r, 350));
  }
  return result;
}
