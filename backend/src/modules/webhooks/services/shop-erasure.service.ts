import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Deleting everything belonging to one shop, for `shop/redact`.
 *
 * Shopify requires this within 48 hours of an uninstall, and getting it wrong
 * is an App Store rejection. Two things make it fiddly:
 *
 * 1. Almost every foreign key is `ON DELETE RESTRICT`, deliberately — nothing
 *    in normal operation should be able to cascade a merchant's price history
 *    away. That means the order below is not cosmetic; it is the only order
 *    that works, and a new table added in the wrong place will fail loudly
 *    rather than silently orphan rows.
 *
 * 2. It runs in one transaction. A half-deleted shop is worse than a
 *    not-deleted one: it fails the next attempt on a foreign key and leaves
 *    nothing obvious to fix.
 */
@Injectable()
export class ShopErasureService {
  private readonly logger = new Logger(ShopErasureService.name);

  /**
   * Children before parents. `job_dependencies` and `job_executions` would
   * cascade from `jobs` anyway, but they are listed explicitly so this reads
   * as the full inventory rather than relying on which keys happen to cascade.
   */
  private static readonly DELETION_ORDER = [
    'job_dependencies',
    'job_executions',
    'product_tag_changes',
    'price_changes',
    'jobs',
    'campaign_targets',
    'campaigns',
    'csv_rows',
    'csv_imports',
    'suppliers',
    'store_subscription_events',
    'store_subscriptions',
    'store_usage',
  ] as const;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Erase a shop and everything it owns.
   *
   * Returns the row counts, which the handler logs — a redaction that silently
   * deleted nothing because the domain did not match is a compliance failure
   * that looks like a success.
   */
  async eraseByDomain(shopDomain: string): Promise<{
    shopId: string | null;
    deleted: Record<string, number>;
  }> {
    return this.dataSource.transaction(async (manager) => {
      const [shop] = await manager.query<{ id: string }[]>(
        `SELECT id FROM shops WHERE shop_domain = $1`,
        [shopDomain],
      );

      if (!shop) {
        // Already gone, or never installed. Not an error — Shopify may redact
        // a shop we removed on uninstall, and it still expects a 200.
        this.logger.log(`shop/redact for unknown shop ${shopDomain}`);
        return { shopId: null, deleted: {} };
      }

      const deleted: Record<string, number> = {};
      for (const table of ShopErasureService.DELETION_ORDER) {
        const result: unknown[] = await manager.query(
          `DELETE FROM "${table}" WHERE shop_id = $1`,
          [shop.id],
        );
        // node-postgres returns [rows, rowCount] for DELETE.
        deleted[table] = Number(result[1] ?? 0);
      }

      const shopResult: unknown[] = await manager.query(
        `DELETE FROM shops WHERE id = $1`,
        [shop.id],
      );
      deleted.shops = Number(shopResult[1] ?? 0);

      const total = Object.values(deleted).reduce((sum, n) => sum + n, 0);
      this.logger.log(
        `Erased shop ${shopDomain} (${shop.id}): ${total} row(s) across ${
          Object.keys(deleted).length
        } tables`,
      );

      return { shopId: shop.id, deleted };
    });
  }
}
