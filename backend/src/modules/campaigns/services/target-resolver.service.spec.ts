import {
  CampaignIncludeMode,
  CampaignTargetMode,
  CampaignTargetType,
  ShopifyProductStatus,
} from '@pricelogic/shared';
import {
  ShopifyAdminService,
  type CatalogVariant,
} from '../../shopify/services/shopify-admin.service';
import { Shop } from '../../shops/entities/shop.entity';
import type { CampaignTargetingRules } from '../target-resolution';
import { TargetResolverService } from './target-resolver.service';

const shop = { id: 'shop-1', shopDomain: 'demo.myshopify.com' } as Shop;

const variant = (
  id: string,
  overrides: Partial<CatalogVariant> = {},
): CatalogVariant => ({
  variantId: `gid://v/${id}`,
  productId: `gid://p/${id}`,
  productTitle: `Product ${id}`,
  variantTitle: 'Default',
  sku: `SKU-${id}`,
  price: '10.0000',
  compareAtPrice: null,
  barcode: null,
  inventoryQuantity: null,
  productStatus: ShopifyProductStatus.ACTIVE,
  productTags: [],
  productVendor: null,
  productType: null,
  ...overrides,
});

/**
 * The resolution rules, against a scripted catalog.
 *
 * The order of operations is not cosmetic — start set, then draft/archived,
 * then exclusions — and each step changes the answer, so each is asserted
 * separately rather than through one end-to-end case.
 */
