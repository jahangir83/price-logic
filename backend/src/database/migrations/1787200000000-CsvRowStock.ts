import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How many of this variant exist, on each side.
 *
 * `sheet_stock` is what the supplier's file said; `stock_quantity` is what
 * Shopify reported when the row was matched. Both nullable, and null is load
 * bearing: it means "nobody said", which is not the same as zero. Most sheets
 * carry no stock column at all, and plenty of variants have untracked
 * inventory — defaulting either to 0 would leave every one of them looking out
 * of stock and silently unpriceable.
 *
 * Integers rather than a boolean, because "how many" answers questions a flag
 * cannot: a merchant deciding whether two left is worth promoting wants the
 * two.
 */
export class CsvRowStock1787200000000 implements MigrationInterface {
  name = 'CsvRowStock1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "csv_rows"
        ADD COLUMN "sheet_stock" integer,
        ADD COLUMN "stock_quantity" integer
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "csv_rows"
        DROP COLUMN "stock_quantity",
        DROP COLUMN "sheet_stock"
    `);
  }
}
