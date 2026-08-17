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
    await queryRunner.query(
      `CREATE TYPE "public"."campaigns_round_strategy_enum" AS ENUM('UP', 'DOWN', 'NEAREST')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."duplicate_policy_enum" AS ENUM('HIGHEST_DISCOUNT', 'LATEST', 'SKIP')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."jobs_type_enum" AS ENUM('CAMPAIGN_ACTIVATE', 'CAMPAIGN_REVERT', 'CSV_PARSE', 'CSV_MATCH')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."jobs_status_enum" AS ENUM('PENDING', 'BLOCKED', 'RUNNING', 'WAITING_CHILDREN', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_executions_status_enum" AS ENUM('PENDING', 'RUNNING', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_executions_step_enum" AS ENUM('RESOLVE_TARGETS', 'FETCH_PRICES', 'CHECK_PLAN_LIMIT', 'CALCULATE', 'WRITE_CHANGES', 'PUSH_PRICES', 'PUSH_TAGS', 'RESTORE_PRICES', 'RESTORE_TAGS', 'PARSE_FILE', 'MATCH_SKUS', 'FINALIZE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."app_plans_handle_enum" AS ENUM('FREE', 'STARTER', 'PLUS', 'PROFESSIONAL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."store_subscriptions_billing_interval_enum" AS ENUM('MONTHLY', 'ANNUAL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."store_subscriptions_status_enum" AS ENUM('ACTIVE', 'PENDING', 'CANCELLED', 'FROZEN', 'EXPIRED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."store_subscription_events_type_enum" AS ENUM('SYNCED', 'UPGRADED', 'DOWNGRADED', 'CANCELLED', 'RENEWED')`,
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
        "round_strategy" "public"."campaigns_round_strategy_enum" NOT NULL DEFAULT 'UP',
        "duplicate_policy" "public"."duplicate_policy_enum",
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
        "job_id" uuid NOT NULL,
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
        "job_id" uuid NOT NULL,
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
    // 3b. Job execution.
    //
    //     `jobs` is the intent; `job_executions` is one attempt at it, so a
    //     retry writes a new row rather than overwriting what the last
    //     attempt did. That record is the only thing revert can work from
    //     after a half-applied campaign.
    // ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shop_id" uuid NOT NULL,
        "type" "public"."jobs_type_enum" NOT NULL,
        "status" "public"."jobs_status_enum" NOT NULL DEFAULT 'PENDING',
        "parent_job_id" uuid,
        "campaign_id" uuid,
        "csv_import_id" uuid,
        "concurrency_key" character varying,
        "dedup_key" character varying,
        "priority" integer NOT NULL DEFAULT 0,
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer DEFAULT 5,
        "next_run_at" TIMESTAMP WITH TIME ZONE,
        "locked_at" TIMESTAMP WITH TIME ZONE,
        "locked_by" character varying,
        "cancel_requested_at" TIMESTAMP WITH TIME ZONE,
        "paused_at" TIMESTAMP WITH TIME ZONE,
        "total_count" integer NOT NULL DEFAULT 0,
        "processed_count" integer NOT NULL DEFAULT 0,
        "failed_count" integer NOT NULL DEFAULT 0,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "error_code" character varying,
        "error_details" jsonb,
        "last_error" text,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_jobs_shop_id" UNIQUE ("shop_id", "id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "job_executions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shop_id" uuid NOT NULL,
        "job_id" uuid NOT NULL,
        "attempt" integer NOT NULL,
        "status" "public"."job_executions_status_enum" NOT NULL DEFAULT 'PENDING',
        "step" "public"."job_executions_step_enum" NOT NULL,
        "progress" integer NOT NULL DEFAULT 0,
        "result" jsonb,
        "obsolete" boolean NOT NULL DEFAULT false,
        "error_message" text,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_job_executions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_job_executions_job_attempt" UNIQUE ("job_id", "attempt")
      )
    `);

    // A join table rather than an array column: the dispatcher's hot question
    // is "what does finishing this job release?", which needs an index on the
    // *second* column. An array would make that a sequential scan.
    await queryRunner.query(`
      CREATE TABLE "job_dependencies" (
        "shop_id" uuid NOT NULL,
        "job_id" uuid NOT NULL,
        "depends_on_job_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_job_dependencies" PRIMARY KEY ("job_id", "depends_on_job_id"),
        CONSTRAINT "CHK_job_dependencies_no_self" CHECK ("job_id" <> "depends_on_job_id")
      )
    `);

    // ---------------------------------------------------------------
    // 3c. Billing.
    //
    //     `app_plans` is the only table here that is not shop-scoped — it is
    //     catalogue data we own. Limits live in the database rather than in
    //     code because a per-shop override cannot be a constant, and prices
    //     change for commercial reasons that should not need a deploy.
    // ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "app_plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "handle" "public"."app_plans_handle_enum" NOT NULL,
        "name" character varying NOT NULL,
        "price_cents" integer NOT NULL DEFAULT 0,
        "annual_price_cents" integer,
        "trial_days" integer NOT NULL DEFAULT 0,
        "active_variant_limit" integer,
        "active_campaign_limit" integer,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_app_plans" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_app_plans_handle" UNIQUE ("handle"),
        CONSTRAINT "CHK_app_plans_limits_non_negative" CHECK (
          ("active_variant_limit" IS NULL OR "active_variant_limit" >= 0)
          AND ("active_campaign_limit" IS NULL OR "active_campaign_limit" >= 0)
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "store_subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shop_id" uuid NOT NULL,
        "plan_id" uuid NOT NULL,
        "billing_interval" "public"."store_subscriptions_billing_interval_enum" NOT NULL DEFAULT 'MONTHLY',
        "shopify_subscription_gid" character varying,
        "status" "public"."store_subscriptions_status_enum" NOT NULL DEFAULT 'PENDING',
        "current_period_start_at" TIMESTAMP WITH TIME ZONE,
        "current_period_end_at" TIMESTAMP WITH TIME ZONE,
        "trial_start_at" TIMESTAMP WITH TIME ZONE,
        "trial_end_at" TIMESTAMP WITH TIME ZONE,
        "is_in_grace_period" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_store_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_store_subscriptions_shop" UNIQUE ("shop_id")
      )
    `);

    // Append-only: no updated_at, and nothing updates these rows. A row that
    // can be edited is not an audit trail, and merchants dispute charges.
    await queryRunner.query(`
      CREATE TABLE "store_subscription_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shop_id" uuid NOT NULL,
        "subscription_id" uuid,
        "type" "public"."store_subscription_events_type_enum" NOT NULL,
        "from_plan_id" uuid,
        "to_plan_id" uuid,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "occurred_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_store_subscription_events" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "store_usage" (
        "shop_id" uuid NOT NULL,
        "active_variant_count" integer NOT NULL DEFAULT 0,
        "active_campaign_count" integer NOT NULL DEFAULT 0,
        "last_reconciled_at" TIMESTAMP WITH TIME ZONE,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_store_usage" PRIMARY KEY ("shop_id")
      )
    `);

    // ---------------------------------------------------------------
    // 3d. Shop-level billing and overlap settings.
    // ---------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "shops"
        ADD COLUMN "duplicate_policy" "public"."duplicate_policy_enum" NOT NULL DEFAULT 'HIGHEST_DISCOUNT',
        ADD COLUMN "override_active_variant_limit" integer,
        ADD COLUMN "override_active_campaign_limit" integer
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
      `CREATE UNIQUE INDEX "IDX_price_changes_job_variant" ON "price_changes" ("job_id", "shopify_variant_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_product_tag_changes_shop" ON "product_tag_changes" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_product_tag_changes_shop_campaign" ON "product_tag_changes" ("shop_id", "campaign_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_product_tag_changes_job_product" ON "product_tag_changes" ("job_id", "shopify_product_id")`,
    );

    // Job execution indexes.
    await queryRunner.query(
      `CREATE INDEX "IDX_jobs_shop" ON "jobs" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_jobs_shop_status" ON "jobs" ("shop_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_jobs_shop_campaign" ON "jobs" ("shop_id", "campaign_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_jobs_parent" ON "jobs" ("parent_job_id")`,
    );
    // The dispatcher's claim query: due work, highest priority first.
    await queryRunner.query(
      `CREATE INDEX "IDX_jobs_dispatch" ON "jobs" ("status", "next_run_at", "priority")`,
    );

    /*
     * Concurrency 1 per shop per key — the campaign start/end guarantee, and
     * the reason the plan-limit check is race-free (two activations cannot
     * both pass the quota check and then both apply).
     *
     * A partial unique index rather than application logic, because a
     * forgotten WHERE clause must not be able to double-apply a campaign.
     * `migration:generate` cannot see this constraint and will propose
     * dropping it — read generated migrations before applying them.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_jobs_running_concurrency_key"
        ON "jobs" ("shop_id", "concurrency_key")
        WHERE "status" = 'RUNNING' AND "concurrency_key" IS NOT NULL
    `);

    /*
     * Deduplication holds only while a job is live. A finished job releases
     * its key so the same work can legitimately be requested again later —
     * which is why this is not a plain unique constraint.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_jobs_live_dedup_key"
        ON "jobs" ("shop_id", "dedup_key")
        WHERE "dedup_key" IS NOT NULL
          AND "status" IN ('PENDING', 'BLOCKED', 'RUNNING', 'WAITING_CHILDREN', 'PAUSED')
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_job_executions_shop" ON "job_executions" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_executions_shop_job" ON "job_executions" ("shop_id", "job_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_executions_job_status" ON "job_executions" ("job_id", "status")`,
    );

    // Both directions of the dependency graph. The primary key covers
    // "what am I waiting for"; this covers "what does finishing me release".
    await queryRunner.query(
      `CREATE INDEX "IDX_job_dependencies_depends_on" ON "job_dependencies" ("depends_on_job_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_dependencies_shop" ON "job_dependencies" ("shop_id")`,
    );

    // Billing indexes.
    await queryRunner.query(
      `CREATE INDEX "IDX_store_subscriptions_plan" ON "store_subscriptions" ("plan_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_store_subscriptions_shop_status" ON "store_subscriptions" ("shop_id", "status")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_store_subscriptions_shopify_gid"
        ON "store_subscriptions" ("shopify_subscription_gid")
        WHERE "shopify_subscription_gid" IS NOT NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_store_subscription_events_shop" ON "store_subscription_events" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_store_subscription_events_shop_time" ON "store_subscription_events" ("shop_id", "occurred_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_store_usage_reconciled" ON "store_usage" ("last_reconciled_at")`,
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
      'jobs',
      'job_executions',
      'job_dependencies',
      'store_subscriptions',
      'store_subscription_events',
      'store_usage',
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

    // Jobs. Every edge carries shop_id so a job in shop A can never depend on,
    // parent or be claimed alongside a job in shop B.
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_jobs_parent_shop" FOREIGN KEY ("shop_id", "parent_job_id") REFERENCES "jobs"("shop_id","id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_jobs_campaign_shop" FOREIGN KEY ("shop_id", "campaign_id") REFERENCES "campaigns"("shop_id","id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_jobs_csv_import_shop" FOREIGN KEY ("shop_id", "csv_import_id") REFERENCES "csv_imports"("shop_id","id") ON DELETE RESTRICT`,
    );
    // Executions and edges are meaningless without their job, so they cascade.
    await queryRunner.query(
      `ALTER TABLE "job_executions" ADD CONSTRAINT "FK_job_executions_job_shop" FOREIGN KEY ("shop_id", "job_id") REFERENCES "jobs"("shop_id","id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_dependencies" ADD CONSTRAINT "FK_job_dependencies_job_shop" FOREIGN KEY ("shop_id", "job_id") REFERENCES "jobs"("shop_id","id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_dependencies" ADD CONSTRAINT "FK_job_dependencies_depends_on_shop" FOREIGN KEY ("shop_id", "depends_on_job_id") REFERENCES "jobs"("shop_id","id") ON DELETE CASCADE`,
    );

    // The change tables now belong to an execution as well as a campaign.
    // RESTRICT, not CASCADE: deleting the job that applied a price must not
    // silently delete the record of what to put back.
    await queryRunner.query(
      `ALTER TABLE "price_changes" ADD CONSTRAINT "FK_price_changes_job_shop" FOREIGN KEY ("shop_id", "job_id") REFERENCES "jobs"("shop_id","id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_tag_changes" ADD CONSTRAINT "FK_product_tag_changes_job_shop" FOREIGN KEY ("shop_id", "job_id") REFERENCES "jobs"("shop_id","id") ON DELETE RESTRICT`,
    );

    // Billing. Plans are referenced, never deleted while in use.
    await queryRunner.query(
      `ALTER TABLE "store_subscriptions" ADD CONSTRAINT "FK_store_subscriptions_plan" FOREIGN KEY ("plan_id") REFERENCES "app_plans"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_subscription_events" ADD CONSTRAINT "FK_store_subscription_events_subscription" FOREIGN KEY ("subscription_id") REFERENCES "store_subscriptions"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_subscription_events" ADD CONSTRAINT "FK_store_subscription_events_from_plan" FOREIGN KEY ("from_plan_id") REFERENCES "app_plans"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_subscription_events" ADD CONSTRAINT "FK_store_subscription_events_to_plan" FOREIGN KEY ("to_plan_id") REFERENCES "app_plans"("id") ON DELETE RESTRICT`,
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
    // A job names at most one subject — never both a campaign and an import.
    await queryRunner.query(`
      ALTER TABLE "jobs" ADD CONSTRAINT "CHK_jobs_single_subject"
        CHECK (num_nonnulls("campaign_id", "csv_import_id") <= 1)
    `);

    // A subscription's trial cannot end before it starts.
    await queryRunner.query(`
      ALTER TABLE "store_subscriptions" ADD CONSTRAINT "CHK_store_subscriptions_trial_window"
        CHECK (
          "trial_start_at" IS NULL
          OR "trial_end_at" IS NULL
          OR "trial_end_at" >= "trial_start_at"
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "price_changes" ADD CONSTRAINT "CHK_price_changes_positive"
      CHECK ("old_price" >= 0 AND "new_price" >= 0)
    `);

    // ---------------------------------------------------------------
    // 7. Seed the plan catalogue.
    //
    //    A null limit is unlimited. These are starting values, not settings —
    //    the table exists precisely so they can change without a deploy.
    // ---------------------------------------------------------------
    await queryRunner.query(`
      INSERT INTO "app_plans"
        ("handle", "name", "price_cents", "annual_price_cents", "trial_days",
         "active_variant_limit", "active_campaign_limit", "sort_order")
      VALUES
        ('FREE',         'Free',         0,    NULL,  0,   50,   1,    0),
        ('STARTER',      'Starter',      799,  7670,  3,   2000, 10,   1),
        ('PLUS',         'Plus',         1299, 12470, 3,   20000, 30,  2),
        ('PROFESSIONAL', 'Professional', 2999, 28790, 0,   NULL, NULL, 3)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Returns the database to its post-Phase-1 shape (shops + session).
    // See the strategy note at the top of this file — the superseded
    // seventeen-table schema is not recreated here.
    await queryRunner.query(`
      ALTER TABLE "shops"
        DROP COLUMN IF EXISTS "duplicate_policy",
        DROP COLUMN IF EXISTS "override_active_variant_limit",
        DROP COLUMN IF EXISTS "override_active_campaign_limit"
    `);

    for (const table of [
      'store_subscription_events',
      'store_subscriptions',
      'store_usage',
      'app_plans',
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
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }

    for (const type of [
      'store_subscription_events_type_enum',
      'store_subscriptions_status_enum',
      'store_subscriptions_billing_interval_enum',
      'app_plans_handle_enum',
      'job_executions_step_enum',
      'job_executions_status_enum',
      'jobs_status_enum',
      'jobs_type_enum',
      'duplicate_policy_enum',
      'campaigns_round_strategy_enum',
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
