export interface CollectionView {
  id: string;
  name: string;
  description?: string;
  color: string;
  artworkCount: number;
}

export interface CollectionInput {
  name: string;
  description?: string;
  color: string;
}

export interface CollectionRepository {
  list(): Promise<CollectionView[]>;
  create(input: CollectionInput): Promise<CollectionView>;
  update(id: string, patch: Partial<CollectionInput>): Promise<CollectionView>;
  remove(id: string): Promise<void>;
}

/** Mutable seed — also re-exported for the artwork mock repository (facets/stats). */
export const COLLECTIONS: { id: string; name: string; description?: string; color: string }[] = [
  { id: 'c1', name: 'Old Masters', color: '#b45309', description: 'European paintings, 14th–18th century' },
  { id: 'c2', name: 'Impressionists', color: '#0ea5e9', description: 'Late 19th-century French Impressionism' },
  { id: 'c3', name: 'Modern', color: '#8b5cf6', description: 'Early-to-mid 20th-century modernism' },
  { id: 'c4', name: 'Works on Paper', color: '#10b981', description: 'Drawings, prints and watercolours' },
  { id: 'c5', name: 'Contemporary', color: '#ec4899', description: 'Post-1970 contemporary works' },
];

let nextId = COLLECTIONS.length + 1;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class MockCollectionRepository implements CollectionRepository {
  async list(): Promise<CollectionView[]> {
    await delay(80);
    // artworkCount is computed lazily by the caller (dashboard/grid) from artwork data;
    // default to 0 here, callers that need real counts merge with artwork facets.
    return COLLECTIONS.map((c) => ({ ...c, artworkCount: 0 }));
  }

  async create(input: CollectionInput): Promise<CollectionView> {
    await delay(150);
    const id = `c${nextId++}`;
    const created = { id, ...input };
    COLLECTIONS.push(created);
    return { ...created, artworkCount: 0 };
  }

  async update(id: string, patch: Partial<CollectionInput>): Promise<CollectionView> {
    await delay(150);
    const idx = COLLECTIONS.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error('Collection not found');
    COLLECTIONS[idx] = { ...COLLECTIONS[idx]!, ...patch };
    return { ...COLLECTIONS[idx]!, artworkCount: 0 };
  }

  async remove(id: string): Promise<void> {
    await delay(150);
    const idx = COLLECTIONS.findIndex((c) => c.id === id);
    if (idx !== -1) COLLECTIONS.splice(idx, 1);
  }
}

import { HttpCollectionRepository } from './http/collection-repository';

const source = process.env.NEXT_PUBLIC_DATA_SOURCE ?? 'mock';
export const collectionRepository: CollectionRepository =
  source === 'http' ? new HttpCollectionRepository() : new MockCollectionRepository();
