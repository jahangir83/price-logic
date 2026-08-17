import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignBasis,
  CampaignIncludeMode,
  CampaignPriceSource,
  ShopifyProductStatus,
} from '@pricelogic/shared';
import {
  ShopifyAdminService,
  type CatalogVariant,
} from '../../shopify/services/shopify-admin.service';
import { Shop } from '../../shops/entities/shop.entity';
import { CampaignTargetsService } from './campaign-targets.service';
import { CampaignsService } from './campaigns.service';
import { Campaign } from '../entities/campaign.entity';
import { CampaignPreviewService } from './preview.service';
import { TargetResolverService } from './target-resolver.service';

const shop = { id: 'shop-1', currency: 'GBP' } as Shop;

const campaignOf = (overrides: Partial<Campaign> = {}): Campaign =>
  ({
    id: 'campaign-1',
    shopId: 'shop-1',
    title: 'Sale',
    priceSource: CampaignPriceSource.SHOPIFY_CURRENT,
    basis: CampaignBasis.PRICE,
    adjustmentUnit: CampaignAdjustmentUnit.PERCENTAGE,
    adjustmentDirection: CampaignAdjustmentDirection.DECREASE,
    adjustmentValue: '20',
    roundTo: null,
    roundStrategy: 'UP',
    setCompareAt: false,
    includeMode: CampaignIncludeMode.ALL_PRODUCTS,
    excludeDraftArchived: true,
    exclusionsEnabled: false,
    addTags: [],
    removeTags: [],
    ...overrides,
  }) as Campaign;

const variant = (
  id: string,
  price: string,
  overrides: Partial<CatalogVariant> = {},
): CatalogVariant => ({
  variantId: `gid://v/${id}`,
  productId: `gid://p/${id}`,
  productTitle: `Product ${id}`,
  variantTitle: 'Default',
  sku: `SKU-${id}`,
  price,
  compareAtPrice: null,
  barcode: null,
  inventoryQuantity: null,
  productStatus: ShopifyProductStatus.ACTIVE,
  productTags: [],
  productVendor: null,
  productType: null,
  ...overrides,
});

