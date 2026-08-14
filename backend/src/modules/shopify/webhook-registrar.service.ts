import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Shop } from '../shops/entities/shop.entity';
import { ShopifyGraphQlClient } from './shopify-graphql.client';

/**
 * Every topic this app subscribes to, and the route that receives it.
 *
 * The topic strings are Shopify's **GraphQL enum** names — `APP_UNINSTALLED`,
 * not `app/uninstalled`. The REST spelling is a different vocabulary, and
 * mixing them is a mistake that fails quietly: Shopify rejects the unknown
 * value, and if the caller treats "already exists" and "rejected" alike, the
 * subscription is simply never created and nobody notices until a webhook does
 * not arrive.
 *
 * The paths must match `WebhooksController` exactly.
 */
const TOPICS: readonly { topic: string; path: string }[] = [
  { topic: 'APP_UNINSTALLED', path: '/webhooks/app-uninstalled' },
  {
    topic: 'APP_SUBSCRIPTIONS_UPDATE',
    path: '/webhooks/app-subscriptions-update',
  },
  // Shopify's three mandatory privacy topics. Missing any one fails review.
  { topic: 'CUSTOMERS_DATA_REQUEST', path: '/webhooks/customers/data-request' },
  { topic: 'CUSTOMERS_REDACT', path: '/webhooks/customers/redact' },
  { topic: 'SHOP_REDACT', path: '/webhooks/shop/redact' },
];

export interface WebhookRegistrationResult {
  total: number;
  registered: number;
  alreadyPresent: number;
  failed: { topic: string; reason: string }[];
}

/**
 * Subscribing a shop to our webhooks, at install.
 *
 * Runs on every install *and* reinstall, because a merchant who reinstalls
 * gets a fresh token and Shopify does not carry the old subscriptions over.
 * Re-registering an existing topic is a no-op rather than an error — Shopify
 * reports "address for this topic has already been taken", which is success
 * from our point of view.
 *
 * Failures never abort the install. A merchant with a working app and one
 * missing webhook is in a far better place than one who cannot install at all,
 * and the result is returned so a caller can log and retry.
 */
@Injectable()
export class WebhookRegistrarService {
  private readonly logger = new Logger(WebhookRegistrarService.name);

  constructor(
    private readonly client: ShopifyGraphQlClient,
    private readonly config: ConfigService,
  ) {}

  async registerAll(
    shop: Shop,
    accessToken: string,
  ): Promise<WebhookRegistrationResult> {
    const baseUrl = this.callbackBase();

    const result: WebhookRegistrationResult = {
      total: TOPICS.length,
      registered: 0,
      alreadyPresent: 0,
      failed: [],
    };

    for (const { topic, path } of TOPICS) {
      try {
        const outcome = await this.register(
          shop,
          accessToken,
          topic,
          `${baseUrl}${path}`,
        );
        if (outcome === 'CREATED') result.registered += 1;
        else result.alreadyPresent += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        result.failed.push({ topic, reason });
        this.logger.error(
          `Could not subscribe ${shop.shopDomain} to ${topic}: ${reason}`,
        );
      }
    }

    this.logger.log(
      `Webhooks for ${shop.shopDomain}: ${result.registered} new, ` +
        `${result.alreadyPresent} already there, ${result.failed.length} failed`,
    );
    return result;
  }

  private async register(
    shop: Shop,
    accessToken: string,
    topic: string,
    callbackUrl: string,
  ): Promise<'CREATED' | 'ALREADY_PRESENT'> {
    const data = await this.client.request<{
      webhookSubscriptionCreate: {
        webhookSubscription: { id: string } | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    }>({
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      accessToken,
      estimatedCost: 10,
      query: WEBHOOK_SUBSCRIPTION_CREATE,
      variables: {
        topic,
        webhookSubscription: { callbackUrl, format: 'JSON' },
      },
    });

    const errors = data.webhookSubscriptionCreate.userErrors;
    if (errors.length === 0) return 'CREATED';

    const message = errors.map((error) => error.message).join('; ');
    // Shopify's way of saying "you already have this one".
    if (/already\s+been\s+taken|already\s+exists/i.test(message)) {
      return 'ALREADY_PRESENT';
    }
    throw new Error(message);
  }

  /**
   * Where Shopify should send them.
   *
   * `SHOPIFY_APP_URL` is the app's public origin; the webhook routes hang
   * directly off it. Trailing slashes are stripped so a misconfigured value
   * does not produce a double slash Shopify then treats as a different
   * address — which would register a second subscription rather than reusing
   * the first.
   */
  private callbackBase(): string {
    const raw = this.config.get<string>('shopify.appUrl') ?? '';
    const withScheme = raw.startsWith('http') ? raw : `https://${raw}`;
    return withScheme.replace(/\/+$/, '');
  }

  /** The topics this app expects, for a health check or a backfill script. */
  static topics(): readonly string[] {
    return TOPICS.map((entry) => entry.topic);
  }
}

const WEBHOOK_SUBSCRIPTION_CREATE = `
  mutation SubscribeToWebhook(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: $webhookSubscription
    ) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;
