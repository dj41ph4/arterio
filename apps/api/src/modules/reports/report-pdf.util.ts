import PDFDocument from 'pdfkit';
import { DEFAULT_LOCALE, resolveLocalized, type LocalizedText } from '@arterio/shared';

export type ReportType = 'catalogue' | 'insurance' | 'conservation' | 'financial';

export interface ReportArtworkRow {
  inventoryNumber: string;
  title: unknown;
  artistName: string | null;
  yearFrom: number | null;
  techniqueName: string | null;
  heightCm: number | null;
  widthCm: number | null;
  status: string;
  condition: string;
  collectionName: string | null;
  purchasePrice: number | null;
  currentValue: number | null;
  insuranceValue: number | null;
  currency: string;
}

const TITLES: Record<ReportType, string> = {
  catalogue: 'Catalogue des œuvres',
  insurance: "Rapport d'assurance",
  conservation: 'Rapport de conservation',
  financial: 'Rapport financier',
};

function fmtMoney(n: number | null, currency: string): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(n);
}

function fmtDims(h: number | null, w: number | null): string {
  if (h == null && w == null) return '—';
  return `${h ?? '?'} × ${w ?? '?'} cm`;
}

/** Column set + row formatter per report type — each report only shows what it's actually about. */
function columnsFor(type: ReportType): { headers: string[]; widths: number[]; row: (a: ReportArtworkRow, title: string) => string[] } {
  switch (type) {
    case 'insurance':
      return {
        headers: ['N° inv.', 'Titre', 'Artiste', 'Valeur assurée'],
        widths: [70, 200, 140, 100],
        row: (a, title) => [a.inventoryNumber, title, a.artistName ?? '—', fmtMoney(a.insuranceValue, a.currency)],
      };
    case 'conservation':
      return {
        headers: ['N° inv.', 'Titre', 'État', 'Statut'],
        widths: [70, 240, 120, 80],
        row: (a, title) => [a.inventoryNumber, title, a.condition, a.status],
      };
    case 'financial':
      return {
        headers: ['N° inv.', 'Titre', "Prix d'achat", 'Valeur actuelle'],
        widths: [70, 200, 110, 110],
        row: (a, title) => [a.inventoryNumber, title, fmtMoney(a.purchasePrice, a.currency), fmtMoney(a.currentValue, a.currency)],
      };
    case 'catalogue':
    default:
      return {
        headers: ['N° inv.', 'Titre', 'Artiste', 'Année', 'Technique', 'Dimensions'],
        widths: [60, 150, 110, 50, 90, 90],
        row: (a, title) => [a.inventoryNumber, title, a.artistName ?? '—', a.yearFrom ? String(a.yearFrom) : '—', a.techniqueName ?? '—', fmtDims(a.heightCm, a.widthCm)],
      };
  }
}

/** Builds a paginated table PDF for the given report type and returns the full document as a Buffer. */
export function buildReportPdf(type: ReportType, orgName: string, artworks: ReportArtworkRow[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { headers, widths, row } = columnsFor(type);
    const startX = doc.page.margins.left;
    const pageBottom = doc.page.height - doc.page.margins.bottom;

    doc.fontSize(18).font('Helvetica-Bold').text(TITLES[type], { align: 'left' });
    doc.fontSize(10).font('Helvetica').fillColor('#666666').text(orgName, { align: 'left' });
    doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} — ${artworks.length} œuvre${artworks.length > 1 ? 's' : ''}`);
    doc.fillColor('#000000');
    doc.moveDown(1);

    const drawHeader = (y: number) => {
      let x = startX;
      doc.font('Helvetica-Bold').fontSize(9);
      headers.forEach((h, i) => {
        doc.text(h, x, y, { width: widths[i], ellipsis: true });
        x += widths[i]!;
      });
      doc.moveTo(startX, y + 14).lineTo(startX + widths.reduce((a, b) => a + b, 0), y + 14).strokeColor('#cccccc').stroke();
      doc.font('Helvetica').fontSize(9);
    };

    let y = doc.y;
    drawHeader(y);
    y += 20;

    for (const a of artworks) {
      if (y > pageBottom - 20) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader(y);
        y += 20;
      }
      const title = resolveLocalized(a.title as LocalizedText, DEFAULT_LOCALE) || '—';
      const cells = row(a, title);
      let x = startX;
      cells.forEach((c, i) => {
        doc.text(c, x, y, { width: widths[i], ellipsis: true });
        x += widths[i]!;
      });
      y += 16;
    }

    doc.end();
  });
}
