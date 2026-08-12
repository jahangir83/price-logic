import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ShopsService } from '../shops/shops.service';

/**
 * Minimal, correctly-verified webhook receiver so the Shop status lifecycle
 * (ACTIVE/DISCONNECTED) has a real trigger for uninstall. Broader webhook
 * infrastructure — replay-attack protection, additional topics, retry
 * handling — is explicit scope for Phase 13 (Security Hardening); this only
 * covers what Phase 1's lifecycle requirement needs.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly shopsService: ShopsService,
  ) {}

  @Post('app-uninstalled')
  @HttpCode(200)
  async appUninstalled(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-shopify-hmac-sha256') hmacHeader: string | undefined,
    @Headers('x-shopify-shop-domain') shopDomain: string | undefined,
  ): Promise<{ received: true }> {
    if (!this.isValidWebhook(req.rawBody, hmacHeader)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    if (!shopDomain) {
      throw new UnauthorizedException('Missing shop domain header');
    }

    await this.shopsService.disconnectByDomain(shopDomain);
    this.logger.log(`Processed app/uninstalled for ${shopDomain}`);
    return { received: true };
  }

  private isValidWebhook(
    rawBody: Buffer | undefined,
    hmacHeader: string | undefined,
  ): boolean {
    if (!rawBody || !hmacHeader) return false;

    const secret = this.configService.get<string>('shopify.clientSecret');
    const computed = createHmac('sha256', secret as string)
      .update(rawBody)
      .digest('base64');

    const computedBuf = Buffer.from(computed, 'utf8');
    const providedBuf = Buffer.from(hmacHeader, 'utf8');
    if (computedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(computedBuf, providedBuf);
  }
}
