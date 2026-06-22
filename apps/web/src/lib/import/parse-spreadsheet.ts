import * as XLSX from 'xlsx';

export interface ParsedSpreadsheet {
  /** One entry per column, by index — header text can be empty (e.g. an unlabeled column). */
  headers: string[];
  /** Raw cell values, row-major, index-aligned with `headers`. */
  rows: (string | number | null)[][];
}

function colLetter(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Builds headers/rows from a sheet, scanning every row (not just row 1) to find the
 *  widest column count — real-world files sometimes have section-divider rows above
 *  the real header, or unlabeled trailing columns the header row never declared. */
function fromAoa(aoa: unknown[][]): ParsedSpreadsheet {
  const width = aoa.reduce((max, row) => Math.max(max, row.length), 0);
  const headerRow = (aoa[0] ?? []) as unknown[];
  const headers = Array.from({ length: width }, (_, i) => {
    const h = headerRow[i];
    return h != null && String(h).trim() ? String(h).trim() : `Colonne ${colLetter(i)}`;
  });
  const rows = aoa.slice(1).map((row) =>
    Array.from({ length: width }, (_, i) => {
      const v = row[i];
      if (v == null || v === '') return null;
      return v as string | number;
    }),
  );
  // Drop fully-empty rows.
  const filtered = rows.filter((r) => r.some((v) => v !== null));
  return { headers, rows: filtered };
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'csv' || ext === 'txt') {
    const text = await file.text();
    const wb = XLSX.read(text, { type: 'string', raw: true });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][];
    return fromAoa(aoa);
  }

  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][];
  return fromAoa(aoa);
}

export const SUPPORTED_IMPORT_EXTENSIONS = ['.csv', '.txt', '.xlsx', '.xls'];
