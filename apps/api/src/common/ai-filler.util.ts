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
];

function isNoResultFiller(value: string): boolean {
  return NO_RESULT_PATTERNS.some((re) => re.test(value));
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
