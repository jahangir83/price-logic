# Phase 2: Database Schema & Domain Model

Status: Complete
Completed: 2026-08-08
Amended: 2026-08-09
Source: plans/07-database.md #2-45; plans/03-domain-model.md #2-32

> **Amendment (2026-08-09)** — the `pricing_rules.scope_type` / `scope_reference`
> pair specified below was replaced by an include/exclude target set:
> `pricing_rules.include_mode` (`ALL_PRODUCTS`/`SPECIFIC`) plus
> `exclude_draft_and_archived`, `exclusions_enabled`, and a new
> `pricing_rule_targets` table (`mode` INCLUDE/EXCLUDE ×
> `target_type` PRODUCT/COLLECTION/VARIANT/TAG/VENDOR/PRODUCT_TYPE).
> Reason: the single-scope pair cannot express "all products except these",
> multiple include targets, or tag/vendor/product-type targeting, all of
> which the merchant-facing rule and campaign editors require. Migration:
> `1786293135414-AddPricingRuleIncludeExcludeTargets.ts`. The old `SHOP`
> scope maps to `include_mode = ALL_PRODUCTS`.

## Tasks

- [x] **Establish ID, money, and currency conventions** — Adopt generated unique internal IDs (UUID recommended) for every entity's primary key, never a Shopify ID as a primary key; store external Shopify identifiers in a separate field (e.g. `shopify_product_id`); store all money values as exact decimal types (e.g. `NUMERIC(19,4)`, never floating-point); add an explicit `currency` field wherever money is recorded rather than assuming USD (db #4-6). Done when these conventions are documented/enforced as the baseline every table below follows. Depends on the `shops` table already established in Phase 1.

- [x] **Create the `products` table** — Fields: `shop_id`, `shopify_product_id`, `title`, `status`, `vendor`, `product_type`, `handle`, `created_at`, `updated_at`, `synced_at`. Add `UNIQUE(shop_id, shopify_product_id)` so the same Shopify product can't be duplicated within one shop (db #10-11).

