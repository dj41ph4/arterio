'use client';

import * as React from 'react';
import { Settings2, X } from 'lucide-react';
import { toast } from 'sonner';
import { getApiHostOverride, saveApiHostOverride, clearApiHostOverride, normalizeApiUrl } from '@/lib/api/setup-host';

const USE_API = process.env.NEXT_PUBLIC_DATA_SOURCE === 'http';

/**
 * Self-contained — must work even when login is completely broken (wrong API
 * host), so it can't depend on being authenticated or on any app state.
 * Lets an operator fix a split-domain reverse-proxy setup (web and API on
 * different (sub)domains) without opening the browser console.
 */
export function ApiHostLink() {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState('');

  if (!USE_API) return null;

  const current = getApiHostOverride();

  const handleSave = () => {
    if (!value.trim()) return;
    saveApiHostOverride(normalizeApiUrl(value));
    toast.success("Adresse de l'API enregistrée — rechargement…");
    setTimeout(() => window.location.reload(), 600);
  };

  const handleReset = () => {
    clearApiHostOverride();
    toast.success('Adresse de l\'API réinitialisée — rechargement…');
    setTimeout(() => window.location.reload(), 600);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Settings2 className="size-3.5" /> Modifier l'URL de l'API
      </button>
    );
  }

  return (
    <div className="mt-3 w-full max-w-sm rounded-xl border border-border bg-card p-4 text-left">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-foreground">Adresse du serveur API</p>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        {current ? `Actuelle : ${current}` : 'Aucune adresse personnalisée — détection automatique.'}
      </p>
      <div className="flex gap-2">
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          placeholder="https://api.exemple.com"
          className="flex-1 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          onClick={handleSave}
          disabled={!value.trim()}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Enregistrer
        </button>
      </div>
      <button
        onClick={handleReset}
        className="mt-2 w-full rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        API sur le même serveur
      </button>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Juste l'URL de base (ex. <code>https://api.exemple.com</code>) — <code>/api/v1</code> est ajouté automatiquement.
        « API sur le même serveur » efface l'adresse personnalisée et revient à la détection automatique.
      </p>
    </div>
  );
}
