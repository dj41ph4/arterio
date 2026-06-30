import { apiFetch, API_BASE_URL } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';
import type { ArtworkView, Paginated } from '@arterio/shared';

// ---------------------------------------------------------------------------
// Trash (soft-deleted artworks)
// ---------------------------------------------------------------------------

export const trashApi = {
  list: () => apiFetch<Paginated<ArtworkView>>('/artworks/trash'),
  restore: (id: string) => apiFetch<ArtworkView>(`/artworks/${id}/restore`, { method: 'POST' }),
  purge: (id: string) => apiFetch<{ ok: true }>(`/artworks/${id}/purge`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export interface MemberRole {
  id: string;
  key: string;
  name: string;
}

export interface MemberView {
  id: string;
  email: string;
  fullName: string;
  displayName: string | null;
  status: 'active' | 'invited' | 'suspended' | 'disabled';
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  createdAt: string;
  roles: MemberRole[];
}

export interface RoleOption {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

export const membersApi = {
  list: () => apiFetch<MemberView[]>('/members'),
  listRoles: () => apiFetch<RoleOption[]>('/members/roles'),
  invite: (input: { email: string; fullName: string; roleKey: string }) =>
    apiFetch<MemberView>('/members', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, patch: { roleKey?: string; status?: MemberView['status'] }) =>
    apiFetch<{ ok: true }>(`/members/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/members/${id}`, { method: 'DELETE' }),
  resetPassword: (id: string) => apiFetch<{ ok: true }>(`/members/${id}/reset-password`, { method: 'POST' }),
};

// ---------------------------------------------------------------------------
// Organization / notifications
// ---------------------------------------------------------------------------

export interface AiSettingsView {
  enabled: boolean;
  hasApiKey: boolean;
  models: string[];
  hasWikiArtKey: boolean;
  hasGeminiKey: boolean;
  hasArtsyKey: boolean;
  hasMistralKey: boolean;
  /** Order providers are tried in — the first with no usable result falls through to the next. */
  providerOrder: ('openrouter' | 'gemini' | 'mistral')[];
  /** "parallel": every configured OpenRouter model queried at once and merged. "fallback": one at a time, cheaper. */
  multiModelMode: 'parallel' | 'fallback';
}

export interface OrganizationSettings {
  id: string;
  name: string;
  legalName: string | null;
  defaultLocale: string;
  notifications: Record<string, boolean>;
  /** Whether each fallback source has a key configured — the secret itself is never returned. */
  externalSources: Record<'europeana' | 'rijksmuseum' | 'harvard' | 'smithsonian', boolean>;
}

export type OAuthProviderKey = 'google' | 'microsoft';

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  isPublic: boolean;
  rateLimit: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export const settingsApi = {
  getOrganization: () => apiFetch<OrganizationSettings>('/settings/organization'),
  updateOrganization: (
    patch: Partial<Pick<OrganizationSettings, 'name' | 'legalName' | 'defaultLocale'>> & {
      notifications?: Record<string, boolean>;
    },
  ) => apiFetch<OrganizationSettings>('/settings/organization', { method: 'PATCH', body: JSON.stringify(patch) }),

  /** Send "" for a field to clear it, omit a field to leave it unchanged. */
  updateExternalSources: (patch: Partial<Record<'europeana' | 'rijksmuseum' | 'harvard' | 'smithsonian', string>>) =>
    apiFetch<OrganizationSettings>('/settings/external-sources', { method: 'PATCH', body: JSON.stringify(patch) }),

  getAiSettings: () => apiFetch<AiSettingsView>('/settings/ai'),
  /** apiKey/wikiartApiKey/geminiApiKey/mistralApiKey: omit to keep unchanged, send "" to clear it. */
  updateAiSettings: (patch: {
    enabled?: boolean;
    apiKey?: string;
    models?: string[];
    wikiartApiKey?: string;
    geminiApiKey?: string;
    artsyApiKey?: string;
    mistralApiKey?: string;
    providerOrder?: ('openrouter' | 'gemini' | 'mistral')[];
    multiModelMode?: 'parallel' | 'fallback';
  }) =>
    apiFetch<AiSettingsView>('/settings/ai', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  /** Unfiltered — the UI does its own search + "free only" filtering over the full catalog. */
  listOpenRouterModels: () => apiFetch<Array<{ id: string; name: string }>>('/openrouter/models'),

  getCertificate: () =>
    apiFetch<{ hasCustomCertificate: boolean; subject?: string; validFrom?: string; validTo?: string }>('/settings/certificate'),
  uploadCertificate: (certificate: string, privateKey: string) =>
    apiFetch<{ hasCustomCertificate: boolean }>('/settings/certificate', {
      method: 'POST',
      body: JSON.stringify({ certificate, privateKey }),
    }),
  removeCertificate: () => apiFetch<{ hasCustomCertificate: boolean }>('/settings/certificate', { method: 'DELETE' }),

  getOAuthProviders: () => apiFetch<Record<OAuthProviderKey, boolean>>('/settings/oauth'),
  updateOAuthProvider: (provider: OAuthProviderKey, patch: { clientId?: string; clientSecret?: string }) =>
    apiFetch<Record<OAuthProviderKey, boolean>>(`/settings/oauth/${provider}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  listApiKeys: () => apiFetch<ApiKeyView[]>('/settings/api-keys'),
  createApiKey: (input: { name: string; scopes?: string[]; isPublic?: boolean }) =>
    apiFetch<{ id: string; name: string; prefix: string; secret: string; createdAt: string }>('/settings/api-keys', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  revokeApiKey: (id: string) => apiFetch<{ ok: true }>(`/settings/api-keys/${id}`, { method: 'DELETE' }),

  /** Permanently deletes data by category. Irreversible — same behavior on any Prisma datasource. */
  wipeData: (categories: string[]) =>
    apiFetch<{ ok: true; deleted: Record<string, number> }>('/settings/danger-zone/wipe', {
      method: 'POST',
      body: JSON.stringify({ categories }),
    }),

  /** Downloads the full org backup as a .json file via the browser. */
  async downloadBackup(): Promise<void> {
    const { accessToken } = useAuthStore.getState();
    const res = await fetch(`${API_BASE_URL}/settings/backup`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(body.message ?? `Backup export failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arterio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /** Downloads the full portable migration archive (data + media/document files) as a .zip. */
  async downloadMigration(): Promise<void> {
    const { accessToken } = useAuthStore.getState();
    const res = await fetch(`${API_BASE_URL}/settings/migration/export`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(body.message ?? `Migration export failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arterio-migration-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /** Restores a migration .zip — always creates a brand-new organization, never merges into the current one. */
  async importMigration(file: File): Promise<{ organizationId: string; organizationName: string }> {
    const { accessToken } = useAuthStore.getState();
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE_URL}/settings/migration/import`, {
      method: 'POST',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: 'Migration import failed' }));
      throw new Error(body.message ?? 'Migration import failed');
    }
    return res.json();
  },
};
