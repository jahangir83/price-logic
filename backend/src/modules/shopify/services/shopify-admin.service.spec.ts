import { ConfigService } from '@nestjs/config';
import { Shop } from '../../shops/entities/shop.entity';
import { ShopsService } from '../../shops/services/shops.service';
import { ShopifyResponseCache } from '../response-cache';
import { ShopifyAdminService } from './shopify-admin.service';
import {
  ShopifyGraphQlClient,
  ShopifyTransport,
} from '../shopify-graphql.client';
import { ShopifyApiError } from '../shopify.errors';
import { ThrottleRegistry } from '../throttle';

/**
 * The adapter against a scripted Shopify.
 *
 * A recorded transport rather than a live store: pagination, a throttle
 * followed by a retry, and a revoked token are the cases that matter and all
 * three are painful or impossible to provoke on demand against the real API.
 * What is asserted is the adapter's contract — typed errors out, no GraphQL
 * envelope, no query issued per variant.
 */
describe('ShopifyAdminService', () => {
  const shop = {
    id: 'shop-1',
    shopDomain: 'demo.myshopify.com',
    accessTokenEncrypted: 'cipher',
  } as Shop;

  let calls: { query: string; variables: Record<string, unknown> }[];
  let service: ShopifyAdminService;
  let cache: ShopifyResponseCache;
  let throttle: ThrottleRegistry;

  /** Builds a transport that replays the given responses in order. */
  const transportOf = (
    responses: (
      | { status?: number; body: unknown }
      | ((n: number) => { status?: number; body: unknown })
    )[],
  ): ShopifyTransport => {
    let n = 0;
    return (_url, init) => {
      const parsed = JSON.parse(init.body) as {
        query: string;
        variables: Record<string, unknown>;
      };
      calls.push(parsed);
      const entry = responses[Math.min(n, responses.length - 1)];
      n += 1;
      const resolved = typeof entry === 'function' ? entry(n) : entry;
      return Promise.resolve({
        status: resolved?.status ?? 200,
        json: () => Promise.resolve(resolved?.body),
        text: () => Promise.resolve(JSON.stringify(resolved?.body)),
      });
    };
  };

  const build = (transport: ShopifyTransport) => {
    calls = [];
    cache = new ShopifyResponseCache();
    throttle = new ThrottleRegistry();
    const config = {
      get: (key: string) =>
        key === 'shopify.apiVersion' ? '2025-01' : undefined,
    } as unknown as ConfigService;
    const shops = {
      getDecryptedAccessToken: () => 'shpat_test',
    } as unknown as ShopsService;

    service = new ShopifyAdminService(
      new ShopifyGraphQlClient(config, throttle, transport),
      shops,
      cache,
    );
  };

  const cost = (currentlyAvailable = 1000) => ({
    cost: {
      requestedQueryCost: 10,
      actualQueryCost: 10,
      throttleStatus: {
        maximumAvailable: 1000,
        currentlyAvailable,
        restoreRate: 50,
      },
    },
  });

  const productPage = (
    ids: string[],
    pageInfo: { hasNextPage: boolean; endCursor: string | null },
  ) => ({
    body: {
      data: {
        products: {
          edges: ids.map((id) => ({
            node: {
              id,
              title: `Product ${id}`,
              handle: `product-${id}`,
              status: 'ACTIVE',
              vendor: 'Acme',
              productType: 'Shirt',
              tags: ['sale'],
              featuredImage: { url: 'https://cdn/img.png' },
              variantsCount: { count: 3 },
            },
          })),
          pageInfo,
        },
      },
      extensions: cost(),
    },
  });

  describe('product search', () => {
    it('maps a page and surfaces the cursor', async () => {
      build(
        transportOf([
          productPage(['gid://shopify/Product/1'], {
            hasNextPage: true,
            endCursor: 'cursor-1',
          }),
        ]),
      );

      const page = await service.searchProducts(shop, { query: 'shirt' });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.vendor).toBe('Acme');
      expect(page.hasNextPage).toBe(true);
      expect(page.endCursor).toBe('cursor-1');
    });

    it('does not fetch variants it will not show', async () => {
      build(
        transportOf([productPage([], { hasNextPage: false, endCursor: null })]),
      );
      await service.searchProducts(shop);
      // A picker shows a count; pulling variant nodes per row multiplies the
      // query cost for data nobody reads.
      expect(calls[0]?.query).toContain('variantsCount');
      expect(calls[0]?.query).not.toContain('variants(first');
    });

    it('handles an empty catalog without inventing a page', async () => {
      build(
        transportOf([productPage([], { hasNextPage: false, endCursor: null })]),
      );
      const page = await service.searchProducts(shop);
      expect(page.items).toEqual([]);
      expect(page.hasNextPage).toBe(false);
    });

    it('passes the cursor through for the next page', async () => {
      build(
        transportOf([
          productPage(['gid://shopify/Product/2'], {
            hasNextPage: false,
            endCursor: null,
          }),
        ]),
      );
      await service.searchProducts(shop, { after: 'cursor-1' });
      expect(calls[0]?.variables.after).toBe('cursor-1');
    });

    it('clamps the page size to Shopify’s ceiling', async () => {
      build(
        transportOf([productPage([], { hasNextPage: false, endCursor: null })]),
      );
      await service.searchProducts(shop, { first: 5000 });
      expect(calls[0]?.variables.first).toBe(250);
    });

    it('escapes a search term instead of letting it break the query', async () => {
      build(
        transportOf([productPage([], { hasNextPage: false, endCursor: null })]),
      );
      await service.searchProducts(shop, { query: "o'brien" });
      expect(calls[0]?.variables.query).toBe("title:*o\\'brien*");
    });
  });

  describe('caching', () => {
    it('serves a repeated search from cache', async () => {
      build(
        transportOf([
          productPage(['gid://shopify/Product/1'], {
            hasNextPage: false,
            endCursor: null,
          }),
        ]),
      );
      await service.searchProducts(shop, { query: 'tee' });
      await service.searchProducts(shop, { query: 'tee' });
      expect(calls).toHaveLength(1);
    });

    it('treats a different query as a different key', async () => {
      build(
        transportOf([productPage([], { hasNextPage: false, endCursor: null })]),
      );
      await service.searchProducts(shop, { query: 'tee' });
      await service.searchProducts(shop, { query: 'hat' });
      expect(calls).toHaveLength(2);
    });

    it('drops a shop’s cache when asked', async () => {
      build(
        transportOf([productPage([], { hasNextPage: false, endCursor: null })]),
      );
      await service.searchProducts(shop, { query: 'tee' });
      service.invalidate(shop.id);
      await service.searchProducts(shop, { query: 'tee' });
      expect(calls).toHaveLength(2);
    });
  });

  describe('variant prices', () => {
    const variantNode = (id: string, price: string) => ({
      id,
      title: 'Large',
      sku: `SKU-${id.split('/').pop()}`,
      price,
      compareAtPrice: null,
      inventoryQuantity: 4,
      product: { id: 'gid://shopify/Product/1', title: 'Tee' },
    });

    it('batches ids into one query rather than one query each', async () => {
      const ids = Array.from(
        { length: 300 },
        (_, i) => `gid://shopify/ProductVariant/${i}`,
      );
      build(
        transportOf([
          {
            body: {
              data: {
                nodes: ids.slice(0, 250).map((id) => variantNode(id, '10.00')),
              },
              extensions: cost(),
            },
          },
          {
            body: {
              data: {
                nodes: ids.slice(250).map((id) => variantNode(id, '10.00')),
              },
              extensions: cost(),
            },
          },
        ]),
      );

      const records = await service.fetchVariantPrices(shop, ids);
      // 300 variants is two batched calls, not 300.
      expect(calls).toHaveLength(2);
      expect(records).toHaveLength(300);
    });

    it('normalises prices to exact decimal money', async () => {
      build(
        transportOf([
          {
            body: {
              data: {
                nodes: [variantNode('gid://shopify/ProductVariant/1', '19.9')],
              },
              extensions: cost(),
            },
          },
        ]),
      );
      const [record] = await service.fetchVariantPrices(shop, [
        'gid://shopify/ProductVariant/1',
      ]);
      expect(record?.price).toBe('19.9000');
    });

    it('skips a variant deleted between listing and pricing', async () => {
      build(
        transportOf([
          {
            body: {
              data: {
                nodes: [
                  null,
                  variantNode('gid://shopify/ProductVariant/2', '5.00'),
                ],
              },
              extensions: cost(),
            },
          },
        ]),
      );
      const records = await service.fetchVariantPrices(shop, ['a', 'b']);
      expect(records).toHaveLength(1);
    });

    it('does not use the cache by default', async () => {
      build(
        transportOf([
          {
            body: {
              data: {
                nodes: [variantNode('gid://shopify/ProductVariant/1', '10.00')],
              },
              extensions: cost(),
            },
          },
        ]),
      );
      // Phase 6 re-reads immediately before mutating: a price from thirty
      // seconds ago produces a wrong discount that looks right.
      await service.fetchVariantPrices(shop, [
        'gid://shopify/ProductVariant/1',
      ]);
      await service.fetchVariantPrices(shop, [
        'gid://shopify/ProductVariant/1',
      ]);
      expect(calls).toHaveLength(2);
    });

    it('asks for nothing when given no ids', async () => {
      build(
        transportOf([{ body: { data: { nodes: [] }, extensions: cost() } }]),
      );
      expect(await service.fetchVariantPrices(shop, [])).toEqual([]);
      expect(calls).toHaveLength(0);
    });
  });

  describe('SKU lookup', () => {
    const skuNode = (id: string, sku: string) => ({
      id,
      title: 'Default',
      sku,
      price: '12.00',
      compareAtPrice: null,
      inventoryQuantity: 1,
      product: { id: 'gid://shopify/Product/9', title: 'Mug' },
    });

    it('returns every match so an ambiguous SKU can be flagged', async () => {
      build(
        transportOf([
          {
            body: {
              data: {
                productVariants: {
                  edges: [
                    { node: skuNode('gid://shopify/ProductVariant/1', 'DUP') },
                    { node: skuNode('gid://shopify/ProductVariant/2', 'DUP') },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
              extensions: cost(),
            },
          },
        ]),
      );

      const [match] = await service.findVariantsBySku(shop, ['DUP']);
      // Silently picking one would reprice the wrong product invisibly.
      expect(match?.variants).toHaveLength(2);
    });

    it('reports an unmatched SKU as an empty list rather than omitting it', async () => {
      build(
        transportOf([
          {
            body: {
              data: {
                productVariants: {
                  edges: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
              extensions: cost(),
            },
          },
        ]),
      );
      const matches = await service.findVariantsBySku(shop, ['MISSING']);
      expect(matches).toEqual([{ sku: 'MISSING', variants: [] }]);
    });

    it('follows pagination until the last page', async () => {
      build(
        transportOf([
          {
            body: {
              data: {
                productVariants: {
                  edges: [
                    { node: skuNode('gid://shopify/ProductVariant/1', 'A') },
                  ],
                  pageInfo: { hasNextPage: true, endCursor: 'c1' },
                },
              },
              extensions: cost(),
            },
          },
          {
            body: {
              data: {
                productVariants: {
                  edges: [
                    { node: skuNode('gid://shopify/ProductVariant/2', 'A') },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
              extensions: cost(),
            },
          },
        ]),
      );
      const [match] = await service.findVariantsBySku(shop, ['A']);
      expect(calls).toHaveLength(2);
      expect(match?.variants).toHaveLength(2);
    });

    it('ignores a fuzzy match Shopify threw in', async () => {
      build(
        transportOf([
          {
            body: {
              data: {
                productVariants: {
                  edges: [
                    {
                      node: skuNode('gid://shopify/ProductVariant/1', 'ABC-1'),
                    },
                    // Shopify's search is fuzzy at the edges; a sheet row must
                    // not be applied to a similarly-named SKU.
                    {
                      node: skuNode('gid://shopify/ProductVariant/2', 'ABC-10'),
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
              extensions: cost(),
            },
          },
        ]),
      );
      const [match] = await service.findVariantsBySku(shop, ['ABC-1']);
      expect(match?.variants).toHaveLength(1);
      expect(match?.variants[0]?.sku).toBe('ABC-1');
    });

    it('deduplicates the requested SKUs', async () => {
      build(
        transportOf([
          {
            body: {
              data: {
                productVariants: {
                  edges: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
              extensions: cost(),
            },
          },
        ]),
      );
      const matches = await service.findVariantsBySku(shop, [
        'A',
        'A',
        ' A ',
        '',
      ]);
      expect(matches).toHaveLength(1);
    });
  });

  describe('facets', () => {
    it('lists tags and caches them', async () => {
      build(
        transportOf([
          {
            body: {
              data: { shop: { productTags: { edges: [{ node: 'sale' }] } } },
              extensions: cost(),
            },
          },
        ]),
      );
      expect(await service.listTags(shop)).toEqual(['sale']);
      await service.listTags(shop);
      // Shop-wide lists a merchant edits rarely — cached harder than search.
      expect(calls).toHaveLength(1);
    });
  });

  describe('errors and throttling', () => {
    it('retries a THROTTLED response and succeeds', async () => {
      build(
        transportOf([
          {
            body: {
              errors: [
                { message: 'Throttled', extensions: { code: 'THROTTLED' } },
              ],
              extensions: cost(0),
            },
          },
          productPage(['gid://shopify/Product/1'], {
            hasNextPage: false,
            endCursor: null,
          }),
        ]),
      );

      const page = await service.searchProducts(shop);
      expect(page.items).toHaveLength(1);
      expect(calls).toHaveLength(2);
    });

    it('learns the bucket state from a throttled response', async () => {
      build(
        transportOf([
          {
            body: {
              errors: [
                { message: 'Throttled', extensions: { code: 'THROTTLED' } },
              ],
              extensions: cost(0),
            },
          },
          productPage([], { hasNextPage: false, endCursor: null }),
        ]),
      );
      await service.searchProducts(shop);
      // A throttled reply still reports the bucket — exactly when we need it.
      expect(throttle.get('shop-1').maximumAvailable).toBe(1000);
    });

    it('surfaces a revoked token as a typed error, never a payload', async () => {
      build(transportOf([{ status: 401, body: {} }]));

      await expect(service.searchProducts(shop)).rejects.toBeInstanceOf(
        ShopifyApiError,
      );
      await expect(service.searchProducts(shop)).rejects.toMatchObject({
        kind: 'UNAUTHORIZED',
        retryable: false,
      });
    });

    it('does not retry a revoked token', async () => {
      build(transportOf([{ status: 401, body: {} }]));
      await expect(service.searchProducts(shop)).rejects.toThrow(
        ShopifyApiError,
      );
      // Four retries only delay the reinstall prompt the merchant needs.
      expect(calls).toHaveLength(1);
    });

    it('classifies an ACCESS_DENIED GraphQL error as unauthorized', async () => {
      build(
        transportOf([
          {
            body: {
              errors: [
                {
                  message: 'Access denied',
                  extensions: { code: 'ACCESS_DENIED' },
                },
              ],
            },
          },
        ]),
      );
      await expect(service.searchProducts(shop)).rejects.toMatchObject({
        kind: 'UNAUTHORIZED',
      });
    });

    it('treats a 5xx as retryable', async () => {
      build(
        transportOf([
          { status: 503, body: {} },
          productPage([], { hasNextPage: false, endCursor: null }),
        ]),
      );
      await expect(service.searchProducts(shop)).resolves.toBeDefined();
      expect(calls).toHaveLength(2);
    });

    it('gives up after the retry budget and reports the last failure', async () => {
      build(transportOf([{ status: 503, body: {} }]));
      await expect(service.searchProducts(shop)).rejects.toMatchObject({
        kind: 'UNAVAILABLE',
      });
      expect(calls).toHaveLength(4);
    });

    it('does not leak a raw GraphQL payload for an unknown error', async () => {
      build(
        transportOf([
          { body: { errors: [{ message: 'Field does not exist' }] } },
        ]),
      );
      const error = await service.searchProducts(shop).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ShopifyApiError);
      expect((error as ShopifyApiError).kind).toBe('UNKNOWN');
      expect((error as ShopifyApiError).retryable).toBe(false);
    });

    it('reports a malformed body as unavailable rather than crashing', async () => {
      build(
        transportOf([
          {
            body: undefined,
            status: 200,
          },
        ]),
      );
      // json() resolving to undefined is the shape a proxy error page takes.
      await expect(service.searchProducts(shop)).rejects.toMatchObject({
        kind: 'UNAVAILABLE',
      });
    });
  });

  describe('version pinning', () => {
    it('pins the configured API version in the endpoint', () => {
      build(transportOf([{ body: { data: {} } }]));
      const client = new ShopifyGraphQlClient(
        {
          get: (key: string) =>
            key === 'shopify.apiVersion' ? '2025-01' : undefined,
        } as unknown as ConfigService,
        new ThrottleRegistry(),
        transportOf([{ body: { data: {} } }]),
      );
      expect(client.endpointFor('demo.myshopify.com')).toBe(
        'https://demo.myshopify.com/admin/api/2025-01/graphql.json',
      );
    });
  });
});
