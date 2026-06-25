import type { PrismaClient } from '@prisma/client';

/**
 * The system permission + role matrix, shared between the dev seed script
 * (packages/database/prisma/seed.ts) and the API's first-run setup wizard
 * (apps/api/src/modules/setup) — both need to create an identical RBAC
 * baseline for a brand-new organization, so the list lives in one place.
 */
export const RBAC_PERMISSIONS: Array<{ resource: string; action: string; description: string }> = [
  { resource: 'artwork', action: 'read', description: 'View artworks' },
  { resource: 'artwork', action: 'create', description: 'Create artworks' },
  { resource: 'artwork', action: 'update', description: 'Edit artworks' },
  { resource: 'artwork', action: 'delete', description: 'Delete artworks' },
  { resource: 'valuation', action: 'read', description: 'View financial valuations' },
  { resource: 'valuation', action: 'update', description: 'Edit financial valuations' },
  { resource: 'loan', action: 'read', description: 'View loans' },
  { resource: 'loan', action: 'approve', description: 'Approve loans' },
  { resource: 'exhibition', action: 'manage', description: 'Manage exhibitions' },
  { resource: 'restoration', action: 'manage', description: 'Manage restorations' },
  { resource: 'document', action: 'sign', description: 'Electronically sign documents' },
  { resource: 'user', action: 'manage', description: 'Manage users and roles' },
  { resource: 'settings', action: 'manage', description: 'Manage organization settings' },
  { resource: 'audit', action: 'read', description: 'Read the audit log' },
];

export const RBAC_ROLES: Record<string, { name: string; description: string; permissions: 'all' | string[] }> = {
  admin: { name: 'Administrator', description: 'Full access', permissions: 'all' },
  curator: {
    name: 'Curator',
    description: 'Catalogue, exhibitions, valuations (read)',
    permissions: [
      'artwork:read', 'artwork:create', 'artwork:update',
      'valuation:read', 'exhibition:manage', 'loan:read', 'restoration:manage',
    ],
  },
  registrar: {
    name: 'Registrar',
    description: 'Movements, loans, documents',
    permissions: ['artwork:read', 'artwork:update', 'loan:read', 'loan:approve', 'document:sign'],
  },
  conservator: {
    name: 'Conservator',
    description: 'Condition & restoration',
    permissions: ['artwork:read', 'restoration:manage'],
  },
  finance: {
    name: 'Finance',
    description: 'Valuations & insurance',
    permissions: ['artwork:read', 'valuation:read', 'valuation:update'],
  },
  viewer: { name: 'Viewer', description: 'Read-only', permissions: ['artwork:read'] },
};

/**
 * Upserts the global permission catalogue, then creates/updates the full
 * role matrix for one organization. Idempotent — safe to call on an
 * organization that already has roles (e.g. re-running the dev seed).
 */
export async function seedRbac(prisma: PrismaClient, organizationId: string) {
  for (const p of RBAC_PERMISSIONS) {
    const key = `${p.resource}:${p.action}`;
    await prisma.permission.upsert({
      where: { key },
      update: { description: p.description },
      create: { key, resource: p.resource, action: p.action, description: p.description },
    });
  }
  const allPermissions = await prisma.permission.findMany();

  for (const [key, role] of Object.entries(RBAC_ROLES)) {
    const created = await prisma.role.upsert({
      where: { organizationId_key: { organizationId, key } },
      update: { name: role.name, description: role.description, isSystem: true },
      create: { organizationId, key, name: role.name, description: role.description, isSystem: true, policy: {} },
    });
    const perms =
      role.permissions === 'all'
        ? allPermissions
        : allPermissions.filter((p) => role.permissions.includes(p.key));
    await prisma.rolePermission.deleteMany({ where: { roleId: created.id } });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: created.id, permissionId: p.id })),
    });
  }
}
