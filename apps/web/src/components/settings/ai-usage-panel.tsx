'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { aiApi } from '@/lib/data/ai';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * Surfaces real AI call volume (last 30 days) so an admin can see what's
 * actually driving OpenRouter usage/cost without digging through server
 * logs — one row is logged per model attempt, so a single autofill click
 * querying 3 models counts as 3 here.
 */
export function AiUsagePanel() {
  const { data, isLoading } = useQuery({ queryKey: ['ai-usage'], queryFn: aiApi.getUsage, staleTime: 60_000 });

  if (isLoading || !data) return null;
  if (data.total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Usage IA (30 derniers jours)
          </CardTitle>
          <CardDescription>Aucun appel IA enregistré pour le moment.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const maxDay = Math.max(...data.last30Days.map((d) => d.count), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" /> Usage IA (30 derniers jours)
        </CardTitle>
        <CardDescription>
          {data.total} appel{data.total > 1 ? 's' : ''} au total
          {data.failures > 0 ? ` — ${data.failures} échoué${data.failures > 1 ? 's' : ''}` : ''}. Un clic sur un
          bouton IA qui interroge plusieurs modèles compte un appel par modèle.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex h-16 items-end gap-1">
          {data.last30Days.map((d) => (
            <div
              key={d.date}
              title={`${d.date} — ${d.count} appel${d.count > 1 ? 's' : ''}`}
              className="flex-1 rounded-t bg-primary/60 transition-colors hover:bg-primary"
              style={{ height: `${Math.max((d.count / maxDay) * 100, 4)}%` }}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <p className="mb-1 font-medium text-muted-foreground">Par opération</p>
            <ul className="space-y-0.5">
              {data.byOperation.map((o) => (
                <li key={o.operation} className="flex justify-between text-foreground">
                  <span className="text-muted-foreground">{o.operation}</span>
                  <span className="font-mono tabular-nums">{o.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 font-medium text-muted-foreground">Par modèle</p>
            <ul className="space-y-0.5">
              {data.byModel.map((m) => (
                <li key={m.model} className="flex justify-between text-foreground">
                  <span className="truncate text-muted-foreground" title={m.model}>{m.model}</span>
                  <span className="font-mono tabular-nums">{m.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
