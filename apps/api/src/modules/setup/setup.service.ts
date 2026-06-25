import { ConflictException, Injectable } from '@nestjs/common';
import { seedRbac } from '@arterio/database';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { TokenService } from '../auth/token.service';
import type { CompleteSetupDto } from './dto';
import type { AuthUser } from '../../common/types';

@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
  ) {}

  /** True once at least one organization exists — the app is no longer "fresh". */
  async needsSetup(): Promise<boolean> {
    const count = await this.prisma.organization.count();
    return count === 0;
  }

  /**
   * Creates the first organization + admin account. Only ever runs once:
   * guarded by needsSetup() at the controller level, and re-checked here
   * inside the same call to close the race between two concurrent requests.
   */
  async complete(dto: CompleteSetupDto, meta: { ip?: string; ua?: string }) {
    if (!(await this.needsSetup())) {
      throw new ConflictException('Setup has already been completed');
    }

    const slug = this.slugify(dto.organizationName) || 'default';
    const passwordHash = await this.crypto.hashPassword(dto.password);

    const { organization, user } = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          slug,
          name: dto.organizationName,
          defaultLocale: 'en',
          settings: { accentColor: '#6366f1', theme: 'system' },
        },
      });

      await seedRbac(tx as never, organization.id);

      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: dto.email,
          emailVerified: new Date(),
          passwordHash,
          fullName: dto.fullName,
          displayName: dto.fullName.split(' ')[0],
          locale: 'en',
          status: 'active',
        },
      });
      await tx.membership.create({
        data: { organizationId: organization.id, userId: user.id, status: 'active' },
      });
      const adminRole = await tx.role.findUniqueOrThrow({
        where: { organizationId_key: { organizationId: organization.id, key: 'admin' } },
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });

      return { organization, user };
    });

    // Auto-login: the operator lands straight in the app instead of re-typing
    // the password they just chose. Permissions must be baked into the access
    // token now (the JWT payload is the source of truth read by every guard).
    const adminRoleWithPerms = await this.prisma.role.findUniqueOrThrow({
      where: { organizationId_key: { organizationId: organization.id, key: 'admin' } },
      include: { permissions: { include: { permission: true } } },
    });
    const authUser: AuthUser = {
      sub: user.id,
      email: user.email,
      organizationId: organization.id,
      roles: ['admin'],
      permissions: adminRoleWithPerms.permissions.map((rp) => rp.permission.key),
    };
    const access = await this.tokens.signAccess(authUser);
    const refresh = await this.tokens.signRefresh(user.id, organization.id);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.tokens.hash(refresh.token),
        familyId: refresh.familyId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        ip: meta.ip,
        userAgent: meta.ua,
      },
    });

    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.expiresIn,
    };
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
