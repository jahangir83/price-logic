# Phase 3: Product & Variant Synchronization

Status: Not Started
Source: plans/04-user-flows.md #6; plans/06-product-requirements.md #8-11; plans/03-domain-model.md #5-7

## Tasks

- [ ] **Build Shopify product fetch integration** — Retrieve a shop's products from the Shopify API (paginated as needed), capturing at minimum: Shopify product ID, title, status, vendor, product type, and variant references — only the data required for pricing operations, not a full mirror of Shopify's catalog (PR #8; domain-model #5).

- [ ] **Build Shopify variant fetch integration** — For each fetched product, retrieve its variants, capturing: Shopify variant ID, product relationship, SKU, barcode (where available), current price, compare-at price (where applicable), and relevant cost information (where available) (PR #9; domain-model #6-7).

- [ ] **Implement product upsert logic (no duplication)** — Create-or-update local `products` rows keyed on `shop_id` + `shopify_product_id`: existing products are updated in place, never duplicated, on repeat sync (PR #8 acceptance criteria).

- [ ] **Implement variant upsert logic (no duplication, history-safe)** — Create-or-update local `variants` rows keyed on `shop_id` + `shopify_variant_id`, keeping each variant correctly associated with its product and treating the Shopify variant ID as a stable identifier across syncs. Syncing the current Shopify price must not silently overwrite/erase internal pricing history records (PR #9 acceptance criteria).

- [ ] **Orchestrate the full sync pipeline** — Implement the end-to-end flow: Start Sync → Fetch Shopify Products → Fetch Variants → Store/Update Local Representation → Sync Complete, run as an async/trackable job so the merchant isn't blocked waiting on a large catalog (user-flows #6).

- [ ] **Track and expose sync status** — Persist and surface sync state per shop: overall status, number of products synced, number of variants synced, and any errors encountered, with per-record `synced_at` timestamps, so the merchant can see current sync status at any time (user-flows #6; PR #8 acceptance criteria).

- [ ] **Handle deleted/unavailable Shopify products and variants safely** — When a previously-synced product or variant is no longer returned by Shopify (deleted, archived, unavailable), mark it appropriately (e.g. soft-deleted/unavailable status) rather than silently dropping it or breaking references from pricing history and past operations (PR #8 acceptance criteria; ties to Phase 2 soft-deletion policy).

- [ ] **Make sync failures visible** — Surface partial or total sync failures (e.g. API errors, rate limits) to the merchant in a clear, actionable way rather than failing silently (PR #8 acceptance criteria).

- [ ] **Implement product/variant search** — Support searching by product title, SKU, and variant SKU as the minimum search fields (vendor, collection, and product type are future scope, not MVP) (PR #10).

- [ ] **Implement product/variant selection with affected-variant count** — Allow the merchant to select individual products, individual variants, multiple products, or a filtered result set as pricing targets, and always display the resulting number of affected variants (e.g. "42 products / 128 variants") (PR #11).
