# PriceLogic MVP — Campaign & Supplier Sheet Redesign

> Plan created interactively via /speclet-plan on 2026-08-12.
>
> **This supersedes `07-database.md` §7–48 and narrows `03-domain-model.md`.**
> Those documents describe a 17-table schema that mirrors the Shopify catalog
> and models suppliers, costs, margins, pricing rules and pricing operations as
> separate concerns. This plan replaces that with an 8-table schema built around
> a single container — the campaign. The older documents should be revised or
> marked superseded before implementation starts.

---

## Why this redesign

Phases 1–2 are complete: the Shopify app shell, tenant foundation and the
17-table schema exist. Phases 3–14 are `Not Started`, so no application logic
depends on that schema yet. Changing it now costs one migration; changing it
after phase 6 would cost a rewrite. That is the reason for doing this first.

## Decisions taken

1. **Shopify is the source of truth.** We never mirror the catalog. No
   `products`, `variants` or `collections` tables. Shopify ids are stored as
   plain strings on the rows that need them, and the UI fetches products live.
2. **Everything is a campaign.** A supplier sheet upload does not create its
   own kind of record — once approved it produces a campaign. Every price
   change belongs to exactly one campaign, so `price_changes.campaign_id` is
   `NOT NULL` and revert has a single code path.
3. **Base price and adjustment are independent.** There is no `campaign_type`
   enum. A campaign says where the base price comes from (`SHOPIFY_CURRENT` or
   `SHEET`) and, separately, what to do to it (increase, decrease, or nothing).
   Four behaviours fall out of two fields, including "supplier's price plus my
   markup".
4. **Sheets carry final prices, not costs.** No cost, margin, markup rules or
   minimum-margin protection in this MVP. A supplier's sheet states a price;
   an optional campaign adjustment sits on top of it.
5. **`price_changes` rows are only written when we are about to change a
   price.** Previews are not stored — for a sheet campaign the staged values
   live in `csv_rows`; for a formula campaign the preview is computed live and
   discarded. Every row in `price_changes` is real.
6. **Revert reads one row and writes it back.** `old_price` and
   `old_compare_at_price` are stored on the change row, so restoring a product
   that was already on sale works without joining anything.
7. **Tenancy is preserved exactly as built.** Every table carries `shop_id`,
   every parent carries `UNIQUE (shop_id, id)`, and every child foreign key
   names both columns so a cross-shop reference cannot be represented.
8. **All money is `numeric(19,4)`.** Never float, at any layer.

## Target schema — 8 tables

```
shops                 already built, unchanged

suppliers             id, shop_id, name, code, status, timestamps, deleted_at

campaigns             id, shop_id, title, status
                      price_source          SHOPIFY_CURRENT | SHEET
                      csv_import_id         set when price_source = SHEET
                      adjustment_unit       PERCENTAGE | FIXED_AMOUNT | null
                      adjustment_direction  INCREASE | DECREASE
                      adjustment_value      numeric(19,4)
                      basis                 PRICE | COMPARE_AT_PRICE
                      round_to              numeric(19,4) null
                      set_compare_at        boolean
                      include_mode          ALL_PRODUCTS | SPECIFIC
                      exclude_draft_archived, exclusions_enabled
                      add_tags[], remove_tags[]
                      start_at, start_timezone, end_at, end_timezone
                      timestamps, deleted_at

campaign_targets      id, shop_id, campaign_id
                      mode          INCLUDE | EXCLUDE
                      target_type   PRODUCT | COLLECTION | TAG | VENDOR | PRODUCT_TYPE
                      target_value  varchar
                      UNIQUE (campaign_id, mode, target_type, target_value)

price_changes         id, shop_id, campaign_id
                      shopify_product_id, shopify_variant_id
                      product_title, variant_title      cached for the results screen
                      old_price, old_compare_at_price   what to restore
                      new_price, new_compare_at_price   what we set
                      status  PENDING | APPLIED | FAILED | REVERTED | SKIPPED
                      error_message, applied_at, reverted_at
                      UNIQUE (campaign_id, shopify_variant_id)

product_tag_changes   id, shop_id, campaign_id, shopify_product_id
                      old_tags[], new_tags[]
                      status, error_message, applied_at, reverted_at
                      UNIQUE (campaign_id, shopify_product_id)

csv_imports           id, shop_id, supplier_id, file_name, status
                      total_rows, valid_rows, invalid_rows, matched_rows
                      created_at, completed_at

csv_rows              id, shop_id, csv_import_id, row_number, raw_data jsonb
                      sku
                      sheet_price       what the supplier sent
                      current_price     fetched from Shopify, for comparison
                      approved_price     after adjustment + rounding; merchant editable
                      shopify_product_id, shopify_variant_id
                      status, error_message
```

