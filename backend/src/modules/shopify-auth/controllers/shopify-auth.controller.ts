import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  SESSION_COOKIE_NAME,
  SessionService,
} from '../../session/services/session.service';
import {
  OAuthFlowError,
  ShopifyAuthService,
} from '../services/shopify-auth.service';

const OAUTH_STATE_COOKIE = 'plc_oauth_state';
/**
 * Carries `host` across the OAuth round trip.
 *
 * Shopify returns `shop` on the callback but not `host`, and App Bridge needs
 * `host` to re-embed the app afterwards. The frontend cannot keep it either:
 * the redirect happens in the top frame, and sessionStorage written by the app
 * inside Shopify's iframe is partitioned away from the top-level context in
 * every current browser. A short-lived cookie is the one place it survives.
 */
const OAUTH_HOST_COOKIE = 'plc_oauth_host';

@Controller('auth')
export class ShopifyAuthController {
  private readonly logger = new Logger(ShopifyAuthController.name);

  constructor(
    private readonly shopifyAuthService: ShopifyAuthService,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  install(
    @Query('shop') shop: string,
    @Query('host') host: string | undefined,
    @Res() res: Response,
  ): void {
    try {
      const { redirectUrl, state } = this.shopifyAuthService.beginInstall(shop);
      const cookieOptions = {
        httpOnly: true,
        secure: this.sessionService.isProduction(),
        sameSite: 'lax' as const,
        maxAge: 10 * 60 * 1000,
      };
      res.cookie(OAUTH_STATE_COOKIE, state, cookieOptions);
      if (host) {
        res.cookie(OAUTH_HOST_COOKIE, host, cookieOptions);
      }
      res.redirect(302, redirectUrl);
    } catch (error) {
      this.redirectToError(res, error);
    }
  }

  @Get('callback')
  async callback(
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const cookies = req.cookies as Record<string, string> | undefined;
      const cookieState = cookies?.[OAUTH_STATE_COOKIE];
      const host = cookies?.[OAUTH_HOST_COOKIE];
      const { sessionToken } = await this.shopifyAuthService.completeInstall(
        query,
        cookieState,
      );

      res.clearCookie(OAUTH_STATE_COOKIE);
      res.clearCookie(OAUTH_HOST_COOKIE);
      res.cookie(SESSION_COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: this.sessionService.isProduction(),
        sameSite: 'lax',
        maxAge: this.sessionService.cookieMaxAgeMs(),
      });

      // `shop` and `host` go back on the URL because the app is about to boot
      // in a fresh top-level context that has none of the state the embedded
      // app had. Without them the boot gate cannot tell which store it is for
      // and sends the merchant straight back through OAuth — a loop.
      const frontendUrl = this.configService.get<string>('frontendUrl');
      const params = new URLSearchParams({ shop: query.shop });
      if (host) params.set('host', host);
      res.redirect(302, `${frontendUrl}/setup?${params.toString()}`);
    } catch (error) {
      this.redirectToError(res, error);
    }
  }

  private redirectToError(res: Response, error: unknown): void {
    const reason =
      error instanceof OAuthFlowError ? error.reason : 'unknown_error';
    if (!(error instanceof OAuthFlowError)) {
      this.logger.error('Unexpected OAuth failure', error);
    } else {
      this.logger.warn(`OAuth flow rejected: ${reason}`);
    }

    const frontendUrl = this.configService.get<string>('frontendUrl');
    res.redirect(302, `${frontendUrl}/auth/error?reason=${reason}`);
  }
}
