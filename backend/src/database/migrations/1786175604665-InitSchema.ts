import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1786175604665 implements MigrationInterface {
  name = 'InitSchema1786175604665';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."suppliers_status_enum" AS ENUM('ACTIVE', 'INACTIVE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "suppliers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "name" character varying NOT NULL, "code" character varying, "status" "public"."suppliers_status_enum" NOT NULL DEFAULT 'ACTIVE', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_b70ac51766a9e3144f778cfe81e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cc042da525db36aff83517bc3f" ON "suppliers" ("shop_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."supplier_records_source_enum" AS ENUM('CSV_IMPORT', 'API', 'MANUAL')`,
    );
    await queryRunner.query(
      `CREATE TABLE "supplier_records" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "supplier_id" uuid NOT NULL, "sku" character varying NOT NULL, "external_product_id" character varying, "cost" numeric(19,4) NOT NULL, "currency" character varying NOT NULL DEFAULT 'USD', "available_quantity" integer, "source" "public"."supplier_records_source_enum" NOT NULL DEFAULT 'CSV_IMPORT', "source_reference" character varying, "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_aeb11b08ad1e0ae588ab4a914f6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_97c2fd294495edaafb658694ef" ON "supplier_records" ("shop_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b34ae4b1f6c449400c43cb509b" ON "supplier_records" ("supplier_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2458d1a8d035dab53b634fdf9c" ON "supplier_records" ("shop_id", "sku") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."shops_status_enum" AS ENUM('ACTIVE', 'DISCONNECTED', 'SUSPENDED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."shops_initialization_status_enum" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "shops" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shopify_shop_id" character varying NOT NULL, "shop_domain" character varying NOT NULL, "access_token_encrypted" text NOT NULL, "currency" character varying NOT NULL DEFAULT 'USD', "timezone" character varying NOT NULL DEFAULT 'UTC', "status" "public"."shops_status_enum" NOT NULL DEFAULT 'ACTIVE', "initialization_status" "public"."shops_initialization_status_enum" NOT NULL DEFAULT 'NOT_STARTED', "default_settings" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3c6aaa6607d287de99815e60b96" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b1f83a670118bcf5f5423f283c" ON "shops" ("shopify_shop_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ba842c7fef6cf69d3a62495332" ON "shops" ("shop_domain") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."schedules_status_enum" AS ENUM('SCHEDULED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "schedules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "operation_id" uuid NOT NULL, "scheduled_at" TIMESTAMP WITH TIME ZONE NOT NULL, "timezone" character varying NOT NULL, "status" "public"."schedules_status_enum" NOT NULL DEFAULT 'SCHEDULED', "executed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7e33fc2ea755a5765e3564e66dd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd0b82079d7caddddd9f42971b" ON "schedules" ("shop_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_67923765df4ec76477e2765536" ON "schedules" ("operation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7d7afcf6d1593aad27829a250e" ON "schedules" ("scheduled_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c76954510b334df511e6011461" ON "schedules" ("status") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."variants_status_enum" AS ENUM('ACTIVE', 'ARCHIVED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "variants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "product_id" uuid NOT NULL, "shopify_variant_id" character varying NOT NULL, "sku" character varying, "barcode" character varying, "price" numeric(19,4) NOT NULL, "compare_at_price" numeric(19,4), "currency" character varying NOT NULL DEFAULT 'USD', "inventory_quantity" integer NOT NULL DEFAULT '0', "status" "public"."variants_status_enum" NOT NULL DEFAULT 'ACTIVE', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "synced_at" TIMESTAMP WITH TIME ZONE, "deleted_at" TIMESTAMP, "version" integer NOT NULL, CONSTRAINT "PK_672d13d1a6de0197f20c6babb5e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_923e250c674a7aacf2787e76b4" ON "variants" ("shop_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a9625f5484e6b6941d401ec101" ON "variants" ("product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_32a8e1e331946de7919e38942c" ON "variants" ("shop_id", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9cb96e2c8a3350ffcbeefb7620" ON "variants" ("shop_id", "product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b016fc654cecf70004db44f4ae" ON "variants" ("shop_id", "sku") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_2f28107d0ca08c0eea418d868a" ON "variants" ("shop_id", "shopify_variant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."products_status_enum" AS ENUM('ACTIVE', 'ARCHIVED', 'DRAFT')`,
    );
    await queryRunner.query(
      `CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "shopify_product_id" character varying NOT NULL, "title" character varying NOT NULL, "status" "public"."products_status_enum" NOT NULL DEFAULT 'ACTIVE', "vendor" character varying, "product_type" character varying, "handle" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "synced_at" TIMESTAMP WITH TIME ZONE, "deleted_at" TIMESTAMP, CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9e952e93f369f16e27dd786c33" ON "products" ("shop_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e03cae1a8c6cf6ac5490ad777b" ON "products" ("shop_id", "shopify_product_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pricing_rules_rule_type_enum" AS ENUM('PERCENTAGE_MARKUP', 'FIXED_MARKUP', 'TARGET_MARGIN', 'PERCENTAGE_INCREASE', 'PERCENTAGE_DECREASE', 'FIXED_INCREASE', 'FIXED_DECREASE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pricing_rules_scope_type_enum" AS ENUM('SHOP', 'COLLECTION', 'PRODUCT', 'VARIANT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pricing_rules_status_enum" AS ENUM('ACTIVE', 'INACTIVE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "pricing_rules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "name" character varying NOT NULL, "rule_type" "public"."pricing_rules_rule_type_enum" NOT NULL, "value" numeric(19,4) NOT NULL, "currency" character varying NOT NULL DEFAULT 'USD', "scope_type" "public"."pricing_rules_scope_type_enum" NOT NULL DEFAULT 'SHOP', "scope_reference" character varying, "minimum_price" numeric(19,4), "maximum_price" numeric(19,4), "minimum_margin" numeric(9,4), "status" "public"."pricing_rules_status_enum" NOT NULL DEFAULT 'ACTIVE', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_fda27bb8db4630894decda61ff6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7728ff6c94a9cf8611def2c419" ON "pricing_rules" ("shop_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pricing_operations_operation_type_enum" AS ENUM('MANUAL_PRICE_CHANGE', 'RULE_EXECUTION', 'SUPPLIER_REPRICING', 'CAMPAIGN_START', 'CAMPAIGN_END', 'ROLLBACK', 'SCHEDULED_OPERATION')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pricing_operations_status_enum" AS ENUM('DRAFT', 'PREVIEW', 'APPROVED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pricing_operations_source_enum" AS ENUM('MERCHANT', 'SCHEDULER', 'SYSTEM')`,
    );
    await queryRunner.query(
      `CREATE TABLE "pricing_operations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "name" character varying NOT NULL, "operation_type" "public"."pricing_operations_operation_type_enum" NOT NULL, "status" "public"."pricing_operations_status_enum" NOT NULL DEFAULT 'DRAFT', "source" "public"."pricing_operations_source_enum" NOT NULL DEFAULT 'MERCHANT', "pricing_rule_id" uuid, "scheduled_at" TIMESTAMP WITH TIME ZONE, "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "total_variants" integer NOT NULL DEFAULT '0', "successful_variants" integer NOT NULL DEFAULT '0', "failed_variants" integer NOT NULL DEFAULT '0', "skipped_variants" integer NOT NULL DEFAULT '0', "idempotency_key" character varying, "created_by" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a81f71391360e6a7967e2fbe8a5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5fe2264fe862855b2055015fb0" ON "pricing_operations" ("shop_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b803814a61b727d8832574dd96" ON "pricing_operations" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6c5af3a982c396b84a3c82a9b2" ON "pricing_operations" ("scheduled_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_2ba6d925ecde67a3941d45a94f" ON "pricing_operations" ("shop_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."price_changes_status_enum" AS ENUM('PENDING', 'READY', 'SKIPPED', 'SUCCESS', 'FAILED', 'CONFLICT')`,
    );
    await queryRunner.query(
      `CREATE TABLE "price_changes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "operation_id" uuid NOT NULL, "variant_id" uuid NOT NULL, "previous_price" numeric(19,4) NOT NULL, "proposed_price" numeric(19,4) NOT NULL, "final_price" numeric(19,4), "previous_cost" numeric(19,4), "current_cost" numeric(19,4), "previous_margin" numeric(9,4), "projected_margin" numeric(9,4), "status" "public"."price_changes_status_enum" NOT NULL DEFAULT 'PENDING', "error_code" character varying, "error_message" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_44ba7d1ffce2e0e44d57afe3ca8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e44b7e572569b8a4bb6364bfd" ON "price_changes" ("shop_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b87ef195105aafcb7a1bf4f784" ON "price_changes" ("operation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d452dca4d4a8dbd6cb4a230cff" ON "price_changes" ("variant_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d6e17d14c86fb966faf6f05e64" ON "price_changes" ("status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_db21250bc2e08cb0113c39316d" ON "price_changes" ("operation_id", "variant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."price_history_source_enum" AS ENUM('MANUAL', 'RULE', 'SUPPLIER_REPRICING', 'CAMPAIGN', 'ROLLBACK', 'SCHEDULED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "price_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "variant_id" uuid NOT NULL, "operation_id" uuid NOT NULL, "previous_price" numeric(19,4) NOT NULL, "new_price" numeric(19,4) NOT NULL, "currency" character varying NOT NULL DEFAULT 'USD', "source" "public"."price_history_source_enum" NOT NULL, "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_e41e25472373d4b574b153229e9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9563d4eecfe0ed0a48c52cc52c" ON "price_history" ("shop_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c07ec713720618800b931088af" ON "price_history" ("variant_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c262bd08a88c6a27629cb5b680" ON "price_history" ("operation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b29a26589cee1557a234aeb479" ON "price_history" ("changed_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7c511cbd9bfa12b108630505fc" ON "price_history" ("shop_id", "variant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."imports_file_type_enum" AS ENUM('CSV')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."imports_status_enum" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "imports" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "supplier_id" uuid NOT NULL, "file_name" character varying NOT NULL, "file_type" "public"."imports_file_type_enum" NOT NULL DEFAULT 'CSV', "status" "public"."imports_status_enum" NOT NULL DEFAULT 'PENDING', "total_rows" integer NOT NULL DEFAULT '0', "valid_rows" integer NOT NULL DEFAULT '0', "invalid_rows" integer NOT NULL DEFAULT '0', "matched_rows" integer NOT NULL DEFAULT '0', "unmatched_rows" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "completed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ea10c62f5eb1d75e83d8b5225db" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_efe88530c8c973ed8e445cdfed" ON "imports" ("shop_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_340af24b76fed8e210aaec464b" ON "imports" ("supplier_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d371c5c5522c7e62f84600e4cd" ON "imports" ("status") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."import_records_status_enum" AS ENUM('VALID', 'INVALID', 'MATCHED', 'UNMATCHED', 'APPLIED', 'SKIPPED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "import_records" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "import_id" uuid NOT NULL, "shop_id" uuid NOT NULL, "row_number" integer NOT NULL, "raw_data" jsonb NOT NULL, "sku" character varying, "cost" numeric(19,4), "currency" character varying, "matched_variant_id" uuid, "status" "public"."import_records_status_enum" NOT NULL DEFAULT 'VALID', "error_code" character varying, "error_message" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f4868b33006f0644c6ece6c9a69" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1da06b3b26348d11a5bb38afcc" ON "import_records" ("import_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_586e7f7ac0ce94a869f64a19bb" ON "import_records" ("shop_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_38193ba4a9ce760f1e2f2e0ebb" ON "import_records" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c8ffce09e9f509ee9ad8ccd1f6" ON "import_records" ("shop_id", "import_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."campaigns_status_enum" AS ENUM('DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "campaigns" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "name" character varying NOT NULL, "status" "public"."campaigns_status_enum" NOT NULL DEFAULT 'DRAFT', "pricing_rule_id" uuid NOT NULL, "start_at" TIMESTAMP WITH TIME ZONE NOT NULL, "end_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_831e3fcd4fc45b4e4c3f57a9ee4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5a7d42a42a444f3a85b4357350" ON "campaigns" ("shop_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b6b94352da69af03dbaf87c63" ON "campaigns" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f70cc740eaa77706fad4c5cea5" ON "campaigns" ("start_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_actor_type_enum" AS ENUM('MERCHANT', 'SYSTEM', 'SCHEDULER', 'SHOPIFY_WEBHOOK')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('SHOP_CONNECTED', 'RULE_CREATED', 'RULE_UPDATED', 'RULE_DELETED', 'OPERATION_CREATED', 'OPERATION_APPROVED', 'OPERATION_STARTED', 'OPERATION_COMPLETED', 'OPERATION_FAILED', 'PRICE_UPDATED', 'ROLLBACK_EXECUTED', 'IMPORT_STARTED', 'IMPORT_COMPLETED', 'CAMPAIGN_STARTED', 'CAMPAIGN_COMPLETED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_entity_type_enum" AS ENUM('SHOP', 'PRICING_RULE', 'PRICING_OPERATION', 'VARIANT', 'IMPORT', 'CAMPAIGN')`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "actor_type" "public"."audit_logs_actor_type_enum" NOT NULL, "actor_id" character varying, "action" "public"."audit_logs_action_enum" NOT NULL, "entity_type" "public"."audit_logs_entity_type_enum" NOT NULL, "entity_id" uuid NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_859414eb433146940582854c4e" ON "audit_logs" ("shop_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cee5459245f652b75eb2759b4c" ON "audit_logs" ("action") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4aef75aef9831689de101c0192" ON "audit_logs" ("shop_id", "entity_type", "entity_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4aef75aef9831689de101c0192"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cee5459245f652b75eb2759b4c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_859414eb433146940582854c4e"`,
    );
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_entity_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_actor_type_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f70cc740eaa77706fad4c5cea5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b6b94352da69af03dbaf87c63"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5a7d42a42a444f3a85b4357350"`,
    );
    await queryRunner.query(`DROP TABLE "campaigns"`);
    await queryRunner.query(`DROP TYPE "public"."campaigns_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c8ffce09e9f509ee9ad8ccd1f6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_38193ba4a9ce760f1e2f2e0ebb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_586e7f7ac0ce94a869f64a19bb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1da06b3b26348d11a5bb38afcc"`,
    );
    await queryRunner.query(`DROP TABLE "import_records"`);
    await queryRunner.query(`DROP TYPE "public"."import_records_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d371c5c5522c7e62f84600e4cd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_340af24b76fed8e210aaec464b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_efe88530c8c973ed8e445cdfed"`,
    );
    await queryRunner.query(`DROP TABLE "imports"`);
    await queryRunner.query(`DROP TYPE "public"."imports_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."imports_file_type_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7c511cbd9bfa12b108630505fc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b29a26589cee1557a234aeb479"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c262bd08a88c6a27629cb5b680"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c07ec713720618800b931088af"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9563d4eecfe0ed0a48c52cc52c"`,
    );
    await queryRunner.query(`DROP TABLE "price_history"`);
    await queryRunner.query(`DROP TYPE "public"."price_history_source_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db21250bc2e08cb0113c39316d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d6e17d14c86fb966faf6f05e64"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d452dca4d4a8dbd6cb4a230cff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b87ef195105aafcb7a1bf4f784"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e44b7e572569b8a4bb6364bfd"`,
    );
    await queryRunner.query(`DROP TABLE "price_changes"`);
    await queryRunner.query(`DROP TYPE "public"."price_changes_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2ba6d925ecde67a3941d45a94f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6c5af3a982c396b84a3c82a9b2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b803814a61b727d8832574dd96"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5fe2264fe862855b2055015fb0"`,
    );
    await queryRunner.query(`DROP TABLE "pricing_operations"`);
    await queryRunner.query(
      `DROP TYPE "public"."pricing_operations_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."pricing_operations_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."pricing_operations_operation_type_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7728ff6c94a9cf8611def2c419"`,
    );
    await queryRunner.query(`DROP TABLE "pricing_rules"`);
    await queryRunner.query(`DROP TYPE "public"."pricing_rules_status_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."pricing_rules_scope_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."pricing_rules_rule_type_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e03cae1a8c6cf6ac5490ad777b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9e952e93f369f16e27dd786c33"`,
    );
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(`DROP TYPE "public"."products_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2f28107d0ca08c0eea418d868a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b016fc654cecf70004db44f4ae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9cb96e2c8a3350ffcbeefb7620"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_32a8e1e331946de7919e38942c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a9625f5484e6b6941d401ec101"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_923e250c674a7aacf2787e76b4"`,
    );
    await queryRunner.query(`DROP TABLE "variants"`);
    await queryRunner.query(`DROP TYPE "public"."variants_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c76954510b334df511e6011461"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7d7afcf6d1593aad27829a250e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_67923765df4ec76477e2765536"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd0b82079d7caddddd9f42971b"`,
    );
    await queryRunner.query(`DROP TABLE "schedules"`);
    await queryRunner.query(`DROP TYPE "public"."schedules_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ba842c7fef6cf69d3a62495332"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b1f83a670118bcf5f5423f283c"`,
    );
    await queryRunner.query(`DROP TABLE "shops"`);
    await queryRunner.query(
      `DROP TYPE "public"."shops_initialization_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."shops_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2458d1a8d035dab53b634fdf9c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b34ae4b1f6c449400c43cb509b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97c2fd294495edaafb658694ef"`,
    );
    await queryRunner.query(`DROP TABLE "supplier_records"`);
    await queryRunner.query(
      `DROP TYPE "public"."supplier_records_source_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cc042da525db36aff83517bc3f"`,
    );
    await queryRunner.query(`DROP TABLE "suppliers"`);
    await queryRunner.query(`DROP TYPE "public"."suppliers_status_enum"`);
  }
}
