# Phase 5: Supplier Sheet Upload & Approval

Status: Complete
Completed: 2026-08-14
Source: plans/11-campaign-supplier-mvp.md — Phase 5

> Replaces `phase-08-supplier-csv-import.md`. The sheet carries final prices,
> not costs — there is no margin or markup calculation in this phase, only the
> campaign's own adjustment applied on top in Phase 4's pipeline.

## Tasks

- [x] **Build the suppliers module** — Controller, service and DTOs for create, read, update, soft-delete and list. Small: name, code, status. Soft delete only, because `csv_imports` references suppliers and history must stay readable.

- [x] **Build the file upload endpoint** — Accept a CSV or spreadsheet export against a supplier id, enforce a maximum file size and MIME type, and store the file outside the web root (or in object storage) rather than in the database. Create the `csv_imports` row in `UPLOADED`, return its id immediately, and parse asynchronously so a large file does not block the request.

- [x] **Implement the CSV parser** — Stream the file into `csv_rows`, one row per line, storing the full original row in `raw_data jsonb` for debugging and merchant support. Detect the header row, map columns to `sku`, `sheet_price` and optional compare-at. Handle BOM, quoted fields, CRLF, and a trailing empty line. Update the import status to `PARSING` then `READY`.

- [x] **Validate rows individually, never fail the whole file** — A missing SKU, an unparseable price, a negative price or a zero price marks that row `INVALID` with a specific `error_message`. Every other row continues. Update `valid_rows` and `invalid_rows` on the import as the parse proceeds.

- [x] **Handle duplicate SKUs within one file** — Two rows with the same SKU is a real and common case. Decide and implement: recommend flagging both rows `INVALID` with a "duplicate SKU" message rather than silently letting the last one win, since a supplier sheet with duplicates usually means the merchant exported the wrong thing.

- [x] **Match SKUs to Shopify variants** — Use the Phase 2 SKU lookup to resolve each valid row to `shopify_variant_id` and `shopify_product_id`, and fill `current_price` from the same call. Mark matched rows `MATCHED` and unmatched ones `UNMATCHED` with a clear reason. A SKU that resolves to more than one variant is ambiguous — flag it rather than guessing. Update `matched_rows` on the import.

- [x] **Build the approval form API** — Paginated list of rows for an import showing SKU, product title, `current_price`, `sheet_price` and `approved_price`, filterable by status so the merchant can review unmatched and invalid rows separately. Plus an endpoint to edit `approved_price` on a single row, and one to exclude a row from the campaign.

- [x] **Compute `approved_price` on parse, and recompute on edit** — Pre-fill each row's `approved_price` by running the Phase 4 pipeline over `sheet_price` with the campaign's adjustment and rounding. When a merchant edits it, store their value verbatim — but validate server-side that it is a positive decimal within `numeric(19,4)`, since the constitution forbids trusting a client-supplied price.

- [x] **Build the approval form UI** — Polaris table with the three price columns side by side, the last one editable inline, a filter for unmatched and invalid rows, per-row error messages, and a summary bar showing counts. This is the screen the whole phase exists for.

- [x] **Implement approve → create campaign in the background** — On approval, set the import to `APPROVED` and create a campaign with `price_source = SHEET` and `csv_import_id` pointing at it, in a background job. The campaign then owns everything downstream. Make the job idempotent — approving twice must not create two campaigns.

- [x] **Write integration tests over the full import path** — Upload a fixture file containing valid rows, an unparseable price, a missing SKU, a duplicate SKU and an unmatched SKU, and assert each lands in the right status with the right message and that the import counters add up.

## Decisions taken

**A duplicate SKU flags both rows, not the last one.** A supplier sheet with
duplicates usually means the merchant exported the wrong thing — two price
lists concatenated, or a per-warehouse breakdown. Letting the last row win
applies a real, wrong price to a live storefront with nothing to notice.

**Parsing and matching are separate jobs.** Parsing is local and fast; matching
calls Shopify and can be throttled for minutes. Splitting them means a rate
limit never forces a re-parse, and rows appear for review before matching
finishes. Parse spawns match as a child job, which is the first real use of
J2's child-job support.

**The parser refuses to guess European decimal conventions.** `1.234,56` could
be 1234.56 or 1.23456 depending on locale, and guessing wrong reprices a
catalogue by a factor of a hundred. It strips currency symbols and thousands
separators and rejects anything still ambiguous.

**A merchant's edited price is stored verbatim — after validation.** "Verbatim"
means "as typed", not "unchecked": the server confirms it is a positive decimal
inside `numeric(19,4)` before storing, per the constitution's rule against
trusting client prices.

## Verification

| Check | Result |
| --- | --- |
| backend: `tsc --noEmit` / `nest build` | pass |
| backend: eslint (103 files) | 0 errors, 0 warnings |
| backend: unit tests | 216 passed, 14 suites (37 new) |
| backend: integration tests | 118 passed, 6 suites (22 new) |
| frontend: eslint / `tsc -b` / `vite build` | 0 errors · pass · pass |

The fixture contains one of everything that goes wrong, and each lands
correctly:

- a clean row → VALID, then MATCHED with `current_price` filled
- an unparseable price → INVALID, "not a price we can read"
- a missing SKU → INVALID, "This row has no SKU"
- the same SKU twice → **both** rows INVALID, "appears 2 times"
- a SKU no product has → UNMATCHED, "No product in this store has that SKU"
- a SKU two products share → UNMATCHED, "2 products share that SKU" — flagged,
  never guessed
- the counters on the import add up in every case

Plus: a non-CSV upload and an oversized file are refused; a file with no SKU
column fails as a whole rather than producing thousands of identical row
errors; re-parsing replaces rows instead of duplicating them; approving twice
returns the same campaign; and approving with nothing matched is refused.

Parser edge cases covered: BOM, CRLF, quoted commas, doubled quotes, embedded
newlines, trailing blank lines, currency symbols and thousands separators.

## Notes for the next phase

- **`approved_price` is pre-filled from the sheet price alone at match time**,
  because the campaign does not exist yet — approval is what creates it.
  `computeApprovedPrice` already runs the full pipeline when a campaign *is*
  present, so Phase 6 recomputing with the campaign's adjustment is the same
  code path.
- The campaign created by approval is a DRAFT. Activating it is a separate,
  explicit action, exactly as with a hand-built campaign.
- Files are written to `UPLOADS_DIR` (default `../uploads`), namespaced by
  shop. Object storage would be a drop-in replacement for `storeFile`/`pathFor`
  and nothing else.
- Still unverified against a real Shopify store: SKU matching goes through the
  Phase 2 adapter, which has never spoken to Shopify.
