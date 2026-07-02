import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AuthService } from './auth.service';
import type { Env } from '../../core/config/configuration';

export const OAUTH_PROVIDERS = ['google', 'microsoft'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

interface ProviderDef {
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scope: string;
}

const PROVIDER_DEFS: Record<OAuthProvider, ProviderDef> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scope: 'openid email profile',
  },
};

interface OAuthStatePayload {
  provider: OAuthProvider;
  redirectUri: string;
  returnOrigin: string;
  locale: string;
}

interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Manual OAuth2 authorization-code flow for Google/Microsoft sign-in — no
 * Passport dependency, no server-side session store (the appliance has no
 * Redis). CSRF/replay protection comes from a short-lived signed JWT used as
 * the `state` param instead of a server-side session.
 *
 * This is a single-tenant-per-install appliance (one Organization per setup),
 * so provider credentials are looked up from the one organization that
 * exists rather than from request auth — the login page calling these routes
 * has no session yet.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly auth: AuthService,
  ) {}

  /** Which providers are configured — used by the login page to decide which buttons to show. */
  async availableProviders(): Promise<Record<OAuthProvider, boolean>> {
    const org = await this.prisma.organization.findFirst();
    const settings = (org?.settings as Record<string, unknown>) ?? {};
    const oauth = (settings.oauth as Record<string, { clientId?: string }>) ?? {};
    return Object.fromEntries(
      OAUTH_PROVIDERS.map((p) => [p, Boolean(oauth[p]?.clientId)]),
    ) as Record<OAuthProvider, boolean>;
  }

  private async credentials(provider: OAuthProvider): Promise<ProviderCredentials | null> {
    const org = await this.prisma.organization.findFirst();
    const settings = (org?.settings as Record<string, unknown>) ?? {};
    const oauth = (settings.oauth as Record<string, { clientId?: string; clientSecretEnc?: string }>) ?? {};
    const entry = oauth[provider];
    if (!entry?.clientId || !entry?.clientSecretEnc) return null;
    return { clientId: entry.clientId, clientSecret: this.crypto.decrypt(entry.clientSecretEnc) };
  }

  /** Builds the provider's authorize URL and the signed `state` to redirect the browser to. */
  async buildAuthorizeUrl(
    provider: OAuthProvider,
    redirectUri: string,
    returnOrigin: string,
    locale: string,
  ): Promise<string> {
    const creds = await this.credentials(provider);
    if (!creds) throw new BadRequestException(`OAuth provider "${provider}" is not configured`);

    const def = PROVIDER_DEFS[provider];
    const statePayload: OAuthStatePayload = { provider, redirectUri, returnOrigin, locale };
    const state = await this.jwt.signAsync(statePayload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: 600, // 10 minutes — just long enough for the provider round-trip
    });

    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: def.scope,
      state,
      access_type: 'offline',
      prompt: 'select_account',
    });
    return `${def.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Verifies the state, exchanges the code, fetches the provider's userinfo,
   * finds-or-links the matching local user (never auto-creates one — only
   * existing invited members can sign in this way), and issues app tokens.
   */
  async handleCallback(
    provider: OAuthProvider,
    code: string,
    state: string,
    meta: { ip?: string; ua?: string },
  ): Promise<{ returnOrigin: string; locale: string; result: { accessToken: string; refreshToken: string; expiresIn: number } | { error: string } }> {
    let payload: OAuthStatePayload;
    try {
      payload = await this.jwt.verifyAsync<OAuthStatePayload>(state, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }
    if (payload.provider !== provider) throw new UnauthorizedException('Provider mismatch');

    const { returnOrigin, locale } = payload;
    const creds = await this.credentials(provider);
    if (!creds) return { returnOrigin, locale, result: { error: 'not_configured' } };

    try {
      const def = PROVIDER_DEFS[provider];
      const tokenRes = await fetch(def.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          redirect_uri: payload.redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) {
        this.logger.warn(`OAuth token exchange failed for ${provider}: ${await tokenRes.text()}`);
        return { returnOrigin, locale, result: { error: 'token_exchange_failed' } };
      }
      const tokenJson = (await tokenRes.json()) as { access_token?: string };
      if (!tokenJson.access_token) return { returnOrigin, locale, result: { error: 'token_exchange_failed' } };

      const userinfoRes = await fetch(def.userinfoUrl, {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (!userinfoRes.ok) return { returnOrigin, locale, result: { error: 'userinfo_failed' } };
      const profile = (await userinfoRes.json()) as { sub?: string; oid?: string; email?: string };
      const providerUserId = profile.sub ?? profile.oid;
      const email = profile.email?.toLowerCase();
      if (!providerUserId || !email) return { returnOrigin, locale, result: { error: 'userinfo_failed' } };

      const userId = await this.findOrLinkUser(provider, providerUserId, email);
      if (!userId) return { returnOrigin, locale, result: { error: 'no_account' } };

      const tokens = await this.auth.issueTokensForUser(userId, meta);
      return { returnOrigin, locale, result: tokens };
    } catch (err) {
      this.logger.error(`OAuth callback failed for ${provider}: ${String(err)}`);
      return { returnOrigin, locale, result: { error: 'unexpected_error' } };
    }
  }

  /**
   * Returns the local user id to log in, or null if no account matches.
   * Never creates a new user — membership is invite-based; OAuth only links
   * an existing account the first time the matching email signs in.
   */
  private async findOrLinkUser(provider: OAuthProvider, providerUserId: string, email: string): Promise<string | null> {
    const linked = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
    });
    if (linked) return linked.userId;

    const user = await this.prisma.user.findFirst({ where: { email, status: 'active' } });
    if (!user) return null;

    await this.prisma.oAuthAccount.create({ data: { userId: user.id, provider, providerUserId } });
    return user.id;
  }
}
