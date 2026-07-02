import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import type { AccessTokenPayload, AuthUser, RefreshTokenPayload } from '../../common/types';
import type { Env } from '../../core/config/configuration';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async signAccess(user: AuthUser): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const payload: AccessTokenPayload = { ...user, type: 'access' };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn,
    });
    return { token, expiresIn };
  }

  async signRefresh(
    userId: string,
    organizationId: string,
    familyId: string = randomUUID(),
  ): Promise<{ token: string; familyId: string }> {
    const payload: RefreshTokenPayload = {
      sub: userId,
      organizationId,
      familyId,
      type: 'refresh',
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_REFRESH_TTL', { infer: true }),
    });
    return { token, familyId };
  }

  verifyRefresh(token: string): Promise<RefreshTokenPayload> {
    return this.jwt.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
    });
  }

  /** Refresh tokens are stored only as SHA-256 hashes — never in clear. */
  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
