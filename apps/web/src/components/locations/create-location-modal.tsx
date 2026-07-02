'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/client';

export function CreateLocationModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [room, setRoom] = React.useState('');
  const [building, setBuilding] = React.useState('');
  const [floor, setFloor] = React.useState('');
  const [capacity, setCapacity] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setRoom(''); setBuilding(''); setFloor(''); setCapacity('');
    }
  }, [open]);

  const canSubmit = room.trim().length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await apiFetch('/locations', {
        method: 'POST',
        body: JSON.stringify({
          room: room.trim(),
          building: building.trim() || undefined,
          floor: floor.trim() || undefined,
          capacity: capacity ? Number(capacity) : undefined,
        }),
      });
      toast.success('Emplacement créé');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de la création de l'emplacement");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-semibold text-foreground">Nouvel emplacement</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nom de la salle / pièce</label>
            <input
              autoFocus
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="ex. Galerie A — Maîtres anciens"
              className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Bâtiment</label>
              <input
                value={building}
                onChange={(e) => setBuilding(e.target.value)}
                placeholder="ex. Bâtiment principal"
                className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Étage</label>
              <input
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                placeholder="ex. RDC"
                className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Capacité (nombre d'œuvres)</label>
            <input
              type="number"
              min={0}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="ex. 30"
              className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Création…' : "Créer l'emplacement"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