describe('CampaignPreviewService', () => {
  const build = (campaign: Campaign, variants: CatalogVariant[]) => {
    const campaigns = {
      findOne: jest.fn().mockResolvedValue(campaign),
    } as unknown as CampaignsService;
    const targets = {
      list: jest.fn().mockResolvedValue([]),
    } as unknown as CampaignTargetsService;
    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        variants,
        variantIds: variants.map((v) => v.variantId),
        productIds: [...new Set(variants.map((v) => v.productId))],
        excludedVariantCount: 0,
        truncated: false,
      }),
    } as unknown as TargetResolverService;
    const shopify = {} as ShopifyAdminService;

    return new CampaignPreviewService(campaigns, targets, resolver, shopify);
  };

  it('prices every resolved variant', async () => {
    const service = build(campaignOf(), [
      variant('1', '100.00'),
      variant('2', '50.00'),
    ]);
    const preview = await service.preview(shop, 'campaign-1');

    expect(preview.totalVariants).toBe(2);
    expect(preview.changedVariants).toBe(2);
    expect(preview.rows[0]?.newPrice).toBe('80.0000');
  });

  it('uses the shop’s currency, not a hard-coded one', async () => {
    const service = build(campaignOf(), [variant('1', '100.00')]);
    const preview = await service.preview(shop, 'campaign-1');
    expect(preview.rows[0]?.currency).toBe('GBP');
  });

  it('treats zero matched variants as a valid empty preview', async () => {
    // "Nothing matched" is information the merchant needs, not an error.
    const service = build(campaignOf(), []);
    const preview = await service.preview(shop, 'campaign-1');
    expect(preview.totalVariants).toBe(0);
    expect(preview.rows).toEqual([]);
  });

  it('shows rows that will change before those that will not', async () => {
    const service = build(campaignOf({ adjustmentValue: '0' }), [
      variant('unchanged', '100.00'),
    ]);
    const preview = await service.preview(shop, 'campaign-1');
    expect(preview.changedVariants).toBe(0);
    expect(preview.rows[0]?.changed).toBe(false);
    expect(preview.rows[0]?.note).toBe('Already at this price.');
  });

  it('explains a variant it had to skip', async () => {
    const service = build(
      campaignOf({
        adjustmentUnit: CampaignAdjustmentUnit.FIXED_AMOUNT,
        adjustmentValue: '500',
      }),
      [variant('cheap', '10.00')],
    );
    const preview = await service.preview(shop, 'campaign-1');
    expect(preview.rows[0]?.changed).toBe(false);
    expect(preview.rows[0]?.note).toMatch(/larger than the price/);
  });

  it('skips a compare-at basis variant that has no compare-at', async () => {
    const service = build(
      campaignOf({ basis: CampaignBasis.COMPARE_AT_PRICE }),
      [variant('1', '100.00', { compareAtPrice: null })],
    );
    const preview = await service.preview(shop, 'campaign-1');
    expect(preview.rows[0]?.changed).toBe(false);
    expect(preview.rows[0]?.note).toMatch(/no compare-at price/);
  });

  it('counts products for tagging only when the campaign changes tags', async () => {
    const withoutTags = build(campaignOf(), [variant('1', '100.00')]);
    expect((await withoutTags.preview(shop, 'campaign-1')).taggedProducts).toBe(
      0,
    );

    const withTags = build(campaignOf({ addTags: ['sale'] }), [
      variant('1', '100.00'),
    ]);
    expect((await withTags.preview(shop, 'campaign-1')).taggedProducts).toBe(1);
  });

  it('paginates without changing the totals', async () => {
    const variants = Array.from({ length: 30 }, (_, i) =>
      variant(String(i), '100.00'),
    );
    const service = build(campaignOf(), variants);

    const first = await service.preview(shop, 'campaign-1', { pageSize: 10 });
    expect(first.rows).toHaveLength(10);
    // The totals describe the campaign, not the page.
    expect(first.totalVariants).toBe(30);

    const third = await service.preview(shop, 'campaign-1', {
      page: 3,
      pageSize: 10,
    });
    expect(third.rows).toHaveLength(10);
    expect(third.rows[0]?.shopifyVariantId).not.toBe(
      first.rows[0]?.shopifyVariantId,
    );
  });
});

/**
 * The constitution's rule, and the highest-value test in this phase: a price
 * the client sends must never influence what gets written.
 */
