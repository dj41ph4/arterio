import * as XLSX from 'xlsx';
import type { ArtworkView, Locale } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';
import { artworkRepository } from '@/lib/data';

/**
 * Column headers match ARTWORK_FIELDS labels in lib/import/auto-map.ts exactly,
 * so re-importing this file auto-maps every column at ~100% confidence.
 */
const EXPORT_HEADERS = [
  'Titre',
  'Artiste',
  'Année / Date',
  'Technique',
  'Dimensions œuvre',
  'Encadrement (oui/non)',
  'Emplacement / Stockage',
  "Galerie d'achat",
  "Date d'achat",
  "Prix d'achat",
  'Type de paiement',
  'Certificat',
  'Facture',
  "État de l'œuvre",
  'N° inventaire',
] as const;

function dimensionsOf(a: ArtworkView): string {
  if (a.dimensionsNote) return a.dimensionsNote;
  if (a.heightCm && a.widthCm) {
    return a.depthCm
      ? `${a.heightCm} x ${a.widthCm} x ${a.depthCm} cm`
      : `${a.heightCm} x ${a.widthCm} cm`;
  }
  return '';
}

function purchaseDateOf(a: ArtworkView): string {
  if (!a.acquisitionDate) return '';
  return a.acquisitionDate.slice(0, 10);
}

function rowOf(a: ArtworkView, locale: Locale): (string | number)[] {
  return [
    resolveLocalized(a.title, locale) || '',
    a.artistName ?? a.attribution ?? '',
    a.dateText ?? (a.yearFrom ? String(a.yearFrom) : ''),
    a.techniqueName ?? '',
    dimensionsOf(a),
    a.framed ? 'OUI' : 'NON',
    a.currentLocationName ?? '',
    a.valuation?.valuationSource ?? '',
    purchaseDateOf(a),
    a.valuation?.purchasePrice ?? '',
    a.paymentMethod ?? '',
    a.hasCertificate ? 'OUI' : 'NON',
    a.hasInvoice ? 'OUI' : 'NON',
    a.condition,
    a.inventoryNumber,
  ];
}

/** Fetches every artwork (paginated) and writes a re-import-ready .xlsx file. */
export async function exportCollectionToXlsx(locale: Locale): Promise<void> {
  const all: ArtworkView[] = [];
  let cursor: string | null | undefined;
  do {
    const page = await artworkRepository.list({ cursor: cursor ?? undefined, limit: 200 });
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  const aoa = [EXPORT_HEADERS as unknown as string[], ...all.map((a) => rowOf(a, locale))];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = EXPORT_HEADERS.map(() => ({ wch: 20 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Collection');

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `arterio-collection-${date}.xlsx`);
}
