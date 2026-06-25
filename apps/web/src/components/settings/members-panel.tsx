'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus, Trash2, ShieldCheck, Mail, KeyRound } from 'lucide-react';
import { membersApi, type MemberView } from '@/lib/data/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<MemberView['status'], string> = {
  active: 'Actif',
  invited: 'Invité',
  suspended: 'Suspendu',
  disabled: 'Désactivé',
};

const STATUS_COLOR: Record<MemberView['status'], string> = {
  active: 'bg-green-500/10 text-green-600 dark:text-green-400',
  invited: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  suspended: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  disabled: 'bg-muted text-muted-foreground',
};

function InviteForm({ roles, onInvited }: { roles: { key: string; name: string }[]; onInvited: () => void }) {
  const [email, setEmail] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [roleKey, setRoleKey] = React.useState(roles[0]?.key ?? '');

  const mutation = useMutation({
    mutationFn: () => membersApi.invite({ email, fullName, roleKey }),
    onSuccess: () => {
      toast.success(`${fullName} a été ajouté(e) — identifiants à transmettre manuellement`);
      setEmail('');
      setFullName('');
      onInvited();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Échec de l'ajout"),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (email && fullName && roleKey) mutation.mutate(); }}
      className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/30 p-3"
    >
      <div className="min-w-[160px] flex-1">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Nom complet</label>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Jeanne Dupont"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="min-w-[180px] flex-1">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jeanne@exemple.com"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="min-w-[140px]">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Rôle</label>
        <select
          value={roleKey}
          onChange={(e) => setRoleKey(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {roles.map((r) => (
            <option key={r.key} value={r.key}>{r.name}</option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={mutation.isPending || !email || !fullName}
        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <UserPlus className="h-4 w-4" /> Ajouter
      </button>
    </form>
  );
}

export function MembersPanel() {
  const qc = useQueryClient();
  const { data: members, isLoading } = useQuery({ queryKey: ['members'], queryFn: membersApi.list });
  const { data: roles } = useQuery({ queryKey: ['member-roles'], queryFn: membersApi.listRoles });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; roleKey?: string; status?: MemberView['status'] }) =>
      membersApi.update(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
    onError: () => toast.error('Échec de la mise à jour'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => membersApi.remove(id),
    onSuccess: () => { toast.success('Membre désactivé'); qc.invalidateQueries({ queryKey: ['members'] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Échec de la désactivation'),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (id: string) => membersApi.resetPassword(id),
    onSuccess: () => toast.success('Mot de passe réinitialisé — le membre en définit un nouveau à sa prochaine connexion'),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Échec de la réinitialisation'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Membres de l'organisation</CardTitle>
        <CardDescription>
          Gérez qui a accès à votre collection et avec quel rôle. Pas de système d'email configuré — transmettez
          l'email et le mot de passe choisi manuellement ; le premier login le valide.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <InviteForm roles={roles ?? []} onInvited={() => qc.invalidateQueries({ queryKey: ['members'] })} />

        {isLoading ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">Chargement…</div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border">
            {members?.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-[160px] flex-1">
                  <p className="text-sm font-medium text-foreground">{m.fullName}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" />{m.email}</p>
                </div>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLOR[m.status])}>
                  {STATUS_LABEL[m.status]}
                </span>
                <select
                  value={m.roles[0]?.key ?? ''}
                  onChange={(e) => updateMutation.mutate({ id: m.id, roleKey: e.target.value })}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  {roles?.map((r) => (
                    <option key={r.key} value={r.key}>{r.name}</option>
                  ))}
                </select>
                {m.status !== 'disabled' && (
                  <button
                    onClick={() => {
                      if (confirm(`Réinitialiser le mot de passe de ${m.fullName} ?`)) resetPasswordMutation.mutate(m.id);
                    }}
                    title="Réinitialiser le mot de passe"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-amber-500/10 hover:text-amber-500"
                  >
                    <KeyRound className="h-4 w-4" />
                  </button>
                )}
                {m.status !== 'disabled' && (
                  <button
                    onClick={() => removeMutation.mutate(m.id)}
                    title="Désactiver ce membre"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                {m.mfaEnabled && (
                  <span title="2FA actif">
                    <ShieldCheck className="h-4 w-4 text-green-500" />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
