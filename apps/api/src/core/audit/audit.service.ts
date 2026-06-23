import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  organizationId: string;
  actorId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * Append-only, hash-chained audit trail (hash = H(prevHash || canonical(payload))).
 * Each row commits to the previous row's hash, so any retroactive edit or
 * deletion of a row breaks the chain for every row after it — tampering is
 * detectable, not just logged. Never throws: a logging failure must never
 * block the action it's recording.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      const last = await this.prisma.auditLog.findFirst({
        where: { organizationId: entry.organizationId },
        orderBy: { createdAt: 'desc' },
        select: { hash: true },
      });
      const prevHash = last?.hash ?? null;
      const metadata = entry.metadata ?? {};
      const canonical = JSON.stringify({
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId ?? null,
        actorId: entry.actorId ?? null,
        metadata,
      });
      const hash = createHash('sha256').update(`${prevHash ?? ''}${canonical}`).digest('hex');

      await this.prisma.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          actorId: entry.actorId ?? null,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId ?? null,
          metadata: metadata as never,
          ip: entry.ip,
          userAgent: entry.userAgent,
          prevHash,
          hash,
        },
      });
    } catch (err) {
      this.logger.warn(`Audit log write failed for ${entry.action}: ${String(err)}`);
    }
  }

  /** Recomputes the chain and reports the first broken link, if any — used to prove the log hasn't been tampered with. */
  async verifyChain(organizationId: string): Promise<{ ok: boolean; brokenAt?: string }> {
    const rows = await this.prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
    let prevHash: string | null = null;
    for (const row of rows) {
      const canonical = JSON.stringify({
        action: row.action,
        resource: row.resource,
        resourceId: row.resourceId,
        actorId: row.actorId,
        metadata: row.metadata,
      });
      const expected: string = createHash('sha256').update(`${prevHash ?? ''}${canonical}`).digest('hex');
      if (expected !== row.hash) return { ok: false, brokenAt: row.id };
      prevHash = row.hash;
    }
    return { ok: true };
  }
}
