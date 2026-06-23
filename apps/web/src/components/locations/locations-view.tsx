'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { MapPin, Search, ChevronRight, Building2, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { PageHeader } from '@/components/app-shell/page-header';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { CreateLocationModal } from './create-location-modal';

const USE_API = process.env.NEXT_PUBLIC_DATA_SOURCE === 'http';

interface LocationView {
  id: string;
  building: string;
  floor: string;
  room: string;
  artworkCount: number;
  capacity: number;
}

const DEMO_LOCATIONS: LocationView[] = [
  { id: 'loc1', building: 'Bâtiment principal', floor: 'RDC', room: 'Galerie A — Maîtres anciens', artworkCount: 22, capacity: 30 },
  { id: 'loc2', building: 'Bâtiment principal', floor: 'RDC', room: 'Galerie B — Impressionnistes', artworkCount: 18, capacity: 25 },
  { id: 'loc3', building: 'Bâtiment principal', floor: '1er étage', room: 'Galerie C — Art moderne', artworkCount: 31, capacity: 40 },
  { id: 'loc4', building: 'Bâtiment principal', floor: '1er étage', room: 'Réserve climatisée', artworkCount: 47, capacity: 60 },
  { id: 'loc5', building: 'Annexe', floor: 'RDC', room: 'Atelier de restauration', artworkCount: 6, capacity: 12 },
  { id: 'loc6', building: 'Annexe', floor: 'Sous-sol', room: 'Réserve sécurisée (œuvres sur papier)', artworkCount: 20, capacity: 50 },
  { id: 'loc7', building: 'Annexe', floor: 'Sous-sol', room: 'Coffre-fort — pièces de haute valeur', artworkCount: 8, capacity: 10 },
];

export function LocationsView() {
  const t = useTranslations();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [locations, setLocations] = useState<LocationView[]>(USE_API ? [] : DEMO_LOCATIONS);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = () => {
    if (!USE_API) return;
    apiFetch<{ data: LocationView[] }>('/locations')
      .then((res) => setLocations(res.data))
      .catch(() => setLocations([]));
  };

  useEffect(refresh, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cet emplacement ?')) return;
    try {
      await apiFetch(`/locations/${id}`, { method: 'DELETE' });
      toast.success('Emplacement supprimé');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la suppression');
    }
  };

  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = locations.filter(
      (l) => l.room.toLowerCase().includes(q) || l.building.toLowerCase().includes(q) || l.floor.toLowerCase().includes(q),
    );
    const map = new Map<string, LocationView[]>();
    for (const loc of filtered) {
      const list = map.get(loc.building) ?? [];
      list.push(loc);
      map.set(loc.building, list);
    }
    return map;
  }, [search, locations]);

  const total = [...grouped.values()].reduce((s, list) => s + list.length, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 pb-3 md:px-6">
        <PageHeader
          title={t('nav.locations')}
          subtitle={t('locations.subtitle', { count: total })}
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)} className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> Nouvel emplacement
            </Button>
          }
        />
      </div>

      {USE_API && <CreateLocationModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={refresh} />}

      <div className="border-b border-border bg-background px-6 py-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('locations.searchPlaceholder')}
            className="w-full rounded-lg border border-border bg-muted py-2 pl-9 pr-4 text-sm outline-none ring-ring focus:ring-2"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {total === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
            <MapPin className="h-10 w-10 opacity-40" />
            <p className="text-sm">{t('common.noResults')}</p>
          </div>
        ) : (
          [...grouped.entries()].map(([building, rooms]) => (
            <div key={building}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Building2 className="h-4 w-4 text-primary" />
                {building}
              </h2>
              <div className="divide-y divide-border rounded-xl border border-border bg-card">
                {rooms.map((loc) => {
                  const pct = Math.round((loc.artworkCount / loc.capacity) * 100);
                  return (
                    <div
                      key={loc.id}
                      onClick={
                        USE_API
                          ? () => router.push(`/collection?locationId=${loc.id}&locationName=${encodeURIComponent(loc.room)}`)
                          : undefined
                      }
                      className={`flex items-center gap-4 px-4 py-3 ${USE_API ? 'cursor-pointer hover:bg-muted/40' : ''}`}
                    >
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{loc.room}</p>
                        <p className="text-xs text-muted-foreground">{loc.floor}</p>
                      </div>
                      <div className="w-32 shrink-0">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{loc.artworkCount}/{loc.capacity}</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-amber-500' : 'bg-primary'}`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </div>
                      {USE_API && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(loc.id); }}
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Supprimer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
