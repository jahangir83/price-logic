# Phase 5: Supplier Sheet Upload & Approval

Status: Not Started
Source: plans/11-campaign-supplier-mvp.md — Phase 5

> Replaces `phase-08-supplier-csv-import.md`. The sheet carries final prices,
> not costs — there is no margin or markup calculation in this phase, only the
> campaign's own adjustment applied on top in Phase 4's pipeline.

## Tasks

- [ ] **Build the suppliers module** — Controller, service and DTOs for create, read, update, soft-delete and list. Small: name, code, status. Soft delete only, because `csv_imports` references suppliers and history must stay readable.

- [ ] **Build the file upload endpoint** — Accept a CSV or spreadsheet export against a supplier id, enforce a maximum file size and MIME type, and store the file outside the web root (or in object storage) rather than in the database. Create the `csv_imports` row in `UPLOADED`, return its id immediately, and parse asynchronously so a large file does not block the request.

- [ ] **Implement the CSV parser** — Stream the file into `csv_rows`, one row per line, storing the full original row in `raw_data jsonb` for debugging and merchant support. Detect the header row, map columns to `sku`, `sheet_price` and optional compare-at. Handle BOM, quoted fields, CRLF, and a trailing empty line. Update the import status to `PARSING` then `READY`.

- [ ] **Validate rows individually, never fail the whole file** — A missing SKU, an unparseable price, a negative price or a zero price marks that row `INVALID` with a specific `error_message`. Every other row continues. Update `valid_rows` and `invalid_rows` on the import as the parse proceeds.

- [ ] **Handle duplicate SKUs within one file** — Two rows with the same SKU is a real and common case. Decide and implement: recommend flagging both rows `INVALID` with a "duplicate SKU" message rather than silently letting the last one win, since a supplier sheet with duplicates usually means the merchant exported the wrong thing.

- [ ] **Match SKUs to Shopify variants** — Use the Phase 2 SKU lookup to resolve each valid row to `shopify_variant_id` and `shopify_product_id`, and fill `current_price` from the same call. Mark matched rows `MATCHED` and unmatched ones `UNMATCHED` with a clear reason. A SKU that resolves to more than one variant is ambiguous — flag it rather than guessing. Update `matched_rows` on the import.

- [ ] **Build the approval form API** — Paginated list of rows for an import showing SKU, product title, `current_price`, `sheet_price` and `approved_price`, filterable by status so the merchant can review unmatched and invalid rows separately. Plus an endpoint to edit `approved_price` on a single row, and one to exclude a row from the campaign.

- [ ] **Compute `approved_price` on parse, and recompute on edit** — Pre-fill each row's `approved_price` by running the Phase 4 pipeline over `sheet_price` with the campaign's adjustment and rounding. When a merchant edits it, store their value verbatim — but validate server-side that it is a positive decimal within `numeric(19,4)`, since the constitution forbids trusting a client-supplied price.

- [ ] **Build the approval form UI** — Polaris table with the three price columns side by side, the last one editable inline, a filter for unmatched and invalid rows, per-row error messages, and a summary bar showing counts. This is the screen the whole phase exists for.

- [ ] **Implement approve → create campaign in the background** — On approval, set the import to `APPROVED` and create a campaign with `price_source = SHEET` and `csv_import_id` pointing at it, in a background job. The campaign then owns everything downstream. Make the job idempotent — approving twice must not create two campaigns.

- [ ] **Write integration tests over the full import path** — Upload a fixture file containing valid rows, an unparseable price, a missing SKU, a duplicate SKU and an unmatched SKU, and assert each lands in the right status with the right message and that the import counters add up.