describe('server-side recalculation', () => {
  it('ignores any price a caller supplies', async () => {
    const campaign = campaignOf();
    const campaigns = {
      findOne: jest.fn().mockResolvedValue(campaign),
    } as unknown as CampaignsService;
    const targets = {
      list: jest.fn().mockResolvedValue([]),
    } as unknown as CampaignTargetsService;

    // The variant genuinely costs 100. A tampered client claims otherwise by
    // stuffing extra fields into the payload it sends back.
    const tampered = {
      ...variant('1', '100.00'),
      newPrice: '1.0000',
      price_override: '1.0000',
      approvedPrice: '1.0000',
    } as CatalogVariant;

    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        variants: [tampered],
        variantIds: [tampered.variantId],
        productIds: [tampered.productId],
        excludedVariantCount: 0,
        truncated: false,
      }),
    } as unknown as TargetResolverService;

    const service = new CampaignPreviewService(
      campaigns,
      targets,
      resolver,
      {} as ShopifyAdminService,
    );

    const preview = await service.preview(shop, 'campaign-1');

    // 20% off the real 100, not the 1.00 the payload asked for.
    expect(preview.rows[0]?.newPrice).toBe('80.0000');
    expect(preview.rows[0]?.newPrice).not.toBe('1.0000');
  });

  it('recomputes from the campaign row, so editing it changes the answer', async () => {
    // The campaign is the only input a merchant controls, and it reaches the
    // price through the database rather than through a request body.
    const variants = [variant('1', '100.00')];
    const twenty = new CampaignPreviewService(
      {
        findOne: jest.fn().mockResolvedValue(campaignOf()),
      } as unknown as CampaignsService,
      {
        list: jest.fn().mockResolvedValue([]),
      } as unknown as CampaignTargetsService,
      {
        resolve: jest.fn().mockResolvedValue({
          variants,
          variantIds: [],
          productIds: [],
          excludedVariantCount: 0,
          truncated: false,
        }),
      } as unknown as TargetResolverService,
      {} as ShopifyAdminService,
    );
    const fifty = new CampaignPreviewService(
      {
        findOne: jest
          .fn()
          .mockResolvedValue(campaignOf({ adjustmentValue: '50' })),
      } as unknown as CampaignsService,
      {
        list: jest.fn().mockResolvedValue([]),
      } as unknown as CampaignTargetsService,
      {
        resolve: jest.fn().mockResolvedValue({
          variants,
          variantIds: [],
          productIds: [],
          excludedVariantCount: 0,
          truncated: false,
        }),
      } as unknown as TargetResolverService,
      {} as ShopifyAdminService,
    );

    expect((await twenty.preview(shop, 'c')).rows[0]?.newPrice).toBe('80.0000');
    expect((await fifty.preview(shop, 'c')).rows[0]?.newPrice).toBe('50.0000');
  });
});

describe('the shop’s minimum price', () => {
  // The calculator has always taken a floor and always floored correctly. What
  // was missing was anyone passing the merchant's. These cover the wire, not
  // the arithmetic — `calculate.spec.ts` owns that.
  const build = (shopOverride: Shop, variants: CatalogVariant[]) => {
    const campaigns = {
      findOne: jest
        .fn()
        .mockResolvedValue(campaignOf({ adjustmentValue: '90' })),
    } as unknown as CampaignsService;
    const targets = {
      list: jest.fn().mockResolvedValue([]),
    } as unknown as CampaignTargetsService;
    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        variants,
        variantIds: variants.map((v) => v.variantId),
        productIds: [...new Set(variants.map((v) => v.productId))],
        excludedVariantCount: 0,
        truncated: false,
      }),
    } as unknown as TargetResolverService;

    return new CampaignPreviewService(
      campaigns,
      targets,
      resolver,
      {} as ShopifyAdminService,
    );
  };

  const shopWith = (settings: Record<string, unknown>): Shop =>
    ({ id: 'shop-1', currency: 'GBP', defaultSettings: settings }) as Shop;

  it('skips a variant the floor would clamp, rather than selling it at the floor', async () => {
    // 90% off £50 is £5, which is under the merchant's £10 floor. Writing £10
    // would be a price they never chose; writing £5 is the one they set the
    // floor to prevent. Leaving it alone is the only honest option.
    const service = build(shopWith({ minimumPrice: '10.00' }), [
      variant('1', '50.00'),
    ]);

    const pricing = await service.price(
      shopWith({ minimumPrice: '10.00' }),
      'c',
    );

    expect(pricing.rows[0]?.applies).toBe(false);
    expect(pricing.rows[0]?.result.outcome).toBe('FLOORED');
  });

  it('applies a variant that stays above the floor', async () => {
    const shopUnder = shopWith({ minimumPrice: '1.00' });
    const service = build(shopUnder, [variant('1', '50.00')]);

    const pricing = await service.price(shopUnder, 'c');

    expect(pricing.rows[0]?.applies).toBe(true);
  });

  it('says the floor was the merchant’s when they raised it', async () => {
    const shopHigh = shopWith({ minimumPrice: '10.00' });
    const service = build(shopHigh, [variant('1', '50.00')]);

    const pricing = await service.price(shopHigh, 'c');

    expect(pricing.rows[0]?.note).toContain('your minimum price');
  });

  it('does not blame the merchant for the built-in floor', async () => {
    // At the default 0.01 the clamp is a rounding guard, not a choice they
    // made. Saying "below your minimum price" sends them hunting for a setting
    // they never touched.
    const shopDefault = shopWith({ minimumPrice: '0.01' });
    const service = build(shopDefault, [variant('1', '0.01')]);

    const pricing = await service.price(shopDefault, 'c');

    expect(pricing.rows[0]?.note).not.toContain('your minimum price');
  });

  it('treats a shop with no stored settings as having the defaults', async () => {
    // Every shop installed before defaults were seeded has `{}` here.
    const legacy = shopWith({});
    const service = build(legacy, [variant('1', '50.00')]);

    const pricing = await service.price(legacy, 'c');

    expect(pricing.rows[0]?.applies).toBe(true);
    expect(pricing.rows[0]?.result.newPrice).toBe('5.0000');
  });
});

