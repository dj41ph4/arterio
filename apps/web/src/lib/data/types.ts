import type { ArtworkQuery, ArtworkView, Paginated } from '@arterio/shared';

export interface DashboardStats {
  totalArtworks: number;
  totalInsuredValue: number;
  currency: string;
  collections: number;
  artists: number;
  onLoan: number;
  onExhibition: number;
  needsRestoration: number;
  byStatus: Array<{ key: string; count: number }>;
  byCollection: Array<{ id: string; name: string; color: string; count: number; value: number }>;
  byCondition: Array<{ key: string; count: number }>;
  recentlyAdded: ArtworkView[];
  alerts: Array<{
    id: string;
    type: 'insurance_expiring' | 'loan_due' | 'restoration_due';
    severity: 'info' | 'warning' | 'critical';
    title: string;
    artworkId?: string;
    dueAt: string;
  }>;
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
  color?: string;
}

export interface ArtworkFacets {
  status: FacetValue[];
  collection: FacetValue[];
  condition: FacetValue[];
  artist: FacetValue[];
}

/**
 * The contract every data source implements. UI/screens depend only on this —
 * the mock and the (future) HTTP implementation are interchangeable.
 */
export interface ArtworkRepository {
  list(query: ArtworkQuery): Promise<Paginated<ArtworkView>>;
  getById(id: string): Promise<ArtworkView | null>;
  facets(): Promise<ArtworkFacets>;
  stats(): Promise<DashboardStats>;
  toggleFavorite(id: string, value: boolean): Promise<void>;
  update(id: string, patch: Partial<ArtworkView>): Promise<ArtworkView>;
  create(input: Partial<ArtworkView>): Promise<ArtworkView>;
  remove(id: string): Promise<void>;
  uploadMedia(id: string, file: File): Promise<ArtworkView>;
}
