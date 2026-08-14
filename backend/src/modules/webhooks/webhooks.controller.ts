import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { ShopsService } from '../shops/shops.service';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { ShopErasureService } from './shop-erasure.service';

interface WebhookHeaders {
  hmac: string | undefined;
  shopDomain: string | undefined;
  webhookId: string | undefined;
  topic: string;
}

/**
 * Everything Shopify sends us.
 *
 * Two rules govern every handler here:
 *
 * **Verify before acting.** The HMAC is checked against the *raw* body — which
 * is why `main.ts` boots with `rawBody: true` — using a timing-safe compare.
 * An unverified request is rejected before it can touch anything.
 *
 * **Always return 200 once verified.** Shopify retries on any non-2xx, so
 * returning 500 for a shop we cannot find turns one bad delivery into an
 * indefinite retry loop. Failures are recorded on the delivery row instead.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly shopsService: ShopsService,
    private readonly erasure: ShopErasureService,
    @InjectRepository(WebhookDelivery)
    private readonly deliveries: Repository<WebhookDelivery>,
  ) {}

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  @Post('app-uninstalled')
  @HttpCode(200)
  async appUninstalled(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-shopify-hmac-sha256') hmac: string | undefined,
    @Headers('x-shopify-shop-domain') shopDomain: string | undefined,
    @Headers('x-shopify-webhook-id') webhookId: string | undefined,
  ): Promise<{ received: true }> {
    return this.handle(
      req,
      { hmac, shopDomain, webhookId, topic: 'app/uninstalled' },
      async (domain) => {
        /*
         * Moves the shop to DISCONNECTED rather than deleting it. The merchant
         * may reinstall — that is common — and their campaign history should
         * still be there when they do. Deletion is `shop/redact`'s job, and
         * Shopify sends that separately when it actually means it.
         *
         * The scheduler skips disconnected shops, so an active campaign stops
         * trying to write to a store we can no longer reach.
         */
        await this.shopsService.disconnectByDomain(domain);
      },
    );
  }

  // -------------------------------------------------------------------
  // Shopify's mandatory GDPR topics
  // -------------------------------------------------------------------

  /**
   * `customers/data_request` — a shopper asked what data we hold on them.
   *
   * **A no-op, and that is the correct implementation.** This app stores no
   * customer data of any kind: no orders, no carts, no identifiers. Everything
   * in the database is the merchant's own catalog configuration and the record
   * of price changes we made. There is nothing to return, so we acknowledge
   * and record the request.
   *
   * Shopify requires the endpoint to exist and answer regardless.
   */
  @Post('customers/data-request')
  @HttpCode(200)
  async customerDataRequest(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-shopify-hmac-sha256') hmac: string | undefined,
    @Headers('x-shopify-shop-domain') shopDomain: string | undefined,
    @Headers('x-shopify-webhook-id') webhookId: string | undefined,
  ): Promise<{ received: true }> {
    return this.handle(
      req,
      { hmac, shopDomain, webhookId, topic: 'customers/data_request' },
      () => {
        this.logger.log(
          'customers/data_request acknowledged — this app stores no customer data',
        );
        return Promise.resolve();
      },
    );
  }

  /**
   * `customers/redact` — delete a shopper's data.
   *
   * A no-op for the same reason: there is none to delete. Acknowledged and
   * recorded so the delivery is auditable if a reviewer asks.
   */
  @Post('customers/redact')
  @HttpCode(200)
  async customerRedact(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-shopify-hmac-sha256') hmac: string | undefined,
    @Headers('x-shopify-shop-domain') shopDomain: string | undefined,
    @Headers('x-shopify-webhook-id') webhookId: string | undefined,
  ): Promise<{ received: true }> {
    return this.handle(
      req,
      { hmac, shopDomain, webhookId, topic: 'customers/redact' },
      () => {
        this.logger.log(
          'customers/redact acknowledged — this app stores no customer data',
        );
        return Promise.resolve();
      },
    );
  }

  /**
   * `shop/redact` — delete everything belonging to this shop.
   *
   * **This one really deletes.** Shopify sends it 48 hours after an uninstall,
   * and unlike the two above it has real work behind it: the merchant's
   * campaigns, price history, supplier sheets, jobs and billing rows all go.
   */
  @Post('shop/redact')
  @HttpCode(200)
  async shopRedact(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-shopify-hmac-sha256') hmac: string | undefined,
    @Headers('x-shopify-shop-domain') shopDomain: string | undefined,
    @Headers('x-shopify-webhook-id') webhookId: string | undefined,
  ): Promise<{ received: true }> {
    return this.handle(
      req,
      { hmac, shopDomain, webhookId, topic: 'shop/redact' },
      async (domain) => {
        await this.erasure.eraseByDomain(domain);
      },
    );
  }

  // -------------------------------------------------------------------
  // Shared plumbing
  // -------------------------------------------------------------------

  /**
   * Verify, deduplicate, run, record.
   *
   * The delivery row is inserted *before* the work, so a crash mid-handler
   * still leaves evidence the webhook arrived. `orIgnore` on the unique
   * `webhook_id` is the deduplication: a redelivery of one Shopify already
   * sent inserts nothing, and we return 200 without repeating the work.
   */
  private async handle(
    req: RawBodyRequest<Request>,
    headers: WebhookHeaders,
    work: (shopDomain: string) => Promise<void>,
  ): Promise<{ received: true }> {
    if (!this.isValidWebhook(req.rawBody, headers.hmac)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    if (!headers.shopDomain) {
      throw new UnauthorizedException('Missing shop domain header');
    }

    // No delivery id means we cannot deduplicate. Shopify always sends one;
    // treating its absence as "run anyway" is safer than refusing, since the
    // alternative is an endless retry of a webhook we never process.
    const webhookId =
      headers.webhookId ??
      `${headers.topic}:${headers.shopDomain}:${Date.now()}`;

    const shop = await this.shopsService.findByDomain(headers.shopDomain);

    const inserted = await this.deliveries
      .createQueryBuilder()
      .insert()
      .into(WebhookDelivery)
      .values({
        webhookId,
        topic: headers.topic,
        shopDomain: headers.shopDomain,
        shopId: shop?.id ?? null,
        payload: safeJson(req.rawBody) as unknown as Record<string, never>,
      })
      .orIgnore()
      .execute();

    if (inserted.identifiers.filter(Boolean).length === 0) {
      this.logger.log(
        `Ignoring redelivered ${headers.topic} for ${headers.shopDomain}`,
      );
      return { received: true };
    }

    try {
      await work(headers.shopDomain);
      await this.deliveries.update(
        { webhookId },
        { processedAt: new Date(), errorMessage: null },
      );
    } catch (error) {
      /*
       * Recorded, not rethrown. A 500 makes Shopify retry indefinitely, and a
       * handler that failed on bad data will fail the same way every time —
       * the row is where an operator finds out, not the retry queue.
       */
      const message = error instanceof Error ? error.message : String(error);
      await this.deliveries.update({ webhookId }, { errorMessage: message });
      this.logger.error(
        `Failed handling ${headers.topic} for ${headers.shopDomain}: ${message}`,
      );
    }

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
    // Compare lengths first: timingSafeEqual throws on a mismatch, and the
    // length of a base64 digest is not a secret.
    if (computedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(computedBuf, providedBuf);
  }
}

/** The payload is stored for support, so a malformed body must not throw. */
function safeJson(rawBody: Buffer | undefined): Record<string, unknown> {
  if (!rawBody) return {};
  try {
    const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
