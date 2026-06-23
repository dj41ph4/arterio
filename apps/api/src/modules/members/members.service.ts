import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import type { AuthUser } from '../../common/types';
import type { InviteMemberDto, UpdateMemberDto } from './dto';

const PLACEHOLDER_HASH = 'DEV_PLACEHOLDER_REPLACE_VIA_API';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: user.organizationId },
      include: {
        userRoles: { include: { role: true } },
        memberships: { where: { organizationId: user.organizationId } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      displayName: u.displayName,
      status: u.memberships[0]?.status ?? u.status,
      lastLoginAt: u.lastLoginAt,
      mfaEnabled: u.mfaEnabled,
      createdAt: u.createdAt,
      roles: u.userRoles.map((ur) => ({ id: ur.role.id, key: ur.role.key, name: ur.role.name })),
    }));
  }

  async listRoles(user: AuthUser) {
    return this.prisma.role.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, key: true, name: true, description: true },
    });
  }

  /**
   * Creates the member directly (no outbound-email infra in this environment) —
   * same bootstrap pattern as the seeded admin: a placeholder hash that becomes
   * a real Argon2id hash on the member's first successful login.
   */
  async invite(user: AuthUser, dto: InviteMemberDto) {
    const existing = await this.prisma.user.findFirst({
      where: { organizationId: user.organizationId, email: dto.email },
    });
    if (existing) throw new ConflictException('A member with this email already exists');

    const role = await this.prisma.role.findUnique({
      where: { organizationId_key: { organizationId: user.organizationId, key: dto.roleKey } },
    });
    if (!role) throw new BadRequestException(`Unknown role "${dto.roleKey}"`);

    const created = await this.prisma.user.create({
      data: {
        organizationId: user.organizationId,
        email: dto.email,
        fullName: dto.fullName,
        passwordHash: PLACEHOLDER_HASH,
        status: 'invited',
        memberships: { create: { organizationId: user.organizationId, status: 'invited' } },
        userRoles: { create: { roleId: role.id } },
      },
      include: { userRoles: { include: { role: true } } },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorId: user.sub,
      action: 'member.invite',
      resource: 'user',
      resourceId: created.id,
      metadata: { email: dto.email, roleKey: dto.roleKey },
    });

    return {
      id: created.id,
      email: created.email,
      fullName: created.fullName,
      status: 'invited' as const,
      roles: created.userRoles.map((ur) => ({ id: ur.role.id, key: ur.role.key, name: ur.role.name })),
    };
  }

  async update(user: AuthUser, id: string, dto: UpdateMemberDto) {
    const target = await this.prisma.user.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!target) throw new NotFoundException('Member not found');

    if (dto.roleKey) {
      const role = await this.prisma.role.findUnique({
        where: { organizationId_key: { organizationId: user.organizationId, key: dto.roleKey } },
      });
      if (!role) throw new BadRequestException(`Unknown role "${dto.roleKey}"`);
      await this.prisma.userRole.deleteMany({ where: { userId: id } });
      await this.prisma.userRole.create({ data: { userId: id, roleId: role.id } });
    }

    if (dto.status) {
      await this.prisma.user.update({ where: { id }, data: { status: dto.status } });
      await this.prisma.membership.updateMany({
        where: { userId: id, organizationId: user.organizationId },
        data: { status: dto.status },
      });
    }

    await this.audit.log({
      organizationId: user.organizationId,
      actorId: user.sub,
      action: 'member.update',
      resource: 'user',
      resourceId: id,
      metadata: { roleKey: dto.roleKey, status: dto.status },
    });

    return { ok: true };
  }

  /** Soft-removes: disables the account rather than deleting history. */
  async remove(user: AuthUser, id: string) {
    if (id === user.sub) throw new BadRequestException('You cannot remove yourself');
    const target = await this.prisma.user.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!target) throw new NotFoundException('Member not found');

    await this.prisma.user.update({ where: { id }, data: { status: 'disabled' } });
    await this.prisma.membership.updateMany({
      where: { userId: id, organizationId: user.organizationId },
      data: { status: 'disabled' },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorId: user.sub,
      action: 'member.remove',
      resource: 'user',
      resourceId: id,
      metadata: { email: target.email },
    });

    return { ok: true };
  }

  /**
   * Admin-triggered password reset — there's no outbound-email infra to
   * support a self-service "forgot password" flow, so an administrator resets
   * the member back to the placeholder hash; their next login bootstraps a
   * fresh password from whatever they type, exactly like a brand-new invite.
   * All of the member's active sessions are revoked immediately.
   */
  async resetPassword(user: AuthUser, id: string) {
    const target = await this.prisma.user.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!target) throw new NotFoundException('Member not found');

    await this.prisma.user.update({ where: { id }, data: { passwordHash: PLACEHOLDER_HASH } });
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorId: user.sub,
      action: 'member.reset_password',
      resource: 'user',
      resourceId: id,
      metadata: { email: target.email },
    });

    return { ok: true };
  }
}
