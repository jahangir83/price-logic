import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What the matched product is called.
 *
 * The SKU lookup already asks Shopify for `product { title }` and the variant's
 * own title, and threw both away for want of somewhere to put them — leaving
 * the approval screen a list of bare SKU codes. A merchant reviewing four
 * hundred rows can see that `AC-9912-BLK` is going from £14 to £17 and cannot
 * tell what it is.
 *
 * Nullable, and no backfill. An existing row's titles would have to be fetched
 * from Shopify one sheet at a time inside a migration, which is a network call
 * in a transaction — the wrong place by some distance. Re-matching a sheet
 * fills them in; until then the screen falls back to the SKU exactly as it does
 * today.
 */
export class CsvRowProductTitles1787100000000 implements MigrationInterface {
  name = 'CsvRowProductTitles1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "csv_rows"
        ADD COLUMN "product_title" varchar,
        ADD COLUMN "variant_title" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "csv_rows"
        DROP COLUMN "variant_title",
        DROP COLUMN "product_title"
    `);
  }
}
