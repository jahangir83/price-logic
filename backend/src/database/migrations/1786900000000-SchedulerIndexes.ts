import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Indexes the scheduler needs.
 *
 * Every existing `campaigns` index leads with `shop_id`, which suits a
 * merchant browsing their own list. The scheduler asks a different question —
 * "which campaigns *anywhere* are due?" — and none of those indexes can answer
 * it, so the sweep planned as a sequential scan over the whole table every
 * thirty seconds.
 *
 * Both are partial: they index only rows that could ever be due, so they stay
 * small however many finished campaigns accumulate.
 */
export class SchedulerIndexes1786900000000 implements MigrationInterface {
  name = 'SchedulerIndexes1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_campaigns_due_start" ON "campaigns" ("start_at")
        WHERE "status" = 'SCHEDULED'
          AND "start_at" IS NOT NULL
          AND "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_campaigns_due_end" ON "campaigns" ("end_at")
        WHERE "status" = 'ACTIVE'
          AND "end_at" IS NOT NULL
          AND "deleted_at" IS NULL
    `);

    /*
     * Revert reads every APPLIED row for a campaign. The existing
     * (shop_id, campaign_id) index gets close, but a long-running campaign
     * accumulates SKIPPED and REVERTED rows that this filter then discards.
     */
    await queryRunner.query(`
      CREATE INDEX "IDX_price_changes_campaign_applied"
        ON "price_changes" ("campaign_id")
        WHERE "status" = 'APPLIED'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const index of [
      'IDX_price_changes_campaign_applied',
      'IDX_campaigns_due_end',
      'IDX_campaigns_due_start',
    ]) {
      await queryRunner.query(`DROP INDEX IF EXISTS "public"."${index}"`);
    }
  }
}
