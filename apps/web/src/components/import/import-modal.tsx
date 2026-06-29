'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileText, ChevronRight, Check, X,
  AlertCircle, Table2, RefreshCw, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { artworkRepository } from '@/lib/data';
import { artistRepository, type ArtistView } from '@/lib/data/artist-repository';
import { ApiError } from '@/lib/api/client';
import {
  parseSpreadsheetFile,
  SUPPORTED_IMPORT_EXTENSIONS,
  type ParsedSpreadsheet,
} from '@/lib/import/parse-spreadsheet';
import {
  ARTWORK_FIELDS,
  detectColumnMapping,
  type ArtworkFieldKey,
  type ColumnMapping,
} from '@/lib/import/auto-map';
import {
  normalizeArtistName,
  artistDedupKey,
  artworkDedupKey,
  isLikelyDuplicateArtwork,
  normalizeDate,
  normalizePaymentMethod,
  normalizeBoolean,
  parsePrice,
  planInventoryNumbers,
} from '@/lib/import/normalize';

type Step = 'upload' | 'mapping' | 'importing' | 'done';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
}

interface ImportLogEntry {
  row: number;
  title: string;
  artist: string;
  status: 'created' | 'skipped';
  reason: string;
}

/** Downloads the per-row import log as CSV so issues can be diagnosed without server log access. */
function downloadImportLog(entries: ImportLogEntry[]) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = ['ligne', 'titre', 'artiste', 'statut', 'raison'].join(';');
  const lines = entries.map((e) =>
    [e.row, escape(e.title), escape(e.artist), e.status, escape(e.reason)].join(';'),
  );
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `import-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function confidenceColor(pct: number): string {
  if (pct >= 70) return 'text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/30';
  if (pct >= 40) return 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30';
  return 'text-muted-foreground bg-muted border-border';
}

function cell(rows: (string | number | null)[][], rowIdx: number, colIdx: number | undefined): string {
  if (colIdx === undefined) return '';
  const v = rows[rowIdx]?.[colIdx];
  return v == null ? '' : String(v);
}

/** Loads every existing artwork's (title, artist) dedup key so re-importing the same spreadsheet — or a
 *  file that overlaps the existing collection — skips rows instead of creating duplicates. Paginates up to
 *  the same 5000-row safety cap the catalog list endpoint itself uses (single-tenant appliance). */
interface ExistingArtworkRef {
  key: string;
  title: string;
  artist: string;
}

async function loadExistingArtworkKeys(): Promise<ExistingArtworkRef[]> {
  const refs: ExistingArtworkRef[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 25; page++) {
    const result = await artworkRepository.list({ limit: 200, cursor });
    for (const item of result.items) {
      const title = String(item.title?.fr || Object.values(item.title ?? {}).find((v) => v) || '');
      const artist = item.artistName ?? '';
      refs.push({ key: artworkDedupKey(title, artist), title, artist });
    }
    if (!result.nextCursor || result.items.length === 0) break;
    cursor = result.nextCursor;
  }
  return refs;
}

/** Exact-key fast path first (handles the common "re-imported the same file" case for free), then a
 *  fuzzy fallback that catches near-duplicates an exact key would miss — a typo, an extra middle name,
 *  reversed first/last name order. No AI involved: pure bigram-similarity string comparison. */
function findDuplicate(
  title: string,
  artist: string,
  key: string,
  existing: ExistingArtworkRef[],
  seenInFile: ExistingArtworkRef[],
): 'collection' | 'file' | null {
  for (const ref of existing) if (ref.key === key) return 'collection';
  for (const ref of seenInFile) if (ref.key === key) return 'file';
  for (const ref of existing) if (isLikelyDuplicateArtwork(title, artist, ref.title, ref.artist)) return 'collection';
  for (const ref of seenInFile) if (isLikelyDuplicateArtwork(title, artist, ref.title, ref.artist)) return 'file';
  return null;
}

function DropZone({ onFile, loading }: { onFile: (file: File) => void; loading: boolean }) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handle = (f: File | null) => {
    if (!f) return;
    const ext = `.${f.name.split('.').pop()?.toLowerCase()}`;
    if (!SUPPORTED_IMPORT_EXTENSIONS.includes(ext)) {
      toast.error('Format non supporté — utilisez un fichier CSV ou Excel (.xlsx)');
      return;
    }
    onFile(f);
  };

  return (
    <div
      onDragEnter={() => setDragging(true)}
      onDragLeave={() => setDragging(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files[0] ?? null); }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'group relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-12 transition-colors',
        dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,.xlsx,.xls"
        className="hidden"
        onChange={(e) => handle(e.target.files?.[0] ?? null)}
      />
      {loading ? (
        <RefreshCw className="h-10 w-10 animate-spin text-primary" />
      ) : (
        <Upload className="h-10 w-10 text-muted-foreground transition-colors group-hover:text-primary" />
      )}
      <div className="text-center">
        <p className="font-medium text-foreground">
          Glissez un fichier CSV ou Excel, ou cliquez pour sélectionner
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          .xlsx, .xls, .csv — la correspondance des colonnes est détectée automatiquement
        </p>
      </div>
      <div className="flex gap-2">
        {SUPPORTED_IMPORT_EXTENSIONS.map((ext) => (
          <span key={ext} className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {ext}
          </span>
        ))}
      </div>
    </div>
  );
}

function MappingRow({
  mapping,
  onChange,
}: {
  mapping: ColumnMapping;
  onChange: (field: ArtworkFieldKey) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-44 shrink-0 truncate text-sm font-mono text-foreground" title={mapping.header}>
        {mapping.header}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      <select
        value={mapping.field}
        onChange={(e) => onChange(e.target.value as ArtworkFieldKey)}
        className="flex-1 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
      >
        {ARTWORK_FIELDS.map((f) => (
          <option key={f.key} value={f.key}>{f.label}</option>
        ))}
      </select>
      <span
        className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums', confidenceColor(mapping.confidence))}
        title="Confiance de la détection automatique"
      >
        {mapping.confidence}%
      </span>
    </div>
  );
}

export function ImportModal({ open, onClose }: ImportModalProps) {
  const qc = useQueryClient();
  const [step, setStep] = React.useState<Step>('upload');
  const [loading, setLoading] = React.useState(false);
  const [fileName, setFileName] = React.useState('');
  const [sheet, setSheet] = React.useState<ParsedSpreadsheet>({ headers: [], rows: [] });
  const [mappings, setMappings] = React.useState<ColumnMapping[]>([]);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [summary, setSummary] = React.useState({ created: 0, skipped: 0, duplicates: 0, artistsCreated: 0, inventoryGenerated: 0 });
  const [importLog, setImportLog] = React.useState<ImportLogEntry[]>([]);

  const reset = () => {
    setStep('upload');
    setFileName('');
    setSheet({ headers: [], rows: [] });
    setMappings([]);
    setProgress({ done: 0, total: 0 });
    setImportLog([]);
  };

  const fieldCol = (field: ArtworkFieldKey): number | undefined =>
    mappings.find((m) => m.field === field)?.columnIndex;

  const handleFile = async (file: File) => {
    setLoading(true);
    setFileName(file.name);
    try {
      const parsed = await parseSpreadsheetFile(file);
      setSheet(parsed);
      setMappings(detectColumnMapping(parsed.headers, parsed.rows));
      setStep('mapping');
    } catch {
      toast.error('Impossible de lire ce fichier — vérifiez le format.');
    } finally {
      setLoading(false);
    }
  };

  const inventoryColIdx = fieldCol('inventoryNumber');
  const artistColIdx = fieldCol('artistName');

  const inventoryPlan = React.useMemo(
    () => planInventoryNumbers(sheet.rows.map((_, i) => cell(sheet.rows, i, inventoryColIdx) || null)),
    [sheet.rows, inventoryColIdx],
  );

  const artistStats = React.useMemo(() => {
    if (artistColIdx === undefined) return { unique: 0, total: 0 };
    const keys = new Set<string>();
    let total = 0;
    sheet.rows.forEach((_, i) => {
      const raw = cell(sheet.rows, i, artistColIdx);
      const normalized = normalizeArtistName(raw);
      if (!normalized) return;
      total++;
      keys.add(artistDedupKey(raw));
    });
    return { unique: keys.size, total };
  }, [sheet.rows, artistColIdx]);

  const titleColIdx = fieldCol('title');
  const validRowCount = React.useMemo(() => {
    return sheet.rows.filter((_, i) => {
      const title = cell(sheet.rows, i, titleColIdx);
      const artist = cell(sheet.rows, i, artistColIdx);
      return title.trim() || artist.trim();
    }).length;
  }, [sheet.rows, titleColIdx, artistColIdx]);

  const handleImport = async () => {
    setStep('importing');
    const total = sheet.rows.length;
    setProgress({ done: 0, total });

    const artistCache = new Map<string, ArtistView>();
    let created = 0;
    let skipped = 0;
    let duplicates = 0;
    let artistsCreated = 0;
    const log: ImportLogEntry[] = [];

    let existingRefs: ExistingArtworkRef[];
    try {
      existingRefs = await loadExistingArtworkKeys();
    } catch {
      existingRefs = [];
    }
    const seenInFile: ExistingArtworkRef[] = [];

    const resolveArtist = async (raw: string): Promise<{ id: string | null; name: string | null }> => {
      const normalized = normalizeArtistName(raw);
      if (!normalized) return { id: null, name: null };
      const key = artistDedupKey(raw);
      const cached = artistCache.get(key);
      if (cached) return { id: cached.id, name: normalized };

      try {
        const found = await artistRepository.list({ search: normalized, limit: 5 });
        const exact = found.data.find((a) => artistDedupKey(a.fullName) === key);
        if (exact) {
          artistCache.set(key, exact);
          return { id: exact.id, name: normalized };
        }
      } catch {
        // search failed — fall through to create
      }

      try {
        const createdArtist = await artistRepository.add({
          id: '',
          fullName: normalized,
          sortName: normalized,
          biography: {},
          externalIds: {},
          externalUrls: {},
          artworkCount: 0,
          artworkIds: [],
        } as ArtistView);
        artistCache.set(key, createdArtist);
        artistsCreated++;
        return { id: createdArtist.id, name: normalized };
      } catch {
        return { id: null, name: normalized };
      }
    };

    // Some real-world files are an artist roster, not an artwork inventory — e.g. just
    // "Nom / Oeuvre / Bio / Photo", one row per artist. Forcing that shape through the
    // artwork importer would create one fake, near-empty artwork per artist. Detect it by
    // the absence of any artwork-only signal (title/technique/dimensions/inventory/year) and
    // route to a dedicated artist-roster import instead — same dedup/resolve logic, no
    // artwork rows created.
    const artistOnlyFile =
      titleColIdx === undefined &&
      fieldCol('technique') === undefined &&
      fieldCol('dimensions') === undefined &&
      fieldCol('inventoryNumber') === undefined &&
      fieldCol('year') === undefined &&
      artistColIdx !== undefined &&
      (fieldCol('bio') !== undefined || fieldCol('photo') !== undefined);

    if (artistOnlyFile) {
      for (let i = 0; i < sheet.rows.length; i++) {
        const artistRaw = cell(sheet.rows, i, artistColIdx);
        const bio = cell(sheet.rows, i, fieldCol('bio')).trim();
        const photoUrl = cell(sheet.rows, i, fieldCol('photo')).trim();
        if (!artistRaw.trim()) {
          skipped++;
          setProgress({ done: i + 1, total });
          continue;
        }
        const { id: artistId, name: artistName } = await resolveArtist(artistRaw);
        if (!artistId) {
          skipped++;
          log.push({ row: i + 2, title: '', artist: artistRaw, status: 'skipped', reason: 'Nom d\'artiste invalide' });
          setProgress({ done: i + 1, total });
          continue;
        }
        try {
          const current = await artistRepository.getById(artistId);
          const patch: Record<string, unknown> = {};
          if (bio && !Object.values(current?.biography ?? {}).some((v) => v)) patch.biography = { fr: bio };
          if (photoUrl && /^https?:\/\//i.test(photoUrl) && !current?.thumbnail) patch.thumbnail = photoUrl;
          if (Object.keys(patch).length) await artistRepository.update(artistId, patch as never);
          created++;
          log.push({ row: i + 2, title: '', artist: artistName ?? artistRaw, status: 'created', reason: '' });
        } catch (err) {
          skipped++;
          const reason = err instanceof ApiError ? `${err.status} ${err.message}` : String(err);
          log.push({ row: i + 2, title: '', artist: artistName ?? artistRaw, status: 'skipped', reason });
        }
        setProgress({ done: i + 1, total });
      }

      setSummary({ created, skipped, duplicates, artistsCreated, inventoryGenerated: 0 });
      setImportLog(log);
      setStep('done');
      qc.invalidateQueries({ queryKey: ['artists-all'] });
      toast.success(`${created} artiste${created > 1 ? 's' : ''} mis à jour`);
      return;
    }

    for (let i = 0; i < sheet.rows.length; i++) {
      const titleRaw = cell(sheet.rows, i, titleColIdx);
      const artistRaw = cell(sheet.rows, i, artistColIdx);

      if (!titleRaw.trim() && !artistRaw.trim()) {
        skipped++;
        log.push({ row: i + 2, title: titleRaw, artist: artistRaw, status: 'skipped', reason: 'Sans titre ni artiste' });
        setProgress({ done: i + 1, total });
        continue;
      }

      const dedupKey = artworkDedupKey(titleRaw, artistRaw);
      const duplicateOf = findDuplicate(titleRaw, artistRaw, dedupKey, existingRefs, seenInFile);
      if (duplicateOf) {
        skipped++;
        duplicates++;
        log.push({
          row: i + 2,
          title: titleRaw,
          artist: artistRaw,
          status: 'skipped',
          reason: duplicateOf === 'collection' ? 'Doublon — déjà présent dans la collection (ou très similaire)' : 'Doublon — déjà importé dans ce fichier (ou très similaire)',
        });
        setProgress({ done: i + 1, total });
        continue;
      }
      seenInFile.push({ key: dedupKey, title: titleRaw, artist: artistRaw });

      const { id: artistId, name: artistName } = await resolveArtist(artistRaw);
      const dateInfo = normalizeDate(cell(sheet.rows, i, fieldCol('year')));
      const purchaseDateInfo = normalizeDate(cell(sheet.rows, i, fieldCol('purchaseDate')));
      const payment = normalizePaymentMethod(cell(sheet.rows, i, fieldCol('paymentType')));
      const purchasePrice = parsePrice(cell(sheet.rows, i, fieldCol('purchasePrice')));
      const framed = normalizeBoolean(cell(sheet.rows, i, fieldCol('framed')));
      const dimensions = cell(sheet.rows, i, fieldCol('dimensions'));
      const technique = cell(sheet.rows, i, fieldCol('technique'));
      const gallery = cell(sheet.rows, i, fieldCol('gallery'));
      const hasCertificate = normalizeBoolean(cell(sheet.rows, i, fieldCol('certificate')));
      const hasInvoice = normalizeBoolean(cell(sheet.rows, i, fieldCol('invoice')));
      const inventoryNumber = inventoryPlan.assignments.get(i);
      const notes = cell(sheet.rows, i, fieldCol('notes')).trim();
      const bio = cell(sheet.rows, i, fieldCol('bio')).trim();
      const photoUrl = cell(sheet.rows, i, fieldCol('photo')).trim();

      const title = titleRaw.trim() || artistName || 'Sans titre';

      try {
        const createdArtwork = await artworkRepository.create({
          inventoryNumber,
          title: { fr: title },
          description: notes ? { fr: notes } : undefined,
          artistId: artistId ?? undefined,
          artistName: artistId ? undefined : artistName ?? undefined,
          dateText: dateInfo.raw || undefined,
          yearFrom: dateInfo.year ?? undefined,
          dimensionsNote: dimensions || undefined,
          framed,
          acquisitionMethod: payment.acquisitionMethod,
          paymentMethod: payment.method !== 'INCONNU' ? payment.method : undefined,
          acquisitionDate: purchaseDateInfo.iso ?? undefined,
          purchasePrice: purchasePrice ?? undefined,
          gallery: gallery || undefined,
          techniqueName: technique || undefined,
          hasCertificate: hasCertificate ?? false,
          hasInvoice: hasInvoice ?? false,
          status: 'in_storage',
          condition: 'unknown',
        } as never);
        created++;
        log.push({ row: i + 2, title, artist: artistName ?? '', status: 'created', reason: '' });

        // Bio/photo columns describe the artist, not the artwork (real spreadsheets repeat them on every
        // row of that artist) — never overwrite a bio/photo the artist already has from a prior row or a
        // previous enrichment pass.
        if (artistId && (bio || (photoUrl && /^https?:\/\//i.test(photoUrl)))) {
          try {
            const current = await artistRepository.getById(artistId);
            const patch: Record<string, unknown> = {};
            if (bio && !Object.values(current?.biography ?? {}).some((v) => v)) patch.biography = { fr: bio };
            if (photoUrl && /^https?:\/\//i.test(photoUrl) && !current?.thumbnail) patch.thumbnail = photoUrl;
            if (Object.keys(patch).length) await artistRepository.update(artistId, patch as never);
          } catch {
            // best-effort enrichment from the spreadsheet — never blocks the artwork import itself
          }
        }
        if (photoUrl && /^https?:\/\//i.test(photoUrl)) {
          try {
            await artworkRepository.attachMediaFromUrl(createdArtwork.id, photoUrl);
          } catch {
            // unreachable/invalid image URL — the artwork row itself still imported successfully
          }
        }
      } catch (err) {
        skipped++;
        const reason = err instanceof ApiError ? `${err.status} ${err.message}` : String(err);
        log.push({ row: i + 2, title, artist: artistName ?? '', status: 'skipped', reason });
      }

      setProgress({ done: i + 1, total });
    }

    setSummary({ created, skipped, duplicates, artistsCreated, inventoryGenerated: inventoryPlan.generatedCount });
    setImportLog(log);
    setStep('done');
    qc.invalidateQueries({ queryKey: ['artworks'] });
    qc.invalidateQueries({ queryKey: ['artist-artworks'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    qc.invalidateQueries({ queryKey: ['facets'] });
    qc.invalidateQueries({ queryKey: ['artists-all'] });
    toast.success(`${created} œuvre${created > 1 ? 's' : ''} importée${created > 1 ? 's' : ''}`);
  };

  if (!open) return null;

  const STEP_LABELS: Record<Step, string> = {
    upload: 'Fichier',
    mapping: 'Correspondance',
    importing: 'Import',
    done: 'Terminé',
  };
  const STEPS: Step[] = ['upload', 'mapping', 'importing', 'done'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => { if (step !== 'importing') { reset(); onClose(); } }}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }} transition={{ duration: 0.2 }}
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-foreground">Importer des œuvres</h2>
          </div>
          {step !== 'importing' && (
            <button
              onClick={() => { reset(); onClose(); }}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 border-b border-border px-6 py-3">
          {STEPS.map((s, i) => {
            const current = STEPS.indexOf(step);
            const done = current > i;
            const active = current === i;
            return (
              <React.Fragment key={s}>
                {i > 0 && <div className={cn('h-px flex-1', done ? 'bg-primary' : 'bg-border')} />}
                <div className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  done ? 'bg-primary text-white' : active ? 'border-2 border-primary text-primary' : 'border border-border text-muted-foreground',
                )}>
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span className={cn('text-xs', active ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                  {STEP_LABELS[s]}
                </span>
              </React.Fragment>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence initial={false}>
            {step === 'upload' && (
              <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <DropZone onFile={handleFile} loading={loading} />
                <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Mapping intelligent
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Chaque colonne est analysée (intitulé + contenu) pour deviner le champ correspondant,
                    avec un pourcentage de confiance que vous pouvez ajuster avant l'import. Les artistes
                    en double sont fusionnés automatiquement, les numéros d'inventaire manquants sont
                    générés à la suite des existants, et les œuvres déjà présentes dans la collection (ou
                    répétées dans le fichier) sont détectées et ignorées plutôt que recréées.
                  </p>
                </div>
              </motion.div>
            )}

            {step === 'mapping' && (
              <motion.div key="mapping" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="font-medium">{fileName}</span>
                  <span className="ml-auto text-muted-foreground">{sheet.rows.length} lignes détectées</span>
                </div>

                <div>
                  <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Correspondance détectée automatiquement
                  </h3>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Le pourcentage indique la confiance de la détection (intitulé de colonne + analyse du contenu).
                  </p>
                  <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border px-4">
                    {mappings.map((m) => (
                      <MappingRow
                        key={m.columnIndex}
                        mapping={m}
                        onChange={(field) =>
                          setMappings((prev) => prev.map((p) => (p.columnIndex === m.columnIndex ? { ...p, field, confidence: 100 } : p)))
                        }
                      />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Œuvres à importer', value: validRowCount },
                    { label: 'Artistes uniques', value: artistStats.unique },
                    { label: 'N° inventaire réutilisés', value: inventoryPlan.reusedCount },
                    { label: 'N° inventaire générés', value: inventoryPlan.generatedCount },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-xl border border-border bg-muted/40 p-3">
                      <p className="text-2xl font-semibold text-foreground tabular-nums">{stat.value}</p>
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  ))}
                </div>

                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Table2 className="h-4 w-4 text-primary" />
                    Aperçu normalisé (5 premières lignes)
                  </h3>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted">
                          {['N° inventaire', 'Artiste', 'Année', 'Paiement', 'Prix'].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.rows.slice(0, 5).map((_, i) => {
                          const artistRaw = cell(sheet.rows, i, artistColIdx);
                          const normalizedArtist = normalizeArtistName(artistRaw) ?? '—';
                          const dateInfo = normalizeDate(cell(sheet.rows, i, fieldCol('year')));
                          const payment = normalizePaymentMethod(cell(sheet.rows, i, fieldCol('paymentType')));
                          const price = parsePrice(cell(sheet.rows, i, fieldCol('purchasePrice')));
                          return (
                            <tr key={i} className="border-b border-border last:border-0">
                              <td className="px-3 py-2 font-mono text-foreground">{inventoryPlan.assignments.get(i)}</td>
                              <td className="px-3 py-2 text-foreground">{normalizedArtist}</td>
                              <td className="px-3 py-2 text-foreground">{dateInfo.year ?? '—'}</td>
                              <td className="px-3 py-2 text-foreground">{payment.method}</td>
                              <td className="px-3 py-2 text-foreground">{price != null ? `${price} €` : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {titleColIdx === undefined && artistColIdx === undefined && (
                  <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-600 dark:text-yellow-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    Aucune colonne mappée sur "Titre" ou "Artiste" — les lignes correspondantes seront ignorées.
                  </div>
                )}
              </motion.div>
            )}

            {step === 'importing' && (
              <motion.div key="importing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4 py-12">
                <RefreshCw className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm font-medium text-foreground">
                  Import en cours… {progress.done} / {progress.total}
                </p>
                <div className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
              </motion.div>
            )}

            {step === 'done' && (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-5 py-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15">
                  <Check className="h-8 w-8 text-green-500" />
                </div>
                <div>
                  <p className="text-xl font-semibold text-foreground">Import terminé</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{summary.created}</span> œuvre{summary.created > 1 ? 's' : ''} ajoutée{summary.created > 1 ? 's' : ''},{' '}
                    <span className="font-semibold text-foreground">{summary.artistsCreated}</span> artiste{summary.artistsCreated > 1 ? 's' : ''} créé{summary.artistsCreated > 1 ? 's' : ''},{' '}
                    <span className="font-semibold text-foreground">{summary.inventoryGenerated}</span> n° d'inventaire généré{summary.inventoryGenerated > 1 ? 's' : ''}.
                  </p>
                  {summary.skipped > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {summary.skipped} ligne{summary.skipped > 1 ? 's' : ''} ignorée{summary.skipped > 1 ? 's' : ''}
                      {summary.duplicates > 0 && <> (dont <span className="font-medium text-foreground">{summary.duplicates}</span> doublon{summary.duplicates > 1 ? 's' : ''})</>}
                      .
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => downloadImportLog(importLog)}
                  className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  Télécharger le rapport d'import (CSV)
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          {step === 'mapping' ? (
            <button onClick={() => setStep('upload')} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              ← Recommencer
            </button>
          ) : <div />}
          <div className="flex items-center gap-2">
            {step === 'done' ? (
              <button
                onClick={() => { reset(); onClose(); }}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Fermer
              </button>
            ) : step === 'mapping' ? (
              <button
                disabled={sheet.rows.length === 0}
                onClick={handleImport}
                className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Upload className="h-4 w-4" /> Importer {validRowCount} œuvre{validRowCount > 1 ? 's' : ''}
              </button>
            ) : null}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
