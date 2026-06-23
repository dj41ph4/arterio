import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AuditService } from '../../core/audit/audit.service';
import { EmailService } from '../../core/email/email.service';
import { TokenService } from './token.service';
import type { AuthUser } from '../../common/types';
import type { Env } from '../../core/config/configuration';

const PLACEHOLDER_HASH = 'DEV_PLACEHOLDER_REPLACE_VIA_API';
const RESET_TOKEN_TTL = 1_800; // 30 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly jwt: JwtService,
  ) {}

  /** Loads a user with its effective permission set. */
  private async loadAuthUser(userId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    if (!user) return null;

    const roles = user.userRoles.map((ur) => ur.role.key);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.key)),
      ),
    ];
    return {
      sub: user.id,
      email: user.email,
      organizationId: user.organizationId,
      roles,
      permissions,
    };
  }

  async login(email: string, password: string, meta: { ip?: string; ua?: string }) {
    const user = await this.prisma.user.findFirst({ where: { email } });

    const fail = async (reason: string) => {
      await this.prisma.loginEvent
        .create({ data: { email, success: false, reason, ip: meta.ip, userAgent: meta.ua } })
        .catch(() => undefined);
      if (user) {
        await this.audit.log({
          organizationId: user.organizationId,
          actorId: user.id,
          action: 'auth.login_failed',
          resource: 'user',
          resourceId: user.id,
          metadata: { reason },
          ip: meta.ip,
          userAgent: meta.ua,
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    };

    if (!user || user.status !== 'active') return fail('no_user');

    // Bootstrap: the seed stores a placeholder; the first successful login sets
    // a real Argon2id hash from the supplied password. Documented dev behaviour.
    if (user.passwordHash === PLACEHOLDER_HASH) {
      const hashed = await this.crypto.hashPassword(password);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashed } });
      this.logger.warn(`Bootstrapped password for ${user.email}`);
    } else if (!user.passwordHash || !(await this.crypto.verifyPassword(user.passwordHash, password))) {
      return fail('bad_password');
    }

    const authUser = await this.loadAuthUser(user.id);
    if (!authUser) return fail('load_failed');

    const tokens = await this.issueTokens(authUser, meta);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.prisma.loginEvent
      .create({ data: { userId: user.id, email, success: true, ip: meta.ip, userAgent: meta.ua } })
      .catch(() => undefined);
    await this.audit.log({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'auth.login_success',
      resource: 'user',
      resourceId: user.id,
      ip: meta.ip,
      userAgent: meta.ua,
    });
    return tokens;
  }

  /** Issues a token pair for an already-verified user — used by the OAuth callback. */
  async issueTokensForUser(userId: string, meta: { ip?: string; ua?: string }) {
    const authUser = await this.loadAuthUser(userId);
    if (!authUser) throw new UnauthorizedException('User not found');
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(authUser, meta);
  }

  get emailConfigured(): boolean {
    return this.email.isConfigured;
  }

  /**
   * Always returns { ok: true } whether or not the email exists or SMTP is
   * configured — never reveals which emails are registered. Silently no-ops
   * (logged server-side) when there's no outbound email infra; an admin can
   * always fall back to MembersService.resetPassword.
   */
  async forgotPassword(email: string): Promise<{ ok: true }> {
    if (!this.email.isConfigured) return { ok: true };
    const user = await this.prisma.user.findFirst({ where: { email, status: 'active' } });
    if (!user) return { ok: true };

    const token = await this.jwt.signAsync(
      { sub: user.id, type: 'password_reset' },
      { secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }), expiresIn: RESET_TOKEN_TTL },
    );
    const link = `${this.config.get('APP_URL', { infer: true })}/auth/reset-password?token=${token}`;
    await this.email.send(
      user.email,
      'Réinitialisation de votre mot de passe Arterio',
      `<p>Bonjour ${user.fullName},</p><p>Cliquez sur ce lien pour choisir un nouveau mot de passe (valable 30 minutes) :</p><p><a href="${link}">${link}</a></p><p>Si vous n'avez pas demandé cette réinitialisation, ignorez cet e-mail.</p>`,
    );
    return { ok: true };
  }

  async resetPassword(token: string, password: string): Promise<{ ok: true }> {
    let payload: { sub: string; type: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }) });
    } catch {
      throw new BadRequestException('Invalid or expired reset link');
    }
    if (payload.type !== 'password_reset') throw new BadRequestException('Invalid reset token');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new BadRequestException('Invalid reset link');

    const passwordHash = await this.crypto.hashPassword(password);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'auth.password_reset_self_service',
      resource: 'user',
      resourceId: user.id,
    });
    return { ok: true };
  }

  async refresh(refreshToken: string, meta: { ip?: string; ua?: string }) {
    let payload;
    try {
      payload = await this.tokens.verifyRefresh(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const tokenHash = this.tokens.hash(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    // Reuse detection: token valid but already rotated/revoked → kill the family.
    if (!record || record.revokedAt) {
      if (record) {
        await this.prisma.refreshToken.updateMany({
          where: { familyId: record.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    const authUser = await this.loadAuthUser(payload.sub);
    if (!authUser) throw new UnauthorizedException('User no longer exists');
    return this.issueTokens(authUser, meta, record.familyId);
  }

  async logout(refreshToken: string) {
    const tokenHash = this.tokens.hash(refreshToken);
    await this.prisma.refreshToken
      .updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }

  private async issueTokens(
    user: AuthUser,
    meta: { ip?: string; ua?: string },
    familyId?: string,
  ) {
    const access = await this.tokens.signAccess(user);
    const refresh = await this.tokens.signRefresh(user.sub, user.organizationId, familyId);

    const ttl = this.config.get('JWT_REFRESH_TTL', { infer: true });
    await this.prisma.refreshToken
      .create({
        data: {
          userId: user.sub,
          tokenHash: this.tokens.hash(refresh.token),
          familyId: refresh.familyId,
          expiresAt: new Date(Date.now() + ttl * 1000),
          ip: meta.ip,
          userAgent: meta.ua,
        },
      })
      .catch((e: unknown) => this.logger.warn(`Could not persist refresh token: ${String(e)}`));

    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.expiresIn,
    };
  }
}
