import { apiFetch } from '@/lib/api/client';
import type { CollectionRepository, CollectionView, CollectionInput } from '../collection-repository';

export class HttpCollectionRepository implements CollectionRepository {
  async list(): Promise<CollectionView[]> {
    return apiFetch<CollectionView[]>('/collections');
  }

  async create(input: CollectionInput): Promise<CollectionView> {
    return apiFetch<CollectionView>('/collections', { method: 'POST', body: JSON.stringify(input) });
  }

  async update(id: string, patch: Partial<CollectionInput>): Promise<CollectionView> {
    return apiFetch<CollectionView>(`/collections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  async remove(id: string): Promise<void> {
    await apiFetch(`/collections/${id}`, { method: 'DELETE' });
  }
}