## The calculation pipeline

Every campaign, both sources, runs the same steps:

```
base price      sheet_price   or   current Shopify price
    ↓
adjustment      optional — increase or decrease, percentage or fixed
    ↓
rounding        optional — nearest .99 etc.
    ↓
merchant edit   optional, on the approval form
    ↓
new_price       written to price_changes at activation
```

## Tables dropped from the built schema

`products`, `variants`, `suppliers` *(rebuilt smaller)*, `supplier_records`,
`imports`, `import_records`, `pricing_rules`, `pricing_rule_targets`,
`pricing_operations`, `price_history`, `schedules`, `campaign_tag_rules`,
`campaign_tag_applications`.

`price_history` is redundant because `price_changes` rows are never deleted —
they already form the historical timeline. `audit_logs` is **not** in the
8-table list; it is cheap and independent, and can be kept or dropped without
affecting anything else here. Decision pending.

---

## Phase 1: Schema Re-baseline

Replace the 17-table schema with the 8 tables above in a single migration.
Preserve the tenancy pattern exactly as built — `shop_id` on every table,
`UNIQUE (shop_id, id)` on every parent, composite foreign keys on every child —
and keep `numeric(19,4)` for all money. Rewrite the TypeORM entities to match
and delete the modules whose tables no longer exist. Assumes no production
data, so this can squash to a fresh baseline rather than a reversible
transformation; confirm before running.

## Phase 2: Live Shopify Catalog Access

Build the read layer the UI needs now that nothing is mirrored locally: search
products, browse collections, list tags, vendors and product types, and fetch
current prices for a set of variants. This replaces the old product/variant
synchronisation phase entirely. Needs pagination, rate-limit handling and a
short-lived cache so the campaign builder stays responsive without storing
catalog data.

## Phase 3: Campaign Builder & Targeting

Create, edit and delete campaigns with their adjustment settings, rounding,
compare-at behaviour, tag changes and schedule. Implement include/exclude
targeting against `campaign_targets` with the resolution rule that exclusions
always win, plus the blanket draft/archived exclusion. The builder mirrors the
reference screens: all-products or specific, three picker types on each side.

## Phase 4: Price Calculation & Preview

Implement the pipeline — base price, adjustment, rounding — as a pure,
unit-testable function, and the target resolution that turns include/exclude
rows into a concrete variant list via the Shopify read layer. Render the
preview screen showing current price against new price. Nothing is persisted
here; this phase's output is a calculation the merchant looks at.

## Phase 5: Supplier Sheet Upload & Approval

Suppliers, file upload, parsing into `csv_rows`, SKU matching against Shopify,
and the approval form showing current price, sheet price and resulting price
per row with the last column editable. Handles malformed rows, unmatched SKUs
and duplicate SKUs as visible per-row states rather than failing the whole
file. Approval creates the campaign in the background.

## Phase 6: Activation — Applying Changes to Shopify

Write `price_changes` and `product_tag_changes` rows, then push to Shopify in
batches. The Shopify write sits outside the database transaction, so this phase
owns partial-failure handling: per-row status, retry that cannot double-apply,
and a campaign that reports honestly when some variants failed. Progress must
be visible while it runs.

## Phase 7: Deactivation, Revert & Scheduling

Restore `old_price` and `old_compare_at_price` from the change rows, restore
tags from `product_tag_changes`, and mark rows reverted. Build the scheduler
that activates campaigns at `start_at` and deactivates at `end_at`, honouring
the stored timezone so "9am local" survives DST. Manual early deactivation uses
the same path as the scheduled one.

## Phase 8: Dashboard, Hardening & Launch Readiness

Campaign list with live status, per-campaign results including failures, and
the history of what a campaign changed. Then the launch work: Shopify webhook
handling for uninstall, rate-limit resilience, permission checks on every
tenant-scoped query, and end-to-end tests covering the activate → fail →
revert paths.
