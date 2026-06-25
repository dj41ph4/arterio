import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedRbac } from '@arterio/database';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { UPLOAD_DIR } from '../../core/config/paths';
import type { AuthUser } from '../../common/types';

/**
 * Full portable export/import — everything needed to move an installation to
 * a different server without losing data: every collection-management table
 * scoped to the organization, plus the actual media/document files (not just
 * their DB rows). Deliberately excludes server-local operational data that
 * means nothing on a different machine: API keys, webhooks, audit logs,
 * sessions/refresh tokens, login events, notifications, saved views,
 * workflow run history — all regenerate naturally on the new install.
 *
 * Financial values are decrypted for export (the zip file itself is the
 * secret artifact now — store it like one) and re-encrypted with whatever
 * DATA_ENCRYPTION_KEY is active on import, since that key is per-install and
 * never travels with the export.
 */
@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async exportMigration(user: AuthUser, res: Response): Promise<void> {
    const orgId = user.organizationId;
    const p = this.prisma;

    const [
      organization,
      users,
      userRoles,
      artists,
      movements,
      collections,
      categories,
      techniques,
      supports,
      tags,
      artworks,
      artworkTags,
      valuations,
      media,
      locations,
      movementRecords,
      documents,
      documentVersions,
      documentSignatures,
      loans,
      loanItems,
      transports,
      insurancePolicies,
      exhibitions,
      exhibitionArtworks,
      restorations,
    ] = await Promise.all([
      p.organization.findUniqueOrThrow({ where: { id: orgId } }),
      p.user.findMany({ where: { organizationId: orgId } }),
      p.userRole.findMany({ where: { user: { organizationId: orgId } }, include: { role: true } }),
      p.artist.findMany({ where: { organizationId: orgId } }),
      p.artMovement.findMany({ where: { organizationId: orgId } }),
      p.collection.findMany({ where: { organizationId: orgId } }),
      p.category.findMany({ where: { organizationId: orgId } }),
      p.technique.findMany({ where: { organizationId: orgId } }),
      p.support.findMany({ where: { organizationId: orgId } }),
      p.tag.findMany({ where: { organizationId: orgId } }),
      p.artwork.findMany({ where: { organizationId: orgId } }),
      p.artworkTag.findMany({ where: { artwork: { organizationId: orgId } } }),
      p.artworkValuation.findMany({ where: { artwork: { organizationId: orgId } } }),
      p.mediaAsset.findMany({ where: { organizationId: orgId } }),
      p.location.findMany({ where: { organizationId: orgId } }),
      p.movementRecord.findMany({ where: { artwork: { organizationId: orgId } } }),
      p.document.findMany({ where: { organizationId: orgId } }),
      p.documentVersion.findMany({ where: { document: { organizationId: orgId } } }),
      p.documentSignature.findMany({ where: { document: { organizationId: orgId } } }),
      p.loan.findMany({ where: { organizationId: orgId } }),
      p.loanItem.findMany({ where: { loan: { organizationId: orgId } } }),
      p.transport.findMany({ where: { loan: { organizationId: orgId } } }),
      p.insurancePolicy.findMany({ where: { loan: { organizationId: orgId } } }),
      p.exhibition.findMany({ where: { organizationId: orgId } }),
      p.exhibitionArtwork.findMany({ where: { exhibition: { organizationId: orgId } } }),
      p.restoration.findMany({ where: { organizationId: orgId } }),
    ]);

    const data = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      organization: {
        name: organization.name,
        legalName: organization.legalName,
        defaultLocale: organization.defaultLocale,
        settings: organization.settings,
      },
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        emailVerified: u.emailVerified,
        passwordHash: u.passwordHash,
        fullName: u.fullName,
        displayName: u.displayName,
        locale: u.locale,
        status: u.status,
        mfaEnabled: u.mfaEnabled,
        roleKeys: userRoles.filter((ur) => ur.userId === u.id).map((ur) => ur.role.key),
      })),
      artists,
      movements,
      collections,
      categories,
      techniques,
      supports,
      tags,
      artworks,
      artworkTags,
      valuations: valuations.map((v) => ({
        artworkId: v.artworkId,
        currency: v.currency,
        purchasePrice: this.crypto.decryptNumber(v.purchasePriceEnc),
        currentValue: this.crypto.decryptNumber(v.currentValueEnc),
        insuranceValue: this.crypto.decryptNumber(v.insuranceValueEnc),
        valuationDate: v.valuationDate,
        valuationSource: v.valuationSource,
      })),
      media,
      locations,
      movementRecords,
      documents,
      documentVersions,
      documentSignatures,
      loans,
      loanItems,
      transports,
      insurancePolicies: insurancePolicies.map((ip) => ({
        ...ip,
        coverage: this.crypto.decryptNumber(ip.coverageEnc),
        coverageEnc: undefined,
      })),
      exhibitions,
      exhibitionArtworks,
      restorations: restorations.map((r) => ({
        ...r,
        cost: this.crypto.decryptNumber(r.costEnc),
        costEnc: undefined,
      })),
    };

    res.setHeader('Content-Type', 'application/zip');
    const filename = `arterio-migration-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err: Error) => this.logger.warn(`Archive warning: ${err.message}`));
    archive.on('error', (err: Error) => {
      this.logger.error(`Archive error: ${err.message}`);
      res.destroy(err);
    });
    archive.pipe(res);

    archive.append(JSON.stringify(data, null, 2), { name: 'data.json' });

    for (const asset of media) {
      const filePath = join(UPLOAD_DIR, asset.storageKey);
      if (existsSync(filePath)) archive.file(filePath, { name: `files/${asset.storageKey}` });
      else this.logger.warn(`Media file missing on disk, skipped: ${asset.storageKey}`);
    }
    for (const version of documentVersions) {
      const filePath = join(UPLOAD_DIR, version.storageKey);
      if (existsSync(filePath)) archive.file(filePath, { name: `files/${version.storageKey}` });
      else this.logger.warn(`Document file missing on disk, skipped: ${version.storageKey}`);
    }

    await archive.finalize();
  }

  /** Always creates a brand-new organization from the archive — never merges into an existing one. */
  async importMigration(zipPath: string): Promise<{ organizationId: string; organizationName: string }> {
    const zip = new AdmZip(zipPath);
    const dataEntry = zip.getEntry('data.json');
    if (!dataEntry) throw new Error('Invalid migration file: data.json not found');
    const data = JSON.parse(zip.readAsText(dataEntry));

    mkdirSync(UPLOAD_DIR, { recursive: true });

    // Every id from the export is remapped to a fresh one on insert — never
    // trust that an id is free on the target. This is what makes it safe to
    // import the same file twice, or into a database that already has data
    // (its own data, or a previous import), without ever colliding.
    const ids = {
      user: new Map<string, string>(),
      movement: new Map<string, string>(),
      collection: new Map<string, string>(),
      category: new Map<string, string>(),
      technique: new Map<string, string>(),
      support: new Map<string, string>(),
      tag: new Map<string, string>(),
      artist: new Map<string, string>(),
      artwork: new Map<string, string>(),
      location: new Map<string, string>(),
      media: new Map<string, string>(),
      document: new Map<string, string>(),
      loan: new Map<string, string>(),
      exhibition: new Map<string, string>(),
    };
    const remap = (map: Map<string, string>, oldId: string | null | undefined) =>
      oldId == null ? oldId : map.get(oldId);

    const organizationId = await this.prisma.$transaction(
      async (tx) => {
        const slug = `${this.slugify(data.organization.name)}-${Math.random().toString(36).slice(2, 8)}`;
        const organization = await tx.organization.create({
          data: {
            slug,
            name: data.organization.name,
            legalName: data.organization.legalName,
            defaultLocale: data.organization.defaultLocale ?? 'en',
            settings: data.organization.settings ?? {},
          },
        });

        await seedRbac(tx as never, organization.id);
        const roles = await tx.role.findMany({ where: { organizationId: organization.id } });
        const roleByKey = new Map(roles.map((r) => [r.key, r.id]));

        for (const u of data.users) {
          const created = await tx.user.create({
            data: {
              organizationId: organization.id,
              email: u.email,
              emailVerified: u.emailVerified,
              passwordHash: u.passwordHash,
              fullName: u.fullName,
              displayName: u.displayName,
              locale: u.locale,
              status: u.status,
              mfaEnabled: u.mfaEnabled,
            },
          });
          ids.user.set(u.id, created.id);
          await tx.membership.create({
            data: { organizationId: organization.id, userId: created.id, status: 'active' },
          });
          for (const key of u.roleKeys as string[]) {
            const roleId = roleByKey.get(key);
            if (roleId) await tx.userRole.create({ data: { userId: created.id, roleId } });
          }
        }

        for (const m of data.movements) {
          const created = await tx.artMovement.create({
            data: { organizationId: organization.id, name: m.name, label: m.label },
          });
          ids.movement.set(m.id, created.id);
        }
        for (const c of data.collections) {
          const created = await tx.collection.create({
            data: {
              organizationId: organization.id,
              name: c.name,
              label: c.label,
              description: c.description,
              color: c.color,
            },
          });
          ids.collection.set(c.id, created.id);
        }
        for (const c of data.collections) {
          if (c.parentId) {
            await tx.collection.update({
              where: { id: ids.collection.get(c.id) },
              data: { parentId: remap(ids.collection, c.parentId) },
            });
          }
        }
        for (const c of data.categories) {
          const created = await tx.category.create({
            data: { organizationId: organization.id, name: c.name, label: c.label, color: c.color },
          });
          ids.category.set(c.id, created.id);
        }
        for (const t of data.techniques) {
          const created = await tx.technique.create({
            data: { organizationId: organization.id, name: t.name, label: t.label },
          });
          ids.technique.set(t.id, created.id);
        }
        for (const s of data.supports) {
          const created = await tx.support.create({
            data: { organizationId: organization.id, name: s.name, label: s.label },
          });
          ids.support.set(s.id, created.id);
        }
        for (const t of data.tags) {
          const created = await tx.tag.create({
            data: { organizationId: organization.id, name: t.name, color: t.color, aiGenerated: t.aiGenerated },
          });
          ids.tag.set(t.id, created.id);
        }
        for (const a of data.artists) {
          const created = await tx.artist.create({
            data: {
              organizationId: organization.id,
              fullName: a.fullName,
              sortName: a.sortName,
              nationality: a.nationality,
              birthDate: a.birthDate,
              deathDate: a.deathDate,
              biography: a.biography,
              movementId: remap(ids.movement, a.movementId),
              externalIds: a.externalIds,
              thumbnail: a.thumbnail,
              notableWorks: a.notableWorks,
              influencedBy: a.influencedBy,
            },
          });
          ids.artist.set(a.id, created.id);
        }
        for (const a of data.artworks) {
          const created = await tx.artwork.create({
            data: {
              organizationId: organization.id,
              inventoryNumber: a.inventoryNumber,
              accessionNumber: a.accessionNumber,
              title: a.title,
              description: a.description,
              analysis: a.analysis,
              notes: a.notes,
              artistId: remap(ids.artist, a.artistId),
              attribution: a.attribution,
              authentication: a.authentication,
              signature: a.signature,
              signatureDescription: a.signatureDescription,
              movementId: remap(ids.movement, a.movementId),
              categoryId: remap(ids.category, a.categoryId),
              techniqueId: remap(ids.technique, a.techniqueId),
              supportId: remap(ids.support, a.supportId),
              dateText: a.dateText,
              yearFrom: a.yearFrom,
              yearTo: a.yearTo,
              heightCm: a.heightCm,
              widthCm: a.widthCm,
              depthCm: a.depthCm,
              weightKg: a.weightKg,
              dimensionsNote: a.dimensionsNote,
              framed: a.framed,
              frameNote: a.frameNote,
              dominantColors: a.dominantColors,
              status: a.status,
              condition: a.condition,
              conditionNote: a.conditionNote,
              acquisitionMethod: a.acquisitionMethod,
              acquisitionDate: a.acquisitionDate,
              paymentMethod: a.paymentMethod,
              ownerName: a.ownerName,
              collectionId: remap(ids.collection, a.collectionId),
              hasCertificate: a.hasCertificate,
              hasInvoice: a.hasInvoice,
              barcode: a.barcode,
              rfidTag: a.rfidTag,
              nfcTag: a.nfcTag,
              provenance: a.provenance,
              bibliography: a.bibliography,
              references: a.references,
              externalLinks: a.externalLinks,
              aiMeta: a.aiMeta,
              isFavorite: a.isFavorite,
            },
          });
          ids.artwork.set(a.id, created.id);
        }
        for (const at of data.artworkTags) {
          const artworkId = remap(ids.artwork, at.artworkId);
          const tagId = remap(ids.tag, at.tagId);
          if (artworkId && tagId) await tx.artworkTag.create({ data: { artworkId, tagId } });
        }
        for (const v of data.valuations) {
          const artworkId = remap(ids.artwork, v.artworkId);
          if (!artworkId) continue;
          await tx.artworkValuation.create({
            data: {
              artworkId,
              currency: v.currency,
              purchasePriceEnc: this.crypto.encryptNumber(v.purchasePrice),
              currentValueEnc: this.crypto.encryptNumber(v.currentValue),
              insuranceValueEnc: this.crypto.encryptNumber(v.insuranceValue),
              valuationDate: v.valuationDate,
              valuationSource: v.valuationSource,
            },
          });
        }
        for (const l of data.locations) {
          const created = await tx.location.create({
            data: {
              organizationId: organization.id,
              kind: l.kind,
              name: l.name,
              code: l.code,
              mapMeta: l.mapMeta,
            },
          });
          ids.location.set(l.id, created.id);
        }
        for (const l of data.locations) {
          if (l.parentId) {
            await tx.location.update({
              where: { id: ids.location.get(l.id) },
              data: { parentId: remap(ids.location, l.parentId) },
            });
          }
        }
        for (const m of data.media) {
          const artworkId = remap(ids.artwork, m.artworkId);
          const created = await tx.mediaAsset.create({
            data: {
              organizationId: organization.id,
              artworkId,
              type: m.type,
              role: m.role,
              storageKey: m.storageKey,
              derivatives: m.derivatives,
              fileName: m.fileName,
              mimeType: m.mimeType,
              sizeBytes: m.sizeBytes,
              width: m.width,
              height: m.height,
              checksum: m.checksum,
              exif: m.exif,
              phash: m.phash,
              caption: m.caption,
              sortOrder: m.sortOrder,
              encrypted: m.encrypted,
            },
          });
          ids.media.set(m.id, created.id);
        }
        for (const mr of data.movementRecords) {
          const artworkId = remap(ids.artwork, mr.artworkId);
          if (!artworkId) continue;
          await tx.movementRecord.create({
            data: {
              artworkId,
              fromId: remap(ids.location, mr.fromId),
              toId: remap(ids.location, mr.toId),
              reason: mr.reason,
              movedById: null, // the moving user's id from the old install means nothing here
              movedAt: mr.movedAt,
            },
          });
        }
        for (const d of data.documents) {
          const created = await tx.document.create({
            data: {
              organizationId: organization.id,
              artworkId: remap(ids.artwork, d.artworkId),
              type: d.type,
              title: d.title,
              ocrText: d.ocrText,
              encrypted: d.encrypted,
            },
          });
          ids.document.set(d.id, created.id);
        }
        for (const v of data.documentVersions) {
          const documentId = remap(ids.document, v.documentId);
          if (!documentId) continue;
          await tx.documentVersion.create({
            data: {
              documentId,
              version: v.version,
              storageKey: v.storageKey,
              mimeType: v.mimeType,
              sizeBytes: v.sizeBytes,
              checksum: v.checksum,
              note: v.note,
              createdById: null,
            },
          });
        }
        for (const s of data.documentSignatures) {
          const documentId = remap(ids.document, s.documentId);
          const signerId = remap(ids.user, s.signerId);
          if (documentId && signerId) {
            await tx.documentSignature.create({
              data: {
                documentId,
                signerId,
                signature: s.signature,
                digest: s.digest,
                reason: s.reason,
                signedAt: s.signedAt,
              },
            });
          }
        }
        for (const l of data.loans) {
          const created = await tx.loan.create({
            data: {
              organizationId: organization.id,
              reference: l.reference,
              direction: l.direction,
              status: l.status,
              counterparty: l.counterparty,
              contactInfo: l.contactInfo,
              startDate: l.startDate,
              endDate: l.endDate,
              returnedAt: l.returnedAt,
              conditions: l.conditions,
            },
          });
          ids.loan.set(l.id, created.id);
        }
        for (const li of data.loanItems) {
          const loanId = remap(ids.loan, li.loanId);
          const artworkId = remap(ids.artwork, li.artworkId);
          if (loanId && artworkId) {
            await tx.loanItem.create({
              data: { loanId, artworkId, conditionOut: li.conditionOut, conditionIn: li.conditionIn },
            });
          }
        }
        for (const t of data.transports) {
          await tx.transport.create({
            data: {
              loanId: remap(ids.loan, t.loanId),
              carrier: t.carrier,
              method: t.method,
              trackingNumber: t.trackingNumber,
              departureAt: t.departureAt,
              arrivalAt: t.arrivalAt,
              cost: t.cost,
              currency: t.currency,
              notes: t.notes,
            },
          });
        }
        for (const ip of data.insurancePolicies) {
          await tx.insurancePolicy.create({
            data: {
              loanId: remap(ids.loan, ip.loanId),
              insurer: ip.insurer,
              policyNumber: ip.policyNumber,
              coverageEnc: this.crypto.encryptNumber(ip.coverage),
              currency: ip.currency,
              startDate: ip.startDate,
              endDate: ip.endDate,
              notes: ip.notes,
            },
          });
        }
        for (const e of data.exhibitions) {
          const created = await tx.exhibition.create({
            data: {
              organizationId: organization.id,
              title: e.title,
              kind: e.kind,
              status: e.status,
              description: e.description,
              venue: e.venue,
              startDate: e.startDate,
              endDate: e.endDate,
              curator: e.curator,
            },
          });
          ids.exhibition.set(e.id, created.id);
        }
        for (const ea of data.exhibitionArtworks) {
          const exhibitionId = remap(ids.exhibition, ea.exhibitionId);
          const artworkId = remap(ids.artwork, ea.artworkId);
          if (exhibitionId && artworkId) {
            await tx.exhibitionArtwork.create({
              data: { exhibitionId, artworkId, wallLabel: ea.wallLabel, sortOrder: ea.sortOrder },
            });
          }
        }
        for (const r of data.restorations) {
          const artworkId = remap(ids.artwork, r.artworkId);
          if (!artworkId) continue;
          await tx.restoration.create({
            data: {
              organizationId: organization.id,
              artworkId,
              status: r.status,
              title: r.title,
              diagnosis: r.diagnosis,
              treatment: r.treatment,
              conservator: r.conservator,
              costEnc: this.crypto.encryptNumber(r.cost),
              currency: r.currency,
              startDate: r.startDate,
              endDate: r.endDate,
              beforeMediaIds: r.beforeMediaIds,
              afterMediaIds: r.afterMediaIds,
            },
          });
        }

        return organization.id;
      },
      { timeout: 120_000 },
    );

    // Files last, outside the DB transaction — write them straight into the
    // upload directory under their original storage key (a random filename,
    // not a database id, so it never collides), so the freshly-inserted
    // MediaAsset/DocumentVersion rows resolve to the right bytes.
    for (const entry of zip.getEntries()) {
      if (!entry.entryName.startsWith('files/') || entry.isDirectory) continue;
      const storageKey = entry.entryName.slice('files/'.length);
      writeFileSync(join(UPLOAD_DIR, storageKey), entry.getData());
    }

    return { organizationId, organizationName: data.organization.name };
  }

  private slugify(value: string): string {
    return (
      value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'org'
    );
  }
}
