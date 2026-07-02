import { Injectable } from '@nestjs/common';

export interface AiDebugEntry {
  id: string;
  ts: string;
  op: 'autofill_artwork' | 'autofill_artist' | 'find_images' | 'enrichment';
  input: { artistName?: string; title?: string; fullName?: string };
  /** null = DDG returned nothing; number = byte length of context built */
  ddgContextBytes: number | null;
  /** Per-query hit counts for the DDG search — undefined on old artwork path */
  ddgQueries?: Array<{ q: string; hits: number }>;
  /** One-sentence diagnosis of why context is empty or partial */
  ddgReason?: string;
  structuredHit: { source: string; matchedTitle: string } | null;
  provider: string | null;
  success: boolean;
  fieldsFound: string[];
  imageSource: 'wikiart' | 'commons' | 'artsy' | 'ddg' | 'ai-search' | null;
  durationMs: number;
  error?: string;
}

const MAX_ENTRIES = 200;

@Injectable()
export class AiDebugLogService {
  private readonly entries: AiDebugEntry[] = [];
  private seq = 0;

  push(entry: Omit<AiDebugEntry, 'id' | 'ts'>): void {
    this.entries.unshift({
      id: `${Date.now()}-${++this.seq}`,
      ts: new Date().toISOString(),
      ...entry,
    });
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES;
  }

  getAll(): AiDebugEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries.length = 0;
  }
}
