import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  SESSION_COOKIE_NAME,
  SessionService,
} from '../session/session.service';
import { OAuthFlowError, ShopifyAuthService } from './shopify-auth.service';

const OAUTH_STATE_COOKIE = 'plc_oauth_state';

@Controller('auth')
export class ShopifyAuthController {
  private readonly logger = new Logger(ShopifyAuthController.name);

  constructor(
    private readonly shopifyAuthService: ShopifyAuthService,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  install(@Query('shop') shop: string, @Res() res: Response): void {
    try {
      const { redirectUrl, state } = this.shopifyAuthService.beginInstall(shop);
      res.cookie(OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: this.sessionService.isProduction(),
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
      });
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
      const cookieState = (req.cookies as Record<string, string> | undefined)?.[
        OAUTH_STATE_COOKIE
      ];
      const { sessionToken } = await this.shopifyAuthService.completeInstall(
        query,
        cookieState,
      );

      res.clearCookie(OAUTH_STATE_COOKIE);
      res.cookie(SESSION_COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: this.sessionService.isProduction(),
        sameSite: 'lax',
        maxAge: this.sessionService.cookieMaxAgeMs(),
      });

      const frontendUrl = this.configService.get<string>('frontendUrl');
      res.redirect(302, `${frontendUrl}/setup`);
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
