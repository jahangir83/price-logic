# Phase 8: Supplier CSV Import

Status: Not Started
Source: plans/02-business.md #8-10; plans/03-domain-model.md #8-10,24-25; plans/04-user-flows.md #21-25; plans/06-product-requirements.md #30-33; plans/07-database.md #15-20; plans/10-security.md #23-26

## Tasks

- [ ] **Define the `suppliers` entity** — Persist `shop_id`, `name`, `code`, `status` (`ACTIVE`/`INACTIVE`), `created_at`, `updated_at`, tenant-scoped to the shop (db #15, domain-model #8). Done when a shop can have one or more named suppliers to import against.

- [ ] **Define the `supplier_records` entity** — Persist `shop_id`, `supplier_id`, `sku`, `external_product_id`, `cost`, `currency`, `available_quantity`, `source`, `source_reference`, `recorded_at`, `created_at`, `updated_at` (db #16). Treat each record strictly as an input to pricing, never as an automatic Shopify price change (domain-model #9). Done when accepted supplier data is stored per-SKU with enough context to trace where it came from.

- [ ] **Define the `imports` entity** — Persist `shop_id`, `supplier_id`, `file_name`, `file_type`, `status` (`PENDING`/`PROCESSING`/`COMPLETED`/`FAILED`/`CANCELLED`), `total_rows`, `valid_rows`, `invalid_rows`, `matched_rows`, `unmatched_rows`, `created_at`, `completed_at` (db #18). Done when every CSV upload creates one Import record tracking its overall progress and counts.

- [ ] **Define the `import_records` entity** — Persist `import_id`, `shop_id`, `row_number`, `raw_data` (JSON, for debugging/audit), `sku`, `cost`, `currency`, `matched_variant_id`, `status` (`VALID`/`INVALID`/`MATCHED`/`UNMATCHED`/`APPLIED`/`SKIPPED`/`FAILED`), `error_code`, `error_message`, `created_at`, `updated_at` (db #19-20). Done when every row of an uploaded CSV maps to exactly one import_record with a clear, inspectable outcome.

- [ ] **Implement secure CSV upload** — Validate file type, enforce a maximum file size, enforce a maximum row count, validate file encoding, and reject malformed files outright; never execute uploaded file content in any way (security #23). Store the uploaded file safely and create the Import record before any row processing begins (user-flows #22, PR #30). Done when an oversized, wrong-type, or malformed upload is rejected with a clear reason before an Import is even created.

- [ ] **Implement asynchronous import processing** — Follow the pipeline Upload → Validate → Store Safely → Create Import → Queue Job → Process → Delete Temporary File; large imports must not block the upload request, and temporary files must not persist indefinitely after processing completes (security #26). Done when uploading a large CSV returns immediately with a trackable Import while rows are processed in the background.

- [ ] **Implement column detection and merchant column mapping** — Detect the uploaded CSV's header row and let the merchant map arbitrary supplier column names (e.g. "Product Code", "Unit Cost") to PriceLogic fields (SKU, Cost, currency, etc.) before rows are parsed into import_records (user-flows #23, PR #31). Done when two CSVs with differently named columns for the same data can both be imported correctly via mapping.

- [ ] **Implement CSV row validation** — For each mapped row, validate: required columns present, SKU not empty, cost not empty, cost is numeric/finite, cost is not negative, no duplicate SKU within the file, and overall file format validity; mark each row `VALID` or `INVALID` with a specific `error_code`/`error_message`, and never apply an invalid row (user-flows #24, PR #32, security #25). Done when a CSV with mixed valid/invalid rows produces a per-row status and an accurate valid/invalid count on the Import.

- [ ] **Implement CSV formula-injection protection** — Treat every imported cell value as inert data, never as an executable spreadsheet formula; neutralize dangerous formula-prefix characters (`=`, `+`, `-`, `@`, etc.) if supplier values are ever re-exported or rendered into spreadsheet-compatible output (security #24). Done when a crafted CSV cell containing a formula prefix cannot execute anything when opened downstream.

- [ ] **Implement supplier-to-variant matching** — For each `VALID` row, match against the shop's variants using the merchant's configured identifier — SKU primary, with barcode, supplier-SKU-to-Shopify-SKU mapping, or merchant-defined mapping as configurable alternatives (business #9, domain-model #10, PR #33). Set the row's status to `MATCHED` (storing `matched_variant_id`) or `UNMATCHED`. Done when every valid row ends the matching step as clearly matched or unmatched, scoped to the correct shop.

- [ ] **Enforce isolation of unmatched records** — Guarantee that an `UNMATCHED` import_record can never update any Shopify variant and is excluded from any downstream pricing/execution path (business #9, domain-model #10, user-flows #25). Done when an unmatched row is visibly reported to the merchant but has zero effect on any variant's price.

- [ ] **Persist accepted supplier data from matched rows** — For each `MATCHED` row, create or update the corresponding `supplier_records` entry (cost, currency, `recorded_at`, `source_reference`) tied to the supplier and shop — this becomes the latest accepted supplier cost that Phase 9's cost-change detection and repricing will read (business #8, domain-model #31 source-of-truth: "PriceLogic stores the latest accepted supplier data"). Done when a completed import leaves supplier_records up to date for every matched SKU.

- [ ] **Build the import summary report** — Show total rows, valid/invalid counts, matched/unmatched counts, and per-row status/error detail so the merchant can see exactly what happened to each supplier record (user-flows #24, PR #30). Done when a merchant can open a completed Import and understand its full outcome without inspecting raw data.
