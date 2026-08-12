import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `(shop_id, created_at)` indexes for the "recent activity" tables a
 * merchant browses by recency (db #44 lists `created_at` as a minimum
 * index). Hand-written rather than using the raw `migration:generate`
 * output — TypeORM's schema diff doesn't know about the composite unique
 * constraints and foreign keys added by hand in
 * AddTenantConsistencyForeignKeys (they aren't expressed via entity
 * decorators), so the generated migration tried to drop and recreate all
 * of them just to add these three indexes. Keeping only the actual change.
 */
export class AddCreatedAtActivityIndexes1786176160795 implements MigrationInterface {
  name = 'AddCreatedAtActivityIndexes1786176160795';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_77648d94b34ace145ddc1f43f8" ON "pricing_operations" ("shop_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12fdfd5fc94c750478baaf12eb" ON "imports" ("shop_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f767834e179af987ba1decd5f" ON "campaigns" ("shop_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f767834e179af987ba1decd5f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12fdfd5fc94c750478baaf12eb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77648d94b34ace145ddc1f43f8"`,
    );
  }
}
