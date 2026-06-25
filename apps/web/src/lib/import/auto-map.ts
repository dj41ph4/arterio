export const ARTWORK_FIELDS = [
  { key: 'title', label: 'Titre' },
  { key: 'artistName', label: 'Artiste' },
  { key: 'year', label: 'Année / Date' },
  { key: 'technique', label: 'Technique' },
  { key: 'dimensions', label: 'Dimensions œuvre' },
  { key: 'framed', label: 'Encadrement (oui/non)' },
  { key: 'frameDimensions', label: 'Dimensions encadrement' },
  { key: 'location', label: 'Emplacement / Stockage' },
  { key: 'gallery', label: "Galerie d'achat" },
  { key: 'purchaseDate', label: "Date d'achat" },
  { key: 'purchasePrice', label: "Prix d'achat" },
  { key: 'paymentType', label: 'Type de paiement' },
  { key: 'certificate', label: 'Certificat' },
  { key: 'invoice', label: 'Facture' },
  { key: 'condition', label: "État de l'œuvre" },
  { key: 'inventoryNumber', label: 'N° inventaire' },
  { key: 'category', label: 'Catégorie (section)' },
  { key: '_ignore', label: '— Ignorer cette colonne —' },
] as const;

export type ArtworkFieldKey = (typeof ARTWORK_FIELDS)[number]['key'];

interface FieldRule {
  key: ArtworkFieldKey;
  headerPattern: RegExp;
  /** Returns 0..1 — how well sample values fit this field's expected shape. */
  contentScore: (samples: string[]) => number;
}

function ratio(samples: string[], test: (v: string) => boolean): number {
  const nonEmpty = samples.filter((s) => s.trim());
  if (!nonEmpty.length) return 0;
  return nonEmpty.filter(test).length / nonEmpty.length;
}

const RULES: FieldRule[] = [
  { key: 'inventoryNumber', headerPattern: /inventaire|inventory|n[°o]\s*inv/i, contentScore: (s) => ratio(s, (v) => /^\d+-\d+$/.test(v.trim())) },
  { key: 'artistName', headerPattern: /artiste|artist|auteur|nom/i, contentScore: (s) => ratio(s, (v) => /^[a-zA-ZÀ-ÿ?][a-zA-ZÀ-ÿ\s.'-]{1,40}$/.test(v.trim()) && v.trim().split(' ').length <= 4) },
  { key: 'title', headerPattern: /titre|title/i, contentScore: () => 0.3 },
  { key: 'year', headerPattern: /date.*œuvre|date.*oeuvre|ann[eé]e|year/i, contentScore: (s) => ratio(s, (v) => /^\d{4}(-\d{4})?$/.test(v.trim())) },
  { key: 'technique', headerPattern: /technique|medium|support|mat[eé]riau/i, contentScore: (s) => ratio(s, (v) => /toile|papier|bronze|acrylique|huile|encre|gravure|litho|bois|aquarelle|dibond/i.test(v)) },
  { key: 'dimensions', headerPattern: /dimensions?\s*(œuvre|oeuvre)?$/i, contentScore: (s) => ratio(s, (v) => /^\d+([.,]\d+)?\s*[x*X]\s*\d+([.,]\d+)?/.test(v.trim())) },
  { key: 'framed', headerPattern: /encadrement$/i, contentScore: (s) => ratio(s, (v) => /^(oui|non|0ui|yes|no)$/i.test(v.trim())) },
  { key: 'frameDimensions', headerPattern: /dimensions?.*encadrement/i, contentScore: (s) => ratio(s, (v) => /^\d+([.,]\d+)?\s*[x*X]\s*\d+([.,]\d+)?/.test(v.trim())) },
  { key: 'location', headerPattern: /stockage|expo|emplacement|location|lieu/i, contentScore: (s) => ratio(s, (v) => /^n\s?\d/i.test(v.trim())) },
  { key: 'gallery', headerPattern: /galerie|gallery/i, contentScore: (s) => ratio(s, (v) => /gal|art|galerie/i.test(v)) },
  { key: 'purchaseDate', headerPattern: /date.*achat|purchase.*date/i, contentScore: (s) => ratio(s, (v) => /^\d{4,5}$/.test(v.trim())) },
  { key: 'purchasePrice', headerPattern: /prix|value|valeur|price/i, contentScore: (s) => ratio(s, (v) => /^\d+([.,]\d+)?$/.test(v.trim()) && Number(v.replace(',', '.')) > 0) },
  { key: 'paymentType', headerPattern: /paiement|payment/i, contentScore: (s) => ratio(s, (v) => /cash|virement|cheque|leasing|cadeau/i.test(v)) },
  { key: 'certificate', headerPattern: /certificat/i, contentScore: (s) => ratio(s, (v) => /^(cert|oui|non)$/i.test(v.trim())) },
  { key: 'invoice', headerPattern: /facture/i, contentScore: (s) => ratio(s, (v) => /^(oui|non)$/i.test(v.trim())) },
  { key: 'condition', headerPattern: /[eé]tat\s*de\s*l.?œuvre|condition/i, contentScore: () => 0.2 },
  { key: 'category', headerPattern: /^cat[eé]gorie/i, contentScore: () => 0.1 },
];

export interface ColumnMapping {
  columnIndex: number;
  header: string;
  field: ArtworkFieldKey;
  confidence: number; // 0..100
}

/** Scores every (column, candidate-field) pair and assigns each column its best match —
 *  combining header-text keyword match with a content-shape heuristic on sampled values. */
export function detectColumnMapping(headers: string[], rows: (string | number | null)[][]): ColumnMapping[] {
  const sampleRows = rows.slice(0, 40);

  return headers.map((header, columnIndex) => {
    const samples = sampleRows.map((r) => String(r[columnIndex] ?? ''));
    let best: { key: ArtworkFieldKey; score: number } = { key: '_ignore', score: 0 };

    for (const rule of RULES) {
      const headerHit = rule.headerPattern.test(header) ? 0.65 : 0;
      const contentHit = rule.contentScore(samples) * 0.35;
      const score = headerHit + contentHit;
      if (score > best.score) best = { key: rule.key, score };
    }

    // A column with no header text and no content match defaults to ignore.
    const confidence = Math.round(Math.min(best.score, 1) * 100);
    return {
      columnIndex,
      header,
      field: confidence >= 25 ? best.key : '_ignore',
      confidence,
    };
  });
}
