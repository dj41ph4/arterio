/**
 * Models that find nothing for a field routinely refuse to omit it and
 * instead write a sentence *about* not finding anything ("The artwork was
 * not found in the provided search results for this specific title.",
 * "Aucune information disponible.") right into the field's value — which
 * then passes every "is this non-empty" check and gets shown to the user as
 * if it were a real answer. Shared by every AI provider so the same filter
 * applies regardless of which model produced the response.
 */
const NO_RESULT_PATTERNS = [
  /\bnot found\b/i,
  /\bno (specific )?information\b/i,
  /\bno results?\b/i,
  /\bunable to find\b/i,
  /\b(could not|couldn't|cannot|can't) find\b/i,
  /\bno data (is )?available\b/i,
  /\bn'a pas été trouv/i,
  /\baucune information\b/i,
  /\bpas trouvé.*(résultats?|recherche)\b/i,
  /\bne (figure|semble) pas (dans|parmi)\b/i,
  /\bnon disponible\b/i,
  /\bdonnées? indisponibles?\b/i,
  /\b(information|donnée)s? non disponibles?\b/i,
  /\bnon (renseigné|précisé|communiqué)/i,
];

function isNoResultFiller(value: string): boolean {
  const v = value.trim();
  // A "no result" filler is a short stub the model wrote INSTEAD of an answer
  // ("Aucune information disponible.", "Non disponible"). A genuine biography or
  // description is long-form prose that may legitimately CONTAIN one of these
  // phrases mid-sentence ("…little is known, no information survives about his
  // youth…"). Gating on length keeps us from nuking a real long field wholesale —
  // only short values that are essentially the refusal itself get dropped. Real
  // refusal stubs are one-liners (~100 chars); anything past 160 is content.
  if (v.length > 160) return false;
  return NO_RESULT_PATTERNS.some((re) => re.test(v));
}

/** Drops any field whose value is meta-commentary about not finding anything, rather than an actual answer. */
export function stripFillerFields(parsed: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && isNoResultFiller(value)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}
