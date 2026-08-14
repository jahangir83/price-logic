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
  const JOB_A = 'dddddddd-1111-4000-8000-00000000001d';
  const JOB_A2 = 'dddddddd-2222-4000-8000-00000000002d';

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
    await dataSource.query(`DELETE FROM jobs WHERE shop_id IN ($1, $2)`, [
      SHOP_A,
      SHOP_B,
    ]);
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
    // Two executions of the same campaign: an activation, then a re-run.
    await dataSource.query(
      `INSERT INTO jobs (id, shop_id, type, campaign_id)
       VALUES ($1, $3, 'CAMPAIGN_ACTIVATE', $4),
              ($2, $3, 'CAMPAIGN_ACTIVATE', $4)`,
      [JOB_A, JOB_A2, SHOP_A, CAMPAIGN_A],
    );
  });

  const insertPriceChange = (
    shopId: string,
    variantId: string,
    jobId: string = JOB_A,
  ) =>
    dataSource.query(
      `INSERT INTO price_changes
         (shop_id, campaign_id, job_id, shopify_product_id, shopify_variant_id,
          product_title, old_price, new_price)
       VALUES ($1, $2, $4, 'gid://shopify/Product/1', $3, 'Tee', '24.9900', '19.9900')`,
      [shopId, CAMPAIGN_A, variantId, jobId],
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

  it('rejects a second price change for the same execution and variant', async () => {
    // The retry guard: re-running one activation must not double-apply.
    await insertPriceChange(SHOP_A, 'gid://shopify/ProductVariant/1');
    await expect(
      insertPriceChange(SHOP_A, 'gid://shopify/ProductVariant/1'),
    ).rejects.toThrow(/IDX_price_changes_job_variant/);
  });

  it('lets a later execution touch the same variant again', async () => {
    /*
     * The bug the job_id key fixes. Uniqueness used to be
     * (campaign_id, variant), so a campaign could hold exactly one row per
     * variant forever — a second activation had to overwrite the first run's
     * old_price and, with it, the price revert would need to restore.
     * Keyed on the execution, the runs accumulate instead.
     */
    await insertPriceChange(SHOP_A, 'gid://shopify/ProductVariant/1', JOB_A);
    await expect(
      insertPriceChange(SHOP_A, 'gid://shopify/ProductVariant/1', JOB_A2),
    ).resolves.toBeDefined();

    const rows: unknown[] = await dataSource.query(
      `SELECT id FROM price_changes
        WHERE campaign_id = $1 AND shopify_variant_id = $2`,
      [CAMPAIGN_A, 'gid://shopify/ProductVariant/1'],
    );
    expect(rows).toHaveLength(2);
  });

  it('refuses a price change whose execution belongs to another shop', async () => {
    // shop_id + job_id must agree, the same way shop_id + campaign_id must.
    await expect(
      insertPriceChange(SHOP_B, 'gid://shopify/ProductVariant/9', JOB_A),
    ).rejects.toThrow(/FK_price_changes_(campaign|job)_shop/);
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