describe('out of stock', () => {
  const build = (variants: CatalogVariant[]) => {
    const campaigns = {
      findOne: jest.fn().mockResolvedValue(campaignOf()),
    } as unknown as CampaignsService;
    const targets = {
      list: jest.fn().mockResolvedValue([]),
    } as unknown as CampaignTargetsService;
    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        variants,
        variantIds: variants.map((v) => v.variantId),
        productIds: [...new Set(variants.map((v) => v.productId))],
        excludedVariantCount: 0,
        truncated: false,
      }),
    } as unknown as TargetResolverService;

    return new CampaignPreviewService(
      campaigns,
      targets,
      resolver,
      {} as ShopifyAdminService,
    );
  };

  const shopWith = (settings: Record<string, unknown>): Shop =>
    ({ id: 'shop-1', currency: 'GBP', defaultSettings: settings }) as Shop;

  it('leaves a variant with no stock alone', async () => {
    const service = build([variant('1', '100.00', { inventoryQuantity: 0 })]);

    const pricing = await service.price(shopWith({}), 'c');

    expect(pricing.rows[0]?.applies).toBe(false);
    expect(pricing.rows[0]?.note).toContain('Out of stock');
  });

  it('leaves the price untouched on a skipped variant', async () => {
    // Not "priced then discarded" — the row reports the price it already has,
    // so nothing downstream can mistake it for a change worth writing.
    const service = build([variant('1', '100.00', { inventoryQuantity: 0 })]);

    const pricing = await service.price(shopWith({}), 'c');

    expect(pricing.rows[0]?.result.newPrice).toBe('100.00');
    expect(pricing.rows[0]?.result.changed).toBe(false);
  });

  it('treats a negative quantity as out of stock', async () => {
    // Shopify reports oversold variants as negative.
    const service = build([variant('1', '100.00', { inventoryQuantity: -2 })]);

    const pricing = await service.price(shopWith({}), 'c');

    expect(pricing.rows[0]?.applies).toBe(false);
  });

  it('does not treat untracked inventory as out of stock', async () => {
    // Null means Shopify is not tracking this variant. Reading it as zero would
    // silently stop repricing most of a store.
    const service = build([
      variant('1', '100.00', { inventoryQuantity: null }),
    ]);

    const pricing = await service.price(shopWith({}), 'c');

    expect(pricing.rows[0]?.applies).toBe(true);
  });

  it('prices an out-of-stock variant when the merchant turned the rule off', async () => {
    // A merchant restocking next week may want the sale price already set.
    const service = build([variant('1', '100.00', { inventoryQuantity: 0 })]);

    const pricing = await service.price(
      shopWith({ skipOutOfStock: false }),
      'c',
    );

    expect(pricing.rows[0]?.applies).toBe(true);
    expect(pricing.rows[0]?.result.newPrice).toBe('80.0000');
  });
});
