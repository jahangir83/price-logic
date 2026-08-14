import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Re-baselines the schema for the Campaign & Supplier MVP
 * (.speclet/plans/11-campaign-supplier-mvp.md).
 *
 * ## Migration strategy
 *
 * Drop-and-create on top of the existing migration history, rather than
 * squashing the five earlier migrations into a new InitSchema. History stays
 * honest: anyone who ran the old schema can run this and land on the new one.
 *
 * `down()` drops the tables this migration created but does **not** recreate
 * the seventeen-table schema it removed. Reverting returns the database to
 * the shape it had after Phase 1 (shops + session only), which is the state
 * this redesign starts from. The old schema is recoverable by checking out
 * the commit before this one and running the earlier migrations. This is the
 * "reversible where practical" line in the constitution — recreating a
 * superseded seventeen-table schema in `down()` would be dead code that no
 * one ever wants executed.
 *
 * Every drop is `IF EXISTS` so this migration is safe on a database that
 * never had the old schema applied.
 *
 * ## Written by hand, not generated
 *
 * `migration:generate` diffs against entity metadata only, so it cannot see
 * composite `(shop_id, parent_id) → parent(shop_id, id)` foreign keys and
 * would emit spurious DROP statements for them on every future run (see the
 * constitution). It also needs a live database to diff against, and none was
 * reachable when this was written. The composite FKs and the tenant unique
 * constraints below are therefore raw SQL and must stay that way.
 */
export class CampaignSupplierMvpRebaseline1786550000000 implements MigrationInterface {
  name = 'CampaignSupplierMvpRebaseline1786550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ---------------------------------------------------------------
    // 1. Drop the superseded schema. Children first; CASCADE covers any
    //    constraint we have not named explicitly.
    // ---------------------------------------------------------------
    for (const table of [
      'campaign_tag_applications',
      'campaign_tag_rules',
      'price_changes',
      'price_history',
      'import_records',
      'imports',
      'supplier_records',
      'pricing_rule_targets',
      'pricing_operations',
      'pricing_rules',
      'schedules',
      'audit_logs',
      'variants',
      'products',
      'campaigns',
      'suppliers',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }

    // Enum types are not dropped with their tables. Note that
    // shops_status_enum and shops_initialization_status_enum are deliberately
    // absent — the shops table survives this migration untouched.
    for (const type of [
      'products_status_enum',
      'variants_status_enum',
      'suppliers_status_enum',
      'supplier_records_source_enum',
      'imports_status_enum',
      'imports_file_type_enum',
      'import_records_status_enum',
      'pricing_rules_rule_type_enum',
      'pricing_rules_include_mode_enum',
      'pricing_rules_status_enum',
      'pricing_rule_targets_mode_enum',
      'pricing_rule_targets_target_type_enum',
      'pricing_operations_operation_type_enum',
      'pricing_operations_status_enum',
      'pricing_operations_source_enum',
      'price_changes_status_enum',
      'price_history_source_enum',
      'campaigns_status_enum',
      'campaign_tag_rules_action_enum',
      'campaign_tag_applications_action_enum',
      'schedules_status_enum',
      'audit_logs_actor_type_enum',
      'audit_logs_action_enum',
      'audit_logs_entity_type_enum',
    ]) {
      await queryRunner.query(`DROP TYPE IF EXISTS "public"."${type}" CASCADE`);
    }

    // ---------------------------------------------------------------
    // 2. Enum types for the new schema.
    // ---------------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."suppliers_status_enum" AS ENUM('ACTIVE', 'INACTIVE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."campaigns_status_enum" AS ENUM('DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."campaigns_price_source_enum" AS ENUM('SHOPIFY_CURRENT', 'SHEET')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."campaigns_adjustment_unit_enum" AS ENUM('PERCENTAGE', 'FIXED_AMOUNT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."campaigns_adjustment_direction_enum" AS ENUM('INCREASE', 'DECREASE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."campaigns_basis_enum" AS ENUM('PRICE', 'COMPARE_AT_PRICE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."campaigns_include_mode_enum" AS ENUM('ALL_PRODUCTS', 'SPECIFIC')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."campaign_targets_mode_enum" AS ENUM('INCLUDE', 'EXCLUDE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."campaign_targets_target_type_enum" AS ENUM('PRODUCT', 'COLLECTION', 'VARIANT', 'TAG', 'VENDOR', 'PRODUCT_TYPE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."price_changes_status_enum" AS ENUM('PENDING', 'APPLIED', 'FAILED', 'REVERTED', 'SKIPPED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."product_tag_changes_status_enum" AS ENUM('PENDING', 'APPLIED', 'FAILED', 'REVERTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."csv_imports_status_enum" AS ENUM('UPLOADED', 'PARSING', 'READY', 'APPROVED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."csv_rows_status_enum" AS ENUM('VALID', 'INVALID', 'MATCHED', 'UNMATCHED')`,
    );

