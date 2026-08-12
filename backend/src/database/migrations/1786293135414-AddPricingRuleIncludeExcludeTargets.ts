import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replaces the single-scope targeting model on `pricing_rules`
 * (`scope_type` + `scope_reference`) with an include/exclude target set.
 *
 * The old pair could only ever name one thing, so it could not express
 * "all products except these", multiple include targets, or targeting by
 * tag/vendor/product type — all of which the merchant-facing rule and
 * campaign editors require. Targeting now lives in `pricing_rule_targets`,
 * with `include_mode` on the rule deciding whether the include side starts
 * from the whole catalog or from the INCLUDE rows.
 *
 * `scope_type`/`scope_reference` are dropped rather than kept alongside the
 * new model: nothing reads them yet (no phase past 2 is implemented), and
 * leaving two competing targeting representations in the schema is how
 * scope bugs get written later. `ALL_PRODUCTS` is the successor to the old
 * `SHOP` scope; the other three old scope values become target rows.
 *
 * Hand-written, not raw `migration:generate` output — see the constitution:
 * the generated version additionally proposed dropping all 17 composite
 * tenant-consistency foreign keys and 6 unique constraints, because those
 * aren't expressible via entity decorators and so aren't visible to
 * TypeORM's schema diff. Only the intended change is kept here.
 */
export class AddPricingRuleIncludeExcludeTargets1786293135414 implements MigrationInterface {
  name = 'AddPricingRuleIncludeExcludeTargets1786293135414';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."pricing_rule_targets_mode_enum" AS ENUM('INCLUDE', 'EXCLUDE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pricing_rule_targets_target_type_enum" AS ENUM('PRODUCT', 'COLLECTION', 'VARIANT', 'TAG', 'VENDOR', 'PRODUCT_TYPE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "pricing_rule_targets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "pricing_rule_id" uuid NOT NULL, "mode" "public"."pricing_rule_targets_mode_enum" NOT NULL, "target_type" "public"."pricing_rule_targets_target_type_enum" NOT NULL, "target_reference" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_e59519e80a95d5d992eb8d3ced0" UNIQUE ("pricing_rule_id", "mode", "target_type", "target_reference"), CONSTRAINT "PK_072e20753947bd16cd3ded55d61" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f8cf5ba05138b0253d92965469" ON "pricing_rule_targets" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_32519081ce2b3822064c809b35" ON "pricing_rule_targets" ("shop_id", "pricing_rule_id")`,
    );

    // Tenant consistency, same composite-FK technique as the rest of the
    // schema: a target row can only ever point at a rule in its own shop.
    // CASCADE (rather than the RESTRICT used elsewhere) because targets are
    // pure configuration owned by the rule — they carry no history worth
    // preserving once the rule itself is hard-deleted.
    await queryRunner.query(
      `ALTER TABLE "pricing_rule_targets" ADD CONSTRAINT "FK_pricing_rule_targets_shop" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_rule_targets" ADD CONSTRAINT "FK_pricing_rule_targets_rule_shop" FOREIGN KEY ("shop_id", "pricing_rule_id") REFERENCES "pricing_rules"("shop_id","id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `ALTER TABLE "pricing_rules" DROP COLUMN "scope_type"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."pricing_rules_scope_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_rules" DROP COLUMN "scope_reference"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pricing_rules_include_mode_enum" AS ENUM('ALL_PRODUCTS', 'SPECIFIC')`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_rules" ADD "include_mode" "public"."pricing_rules_include_mode_enum" NOT NULL DEFAULT 'ALL_PRODUCTS'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_rules" ADD "exclude_draft_and_archived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_rules" ADD "exclusions_enabled" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pricing_rules" DROP COLUMN "exclusions_enabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_rules" DROP COLUMN "exclude_draft_and_archived"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_rules" DROP COLUMN "include_mode"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."pricing_rules_include_mode_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_rules" ADD "scope_reference" character varying`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pricing_rules_scope_type_enum" AS ENUM('SHOP', 'COLLECTION', 'PRODUCT', 'VARIANT')`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_rules" ADD "scope_type" "public"."pricing_rules_scope_type_enum" NOT NULL DEFAULT 'SHOP'`,
    );

    await queryRunner.query(
      `ALTER TABLE "pricing_rule_targets" DROP CONSTRAINT "FK_pricing_rule_targets_rule_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_rule_targets" DROP CONSTRAINT "FK_pricing_rule_targets_shop"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_32519081ce2b3822064c809b35"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f8cf5ba05138b0253d92965469"`,
    );
    await queryRunner.query(`DROP TABLE "pricing_rule_targets"`);
    await queryRunner.query(
      `DROP TYPE "public"."pricing_rule_targets_target_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."pricing_rule_targets_mode_enum"`,
    );
  }
}
