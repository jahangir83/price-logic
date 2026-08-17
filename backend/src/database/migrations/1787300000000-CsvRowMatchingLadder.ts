import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The other two identifiers a supplier sheet can carry, and which one worked.
 *
 * `matched_by` is the interesting column. Matching stops being a yes/no once
 * there is a ladder, and "found by barcode after the SKU missed" is a materially
 * weaker claim than "the SKU matched" — the merchant reviewing four hundred
 * rows should be able to see which is which, and sort the weak ones to the top.
 *
 * A varchar rather than a Postgres enum: this list will grow (manual mapping is
 * the next rung) and every addition to an enum type is a migration that locks
 * the table against writes for its duration. The values are constrained by
 * `MatchStrategy` in the shared package, which the entity `implements`.
 */
export class CsvRowMatchingLadder1787300000000 implements MigrationInterface {
  name = 'CsvRowMatchingLadder1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "csv_rows"
        ADD COLUMN "supplier_sku" varchar,
        ADD COLUMN "barcode" varchar,
        ADD COLUMN "matched_by" varchar
    `);

    /*
     * Every row already matched got there by its SKU, because that was the
     * only way there was. Backfilling is honest rather than convenient: left
     * null, existing matched rows would read as "matched by nothing", which is
     * a thing that cannot happen and would make the column untrustworthy from
     * its first day.
     */
    await queryRunner.query(`
      UPDATE "csv_rows"
         SET "matched_by" = 'SKU'
       WHERE "status" = 'MATCHED'
         AND "shopify_variant_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "csv_rows"
        DROP COLUMN "matched_by",
        DROP COLUMN "barcode",
        DROP COLUMN "supplier_sku"
    `);
  }
}