describe('TargetResolverService', () => {
  let adapter: {
    listVariantsMatching: jest.Mock;
    listCollectionVariants: jest.Mock;
    listProductVariants: jest.Mock;
    fetchVariantPrices: jest.Mock;
  };
  let resolver: TargetResolverService;

  beforeEach(() => {
    adapter = {
      listVariantsMatching: jest
        .fn()
        .mockResolvedValue({ variants: [], truncated: false }),
      listCollectionVariants: jest
        .fn()
        .mockResolvedValue({ variants: [], truncated: false }),
      listProductVariants: jest.fn().mockResolvedValue([]),
      fetchVariantPrices: jest.fn().mockResolvedValue([]),
    };
    resolver = new TargetResolverService(
      adapter as unknown as ShopifyAdminService,
    );
  });

  const rules = (
    overrides: Partial<CampaignTargetingRules> = {},
  ): CampaignTargetingRules => ({
    includeMode: CampaignIncludeMode.ALL_PRODUCTS,
    excludeDraftArchived: true,
    exclusionsEnabled: false,
    targets: [],
    ...overrides,
  });

  describe('start set', () => {
    it('walks the whole catalog for ALL_PRODUCTS', async () => {
      adapter.listVariantsMatching.mockResolvedValue({
        variants: [variant('1'), variant('2')],
        truncated: false,
      });

      const result = await resolver.resolve(shop, rules());
      // A null query means "the whole catalog"; the limit is the safety cap.
      const [calledShop, calledQuery, calledOptions] = adapter
        .listVariantsMatching.mock.calls[0] as [
        Shop,
        string | null,
        { limit: number },
      ];
      expect(calledShop).toBe(shop);
      expect(calledQuery).toBeNull();
      expect(typeof calledOptions.limit).toBe('number');
      expect(result.variantIds).toHaveLength(2);
    });

    it('covers nothing when SPECIFIC has no includes', async () => {
      // The dangerous default: falling back to the whole catalog here would
      // reprice every product in the store.
      const result = await resolver.resolve(
        shop,
        rules({ includeMode: CampaignIncludeMode.SPECIFIC }),
      );
      expect(result.variantIds).toEqual([]);
      expect(adapter.listVariantsMatching).not.toHaveBeenCalled();
    });

    it('unions the include rows rather than intersecting them', async () => {
      // A merchant picking a vendor *and* a collection means "either".
      adapter.listCollectionVariants.mockResolvedValue({
        variants: [variant('a')],
        truncated: false,
      });
      adapter.listVariantsMatching.mockResolvedValue({
        variants: [variant('b')],
        truncated: false,
      });

      const result = await resolver.resolve(
        shop,
        rules({
          includeMode: CampaignIncludeMode.SPECIFIC,
          targets: [
            {
              mode: CampaignTargetMode.INCLUDE,
              targetType: CampaignTargetType.COLLECTION,
              targetValue: 'gid://c/1',
            },
            {
              mode: CampaignTargetMode.INCLUDE,
              targetType: CampaignTargetType.VENDOR,
              targetValue: 'Acme',
            },
          ],
        }),
      );
      expect(result.variantIds).toHaveLength(2);
    });

    it('counts a variant reached two ways only once', async () => {
      // Double-counting would inflate the quota check into a false rejection.
      const shared = variant('same');
      adapter.listCollectionVariants.mockResolvedValue({
        variants: [shared],
        truncated: false,
      });
      adapter.listVariantsMatching.mockResolvedValue({
        variants: [shared],
        truncated: false,
      });

      const result = await resolver.resolve(
        shop,
        rules({
          includeMode: CampaignIncludeMode.SPECIFIC,
          targets: [
            {
              mode: CampaignTargetMode.INCLUDE,
              targetType: CampaignTargetType.COLLECTION,
              targetValue: 'gid://c/1',
            },
            {
              mode: CampaignTargetMode.INCLUDE,
              targetType: CampaignTargetType.TAG,
              targetValue: 'sale',
            },
          ],
        }),
      );
      expect(result.variantIds).toEqual(['gid://v/same']);
    });

    it('quotes a facet value so an apostrophe cannot break the query', async () => {
      await resolver.resolve(
        shop,
        rules({
          includeMode: CampaignIncludeMode.SPECIFIC,
          targets: [
            {
              mode: CampaignTargetMode.INCLUDE,
              targetType: CampaignTargetType.VENDOR,
              targetValue: "O'Neill",
            },
          ],
        }),
      );
      expect(adapter.listVariantsMatching).toHaveBeenCalledWith(
        shop,
        "vendor:'O\\'Neill'",
        expect.anything(),
      );
    });
  });

  describe('draft and archived', () => {
    it('drops non-active products', async () => {
      adapter.listVariantsMatching.mockResolvedValue({
        variants: [
          variant('live'),
          variant('draft', { productStatus: ShopifyProductStatus.DRAFT }),
          variant('old', { productStatus: ShopifyProductStatus.ARCHIVED }),
        ],
        truncated: false,
      });

      const result = await resolver.resolve(shop, rules());
      expect(result.variantIds).toEqual(['gid://v/live']);
    });

    it('applies independently of the exclusion switch', async () => {
      // A blanket safety setting, not one of the merchant's exclusion rules:
      // turning the exclusion list off must not start repricing archived
      // products.
      adapter.listVariantsMatching.mockResolvedValue({
        variants: [
          variant('draft', { productStatus: ShopifyProductStatus.DRAFT }),
        ],
        truncated: false,
      });

      const result = await resolver.resolve(
        shop,
        rules({ excludeDraftArchived: true, exclusionsEnabled: false }),
      );
      expect(result.variantIds).toEqual([]);
    });

    it('keeps them when the merchant turns the setting off', async () => {
      adapter.listVariantsMatching.mockResolvedValue({
        variants: [
          variant('draft', { productStatus: ShopifyProductStatus.DRAFT }),
        ],
        truncated: false,
      });

      const result = await resolver.resolve(
        shop,
        rules({ excludeDraftArchived: false }),
      );
      expect(result.variantIds).toHaveLength(1);
    });
  });

  describe('exclusions', () => {
    const catalog = [
      variant('keep', { productVendor: 'Acme', productTags: ['new'] }),
      variant('drop', { productVendor: 'Other', productTags: ['clearance'] }),
    ];

    beforeEach(() => {
      adapter.listVariantsMatching.mockResolvedValue({
        variants: catalog,
        truncated: false,
      });
    });

    it('are ignored while the switch is off', async () => {
      const result = await resolver.resolve(
        shop,
        rules({
          exclusionsEnabled: false,
          targets: [
            {
              mode: CampaignTargetMode.EXCLUDE,
              targetType: CampaignTargetType.TAG,
              targetValue: 'clearance',
            },
          ],
        }),
      );
      expect(result.variantIds).toHaveLength(2);
    });

    it('subtract by tag when the switch is on', async () => {
      const result = await resolver.resolve(
        shop,
        rules({
          exclusionsEnabled: true,
          targets: [
            {
              mode: CampaignTargetMode.EXCLUDE,
              targetType: CampaignTargetType.TAG,
              targetValue: 'clearance',
            },
          ],
        }),
      );
      expect(result.variantIds).toEqual(['gid://v/keep']);
      expect(result.excludedVariantCount).toBe(1);
    });

    it('match a tag case-insensitively', async () => {
      // Shopify treats tags that way; excluding "Clearance" must catch
      // products tagged "clearance".
      const result = await resolver.resolve(
        shop,
        rules({
          exclusionsEnabled: true,
          targets: [
            {
              mode: CampaignTargetMode.EXCLUDE,
              targetType: CampaignTargetType.TAG,
              targetValue: 'CLEARANCE',
            },
          ],
        }),
      );
      expect(result.variantIds).toEqual(['gid://v/keep']);
    });

    it('subtract by vendor', async () => {
      const result = await resolver.resolve(
        shop,
        rules({
          exclusionsEnabled: true,
          targets: [
            {
              mode: CampaignTargetMode.EXCLUDE,
              targetType: CampaignTargetType.VENDOR,
              targetValue: 'other',
            },
          ],
        }),
      );
      expect(result.variantIds).toEqual(['gid://v/keep']);
    });

    it('subtract a single variant, not its whole product', async () => {
      adapter.listVariantsMatching.mockResolvedValue({
        variants: [
          variant('small'),
          { ...variant('small'), variantId: 'gid://v/xl' },
        ],
        truncated: false,
      });

      const result = await resolver.resolve(
        shop,
        rules({
          exclusionsEnabled: true,
          targets: [
            {
              mode: CampaignTargetMode.EXCLUDE,
              targetType: CampaignTargetType.VARIANT,
              targetValue: 'gid://v/xl',
            },
          ],
        }),
      );
      // "This whole collection except the extra-large" — the case that cannot
      // be expressed at product granularity.
      expect(result.variantIds).toEqual(['gid://v/small']);
    });

    it('win over an include that matches the same variant', async () => {
      adapter.listVariantsMatching.mockResolvedValue({
        variants: [
          variant('contested', { productTags: ['sale', 'clearance'] }),
        ],
        truncated: false,
      });

      const result = await resolver.resolve(
        shop,
        rules({
          includeMode: CampaignIncludeMode.SPECIFIC,
          exclusionsEnabled: true,
          targets: [
            {
              mode: CampaignTargetMode.INCLUDE,
              targetType: CampaignTargetType.TAG,
              targetValue: 'sale',
            },
            {
              mode: CampaignTargetMode.EXCLUDE,
              targetType: CampaignTargetType.TAG,
              targetValue: 'clearance',
            },
          ],
        }),
      );
      // The constitution's rule: exclusions always win.
      expect(result.variantIds).toEqual([]);
    });
  });

  describe('reporting', () => {
    it('passes truncation through rather than hiding it', async () => {
      adapter.listVariantsMatching.mockResolvedValue({
        variants: [variant('1')],
        truncated: true,
      });
      const result = await resolver.resolve(shop, rules());
      expect(result.truncated).toBe(true);
    });

    it('reports the distinct products behind the variants', async () => {
      adapter.listVariantsMatching.mockResolvedValue({
        variants: [
          variant('a'),
          { ...variant('a'), variantId: 'gid://v/a2' },
          variant('b'),
        ],
        truncated: false,
      });
      const result = await resolver.resolve(shop, rules());
      expect(result.variantIds).toHaveLength(3);
      expect(result.productIds).toHaveLength(2);
    });
  });
});