- [x] **Create the `variants` table** — Fields: `shop_id`, `product_id`, `shopify_variant_id`, `sku`, `barcode`, `price`, `compare_at_price`, `currency`, `inventory_quantity`, `status`, `created_at`, `updated_at`, `synced_at`. Add `UNIQUE(shop_id, shopify_variant_id)`; do not assume global SKU uniqueness. Add indexes on `(shop_id, sku)`, `(shop_id, product_id)`, `(shop_id, status)`, `(shop_id, shopify_variant_id)` to support product search and supplier matching (db #12-14).

- [x] **Create the `suppliers` table** — Fields: `shop_id`, `name`, `code`, `status` (`ACTIVE`/`INACTIVE`), `created_at`, `updated_at` (db #15).

- [x] **Create the `supplier_records` table** — Fields: `shop_id`, `supplier_id`, `sku`, `external_product_id`, `cost`, `currency`, `available_quantity`, `source`, `source_reference`, `recorded_at`, `created_at`, `updated_at`. Do not overwrite historical supplier cost data without a record — MVP may retain current supplier data plus import history (a dedicated `supplier_cost_history` table is future scope, not MVP) (db #16-17).

- [x] **Create the `imports` and `import_records` tables** — `imports` fields: `shop_id`, `supplier_id`, `file_name`, `file_type`, `status` (`PENDING`/`PROCESSING`/`COMPLETED`/`FAILED`/`CANCELLED`), `total_rows`, `valid_rows`, `invalid_rows`, `matched_rows`, `unmatched_rows`, `created_at`, `completed_at`. `import_records` fields: `import_id`, `shop_id`, `row_number`, `raw_data` (JSON/JSONB), `sku`, `cost`, `currency`, `matched_variant_id`, `status` (`VALID`/`INVALID`/`MATCHED`/`UNMATCHED`/`APPLIED`/`SKIPPED`/`FAILED`), `error_code`, `error_message`, `created_at`, `updated_at` (db #18-20).

- [x] **Create the `pricing_rules` table** — Fields: `shop_id`, `name`, `rule_type` (`PERCENTAGE_MARKUP`/`FIXED_MARKUP`/`TARGET_MARGIN`/`PERCENTAGE_INCREASE`/`PERCENTAGE_DECREASE`/`FIXED_INCREASE`/`FIXED_DECREASE`), `value`, `currency`, ~~`scope_type` (`SHOP`/`COLLECTION`/`PRODUCT`/`VARIANT`), `scope_reference`~~ (superseded — see amendment above), `minimum_price`, `maximum_price`, `minimum_margin`, `status`, `created_at`, `updated_at`. The application layer (not the database) must interpret `value` according to `rule_type` (db #21-24).

- [x] **Create the `pricing_operations` table** — Fields: `shop_id`, `name`, `operation_type` (`MANUAL_PRICE_CHANGE`/`RULE_EXECUTION`/`SUPPLIER_REPRICING`/`CAMPAIGN_START`/`CAMPAIGN_END`/`ROLLBACK`/`SCHEDULED_OPERATION`), `status`, `source`, `pricing_rule_id`, `scheduled_at`, `started_at`, `completed_at`, `total_variants`, `successful_variants`, `failed_variants`, `skipped_variants`, `created_by`, `created_at`, `updated_at`. Status must follow the lifecycle `DRAFT → PREVIEW → APPROVED → QUEUED → PROCESSING → COMPLETED`, with `FAILED`/`CANCELLED` as terminal states, and the application must enforce valid transitions (db #25-27).

- [x] **Create the `price_changes` table** — Fields: `shop_id`, `operation_id`, `variant_id`, `previous_price`, `proposed_price`, `final_price`, `previous_cost`, `current_cost`, `previous_margin`, `projected_margin`, `status` (`PENDING`/`READY`/`SKIPPED`/`SUCCESS`/`FAILED`/`CONFLICT`), `error_code`, `error_message`, `created_at`, `updated_at` — represents the effect of one Pricing Operation on one variant (db #28-29).

- [x] **Create the `price_history` table** — Fields: `shop_id`, `variant_id`, `operation_id`, `previous_price`, `new_price`, `currency`, `source`, `changed_at`. Must be treated as append-only: a variant's successive price changes (e.g. $100→$120, then $120→$135) each produce a new row; existing rows are never updated to reflect current price (db #30-31).

- [x] **Create the `campaigns` table** — Fields: `shop_id`, `name`, `status` (`DRAFT`/`SCHEDULED`/`ACTIVE`/`COMPLETED`/`CANCELLED`/`FAILED`), `pricing_rule_id`, `start_at`, `end_at`, `created_at`, `updated_at`. MVP may reuse the pricing rule scope model for targeting rather than a dedicated campaign-target table (db #32-33).

- [x] **Create the `schedules` table** — Fields: `shop_id`, `operation_id`, `scheduled_at`, `timezone`, `status` (`SCHEDULED`/`PROCESSING`/`COMPLETED`/`FAILED`/`CANCELLED`), `executed_at`, `created_at`, `updated_at` (db #34).

- [x] **Create the `audit_logs` table** — Fields: `shop_id`, `actor_type`, `actor_id`, `action`, `entity_type`, `entity_id`, `metadata`, `created_at`. Append-only. Must be able to record at minimum: `SHOP_CONNECTED`, `RULE_CREATED`, `RULE_UPDATED`, `RULE_DELETED`, `OPERATION_CREATED`, `OPERATION_APPROVED`, `OPERATION_STARTED`, `OPERATION_COMPLETED`, `OPERATION_FAILED`, `PRICE_UPDATED`, `ROLLBACK_EXECUTED`, `IMPORT_STARTED`, `IMPORT_COMPLETED`, `CAMPAIGN_STARTED`, `CAMPAIGN_COMPLETED` (db #35-36).

- [x] **Enforce tenant/ownership consistency across all foreign keys** — Every tenant-owned relationship (e.g. `price_changes.shop_id` + `price_changes.variant_id`, and equivalents across products, variants, pricing rules, operations, campaigns, imports) must be constrained so a record can never reference another shop's data — a Price Change belonging to Shop A must never reference a Variant belonging to Shop B. Reflects the domain invariants: Variant belongs to Product, Product belongs to Shop, Pricing Rule/Operation/Campaign belong to Shop, Price Change references an Operation and a Variant, Supplier Record belongs to its Supplier/Import context (db #38; domain-model #29, #32).

- [x] **Apply soft-deletion policy for historically-referenced entities** — Add a `deleted_at` field (or equivalent) to Products, Variants, Pricing Rules, Suppliers, and Campaigns so historical records (price history, operations, audit logs) remain traceable even after the source entity is removed/unavailable in Shopify (db #39).

- [x] **Add concurrency and idempotency support for pricing execution** — Design the schema so concurrent operations touching the same variant (e.g. two operations both targeting the same variant) don't blindly overwrite each other — via locking, version checking, or conflict detection — and add an `idempotency_key` (or equivalent) on operation-level writes so retries can't apply the same logical operation twice (db #41-42).

- [x] **Finalize indexing strategy and migration process** — At minimum index `shop_id`, `shopify_product_id`, `shopify_variant_id`, `sku`, `operation_id`, `variant_id`, `status`, `created_at`, `scheduled_at` across the tables above, adding composite indexes based on real query patterns rather than indexing every column. Set up version-controlled, reproducible, production-safe migrations (reversible where practical) as the only sanctioned way to change schema (db #44, #49).
