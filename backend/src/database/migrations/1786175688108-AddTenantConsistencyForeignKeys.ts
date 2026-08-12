import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enforces the tenant/ownership invariants from domain-model #32 and
 * db #38 at the database level, not just in TenantScopedRepository: a
 * child row's `shop_id` must match its parent's `shop_id`, so e.g. a
 * PriceChange belonging to Shop A can never reference a Variant belonging
 * to Shop B — Postgres rejects the insert/update outright.
 *
 * Technique: each referenced parent gets a `UNIQUE(shop_id, id)` (in
 * addition to its `id` primary key), which lets the child declare a
 * composite foreign key on `(shop_id, parent_id)`. If the child's shop_id
 * doesn't match the parent row's shop_id, no matching unique tuple exists
 * and the foreign key fails.
 *
 * Root-level tables (no shop-scoped parent other than the shop itself) get
 * a direct `shop_id -> shops(id)` foreign key instead. Tables reached only
 * through a composite FK don't need a redundant direct one — their shop_id
 * is already transitively validated through the parent chain.
 *
 * ON DELETE RESTRICT everywhere: this app never hard-deletes shop-owned
 * data outside the soft-deletion pattern (deleted_at) — a cascading delete
 * here would silently destroy pricing/audit history.
 */
export class AddTenantConsistencyForeignKeys1786175688108 implements MigrationInterface {
  name = 'AddTenantConsistencyForeignKeys1786175688108';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite unique targets for shop-scoped foreign keys.
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "UQ_products_shop_id" UNIQUE ("shop_id", "id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "variants" ADD CONSTRAINT "UQ_variants_shop_id" UNIQUE ("shop_id", "id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "suppliers" ADD CONSTRAINT "UQ_suppliers_shop_id" UNIQUE ("shop_id", "id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "imports" ADD CONSTRAINT "UQ_imports_shop_id" UNIQUE ("shop_id", "id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_rules" ADD CONSTRAINT "UQ_pricing_rules_shop_id" UNIQUE ("shop_id", "id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_operations" ADD CONSTRAINT "UQ_pricing_operations_shop_id" UNIQUE ("shop_id", "id")`,
    );

    // Root-level tables: shop_id must reference an existing shop directly.
    for (const table of [
      'products',
      'suppliers',
      'pricing_rules',
      'pricing_operations',
      'campaigns',
      'audit_logs',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_shop" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT`,
      );
    }

    // Composite tenant-consistent foreign keys: child (shop_id, parent_id)
    // -> parent (shop_id, id).
    await queryRunner.query(
      `ALTER TABLE "variants" ADD CONSTRAINT "FK_variants_product_shop" FOREIGN KEY ("shop_id", "product_id") REFERENCES "products"("shop_id", "id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "imports" ADD CONSTRAINT "FK_imports_supplier_shop" FOREIGN KEY ("shop_id", "supplier_id") REFERENCES "suppliers"("shop_id", "id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_records" ADD CONSTRAINT "FK_supplier_records_supplier_shop" FOREIGN KEY ("shop_id", "supplier_id") REFERENCES "suppliers"("shop_id", "id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "import_records" ADD CONSTRAINT "FK_import_records_import_shop" FOREIGN KEY ("shop_id", "import_id") REFERENCES "imports"("shop_id", "id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_changes" ADD CONSTRAINT "FK_price_changes_operation_shop" FOREIGN KEY ("shop_id", "operation_id") REFERENCES "pricing_operations"("shop_id", "id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_changes" ADD CONSTRAINT "FK_price_changes_variant_shop" FOREIGN KEY ("shop_id", "variant_id") REFERENCES "variants"("shop_id", "id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_history" ADD CONSTRAINT "FK_price_history_operation_shop" FOREIGN KEY ("shop_id", "operation_id") REFERENCES "pricing_operations"("shop_id", "id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_history" ADD CONSTRAINT "FK_price_history_variant_shop" FOREIGN KEY ("shop_id", "variant_id") REFERENCES "variants"("shop_id", "id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "schedules" ADD CONSTRAINT "FK_schedules_operation_shop" FOREIGN KEY ("shop_id", "operation_id") REFERENCES "pricing_operations"("shop_id", "id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD CONSTRAINT "FK_campaigns_pricing_rule_shop" FOREIGN KEY ("shop_id", "pricing_rule_id") REFERENCES "pricing_rules"("shop_id", "id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_operations" ADD CONSTRAINT "FK_pricing_operations_pricing_rule_shop" FOREIGN KEY ("shop_id", "pricing_rule_id") REFERENCES "pricing_rules"("shop_id", "id") ON DELETE RESTRICT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pricing_operations" DROP CONSTRAINT "FK_pricing_operations_pricing_rule_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP CONSTRAINT "FK_campaigns_pricing_rule_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "schedules" DROP CONSTRAINT "FK_schedules_operation_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_history" DROP CONSTRAINT "FK_price_history_variant_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_history" DROP CONSTRAINT "FK_price_history_operation_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_changes" DROP CONSTRAINT "FK_price_changes_variant_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_changes" DROP CONSTRAINT "FK_price_changes_operation_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "import_records" DROP CONSTRAINT "FK_import_records_import_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_records" DROP CONSTRAINT "FK_supplier_records_supplier_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "imports" DROP CONSTRAINT "FK_imports_supplier_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "variants" DROP CONSTRAINT "FK_variants_product_shop"`,
    );

    for (const table of [
      'products',
      'suppliers',
      'pricing_rules',
      'pricing_operations',
      'campaigns',
      'audit_logs',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT "FK_${table}_shop"`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "pricing_operations" DROP CONSTRAINT "UQ_pricing_operations_shop_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pricing_rules" DROP CONSTRAINT "UQ_pricing_rules_shop_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "imports" DROP CONSTRAINT "UQ_imports_shop_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "suppliers" DROP CONSTRAINT "UQ_suppliers_shop_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "variants" DROP CONSTRAINT "UQ_variants_shop_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "UQ_products_shop_id"`,
    );
  }
}
