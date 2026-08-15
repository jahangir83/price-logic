import type { ConfigService } from '@nestjs/config';
import type { Shop } from '../shops/entities/shop.entity';
import type { ShopifyGraphQlClient } from './shopify-graphql.client';
import { WebhookRegistrarService } from './webhook-registrar.service';

interface CreateResult {
  webhookSubscriptionCreate: {
    webhookSubscription: { id: string } | null;
    userErrors: { field: string[] | null; message: string }[];
  };
}

function ok(): CreateResult {
  return {
    webhookSubscriptionCreate: {
      webhookSubscription: { id: 'gid://shopify/WebhookSubscription/1' },
      userErrors: [],
    },
  };
}

function userError(message: string): CreateResult {
  return {
    webhookSubscriptionCreate: {
      webhookSubscription: null,
      userErrors: [{ field: ['callbackUrl'], message }],
    },
  };
}

describe('WebhookRegistrarService', () => {
  const shop = {
    id: 'shop-1',
    shopDomain: 'demo.myshopify.com',
  } as Shop;

  interface GraphQlCall {
    accessToken: string;
    variables: {
      topic: string;
      webhookSubscription: { callbackUrl: string };
    };
  }

  let request: jest.Mock;
  let service: WebhookRegistrarService;

  /** The nth request the service made, typed. */
  function callAt(index: number): GraphQlCall {
    const calls = request.mock.calls as [GraphQlCall][];
    return calls[index][0];
  }

  function build(appUrl = 'https://app.pricelogic.test'): void {
    request = jest.fn(() => Promise.resolve(ok()));
    const config = {
      get: jest.fn((key: string) =>
        key === 'shopify.appUrl' ? appUrl : undefined,
      ),
    };
    service = new WebhookRegistrarService(
      { request } as unknown as ShopifyGraphQlClient,
      config as unknown as ConfigService,
    );
  }

  beforeEach(() => build());

  it('subscribes to every topic the app declares', async () => {
    const result = await service.registerAll(shop, 'shpat_token');

    expect(result.total).toBe(WebhookRegistrarService.topics().length);
    expect(result.registered).toBe(result.total);
    expect(result.failed).toEqual([]);
    expect(request).toHaveBeenCalledTimes(result.total);

    const topics = request.mock.calls.map(
      (_call, index) => callAt(index).variables.topic,
    );
    expect(topics).toEqual([...WebhookRegistrarService.topics()]);
  });

  it("leaves Shopify's three mandatory privacy topics to app config", () => {
    // These are app settings, not per-shop subscriptions: they are declared in
    // `[webhooks.privacy_compliance]` in shopify.app.toml, and Shopify rejects
    // them from webhookSubscriptionCreate. Subscribing to them here would fail
    // on every single install without breaking anything, which is the worst
    // kind of failure — noisy, permanent, and not actually a symptom.
    expect(WebhookRegistrarService.topics()).not.toEqual(
      expect.arrayContaining([
        'CUSTOMERS_DATA_REQUEST',
        'CUSTOMERS_REDACT',
        'SHOP_REDACT',
      ]),
    );
  });

  it('uses GraphQL enum topic names, never the REST slash form', () => {
    // `app/uninstalled` is a different vocabulary; Shopify rejects it here, and
    // a caller that treats every userError as "already exists" would never see
    // the rejection.
    for (const topic of WebhookRegistrarService.topics()) {
      expect(topic).not.toContain('/');
      expect(topic).toBe(topic.toUpperCase());
    }
  });

  it('points every callback at the configured app URL', async () => {
    await service.registerAll(shop, 'shpat_token');

    const urls = request.mock.calls.map(
      (_call, index) => callAt(index).variables.webhookSubscription.callbackUrl,
    );
    for (const url of urls) {
      expect(url.startsWith('https://app.pricelogic.test/webhooks/')).toBe(
        true,
      );
    }
  });

  it('strips a trailing slash so the callback is not registered twice', async () => {
    build('https://app.pricelogic.test///');
    await service.registerAll(shop, 'shpat_token');

    const url = callAt(0).variables.webhookSubscription.callbackUrl;
    expect(url).toBe('https://app.pricelogic.test/webhooks/app-uninstalled');
  });

  it('adds a scheme when the configured app URL is a bare host', async () => {
    build('app.pricelogic.test');
    await service.registerAll(shop, 'shpat_token');

    const url = callAt(0).variables.webhookSubscription.callbackUrl;
    expect(url.startsWith('https://app.pricelogic.test/')).toBe(true);
  });

  it('treats an already-registered topic as success, not failure', async () => {
    // The reinstall path: Shopify says the address is taken, which is exactly
    // the state we wanted.
    request.mockResolvedValue(
      userError('Address for this topic has already been taken'),
    );

    const result = await service.registerAll(shop, 'shpat_token');

    expect(result.alreadyPresent).toBe(result.total);
    expect(result.registered).toBe(0);
    expect(result.failed).toEqual([]);
  });

  it('reports a real userError as a failure', async () => {
    request.mockResolvedValue(userError('Callback URL is not a valid URL'));

    const result = await service.registerAll(shop, 'shpat_token');

    expect(result.failed).toHaveLength(result.total);
    expect(result.failed[0].reason).toContain('not a valid URL');
    expect(result.registered).toBe(0);
  });

  it('keeps going after one topic fails', async () => {
    // One missing webhook must not cost the merchant the other four.
    request
      .mockResolvedValueOnce(ok())
      .mockRejectedValueOnce(new Error('Shopify unavailable'))
      .mockResolvedValue(ok());

    const result = await service.registerAll(shop, 'shpat_token');

    expect(request).toHaveBeenCalledTimes(result.total);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].topic).toBe(WebhookRegistrarService.topics()[1]);
    expect(result.registered).toBe(result.total - 1);
  });

  it('never rejects, so a webhook problem cannot abort an install', async () => {
    request.mockRejectedValue(new Error('network down'));

    await expect(service.registerAll(shop, 'shpat_token')).resolves.toEqual(
      expect.objectContaining({ registered: 0 }),
    );
  });

  it('sends the token it was given rather than reading one from the shop', async () => {
    // At install time the shop row has only just been written; the freshly
    // exchanged token is the one that works.
    await service.registerAll(shop, 'shpat_fresh');

    expect(callAt(0).accessToken).toBe('shpat_fresh');
  });
});
