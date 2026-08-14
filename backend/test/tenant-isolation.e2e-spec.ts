import { DataSource } from 'typeorm';

/**
 * Proves the tenancy model at the database level.
 *
 * The application layer scopes queries through TenantScopedRepository, but
 * that is a convention a future contributor can forget. These tests assert
 * the constraint underneath it: a composite foreign key on
 * `(shop_id, parent_id) → parent(shop_id, id)` makes a cross-tenant reference
 * *unrepresentable*, so leaking one merchant's data into another's records
 * requires a schema change rather than a forgotten WHERE clause.
 *
 * Requires a real PostgreSQL instance — these constraints cannot be exercised
 * against a mock, which is precisely why they are tested here.
 */
describe('tenant isolation (database constraints)', () => {
  let dataSource: DataSource;

  const SHOP_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const SHOP_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
  const CAMPAIGN_A = 'cccccccc-0000-4000-8000-00000000000c';

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      synchronize: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query(
      `DELETE FROM price_changes WHERE shop_id IN ($1, $2)`,
      [SHOP_A, SHOP_B],
    );
    await dataSource.query(`DELETE FROM campaigns WHERE shop_id IN ($1, $2)`, [
      SHOP_A,
      SHOP_B,
    ]);
    await dataSource.query(`DELETE FROM shops WHERE id IN ($1, $2)`, [
      SHOP_A,
      SHOP_B,
    ]);

    await dataSource.query(
      `INSERT INTO shops (id, shopify_shop_id, shop_domain, access_token_encrypted)
       VALUES ($1, 'shop-a', 'a.myshopify.com', 'ciphertext'),
              ($2, 'shop-b', 'b.myshopify.com', 'ciphertext')`,
      [SHOP_A, SHOP_B],
    );
    await dataSource.query(
      `INSERT INTO campaigns (id, shop_id, title) VALUES ($1, $2, 'Shop A campaign')`,
      [CAMPAIGN_A, SHOP_A],
    );
  });

  const insertPriceChange = (shopId: string, variantId: string) =>
    dataSource.query(
      `INSERT INTO price_changes
         (shop_id, campaign_id, shopify_product_id, shopify_variant_id,
          product_title, old_price, new_price)
       VALUES ($1, $2, 'gid://shopify/Product/1', $3, 'Tee', '24.9900', '19.9900')`,
      [shopId, CAMPAIGN_A, variantId],
    );

  it('accepts a price change that references a campaign in its own shop', async () => {
    await expect(
      insertPriceChange(SHOP_A, 'gid://shopify/ProductVariant/1'),
    ).resolves.toBeDefined();
  });

  it('rejects a price change in shop B that references shop A’s campaign', async () => {
    await expect(
      insertPriceChange(SHOP_B, 'gid://shopify/ProductVariant/9'),
    ).rejects.toThrow(/FK_price_changes_campaign_shop/);
  });

  it('rejects a second price change for the same campaign and variant', async () => {
    // The retry guard: re-running an activation must not double-apply.
    await insertPriceChange(SHOP_A, 'gid://shopify/ProductVariant/1');
    await expect(
      insertPriceChange(SHOP_A, 'gid://shopify/ProductVariant/1'),
    ).rejects.toThrow(/IDX_price_changes_campaign_variant/);
  });

  it('refuses to delete a shop that still owns data', async () => {
    await expect(
      dataSource.query(`DELETE FROM shops WHERE id = $1`, [SHOP_A]),
    ).rejects.toThrow(/violates foreign key constraint/);
  });
});

describe('campaign consistency (check constraints)', () => {
  let dataSource: DataSource;
  const SHOP = 'dddddddd-0000-4000-8000-00000000000d';

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.query(`DELETE FROM campaigns WHERE shop_id = $1`, [SHOP]);
    await dataSource.query(`DELETE FROM shops WHERE id = $1`, [SHOP]);
    await dataSource.query(
      `INSERT INTO shops (id, shopify_shop_id, shop_domain, access_token_encrypted)
       VALUES ($1, 'shop-d', 'd.myshopify.com', 'ciphertext')`,
      [SHOP],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM campaigns WHERE shop_id = $1`, [
        SHOP,
      ]);
      await dataSource.query(`DELETE FROM shops WHERE id = $1`, [SHOP]);
      await dataSource.destroy();
    }
  });

  it('rejects a SHEET campaign with no import attached', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO campaigns (shop_id, title, price_source)
         VALUES ($1, 'no import', 'SHEET')`,
        [SHOP],
      ),
    ).rejects.toThrow(/CHK_campaigns_price_source/);
  });

  it('rejects a half-specified adjustment', async () => {
    // unit, direction and value are all-or-nothing.
    await expect(
      dataSource.query(
        `INSERT INTO campaigns (shop_id, title, adjustment_unit)
         VALUES ($1, 'half adjustment', 'PERCENTAGE')`,
        [SHOP],
      ),
    ).rejects.toThrow(/CHK_campaigns_adjustment_group/);
  });

  it('accepts a fully specified adjustment', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO campaigns
           (shop_id, title, adjustment_unit, adjustment_direction, adjustment_value)
         VALUES ($1, 'full adjustment', 'PERCENTAGE', 'DECREASE', '20.0000')`,
        [SHOP],
      ),
    ).resolves.toBeDefined();
  });

  it('rejects a campaign that ends before it starts', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO campaigns (shop_id, title, start_at, end_at)
         VALUES ($1, 'backwards', now(), now() - interval '1 day')`,
        [SHOP],
      ),
    ).rejects.toThrow(/CHK_campaigns_window/);
  });
});