    // ---------------------------------------------------------------
    // 3. Tables.
    // ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "suppliers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shop_id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "code" character varying,
        "status" "public"."suppliers_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_suppliers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_suppliers_shop_id" UNIQUE ("shop_id", "id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "csv_imports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shop_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "file_name" character varying NOT NULL,
        "status" "public"."csv_imports_status_enum" NOT NULL DEFAULT 'UPLOADED',
        "total_rows" integer NOT NULL DEFAULT 0,
        "valid_rows" integer NOT NULL DEFAULT 0,
        "invalid_rows" integer NOT NULL DEFAULT 0,
        "matched_rows" integer NOT NULL DEFAULT 0,
        "error_message" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_csv_imports" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_csv_imports_shop_id" UNIQUE ("shop_id", "id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "csv_rows" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shop_id" uuid NOT NULL,
        "csv_import_id" uuid NOT NULL,
        "row_number" integer NOT NULL,
        "raw_data" jsonb NOT NULL,
        "sku" character varying,
        "sheet_price" numeric(19,4),
        "sheet_compare_at_price" numeric(19,4),
        "current_price" numeric(19,4),
        "approved_price" numeric(19,4),
        "currency" character varying NOT NULL DEFAULT 'USD',
        "shopify_product_id" character varying,
        "shopify_variant_id" character varying,
        "excluded" boolean NOT NULL DEFAULT false,
        "status" "public"."csv_rows_status_enum" NOT NULL DEFAULT 'VALID',
        "error_message" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_csv_rows" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_csv_rows_import_row_number" UNIQUE ("csv_import_id", "row_number")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "campaigns" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shop_id" uuid NOT NULL,
        "title" character varying NOT NULL,
        "status" "public"."campaigns_status_enum" NOT NULL DEFAULT 'DRAFT',
        "price_source" "public"."campaigns_price_source_enum" NOT NULL DEFAULT 'SHOPIFY_CURRENT',
        "csv_import_id" uuid,
        "adjustment_unit" "public"."campaigns_adjustment_unit_enum",
        "adjustment_direction" "public"."campaigns_adjustment_direction_enum",
        "adjustment_value" numeric(19,4),
        "basis" "public"."campaigns_basis_enum" NOT NULL DEFAULT 'PRICE',
        "round_to" numeric(19,4),
        "set_compare_at" boolean NOT NULL DEFAULT false,
        "include_mode" "public"."campaigns_include_mode_enum" NOT NULL DEFAULT 'ALL_PRODUCTS',
        "exclude_draft_archived" boolean NOT NULL DEFAULT true,
        "exclusions_enabled" boolean NOT NULL DEFAULT false,
        "add_tags" text array NOT NULL DEFAULT '{}',
        "remove_tags" text array NOT NULL DEFAULT '{}',
        "start_at" TIMESTAMP WITH TIME ZONE,
        "start_timezone" character varying NOT NULL DEFAULT 'UTC',
        "end_at" TIMESTAMP WITH TIME ZONE,
        "end_timezone" character varying NOT NULL DEFAULT 'UTC',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_campaigns" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_campaigns_shop_id" UNIQUE ("shop_id", "id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "campaign_targets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shop_id" uuid NOT NULL,
        "campaign_id" uuid NOT NULL,
        "mode" "public"."campaign_targets_mode_enum" NOT NULL,
        "target_type" "public"."campaign_targets_target_type_enum" NOT NULL,
        "target_value" character varying NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_campaign_targets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_campaign_targets_unique_target" UNIQUE ("campaign_id", "mode", "target_type", "target_value")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "price_changes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shop_id" uuid NOT NULL,
        "campaign_id" uuid NOT NULL,
        "shopify_product_id" character varying NOT NULL,
        "shopify_variant_id" character varying NOT NULL,
        "product_title" character varying NOT NULL,
        "variant_title" character varying,
        "old_price" numeric(19,4) NOT NULL,
        "old_compare_at_price" numeric(19,4),
        "new_price" numeric(19,4) NOT NULL,
        "new_compare_at_price" numeric(19,4),
        "currency" character varying NOT NULL DEFAULT 'USD',
        "status" "public"."price_changes_status_enum" NOT NULL DEFAULT 'PENDING',
        "error_message" text,
        "applied_at" TIMESTAMP WITH TIME ZONE,
        "reverted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_changes" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "product_tag_changes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shop_id" uuid NOT NULL,
        "campaign_id" uuid NOT NULL,
        "shopify_product_id" character varying NOT NULL,
        "old_tags" text array NOT NULL,
        "new_tags" text array NOT NULL,
        "status" "public"."product_tag_changes_status_enum" NOT NULL DEFAULT 'PENDING',
        "error_message" text,
        "applied_at" TIMESTAMP WITH TIME ZONE,
        "reverted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_tag_changes" PRIMARY KEY ("id")
      )
    `);

    // ---------------------------------------------------------------
    // 4. Indexes. Only the paths the application actually queries —
    //    shop_id for tenancy, the parent key for child lookups, and the
    //    scheduler's due-campaign scan.
    // ---------------------------------------------------------------
    await queryRunner.query(
      `CREATE INDEX "IDX_suppliers_shop" ON "suppliers" ("shop_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_csv_imports_shop" ON "csv_imports" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_csv_imports_supplier" ON "csv_imports" ("supplier_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_csv_imports_status" ON "csv_imports" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_csv_imports_shop_created" ON "csv_imports" ("shop_id", "created_at")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_csv_rows_shop" ON "csv_rows" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_csv_rows_shop_import" ON "csv_rows" ("shop_id", "csv_import_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_csv_rows_import_status" ON "csv_rows" ("csv_import_id", "status")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_campaigns_shop" ON "campaigns" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaigns_shop_status" ON "campaigns" ("shop_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaigns_shop_start_at" ON "campaigns" ("shop_id", "start_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaigns_shop_end_at" ON "campaigns" ("shop_id", "end_at")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_targets_shop" ON "campaign_targets" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_targets_shop_campaign" ON "campaign_targets" ("shop_id", "campaign_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_price_changes_shop" ON "price_changes" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_price_changes_shop_campaign" ON "price_changes" ("shop_id", "campaign_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_price_changes_shop_status" ON "price_changes" ("shop_id", "status")`,
    );
    // Domain rule and retry guard: a campaign touches a variant exactly once.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_price_changes_campaign_variant" ON "price_changes" ("campaign_id", "shopify_variant_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_product_tag_changes_shop" ON "product_tag_changes" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_product_tag_changes_shop_campaign" ON "product_tag_changes" ("shop_id", "campaign_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_product_tag_changes_campaign_product" ON "product_tag_changes" ("campaign_id", "shopify_product_id")`,
    );

    // ---------------------------------------------------------------
    // 5. Tenant foreign keys.
    //
    //    Every table points at shops. Every child ALSO points at its parent
    //    through BOTH columns — (shop_id, parent_id) → parent(shop_id, id) —
    //    so a row in shop A can never reference a row in shop B. That is the
    //    constraint the whole tenancy model rests on, and it cannot be
    //    expressed with entity decorators.
    //
    //    RESTRICT everywhere except targets and sheet rows, which are pure
    //    configuration/staging and are meaningless without their parent.
    // ---------------------------------------------------------------
    for (const table of [
      'suppliers',
      'csv_imports',
      'csv_rows',
      'campaigns',
      'campaign_targets',
      'price_changes',
      'product_tag_changes',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_shop" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "csv_imports" ADD CONSTRAINT "FK_csv_imports_supplier_shop" FOREIGN KEY ("shop_id", "supplier_id") REFERENCES "suppliers"("shop_id","id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "csv_rows" ADD CONSTRAINT "FK_csv_rows_import_shop" FOREIGN KEY ("shop_id", "csv_import_id") REFERENCES "csv_imports"("shop_id","id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD CONSTRAINT "FK_campaigns_csv_import_shop" FOREIGN KEY ("shop_id", "csv_import_id") REFERENCES "csv_imports"("shop_id","id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_targets" ADD CONSTRAINT "FK_campaign_targets_campaign_shop" FOREIGN KEY ("shop_id", "campaign_id") REFERENCES "campaigns"("shop_id","id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_changes" ADD CONSTRAINT "FK_price_changes_campaign_shop" FOREIGN KEY ("shop_id", "campaign_id") REFERENCES "campaigns"("shop_id","id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_tag_changes" ADD CONSTRAINT "FK_product_tag_changes_campaign_shop" FOREIGN KEY ("shop_id", "campaign_id") REFERENCES "campaigns"("shop_id","id") ON DELETE RESTRICT`,
    );

    // ---------------------------------------------------------------
    // 6. Consistency checks the application must not be trusted to keep.
    // ---------------------------------------------------------------
    // A SHEET campaign must name its import; a SHOPIFY_CURRENT one must not.
    await queryRunner.query(`
      ALTER TABLE "campaigns" ADD CONSTRAINT "CHK_campaigns_price_source"
      CHECK (
        ("price_source" = 'SHEET' AND "csv_import_id" IS NOT NULL)
        OR ("price_source" = 'SHOPIFY_CURRENT' AND "csv_import_id" IS NULL)
      )
    `);
    // The adjustment is an all-or-nothing group.
    await queryRunner.query(`
      ALTER TABLE "campaigns" ADD CONSTRAINT "CHK_campaigns_adjustment_group"
      CHECK (
        num_nonnulls("adjustment_unit", "adjustment_direction", "adjustment_value") IN (0, 3)
      )
    `);
    // Money is never negative, and a campaign window never ends before it starts.
    await queryRunner.query(`
      ALTER TABLE "campaigns" ADD CONSTRAINT "CHK_campaigns_window"
      CHECK ("start_at" IS NULL OR "end_at" IS NULL OR "end_at" > "start_at")
    `);
    await queryRunner.query(`
      ALTER TABLE "price_changes" ADD CONSTRAINT "CHK_price_changes_positive"
      CHECK ("old_price" >= 0 AND "new_price" >= 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Returns the database to its post-Phase-1 shape (shops + session).
    // See the strategy note at the top of this file — the superseded
    // seventeen-table schema is not recreated here.
    for (const table of [
      'product_tag_changes',
      'price_changes',
      'campaign_targets',
      'campaigns',
      'csv_rows',
      'csv_imports',
      'suppliers',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }

    for (const type of [
      'csv_rows_status_enum',
      'csv_imports_status_enum',
      'product_tag_changes_status_enum',
      'price_changes_status_enum',
      'campaign_targets_target_type_enum',
      'campaign_targets_mode_enum',
      'campaigns_include_mode_enum',
      'campaigns_basis_enum',
      'campaigns_adjustment_direction_enum',
      'campaigns_adjustment_unit_enum',
      'campaigns_price_source_enum',
      'campaigns_status_enum',
      'suppliers_status_enum',
    ]) {
      await queryRunner.query(`DROP TYPE IF EXISTS "public"."${type}" CASCADE`);
    }
  }
}
