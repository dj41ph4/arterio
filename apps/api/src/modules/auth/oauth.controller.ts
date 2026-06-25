import { BadRequestException, Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { OAuthService, OAUTH_PROVIDERS, type OAuthProvider } from './oauth.service';
import { Public } from '../../common/decorators';

function isProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

@ApiTags('auth')
@Controller('auth/oauth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  private meta(req: Request) {
    return { ip: req.ip, ua: req.headers['user-agent'] };
  }

  /** Same-origin callback URL the provider redirects back to — must be registered there. */
  private redirectUri(req: Request, provider: string): string {
    return `${req.protocol}://${req.get('host')}/api/v1/auth/oauth/${provider}/callback`;
  }

  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Which OAuth providers are configured — drives which buttons the login page shows' })
  providers() {
    return this.oauth.availableProviders();
  }

  @Public()
  @Get(':provider/start')
  @ApiOperation({ summary: 'Redirects the browser to the provider sign-in page' })
  async start(
    @Param('provider') provider: string,
    @Query('returnOrigin') returnOrigin: string,
    @Query('locale') locale: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!isProvider(provider)) throw new BadRequestException(`Unknown provider "${provider}"`);
    if (!returnOrigin) throw new BadRequestException('Missing returnOrigin');
    const url = await this.oauth.buildAuthorizeUrl(
      provider,
      this.redirectUri(req, provider),
      returnOrigin,
      locale || 'en',
    );
    res.redirect(url);
  }

  @Public()
  @Get(':provider/callback')
  @ApiOperation({ summary: 'Provider redirects here after consent; we hand off tokens to the web app' })
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!isProvider(provider)) throw new BadRequestException(`Unknown provider "${provider}"`);
    const { returnOrigin, locale, result } = await this.oauth.handleCallback(provider, code, state, this.meta(req));

    const target = `${returnOrigin}/${locale}/auth/callback`;
    if ('error' in result) {
      res.redirect(`${target}#error=${encodeURIComponent(result.error)}`);
      return;
    }
    // Tokens travel in the URL fragment, not the query string — fragments are
    // never sent to the server (here or on any subsequent request), only
    // readable by JS on the landing page. Closest thing to safe handoff
    // without a server-side session store.
    const frag = new URLSearchParams({
      access: result.accessToken,
      refresh: result.refreshToken,
      expiresIn: String(result.expiresIn),
    });
    res.redirect(`${target}#${frag.toString()}`);
  }
}
