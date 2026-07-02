'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Lock, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_BASE_URL } from '@/lib/api/client';

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);

  if (!token) {
    return <p className="text-center text-sm text-muted-foreground">Lien de réinitialisation invalide ou manquant.</p>;
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <CheckCircle2 className="size-10 text-green-500" />
        <p className="text-sm text-foreground">Mot de passe mis à jour. Vous pouvez vous connecter.</p>
        <Button onClick={() => router.push('/login')}>Se connecter</Button>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }
    if (password !== confirm) {
      toast.error('Les mots de passe ne correspondent pas');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Échec de la réinitialisation' }));
        throw new Error(body.message ?? 'Échec de la réinitialisation');
      }
      setDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la réinitialisation');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Nouveau mot de passe</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choisissez un nouveau mot de passe pour votre compte.</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="password">Nouveau mot de passe</label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="pl-9"
            autoComplete="new-password"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="confirm">Confirmer le mot de passe</label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            className="pl-9"
            autoComplete="new-password"
          />
        </div>
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <>Réinitialiser <ArrowRight className="size-4" /></>}
      </Button>
    </form>
  );
}
