/**
 * Seed — creates a demo organization, the system RBAC matrix, an admin user,
 * core taxonomies and a few illustrative artworks.
 *
 * Idempotent: safe to run repeatedly (upserts by natural keys).
 *
 * NOTE: password hashing here uses a placeholder. The API owns real Argon2id
 * hashing; for the demo admin we store a clearly-marked dev hash that the API
 * seed routine replaces. Never use this in production.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const PERMISSIONS: Array<{ resource: string; action: string; description: string }> = [
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

const ROLES: Record<string, { name: string; description: string; permissions: 'all' | string[] }> = {
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

async function main() {
  console.log('▸ Seeding permissions…');
  for (const p of PERMISSIONS) {
    const key = `${p.resource}:${p.action}`;
    await prisma.permission.upsert({
      where: { key },
      update: { description: p.description },
      create: { key, resource: p.resource, action: p.action, description: p.description },
    });
  }
  const allPermissions = await prisma.permission.findMany();

  console.log('▸ Seeding organization…');
  const org = await prisma.organization.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      slug: 'demo',
      name: 'Demo Museum & Collection',
      legalName: 'Arterio Demo Foundation',
      defaultLocale: 'en',
      settings: { accentColor: '#6366f1', theme: 'system' },
    },
  });

  console.log('▸ Seeding roles…');
  for (const [key, role] of Object.entries(ROLES)) {
    const created = await prisma.role.upsert({
      where: { organizationId_key: { organizationId: org.id, key } },
      update: { name: role.name, description: role.description, isSystem: true },
      create: { organizationId: org.id, key, name: role.name, description: role.description, isSystem: true, policy: {} },
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

  console.log('▸ Seeding admin user…');
  const admin = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: 'admin@arterio.app' } },
    update: {},
    create: {
      organizationId: org.id,
      email: 'admin@arterio.app',
      emailVerified: new Date(),
      // Dev placeholder — API replaces with Argon2id on first real run.
      passwordHash: 'DEV_PLACEHOLDER_REPLACE_VIA_API',
      fullName: 'Demo Administrator',
      displayName: 'Admin',
      locale: 'en',
      status: 'active',
    },
  });
  await prisma.membership.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: admin.id } },
    update: {},
    create: { organizationId: org.id, userId: admin.id, status: 'active' },
  });
  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { organizationId_key: { organizationId: org.id, key: 'admin' } },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  console.log('▸ Seeding taxonomies & sample artworks…');
  const collection = await prisma.collection.create({
    data: {
      organizationId: org.id,
      name: 'Old Masters',
      label: { en: 'Old Masters', fr: 'Maîtres anciens', it: 'Antichi maestri' },
      color: '#b45309',
      description: {},
    },
  });
  const technique = await prisma.technique.upsert({
    where: { organizationId_name: { organizationId: org.id, name: 'Oil on canvas' } },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Oil on canvas',
      label: { en: 'Oil on canvas', fr: 'Huile sur toile', it: 'Olio su tela' },
    },
  });
  const artist = await prisma.artist.create({
    data: {
      organizationId: org.id,
      fullName: 'Rembrandt van Rijn',
      sortName: 'Rembrandt van Rijn',
      nationality: 'Dutch',
      birthDate: '1606',
      deathDate: '1669',
      biography: {
        en: 'Dutch Golden Age painter and printmaker, a master of light and shadow.',
        fr: 'Peintre et graveur de l’âge d’or néerlandais, maître du clair-obscur.',
      },
      externalIds: {},
    },
  });

  const artworkJsonDefaults = {
    description: {},
    analysis: {},
    notes: {},
    conditionNote: {},
    provenance: {},
    bibliography: {},
    references: {},
    externalLinks: {},
    aiMeta: {},
  };

  const samples: Prisma.ArtworkCreateInput[] = [
    {
      ...artworkJsonDefaults,
      organization: { connect: { id: org.id } },
      inventoryNumber: 'INV-0001',
      title: { en: 'Portrait of a Man', fr: 'Portrait d’un homme' },
      artist: { connect: { id: artist.id } },
      technique: { connect: { id: technique.id } },
      collection: { connect: { id: collection.id } },
      authentication: 'attributed',
      dateText: 'c. 1632',
      yearFrom: 1632,
      heightCm: 92,
      widthCm: 74,
      status: 'active',
      condition: 'good',
      acquisitionMethod: 'purchase',
      dominantColors: ['#2b2118', '#7a5c3e', '#cdb89a'],
      qrSlug: 'demo-inv-0001',
    },
    {
      ...artworkJsonDefaults,
      organization: { connect: { id: org.id } },
      inventoryNumber: 'INV-0002',
      title: { en: 'Still Life with Fruit', fr: 'Nature morte aux fruits' },
      technique: { connect: { id: technique.id } },
      collection: { connect: { id: collection.id } },
      authentication: 'unverified',
      dateText: '17th century',
      yearFrom: 1650,
      heightCm: 60,
      widthCm: 80,
      status: 'in_storage',
      condition: 'fair',
      dominantColors: ['#3a2d1f', '#8a3324', '#c9a227'],
      qrSlug: 'demo-inv-0002',
    },
  ];
  for (const data of samples) {
    await prisma.artwork.upsert({
      where: { organizationId_inventoryNumber: { organizationId: org.id, inventoryNumber: data.inventoryNumber } },
      update: {},
      create: data,
    });
  }

  console.log('✓ Seed complete.');
  console.log('  Demo org:   demo');
  console.log('  Admin:      admin@arterio.app');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
